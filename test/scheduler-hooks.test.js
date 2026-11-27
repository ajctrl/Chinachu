'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { stateFixture } = require('./helpers/state');

const repo = path.join(__dirname, '..');
const run = promisify(execFile);

describe('scheduler hooks', function() {
	this.timeout(10000);
	let fixture, root, store;

	beforeEach(function() {
		fixture = stateFixture();
		root = fixture.root;
		store = fixture.open();
		for (const dir of ['web', 'log', 'bin', 'node_modules/mirakurun']) fs.mkdirSync(path.join(root, dir), { recursive: true });
		// The fixture exercises hooks without changing its process priority.
		fs.symlinkSync('/bin/true', path.join(root, 'bin/renice'));
		for (const name of ['app-scheduler.js', 'app-cli.js']) fs.copyFileSync(path.join(repo, name), path.join(root, name));
		for (const name of ['lib', 'package.json']) fs.symlinkSync(path.join(repo, name), path.join(root, name));
		fs.writeFileSync(path.join(root, 'node_modules/mirakurun/index.js'), `
			exports.default = class {
				async getServices() { return [{ id: 10, networkId: 1, serviceId: 2, name: 'Station', channel: { type: 'GR', channel: '27' } }]; }
				async getPrograms() { return [{ id: 11, networkId: 1, serviceId: 2, name: 'New program', startAt: Date.now() + 3600000, duration: 60000 }]; }
				async getTuners() { return []; }
			};
		`);
	});
	afterEach(function() { fixture.close(); });

	function hook(name, body) {
		const filename = path.join(root, name);
		fs.writeFileSync(filename, '#!' + process.execPath + '\n' + body, { mode: 0o700 });
		return filename;
	}

	function schedule(config, args = []) {
		fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
		return run(process.execPath, ['app-scheduler.js', ...args], { cwd: root, timeout: 5000,
			env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, NODE_PATH: path.join(repo, 'node_modules') } });
	}

	it('lets the start hook reserve a newly published program using the CLI before planning', async function() {
		const start = hook('start.cjs', `
			const schedule = JSON.parse(require('node:fs').readFileSync(process.argv[5]));
			const program = schedule[0].programs[0];
			require('node:child_process').execFileSync(process.execPath, ['app-cli.js', '-mode', 'reserve', '-id', program.id]);
		`);
		const revision = store.revision('schedule').revision;
		await schedule({ schedulerStartCommand: start }, ['--simulation']);
		assert.equal(store.revision('schedule').revision, revision);
		assert.deepEqual(store.read('reserves'), []);
		await schedule({ schedulerStartCommand: start });
		assert.equal(store.revision('schedule').revision, revision + 1);
		const [program] = store.read('reserves');
		assert.equal(program.id, 'b');
		assert.equal(program.isManualReserved, true);
		assert.equal(program.isConflict, true); // The hook's reservation was included in this run.
	});

	it('plans reservations when configured start hooks cannot be launched', async function() {
		store.replace('rules', [{}]);
		const { stdout } = await schedule({
			epgStartCommand: path.join(root, 'missing-epg'), schedulerStartCommand: path.join(root, 'missing-scheduler')
		});
		assert.match(stdout, /ERROR: .*missing-epg.*ENOENT/);
		assert.match(stdout, /ERROR: .*missing-scheduler.*ENOENT/);
		assert.deepEqual(store.read('reserves').map(program => program.id), ['b']);
	});

	it('runs the next update while both end hooks still hold their original snapshots', async function() {
		store.replace('rules', [{}]);
		const end = hook('end.cjs', `
			const fs = require('node:fs');
			const [pid, rules, reserves, guide, ...counts] = process.argv.slice(2);
			const label = counts.length ? 'scheduler' : 'epg';
			const deadline = setTimeout(() => process.exit(1), 6000);
			const timer = setInterval(() => {
				if (!fs.existsSync('release-hooks')) return;
				const ids = JSON.parse(fs.readFileSync(reserves)).map(program => program.id);
				fs.writeFileSync(label + '.json', JSON.stringify({ ids, guide }));
				clearInterval(timer);
				clearTimeout(deadline);
			}, 10);
		`);
		await schedule({ epgEndCommand: end, schedulerEndCommand: end });
		assert.equal(fs.existsSync(path.join(root, 'data/scheduler.pid')), false);
		store.replace('rules', []);
		await schedule({});
		assert.deepEqual(store.read('reserves'), []);
		fs.writeFileSync(path.join(root, 'release-hooks'), '');
		for (const [label, ids] of [['epg', []], ['scheduler', ['b']]]) {
			const result = path.join(root, label + '.json');
			for (let i = 0; i < 200 && !fs.existsSync(result); i++) await delay(10);
			const snapshot = JSON.parse(fs.readFileSync(result));
			assert.deepEqual(snapshot.ids, ids);
			const dir = path.dirname(snapshot.guide);
			for (let i = 0; i < 200 && fs.existsSync(dir); i++) await delay(10);
			assert.equal(fs.existsSync(dir), false);
		}
	});

	it('releases the scheduler PID file while a verbose conflict hook is still running', async function() {
		store.replace('rules', [{}]);
		const conflict = hook('conflict.cjs', `
			const fs = require('node:fs');
			fs.writeFileSync(1, Buffer.alloc(2 * 1024 * 1024));
			fs.writeFileSync(2, Buffer.alloc(2 * 1024 * 1024));
			const timeout = setTimeout(() => process.exit(1), 5000);
			const poll = setInterval(() => {
				if (fs.existsSync('data/scheduler.pid')) return;
				clearInterval(poll);
				clearTimeout(timeout);
				fs.writeFileSync('conflict.json', JSON.stringify(process.argv.slice(2)));
			}, 10);
		`);
		await schedule({ conflictCommand: conflict });
		assert.equal(fs.existsSync(path.join(root, 'data/scheduler.pid')), false);
		const result = path.join(root, 'conflict.json');
		for (let i = 0; i < 200 && !fs.existsSync(result); i++) await delay(10);
		const [, id, , station, title, json] = JSON.parse(fs.readFileSync(result));
		assert.equal(id, 'b');
		assert.equal(station, 'Station');
		assert.equal(title, 'New program');
		assert.equal(JSON.parse(json).isConflict, true);
		// A failed spawn must also release the PID and preserve the committed plan.
		const { stdout } = await schedule({ conflictCommand: path.join(root, 'missing') });
		assert.match(stdout, /ENOENT/);
		assert.equal(store.read('reserves')[0].isConflict, true);
	});
});
