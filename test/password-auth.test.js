'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPassword, parseHash, createVerifier, migrateUsers } = require('../lib/password-auth');
const { users } = require('./helpers/auth');
const client = address => ({ socket: { remoteAddress: address } });

describe('hashed Basic authentication', function() {
	this.timeout(10000);
	it('uses distinct salts and verifies Unicode and colons without retaining plaintext', async function() {
		const password = '日本語のパスワード:long-secret';
		const first = hashPassword(password), second = hashPassword(password);
		assert.notEqual(first, second);
		assert.ok(!first.includes(password));
		const verify = createVerifier([{ username: 'alice', passwordHash: first }]);
		assert.equal(await verify('alice', password), true);
		assert.equal(await verify('alice', 'wrong'), false);
		assert.equal(await verify('unknown', password), false);
		assert.equal(await verify('alice', ''), false);
		assert.equal(await verify('alice', 'x'.repeat(1025)), false);
	});
	it('rejects legacy, unset, duplicate and unsupported hashes at startup', function() {
		for (const entries of [['alice:secret'], [{ username: 'alice' }], [...users, ...users],
			[{ username: 'alice', passwordHash: users[0].passwordHash.replace('131072', '262144') }]]) {
			assert.throws(() => createVerifier(entries));
		}
		assert.throws(() => migrateUsers(['invalid']));
	});
	it('bounds per-source attempts and resets after a minute', async function() {
		let now = 0, calls = 0;
		const verify = createVerifier(users, { clock: () => now, derive: async () => { calls++; return Buffer.alloc(32); } });
		for (let i = 0; i < 10; i++) assert.equal(await verify('alice', 'wrong'), false);
		assert.equal(calls, 5);
		now = 60000;
		assert.equal(await verify('alice', 'wrong'), false);
		assert.equal(calls, 6);
	});
	it('limits concurrent KDFs and fails closed when a derivation errors', async function() {
		const complete = [];
		const verify = createVerifier(users, { derive: () => new Promise((resolve, reject) => complete.push({ resolve, reject })) });
		const a = verify('alice', 'wrong1', client('192.0.2.1')), b = verify('alice', 'wrong2', client('192.0.2.2'));
		assert.equal(await verify('alice', 'wrong3', client('192.0.2.3')), false);
		assert.equal(complete.length, 2);
		complete[0].reject(new Error('test')); complete[1].resolve(Buffer.alloc(32));
		assert.deepEqual(await Promise.all([a, b]), [false, false]);
	});
	it('shares an in-flight check for simultaneous requests with the same credentials', async function() {
		let finish, calls = 0;
		const verify = createVerifier(users, { derive: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
		const requests = Array.from({ length: 12 }, () => verify('alice', 'secret'));
		await Promise.resolve();
		assert.equal(calls, 1);
		finish(parseHash(users[0].passwordHash).key);
		assert.deepEqual(await Promise.all(requests), Array(12).fill(true));
	});
	it('does not let unknown usernames consume KDF capacity or block an uncached valid login', async function() {
		let calls = 0;
		const key = parseHash(users[0].passwordHash).key;
		const verify = createVerifier(users, { clock: () => 0, derive: async () => { calls++; return key; } });
		for (let i = 0; i < 1100; i++) assert.equal(await verify('user' + i, 'wrong'), false);
		assert.equal(calls, 0);
		assert.equal(await verify('alice', 'secret'), true);
		assert.equal(calls, 1);
	});
	it('limits a source across usernames without blocking another source using the same account', async function() {
		let calls = 0;
		const key = parseHash(users[0].passwordHash).key;
		const accounts = [...users, { username: 'bob', passwordHash: users[0].passwordHash }];
		const verify = createVerifier(accounts, { clock: () => 0, derive: async password => {
			calls++; return password === 'secret' ? key : Buffer.alloc(32);
		} });
		for (let i = 0; i < 30; i++) assert.equal(await verify(i % 2 ? 'alice' : 'bob', 'wrong', client('192.0.2.1')), false);
		assert.equal(calls, 5);
		assert.equal(await verify('alice', 'secret', client('192.0.2.2')), true);
		assert.equal(calls, 6);
	});
	it('keeps fresh valid logins available after repeated minute-by-minute guesses from another client', async function() {
		let now = 0, calls = 0;
		const key = parseHash(users[0].passwordHash).key;
		const verify = createVerifier(users, { clock: () => now, derive: async password => {
			calls++; return password === 'secret' ? key : Buffer.alloc(32);
		} });
		for (let minute = 0; minute < 3; minute++) {
			now = minute * 60000;
			for (let i = 0; i < 5; i++) assert.equal(await verify('alice', 'wrong', client('192.0.2.1')), false);
			assert.equal(await verify('alice', 'secret', client('192.0.2.2')), true);
		}
		assert.equal(calls, 18, 'the valid client must perform fresh KDFs after its cache expires');
	});
	it('reserves a worker for another source while one source has an in-flight check', async function() {
		const complete = [];
		const key = parseHash(users[0].passwordHash).key;
		const verify = createVerifier(users, { derive: () => new Promise(resolve => complete.push(resolve)) });
		const attacker = verify('alice', 'wrong1', client('192.0.2.1'));
		assert.equal(await verify('alice', 'wrong2', client('192.0.2.1')), false);
		const legitimate = verify('alice', 'secret', client('192.0.2.2'));
		await Promise.resolve();
		assert.equal(complete.length, 2);
		complete[0](Buffer.alloc(32)); complete[1](key);
		assert.deepEqual(await Promise.all([attacker, legitimate]), [false, true]);
	});
	it('bounds source-counter storage without rejecting all new clients', async function() {
		const key = parseHash(users[0].passwordHash).key;
		const verify = createVerifier(users, { clock: () => 0, derive: async password => password === 'secret' ? key : Buffer.alloc(32) });
		for (let i = 0; i < 1100; i++) {
			assert.equal(await verify('alice', 'wrong', client('198.18.' + Math.floor(i / 256) + '.' + (i % 256))), false);
		}
		assert.equal(await verify('alice', 'secret', client('192.0.2.2')), true);
	});
	it('caches only successful credentials for one minute and a fresh verifier revokes them', async function() {
		let now = 0, calls = 0;
		const key = parseHash(users[0].passwordHash).key;
		const verify = createVerifier(users, { clock: () => now, derive: async password => {
			calls++; return password === 'secret' ? key : Buffer.alloc(32);
		} });
		assert.equal(await verify('alice', 'secret'), true);
		assert.equal(await verify('alice', 'secret'), true);
		assert.equal(calls, 1);
		assert.equal(await verify('alice', 'wrong'), false);
		assert.equal(await verify('alice', 'wrong'), false);
		assert.equal(calls, 3);
		now = 60000;
		assert.equal(await verify('alice', 'secret'), true);
		assert.equal(calls, 4);
		const revoked = createVerifier([], { derive: async () => crypto.randomBytes(32) });
		assert.equal(await revoked('alice', 'secret'), false);
	});
});
