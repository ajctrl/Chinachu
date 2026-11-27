'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');
const { stateFixture } = require('./helpers/state');

describe('operator history recovery', function() {
	it('recovers two closed files once after SIGKILL during a main DB lock', async function() {
		this.timeout(25000);
		const repo = path.resolve(__dirname, '..');
		const fixture = stateFixture();
		const { root } = fixture;
		const store = fixture.open();
		const logFile = path.join(root, 'operator.log');
		const logs = () => fs.readFileSync(logFile, 'utf8');
		let child, pending;
		function launch() {
			const fd = fs.openSync(logFile, 'w');
			try {
				child = spawn(process.execPath, ['app-operator.js'], {
					cwd: root, env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules') },
					stdio: ['ignore', fd, fd]
				});
			} finally { fs.closeSync(fd); }
		}
		async function waitFor(check) {
			for (let i = 0; i < 160; i++) {
				if (check()) return;
				if (child.exitCode !== null || child.signalCode !== null) break;
				await delay(50);
			}
			assert.fail('Operator did not reach expected state.\n' + logs());
		}
		async function stop(signal) {
			if (!child || child.exitCode !== null || child.signalCode !== null) return;
			const exit = once(child, 'exit');
			child.kill(signal);
			return exit;
		}

		try {
			for (const dir of ['log', 'web', 'node_modules/mirakurun']) fs.mkdirSync(path.join(root, dir), { recursive: true });
			fs.copyFileSync(path.join(repo, 'app-operator.js'), path.join(root, 'app-operator.js'));
			for (const name of ['lib', 'package.json']) fs.symlinkSync(path.join(repo, name), path.join(root, name));
			fs.symlinkSync('/bin/true', path.join(root, 'chinachu'));
			fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
				uid: process.getuid(), gid: process.getgid(), recordedDir: root, recordedFormat: '<id>.ts'
			}));
			fs.writeFileSync(path.join(root, 'node_modules/mirakurun/index.js'), `
				const { PassThrough } = require('node:stream');
				exports.default = class {
					async getProgramStream({ id }) {
						const stream = new PassThrough();
						stream.req = { path: '/stream/' + id };
						stream.write(id.toString(36) + '-video');
						return stream;
					}
				};
			`);
			const start = Date.now() - 1000;
			const ids = ['one', 'two'];
			store.replace('reserves', ids.map(id => ({ id, start, end: start + 120000,
				title: id, channel: { type: 'GR', channel: '20', name: 'station' }, isManualReserved: true })));
			launch();
			await waitFor(() => store.read('recording').filter(p => p.recorded && fs.statSync(p.recorded).size > 0).length === ids.length);
			pending = new DatabaseSync(path.join(root, 'data/recording-pending.sqlite'), { readOnly: true });
			const count = () => pending.prepare('SELECT count(*) AS n FROM pending').get().n;
			store.db.exec('BEGIN IMMEDIATE');
			child.kill('SIGINT');
			await waitFor(() => count() === ids.length);
			assert.deepEqual(store.read('recorded'), []);
			assert.deepEqual(await stop('SIGKILL'), [null, 'SIGKILL']);
			launch();
			await waitFor(() => logs().includes('metadata save failed'));
			store.db.exec('COMMIT');
			await waitFor(() => store.read('recorded').length === ids.length);
			assert.equal(count(), 0);
			assert.deepEqual(store.read('recording'), []);
			assert.deepEqual(store.read('reserves'), []);
			const history = store.read('recorded');
			assert.deepEqual(history.map(p => p.id).sort(), ids);
			for (const p of history) assert.equal(fs.readFileSync(p.recorded, 'utf8'), p.id + '-video');
			assert.deepEqual(await stop('SIGTERM'), [0, null]);
			launch();
			await waitFor(() => logs().includes('WRITE: recording'));
			assert.deepEqual(store.read('recorded'), history);
		} finally {
			await stop('SIGKILL');
			if (store.db.isTransaction) store.db.exec('ROLLBACK');
			if (pending) pending.close();
			fixture.close();
		}
	});
});
