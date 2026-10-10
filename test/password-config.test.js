'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../lib/config-store');
const passwords = require('../lib/password-auth');
const { users } = require('./helpers/auth');
const api = fs.readFileSync(path.join(__dirname, '../api/script-config.vm.js'), 'utf8');

describe('write-only configuration passwords and migration', function() {
	this.timeout(15000);
	let directory, filename;
	beforeEach(function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-password-config-'));
		filename = path.join(directory, 'config.json');
		fs.writeFileSync(filename, JSON.stringify({ wuiUsers: users, custom: 'keep' }), { mode: 0o600 });
	});
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });
	function read() { return fs.readFileSync(filename, 'utf8'); }
	function request(method, config, revision = store.revision(read())) {
		const result = { headers: {} };
		vm.runInNewContext(api, {
			fs, configStore: store, define: { CONFIG_FILE: filename }, data: { status: { feature: { configurator: true } } },
			request: { method, query: { json: config === undefined ? undefined : JSON.stringify(config), revision } },
			response: { setHeader(key, value) { result.headers[key] = value; }, head(code) { result.status = code; },
				end(text) { result.body = JSON.parse(text); }, error(code) { result.status = code; } }
		});
		return result;
	}
	it('returns only usernames and configured state, with no-store, for both legacy and hashed credentials', function() {
		for (const entries of [users, ['alice:secret']]) {
			fs.writeFileSync(filename, JSON.stringify({ wuiUsers: entries }));
			const result = request('GET');
			assert.equal(result.status, 200);
			assert.equal(result.headers['Cache-Control'], 'no-store');
			assert.deepEqual(result.body, { wuiUsers: [{ username: 'alice', passwordSet: true }] });
			assert.ok(!JSON.stringify(result).includes('secret'));
			assert.ok(!JSON.stringify(result).includes(users[0].passwordHash));
		}
	});
	it('never exposes malformed legacy credential strings as usernames', function() {
		for (const credential of ['do-not-disclose', ':do-not-disclose', 'alice:']) {
			fs.writeFileSync(filename, JSON.stringify({ wuiUsers: [credential] }));
			const result = request('GET');
			assert.equal(result.status, 500);
			assert.ok(!JSON.stringify(result).includes('do-not-disclos'));
		}
	});
	it('preserves passwords when omitted or left blank, including a forged configured-state flag', function() {
		for (const config of [{ custom: 'changed' }, { wuiUsers: [{ username: 'alice', password: '', passwordSet: false }] }]) {
			const result = request('PUT', config);
			assert.equal(result.status, 200);
			assert.deepEqual(JSON.parse(read()).wuiUsers, users);
			assert.ok(!JSON.stringify(result).includes(users[0].passwordHash));
		}
	});
	it('changes a password, redacts the response, and keeps a usable hashed backup', async function() {
		const newPassword = 'new-unique-password:日本語';
		const config = request('GET').body;
		config.wuiUsers[0].password = newPassword;
		const result = request('PUT', config);
		assert.equal(result.status, 200);
		assert.equal(result.headers.ETag, '"' + store.revision(read()) + '"');
		assert.equal(result.body.custom, 'keep');
		assert.deepEqual(result.body.wuiUsers, [{ username: 'alice', passwordSet: true }]);
		assert.ok(!read().includes(newPassword));
		const verify = passwords.createVerifier(JSON.parse(read()).wuiUsers);
		assert.equal(await verify('alice', newPassword), true);
		assert.equal(await verify('alice', 'secret'), false);
		assert.deepEqual(JSON.parse(fs.readFileSync(filename + '.bak', 'utf8')).wuiUsers, users);
	});
	it('rejects hash injection, legacy values, duplicate users, short passwords and invalid types without writing', function() {
		const before = read();
		for (const entries of [users, ['alice:secret'], [{ username: 'alice' }, { username: 'alice' }],
			[{ username: 'new' }], [{ username: 'alice', password: 'short' }], [{ username: 'alice', password: null }],
			[{ username: 'alice', password: 'x'.repeat(1025) }], [{ username: 'bad:name', password: 'long-password' }]]) {
			const result = request('PUT', { wuiUsers: entries });
			assert.equal(result.status, 400);
			assert.equal(read(), before);
		}
		assert.equal(fs.existsSync(filename + '.bak'), false);
	});
	it('rejects a stale password update before changing either credentials or backups', function() {
		const before = read();
		assert.equal(request('PUT', { wuiUsers: [{ username: 'alice', password: 'new-long-password' }] }, 'stale').status, 409);
		assert.equal(read(), before);
		assert.equal(fs.existsSync(filename + '.bak'), false);
	});
	it('sanitizes legacy credentials in the config and backup on save and restricts file modes', async function() {
		fs.writeFileSync(filename, JSON.stringify({ wuiUsers: ['alice:legacy-secret'] }));
		fs.chmodSync(filename, 0o666);
		const initial = fs.statSync(filename);
		assert.equal(request('PUT', request('GET').body).status, 200);
		for (const file of [filename, filename + '.bak']) {
			const text = fs.readFileSync(file, 'utf8');
			assert.ok(!text.includes('legacy-secret'));
			const stat = fs.statSync(file);
			assert.equal(stat.mode & 0o777, 0o600);
			assert.equal(stat.uid, initial.uid);
			assert.equal(stat.gid, initial.gid);
			assert.equal(await passwords.createVerifier(JSON.parse(text).wuiUsers)('alice', 'legacy-secret'), true);
		}
	});
	it('migrates existing credentials through the CLI without changing the password or other settings', async function() {
		fs.writeFileSync(filename, JSON.stringify({ wuiUsers: ['alice:legacy-secret'], custom: 'keep' }));
		fs.writeFileSync(filename + '.bak', JSON.stringify({ wuiUsers: ['alice:older-secret'] }));
		await require('../scripts/set-wui-password.cjs').main(['--config', filename, '--migrate']);
		assert.equal(JSON.parse(read()).custom, 'keep');
		for (const file of [filename, filename + '.bak']) {
			const text = fs.readFileSync(file, 'utf8');
			assert.ok(!text.includes('legacy-secret'));
			assert.ok(!text.includes('older-secret'));
			assert.equal(fs.statSync(file).mode & 0o777, 0o600);
			assert.equal(await passwords.createVerifier(JSON.parse(text).wuiUsers)('alice', 'legacy-secret'), true);
		}
	});
	it('resets a damaged hash through the CLI without retaining it in the backup', async function() {
		const damaged = { username: 'alice', passwordHash: 'damaged-or-plaintext-secret' };
		const bob = { username: 'bob', passwordHash: users[0].passwordHash };
		fs.writeFileSync(filename, JSON.stringify({ wuiUsers: [damaged, bob], custom: 'keep' }));
		fs.chmodSync(filename, 0o666);
		let prompts = 0;
		await require('../scripts/set-wui-password.cjs').main(['alice', '--config', filename], {
			prompt: async () => { prompts++; return 'new-valid-password'; }
		});
		assert.equal(prompts, 2);
		const config = JSON.parse(read());
		assert.equal(config.custom, 'keep');
		assert.deepEqual(config.wuiUsers[1], bob);
		const verify = passwords.createVerifier(config.wuiUsers);
		assert.equal(await verify('alice', 'new-valid-password'), true);
		assert.equal(await verify('bob', 'secret'), true);
		const backup = JSON.parse(fs.readFileSync(filename + '.bak', 'utf8'));
		assert.deepEqual(backup, { wuiUsers: [{ username: 'alice' }, bob], custom: 'keep' });
		assert.throws(() => passwords.createVerifier(backup.wuiUsers));
		for (const file of [filename, filename + '.bak']) {
			const text = fs.readFileSync(file, 'utf8');
			assert.ok(!text.includes(damaged.passwordHash));
			assert.ok(!text.includes('new-valid-password'));
			assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		}
	});
	it('keeps a valid old credential in the CLI reset backup', async function() {
		await require('../scripts/set-wui-password.cjs').main(['alice', '--config', filename], {
			prompt: async () => 'new-valid-password'
		});
		assert.deepEqual(JSON.parse(fs.readFileSync(filename + '.bak', 'utf8')).wuiUsers, users);
		assert.equal(await passwords.createVerifier(JSON.parse(read()).wuiUsers)('alice', 'new-valid-password'), true);
	});
	it('does not discard another user\'s damaged credential during a CLI reset', async function() {
		fs.writeFileSync(filename, JSON.stringify({ wuiUsers: [...users, { username: 'bob', passwordHash: 'damaged' }] }));
		const before = read();
		await assert.rejects(require('../scripts/set-wui-password.cjs').main(['alice', '--config', filename], {
			prompt: async () => 'new-valid-password'
		}));
		assert.equal(read(), before);
		assert.equal(fs.existsSync(filename + '.bak'), false);
	});
	it('supports explicit disabling while ordinary omitted settings retain authentication', function() {
		assert.equal(request('PUT', { wuiUsers: [] }).status, 200);
		assert.deepEqual(JSON.parse(read()).wuiUsers, []);
	});
});
