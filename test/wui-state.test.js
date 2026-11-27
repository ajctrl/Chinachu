'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { stateFixture } = require('./helpers/state');

describe('WUI database contention over HTTP', function () {
	this.timeout(15000);
	let fixture, db, child, exited, base;
	beforeEach(async function () {
		fixture = stateFixture();
		const root = fixture.root;
		db = fixture.open();
		const repo = path.join(__dirname, '..');
		for (const item of ['api', 'lib', 'web', 'node_modules', 'package.json', 'processes.json']) {
			fs.symlinkSync(path.join(repo, item), path.join(root, item));
		}
		fs.copyFileSync(path.join(repo, 'app-wui.js'), path.join(root, 'app-wui.js'));
		fs.mkdirSync(path.join(root, 'log'));
		const probe = net.createServer();
		probe.listen(0, '127.0.0.1');
		await once(probe, 'listening');
		const port = probe.address().port;
		await new Promise(resolve => probe.close(resolve));
		fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
			uid: process.getuid(), gid: process.getgid(), wuiPort: port, wuiUsers: [], recordedDir: root
		}));
		base = 'http://127.0.0.1:' + port + '/api/';
		child = spawn(process.execPath, ['app-wui.js'], {
			cwd: root, env: { ...process.env, pm_id: '' }, stdio: ['ignore', 'pipe', 'pipe']
		});
		exited = once(child, 'exit');
		let logs = '';
		for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { logs += part; });
		for (let i = 0; i < 100 && !logs.includes('backend listening on'); i++) {
			assert.equal(child.exitCode, null, logs);
			await delay(30);
		}
		assert.match(logs, /backend listening on/);
	});
	afterEach(async function () {
		if (db?.db.isTransaction) db.db.exec('ROLLBACK');
		if (child && child.exitCode === null && !child.signalCode) child.kill('SIGQUIT');
		if (exited) await exited;
		fixture.close();
	});

	function request(name, options = {}) {
		return fetch(base + name, { signal: AbortSignal.timeout(3000), ...options });
	}
	it('serves reads and media while a write waits, and reports success only after commit', async function () {
		const file = path.join(fixture.root, 'one.ts');
		fs.writeFileSync(file, 'sample TS');
		db.replace('recorded', [{ id: 'one', recorded: file }]);
		db.db.exec('BEGIN IMMEDIATE');
		const rule = { reserve_titles: ['ニュース'] };
		let completed = false;
		const pending = request('rules.json', { method: 'POST', body: JSON.stringify(rule),
			headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }
		}).then(response => { completed = true; return response; });
		try {
			await delay(100);
			assert.deepEqual(await (await request('rules.json')).json(), []);
			assert.equal(await (await request('recorded/one/file.m2ts')).text(), 'sample TS');
			assert.equal(completed, false);
			assert.deepEqual(db.read('rules'), []);
		} finally {
			db.db.exec('COMMIT');
			await pending;
		}
		assert.equal((await pending).status, 201);
		assert.deepEqual(db.read('rules'), [rule]);
	});

	it('drains a pending write on service shutdown', async function () {
		db.db.exec('BEGIN IMMEDIATE');
		const rule = { reserve_titles: ['pending'] };
		const pending = request('rules.json', { method: 'POST', body: JSON.stringify(rule),
			headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
		try {
			await delay(100);
			assert.deepEqual(await (await request('rules.json')).json(), []);
			child.kill('SIGQUIT');
			await delay(100);
			assert.equal(child.exitCode, null);
			assert.equal(child.signalCode, null);
		} finally {
			db.db.exec('COMMIT');
			await pending;
		}
		assert.deepEqual(await exited, [0, null]);
		assert.deepEqual(db.read('rules'), [rule]);
	});

	it('returns a database error if the handler finishes but its commit fails', async function () {
		db.db.exec(`
			CREATE TABLE parents (id INTEGER PRIMARY KEY);
			CREATE TABLE children (parent INTEGER REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED);
			CREATE TRIGGER fail_rule_commit AFTER INSERT ON items WHEN NEW.name = 'rules'
			BEGIN INSERT INTO children VALUES (1); END;
		`);
		const before = db.revision('rules').revision;
		const response = await request('rules.json', { method: 'POST', body: '{"reserve_titles":["test"]}',
			headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' } });
		assert.equal(response.status, 500);
		assert.deepEqual(db.read('rules'), []);
		assert.equal(db.revision('rules').revision, before);
	});

	it('serves status while an exclusive lock blocks the schedule read', async function () {
		db.db.exec('BEGIN EXCLUSIVE');
		let completed = false;
		const pending = request('schedule.json').then(response => { completed = true; return response; });
		try {
			await delay(100);
			assert.equal((await request('status.json')).status, 200);
			assert.equal(completed, false);
		} finally {
			db.db.exec('ROLLBACK');
			await pending;
		}
		assert.deepEqual(await (await pending).json(), []);
	});
});
