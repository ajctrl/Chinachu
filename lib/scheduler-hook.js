'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawn, spawnSync } = require('node:child_process');
const { log } = require('./logger');

// Hooks receive the original three JSON arguments as private snapshots.
function runSchedulerHook(store, command, { sync = false, counts = [], schedule } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-hook-'));
	const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
	try {
		const files = store.transaction(() => ['rules', 'reserves', 'schedule'].map(name => {
			const file = path.join(dir, name + '.json');
			const items = name === 'schedule' && schedule !== undefined ? schedule : store.read(name);
			fs.writeFileSync(file, JSON.stringify(items));
			return file;
		}), false);
		const args = [String(process.pid), ...files, ...counts];
		if (sync) {
			const child = spawnSync(command, args, { stdio: 'ignore' });
			cleanup();
			if (child.error) log('ERROR: ' + command + ': ' + child.error.message);
			else log('SPAWN: ' + command + ' (pid=' + child.pid + ')');
		} else {
			// The helper owns these snapshots until the hook exits, even after the scheduler exits.
			const helper = fork(__filename, [dir, command, ...args], {
				execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']
			});
			helper.once('error', error => {
				cleanup();
				log('ERROR: ' + command + ': ' + error.message);
			});
			helper.once('message', message => {
				log(message);
				helper.disconnect();
			});
			helper.once('disconnect', () => helper.unref());
		}
	} catch (error) { cleanup(); throw error; }
}

if (require.main === module && process.send) {
	const [dir, command, ...args] = process.argv.slice(2);
	const child = spawn(command, args, { stdio: 'ignore' });
	const report = message => {
		if (process.connected) process.send(message, () => {}); // The scheduler may already have exited.
	};
	child.once('spawn', () => report('SPAWN: ' + command + ' (pid=' + child.pid + ')'));
	child.once('error', error => report('ERROR: ' + command + ': ' + error.message));
	child.once('close', () => fs.rmSync(dir, { recursive: true, force: true }));
}

module.exports = { runSchedulerHook };
