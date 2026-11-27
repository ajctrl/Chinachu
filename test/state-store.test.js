'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { stateFixture } = require('./helpers/state');
const { finishRecording, requestStop, saveRecording } = require('../lib/program-state');
const run = promisify(execFile);

describe('SQLite state and migration', function () {
	let fixture;
	afterEach(function () { fixture.close(); });
	const first = { id: 'abc', start: 50, end: 70, channel: { id: 'ch' }, title: '日本語', extra: { key: '説明' } };
	const manual = { ...first, isManualReserved: true, '1seg': true };
	const finished = { ...manual, recorded: '/録画/番組.ts' };

	it('round-trips ordered channels, duplicate program IDs, rule order and recording paths exactly once', function () {
		const duplicate = { ...first, start: 80, end: 99, channel: { id: 'last' } };
		const schedule = [{ id: 'ch', programs: [first] }, { id: 'empty', programs: [] }, { id: 'last', programs: [duplicate] }];
		const rules = [{ sid: 2 }, { sid: 1 }, { sid: 2 }];
		fixture = stateFixture({ 'data/schedule.json': schedule, 'data/reserves.json': [manual],
			'data/recording.json': [manual], 'data/recorded.json': [finished], 'rules.json': rules,
			'excludes.json': [], 'config.json': { autoExclusionRules: [{ sid: 99 }] } });
		const store = fixture.open();
		assert.deepEqual(store.read('schedule'), schedule);
		assert.deepEqual(store.program('abc'), duplicate);
		assert.deepEqual(store.channel('ch', 70).programs, [first]);
		assert.deepEqual(store.channel('empty').programs, []);
		assert.equal(store.channel('missing'), null);
		assert.deepEqual(store.programs(null, 80), [duplicate]);
		assert.deepEqual(store.read('rules'), rules);
		assert.deepEqual(store.read('excludes'), []);
		assert.deepEqual(store.read('recording'), [manual]);
		assert.deepEqual(store.read('reserves'), [manual]);
		assert.deepEqual(store.read('recorded'), [finished]);
		store.replace('rules', []);
		fs.writeFileSync(path.join(fixture.root, 'excludes.json'), 'broken after migration');
		assert.deepEqual(fixture.open().read('rules'), []);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.root, 'rules.json'))), rules);
	});

	it('serves channel logos by ID even when program listings cannot be read', async function () {
		fixture = stateFixture({ 'data/schedule.json': [{ id: 'ch', name: 'first', programs: [first] },
			{ id: 'ch', name: 'last', programs: [] }] });
		const store = fixture.open();
		store.db.exec('ALTER TABLE programs RENAME TO unavailable_programs');
		assert.equal(store.channelMetadata('ch').name, 'last');
		const script = fs.readFileSync(path.join(__dirname, '../api/script-channel-logo.vm.js'), 'utf8');
		const png = Buffer.from([137, 80, 78, 71]);
		for (const chid of ['ch', 'missing']) {
			const calls = [];
			let status;
			const result = await new Promise(resolve => {
				require('node:vm').runInNewContext(script, {
					data: { channel: store.channelMetadata(chid) }, request: { param: { chid }, type: 'png' },
					mirakurun: { async getLogoImage(id) { calls.push(id); return png; } },
					response: { head(code) { status = code; }, end: resolve, error(code) { status = code; resolve(); } }
				});
			});
			assert.equal(status, chid === 'ch' ? 200 : 404);
			assert.deepEqual(calls, chid === 'ch' ? [parseInt(chid, 36)] : []);
			assert.deepEqual(result, chid === 'ch' ? png : undefined);
		}
	});

	it('resolves scheduler log entries in order, including repeated, reused and missing IDs', function () {
		const duplicate = { ...first, title: 'Later airing' };
		fixture = stateFixture({ 'data/schedule.json': [
			{ programs: [first, duplicate] }, { programs: [duplicate] }
		] });
		const store = fixture.open();
		const script = fs.readFileSync(path.join(__dirname, '../api/script-scheduler.vm.js'), 'utf8');
		function result(log) {
			let body;
			require('node:vm').runInNewContext(script, {
				request: { method: 'GET', type: 'json' }, store,
				fs: { existsSync: () => true, statSync: () => ({ mtime: new Date(123) }) },
				define: { SCHEDULER_LOG_FILE: 'scheduler' }, child_process: { execSync: () => log },
				response: { head(code) { assert.equal(code, 200); }, end(text) { body = JSON.parse(text); } }
			});
			return body;
		}
		assert.deepEqual(result('RESERVE: abc\nCONFLICT: abc\nRESERVE: missing\nRESERVE: abc\n'), {
			time: 123, conflicts: [first], reserves: [first, null, first]
		});
		store.db.exec('ALTER TABLE programs RENAME TO unavailable_programs');
		assert.deepEqual(result('RUNNING SCHEDULER.'), { time: 123, conflicts: [], reserves: [] });
	});

	it('rolls back every collection on bad input and retries from the corrected originals', function () {
		fixture = stateFixture({ 'rules.json': [{}], 'data/recorded.json': [finished], 'excludes.json': [null] });
		assert.throws(() => fixture.open(), /excludes.json/);
		const db = new DatabaseSync(path.join(fixture.root, 'data/chinachu.sqlite'));
		try {
			assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
			assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_master').get().n, 0);
		} finally { db.close(); }
		fs.writeFileSync(path.join(fixture.root, 'excludes.json'), '[]');
		assert.deepEqual(fixture.open().read('recorded'), [finished]);
	});

	it('can simulate on a legacy installation without creating a database', function () {
		fixture = stateFixture({ 'config.json': { autoExclusionRules: [{ channels: ['x'] }] } });
		const sim = fixture.open({ simulation: true });
		assert.deepEqual(sim.read('excludes'), [{ channels: ['x'] }]);
		assert.deepEqual(fs.readdirSync(path.join(fixture.root, 'data')), []);
	});

	it('provides isolated JSON snapshots and count arguments to scheduler hooks', function () {
		fixture = stateFixture({ 'rules.json': [{ sid: 9 }], 'data/reserves.json': [manual] });
		const hook = path.join(fixture.root, 'hook.cjs');
		fs.writeFileSync(hook, `#!${process.execPath}
			const fs = require('node:fs');
			const [pid, ...args] = process.argv.slice(2);
			const files = args.slice(0, 3);
			const input = files.map(name => JSON.parse(fs.readFileSync(name)));
			fs.writeFileSync(__dirname + '/result.json', JSON.stringify({ pid, files, input, counts: args.slice(3) }));
		`, { mode: 0o700 });
		const schedule = [{ id: 'ch', programs: [first] }];
		require('../lib/scheduler-hook').runSchedulerHook(fixture.open(), hook, { sync: true, schedule, counts: ['3', '2'] });
		const result = JSON.parse(fs.readFileSync(path.join(fixture.root, 'result.json')));
		assert.equal(result.pid, String(process.pid));
		assert.deepEqual(result.input, [[{ sid: 9 }], [manual], schedule]);
		assert.deepEqual(result.counts, ['3', '2']);
		assert.ok(result.files.every(name => !fs.existsSync(name)));
	});

	it('serializes first use and concurrent edits by independent processes', async function () {
		this.timeout(15000);
		fixture = stateFixture({ 'rules.json': [{ initial: true }] });
		const script = `const { StateStore } = require('./lib/state-store');
			const { editRule } = require('./lib/rule-state');
			const store = new StateStore(process.argv[1]);
			editRule(store, 'rules', 'POST', undefined, { writer: process.argv[2] });
			store.close();`;
		const writers = ['a', 'b', 'c', 'd', 'e'];
		await Promise.all(writers.map(id => run(process.execPath, ['-e', script, fixture.root, id], { cwd: path.join(__dirname, '..') })));
		const [initial, ...added] = fixture.open().read('rules');
		assert.deepEqual(initial, { initial: true });
		assert.deepEqual(added.map(rule => rule.writer).sort(), writers);
	});

	it('keeps stop requests through operator updates and commits completion atomically, including on retry', function () {
		const other = { id: 'other', start: 10 };
		const old = { ...finished, recorded: '/録画/前回.ts' };
		fixture = stateFixture({ 'data/recording.json': [manual, other], 'data/reserves.json': [manual, other], 'data/recorded.json': [old] });
		const operator = fixture.open(), cli = fixture.open();
		requestStop(cli, manual.id);
		saveRecording(operator, [finished, other]);
		assert.equal(cli.read('recording')[0].abort, true);
		const revisions = ['recorded', 'recording', 'reserves'].map(name => cli.revision(name).revision);
		operator.db.exec("CREATE TRIGGER fail BEFORE DELETE ON items WHEN old.name = 'reserves' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
		assert.throws(() => finishRecording(operator, finished), /disk full/);
		assert.deepEqual(cli.read('recorded'), [old]);
		assert.deepEqual(cli.read('reserves'), [manual, other]);
		assert.equal(cli.read('recording').length, 2);
		assert.deepEqual(['recorded', 'recording', 'reserves'].map(name => cli.revision(name).revision), revisions);
		operator.db.exec('DROP TRIGGER fail');
		finishRecording(operator, finished);
		finishRecording(operator, finished);
		assert.deepEqual(cli.read('recorded'), [{ ...old, id: 'abc-' + old.start.toString(36) }, finished]);
		assert.deepEqual(cli.read('recording'), [other]);
		assert.deepEqual(cli.read('reserves'), [other]);
	});

	it('retains a later manual reservation when an event ID is reused', function () {
		const later = { ...manual, start: finished.end + 1, end: finished.end + 200 };
		fixture = stateFixture({ 'data/recording.json': [finished], 'data/reserves.json': [later] });
		const store = fixture.open();
		finishRecording(store, finished);
		assert.deepEqual(store.read('reserves'), [later]);
	});
});
