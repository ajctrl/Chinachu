'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const run = promisify(execFile);

describe('generated LSB service', function() {
	this.timeout(15000);

	it('keeps the old PID throughout a delayed restart and serializes another start', async function() {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-init-'));
		const daemon = path.join(root, 'chinachu');
		const init = path.join(root, 'init');
		const pidFile = path.join(root, 'operator.pid');
		const release = path.join(root, 'release');
		const log = path.join(root, 'log/operator');
		fs.copyFileSync(path.join(__dirname, '../chinachu'), daemon);
		fs.writeFileSync(path.join(root, 'config.json'), '{}');
		fs.symlinkSync(process.execPath, path.join(root, 'node'));
		// Exercise the generated launcher and process tree under the test user.
		fs.writeFileSync(path.join(root, 'su'), '#!/bin/sh\nshift 3\nexec /bin/sh "$@"\n', { mode: 0o755 });
		fs.writeFileSync(path.join(root, 'app-operator.js'), `
			const fs = require('node:fs');
			function drain() {
				console.log('draining', process.pid);
				setInterval(() => {
					if (fs.existsSync('release')) { console.log('saved', process.pid); process.exit(0); }
				}, 20);
			}
			for (const signal of ['SIGTERM', 'SIGQUIT']) process.once(signal, drain);
			console.log('started', process.pid);
			setInterval(() => { if (!fs.existsSync(__dirname)) process.exit(0); }, 1000);
		`);
		const { stdout } = await run(daemon, ['service', 'operator', 'initscript']);
		fs.writeFileSync(init, stdout.replace('PATH=/usr/local/sbin:', 'PATH=' + root + ':/usr/local/sbin:')
			.replace('PIDFILE=/var/run/${NAME}.pid', 'PIDFILE=' + pidFile), { mode: 0o755 });
		const invoke = action => run(init, [action], { timeout: 10000 });
		const logs = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
		async function waitFor(line) {
			for (let i = 0; i < 150 && !logs().includes(line); i++) await delay(20);
			assert.ok(logs().includes(line), logs());
		}
		const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
		let restart, concurrent;
		try {
			fs.writeFileSync(pidFile, String(unrelated.pid));
			assert.match((await invoke('status')).stdout, /is not running/);
			await invoke('stop');
			assert.equal(fs.existsSync(pidFile), false);
			fs.writeFileSync(pidFile, String(unrelated.pid));
			await invoke('restart');
			assert.equal(unrelated.signalCode, null);
			const old = fs.readFileSync(pidFile, 'utf8').trim();
			await waitFor('started ' + old);
			restart = invoke('restart');
			await waitFor('draining ' + old);
			concurrent = invoke('start');
			await delay(3200);
			assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), old);
			assert.equal(logs().match(/started/g).length, 1);
			fs.writeFileSync(release, '');
			await Promise.all([restart, concurrent]);
			const next = fs.readFileSync(pidFile, 'utf8').trim();
			assert.notEqual(next, old);
			await waitFor('started ' + next);
			assert.ok(logs().includes('saved ' + old + '\nstarted ' + next));
			assert.equal(logs().match(/started/g).length, 2);
		} finally {
			unrelated.kill();
			fs.writeFileSync(release, '');
			await Promise.allSettled([restart, concurrent]);
			try { await invoke('stop'); }
			finally { fs.rmSync(root, { recursive: true, force: true }); }
		}
	});
});
