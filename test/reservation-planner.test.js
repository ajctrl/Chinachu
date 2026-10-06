'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const chinachu = require('chinachu-common');
const planner = require('../lib/reservation-planner');

function program(overrides) {
	const start = Date.now() + 3600000;
	return Object.assign({
		id: 'one', fullTitle: 'ＡＢＣ 再放送', title: 'ABC', detail: '旅の紹介 再放送',
		start, end: start + 1800000, seconds: 1800, category: 'variety', flags: [],
		channel: { id: 'gr1', channel: '27', type: 'GR', sid: 1, name: 'Test' }
	}, overrides);
}

function permutations(items) {
	if (!items.length) { return [[]]; }
	return items.flatMap((item, index) =>
		permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
}

describe('duplicate reservation selection', function () {
	const states = {
		reserve: {}, manual: { isManualReserved: true }, skip: { isSkip: true },
		manualSkip: { isManualReserved: true, isSkip: true },
		autoSkip: { isSkip: true, isAutoSkip: true }, override: { autoSkipOverride: true }
	};
	const cases = [
		['ordinary services', ['reserve', 'reserve', 'reserve'], [0]],
		['manual skip suppresses alternatives', ['skip', 'reserve', 'reserve'], [0]],
		['manual reservation with lowest SID', ['manual', 'reserve', 'skip'], [0, 2]],
		['manual reservation with highest SID', ['skip', 'reserve', 'manual'], [0, 2]],
		['skipped manual reservation', ['manualSkip', 'manual', 'reserve'], [0, 1]],
		['automatic exclusion remains local', ['autoSkip', 'reserve', 'reserve'], [0, 1]],
		['manual reservation beside automatic exclusions', ['autoSkip', 'autoSkip', 'manual'], [0, 1, 2]],
		['explicit override beside manual skip', ['skip', 'reserve', 'override'], [0, 2]],
		['multiple explicit overrides', ['skip', 'override', 'override'], [0, 1, 2]],
		['manual and automatic skips with no eligible recording', ['skip', 'autoSkip', 'reserve'], [0, 1]],
		['all services skipped', ['skip', 'manualSkip', 'autoSkip'], [0, 1, 2]],
		['ordinary SID selection between manual reservations', ['manual', 'manual', 'skip'], [0, 2]],
		['explicit override priority', ['reserve', 'manual', 'override'], [2]]
	];
	for (const [name, status, survivors] of cases) {
		it('selects ' + name + ' consistently in all six service orders', function () {
			const start = Date.now() + 3600000;
			const programs = status.map((state, index) => program({
				id: 'service-' + index, start, end: start + 1800000,
				channel: { id: 'gr' + index, type: 'GR', channel: '27', sid: index + 1 },
				...states[state]
			}));
			const expected = survivors.map(index => 'service-' + index);
			for (const order of permutations(programs)) {
				const candidates = JSON.parse(JSON.stringify(order));
				for (let update = 0; update < 2; update++) {
					assert.equal(planner.markDuplicates(candidates), 3 - expected.length);
					assert.deepEqual(candidates.filter(p => !p.isDuplicate).map(p => p.id).sort(), expected);
				}
			}
		});
	}

	it('selects a stable reservation when SIDs are tied or missing', function () {
		for (const sid of [1, undefined]) {
			const first = program({ id: 'first' });
			const second = program({ id: 'second', start: first.start, end: first.end });
			first.channel.sid = second.channel.sid = sid;
			for (const order of permutations([first, second])) {
				const candidates = JSON.parse(JSON.stringify(order));
				assert.equal(planner.markDuplicates(candidates), 1);
				assert.equal(candidates.find(p => !p.isDuplicate).id, first.id);
			}
		}
	});
});

describe('reservation keyword matching', function () {
	it('collects unique actual matches only from fully matching enabled rules', function () {
		const rules = [
			{ reserve_titles: ['ABC', 'missing'], reserve_descriptions: ['旅', 'missing'] },
			{ reserve_titles: ['ABC'], reserve_descriptions: ['旅'] },
			{ reserve_titles: ['再放送'], types: ['BS'] },
			{ reserve_descriptions: ['紹介'], isDisabled: true },
			{ reserve_titles: ['再放送'], ignore_descriptions: ['旅'] },
			{ reserve_descriptions: ['紹介'], duration: { min: 0, max: 60 } }
		];
		assert.deepEqual(chinachu.getProgramMatchInfo(rules, program(), 'NFKC'), {
			isMatched: true, keywords: ['ABC', '旅'], channels: []
		});
	});

	it('keeps regular expressions and normalization consistent with existing matching', function () {
		const p = program();
		assert.deepEqual(chinachu.getProgramMatchInfo([{ reserve_titles: ['^ABC', '再.*送'] }], p).keywords, ['再.*送']);
		assert.deepEqual(chinachu.getProgramMatchInfo([{ reserve_titles: ['^ABC', '再.*送'] }], p, 'NFKC').keywords, ['^ABC', '再.*送']);
	});

	it('handles missing detail and rules without keywords', function () {
		assert.deepEqual(chinachu.getProgramMatchInfo([{ types: ['GR'] }], program({ detail: undefined }), 'NFKC'), {
			isMatched: true, keywords: [], channels: []
		});
		assert.equal(chinachu.getProgramMatchInfo([{ reserve_descriptions: ['旅'] }], program({ detail: undefined }), 'NFKC').isMatched, false);
	});

	it('collects channel evidence only from fully matching rules and deduplicates aliases', function() {
		const p = program();
		const nonmatching = [
			{ channels: ['gr1'], reserve_titles: ['missing'] },
			{ channels: ['gr1'], isDisabled: true },
			{ channels: ['gr1'], ignore_descriptions: ['旅'] },
			{ channels: ['gr1'], types: ['BS'] }
		];
		assert.deepEqual(chinachu.getProgramMatchInfo(nonmatching.concat([{ reserve_titles: ['ABC'] }]), p, 'NFKC'), {
			isMatched: true, keywords: ['ABC'], channels: []
		});
		assert.deepEqual(chinachu.getProgramMatchInfo(nonmatching.concat([
			{ channels: ['gr1', 'other'], reserve_titles: ['ABC'] },
			{ channels: ['27'] }, { channels: ['GR_1'] }
		]), p, 'NFKC'), { isMatched: true, keywords: ['ABC'], channels: ['gr1'] });
	});
});

describe('reservation exclusion state', function () {
	const rules = [{ reserve_titles: ['ABC'] }];
	const config = { normalizationForm: 'NFKC' };
	const excludes = [
		{ reserve_titles: ['再放送', 'missing'] }, { reserve_descriptions: ['再放送'] }
	];
	function build(p, previous = [], settings = config, recordingRules = rules) {
		return planner.buildCandidates([{ programs: [p] }], recordingRules, JSON.parse(JSON.stringify(previous)), settings, settings === config ? excludes : []);
	}

	it('retains excluded candidates, persists their evidence, and does not mutate the EPG', function () {
		const p = program();
		const [reserve] = build(p);
		assert.equal(reserve.isSkip, true);
		assert.equal(reserve.isAutoSkip, true);
		assert.deepEqual(reserve.matchedKeywords, ['ABC']);
		assert.deepEqual(reserve.excludedKeywords, ['再放送']);
		assert.equal(p.isSkip, undefined);
	});

	it('persists channel-only exclusion evidence and clears it when no longer matched or manually reserved', function() {
		const p = program();
		function channelBuild(previous = [], channelExcludes = [{ channels: ['gr1'] }], epg = p) {
			return planner.buildCandidates([{ programs: [epg] }], rules, JSON.parse(JSON.stringify(previous)), config, channelExcludes)[0];
		}
		let reserve = channelBuild();
		assert.equal(reserve.isAutoSkip, true);
		assert.deepEqual(reserve.excludedKeywords, []);
		assert.deepEqual(reserve.excludedChannels, ['gr1']);
		assert.equal(p.excludedChannels, undefined);
		planner.unskip(reserve);
		reserve = channelBuild([reserve]);
		assert.equal(reserve.autoSkipOverride, true);
		assert.deepEqual(reserve.excludedChannels, ['gr1']);
		const changed = channelBuild([reserve], [{ channels: ['gr1'], reserve_titles: ['missing'] }]);
		assert.equal(changed.isExcluded, false);
		assert.deepEqual(changed.excludedChannels, []);
		assert.deepEqual(channelBuild([reserve], []).excludedChannels, []);
		const manual = channelBuild([{ ...reserve, isManualReserved: true }]);
		assert.equal(manual.isManualReserved, true);
		assert.deepEqual(manual.excludedChannels, []);
		assert.equal(manual.isExcluded, undefined);
		assert.equal(manual.isSkip, undefined);
	});

	it('preserves an override across updates, disappearing/reappearing exclusions and JSON reloads', function () {
		const p = program();
		let [reserve] = build(p);
		planner.unskip(reserve);
		for (let i = 0; i < 3; i++) {
			[reserve] = build(Object.assign({}, p, { start: p.start + 3600000, end: p.end + 3600000 }), [reserve]);
			assert.equal(reserve.isSkip, undefined);
			assert.equal(reserve.autoSkipOverride, true);
			assert.deepEqual(reserve.excludedKeywords, ['再放送']);
		}
		[reserve] = build(p, [reserve], { normalizationForm: 'NFKC' });
		assert.deepEqual(reserve.excludedKeywords, []);
		[reserve] = build(p, [reserve]);
		assert.equal(reserve.isSkip, undefined);
		planner.skip(reserve);
		[reserve] = build(p, [reserve]);
		assert.equal(reserve.autoSkipOverride, undefined);
		assert.equal(reserve.isAutoSkip, true);
		[reserve] = build(p, [reserve], { normalizationForm: 'NFKC' });
		assert.equal(reserve.isSkip, undefined);
	});

	it('releases automatic skips but preserves ordinary and legacy manual skips', function () {
		const p = program();
		let [reserve] = build(p);
		[reserve] = build(p, [reserve], { normalizationForm: 'NFKC' });
		assert.equal(reserve.isSkip, undefined);
		planner.skip(reserve);
		[reserve] = build(p, [reserve]);
		assert.equal(reserve.isSkip, true);
		assert.equal(reserve.isAutoSkip, undefined);
		[reserve] = build(p, [reserve], { normalizationForm: 'NFKC' });
		assert.equal(reserve.isSkip, true);
		planner.unskip(reserve);
		assert.equal(reserve.autoSkipOverride, undefined);
	});

	it('does not inherit overrides on the next airing, including reused event IDs', function () {
		const p = program({ start: Date.now() - 3600000, end: Date.now() - 1800000 });
		const [reserve] = build(p);
		planner.unskip(reserve);
		for (const id of ['two', p.id]) {
			const [next] = build(Object.assign({}, p, { id, start: p.start + 86400000, end: p.end + 86400000 }), [reserve]);
			assert.equal(next.isAutoSkip, true);
			assert.equal(next.autoSkipOverride, undefined);
		}
	});

	it('exempts manual reservations even when recording rules also match', function () {
		const p = program();
		const [reserve] = build(p, [Object.assign({}, p, { isManualReserved: true, '1seg': true })]);
		assert.equal(reserve.isManualReserved, true);
		assert.equal(reserve['1seg'], true);
		assert.equal(reserve.isSkip, undefined);
		assert.deepEqual(reserve.excludedKeywords, []);
	});
	it('preserves explicitly skipped manual reservations across EPG changes and missing EPG', function () {
		const p = program();
		let [reserve] = build(p, [Object.assign({}, p, { isManualReserved: true })]);
		planner.skip(reserve);
		for (let i = 0; i < 3; i++) {
			[reserve] = build(Object.assign({}, p, { start: p.start + 60000, end: p.end + 60000 }), [reserve]);
			assert.equal(reserve.isSkip, true);
			assert.equal(reserve.isManualReserved, true);
			assert.equal(reserve.isAutoSkip, undefined);
			assert.deepEqual(reserve.excludedKeywords, []);
		}
		[reserve] = planner.buildCandidates([], [], [reserve], config);
		assert.equal(reserve.isSkip, true);
		planner.unskip(reserve);
		[reserve] = build(p, [reserve]);
		assert.equal(reserve.isSkip, undefined);
		assert.equal(reserve.autoSkipOverride, undefined);
		assert.equal(reserve.isManualReserved, true);
	});

	it('keeps ignore titles/descriptions excluding candidates and adds no candidates via exclusions', function () {
		const p = program();
		assert.deepEqual(build(p, [], config, [{ ignore_titles: ['再放送'] }]), []);
		assert.deepEqual(build(p, [], config, [{ ignore_descriptions: ['旅'] }]), []);
		assert.deepEqual(build(p, [], config, []), []);
	});
});

// Execute the real scheduler/CLI in fresh contexts backed by persisted JSON.
// External EPG, process and filesystem services are replaced with in-memory stubs.
describe('scheduler and CLI persistence', function () {
	const root = path.resolve(__dirname, '..');
	let files, config;
	function run(entry, args = {}) {
		const stopped = {};
		const context = vm.createContext({
			__dirname: root, console: { log() {}, info() {}, error() {} }, Buffer,
			process: { pid: 123, on() {}, exit(code) { assert.equal(code, 0); throw stopped; } },
			require(name) {
				if (name === root + '/config.json') { return JSON.parse(JSON.stringify(config)); }
				if (name === 'fs') {
					return {
						existsSync(file) { return !file.endsWith('scheduler.pid'); },
						readFileSync(file) {
							const name = path.basename(file);
							if (name === 'excludes.json' && !(name in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
							return files[name] || '[]';
						},
						writeFileSync(file, value) { files[path.basename(file)] = value; }
					};
				}
				if (name === 'opts') { return { parse() {}, get(key) { return args[key]; } }; }
				if (name === 'child_process') { return { execSync() {} }; }
				if (name === './lib/logger') { return { log() {} }; }
				if (name === './lib/mirakurun-client') { return { configureMirakurunClient() {} }; }
				if (name === 'mirakurun') { return { default: class { getServices() { return new Promise(() => {}); } } }; }
				return require(name.startsWith('./') ? path.join(root, name) : name);
			}
		});
		try {
			vm.runInContext(fs.readFileSync(path.join(root, entry), 'utf8'), context);
			if (entry === 'app-scheduler.js') {
				vm.runInContext('tuners = [{ types: ["GR"] }]; scheduler();', context);
			}
		} catch (error) {
			if (error !== stopped) { throw error; }
		}
		return JSON.parse(files['reserves.json']);
	}

	beforeEach(function () {
		config = {};
		files = { 'rules.json': JSON.stringify([{}]), 'excludes.json': JSON.stringify([{ reserve_titles: ['再放送'] }]), 'reserves.json': '[]' };
	});

	it('reads legacy config rules only until excludes.json exists', function () {
		config.autoExclusionRules = [{ reserve_titles: ['再放送'] }];
		delete files['excludes.json'];
		files['schedule.json'] = JSON.stringify([{ programs: [program()] }]);
		assert.equal(run('app-scheduler.js')[0].isAutoSkip, true);
		files['excludes.json'] = '[]';
		assert.equal(run('app-scheduler.js')[0].isSkip, undefined);
	});

	it('persists channel exclusion evidence through scheduler saves and CLI overrides', function() {
		const p = program();
		files['schedule.json'] = JSON.stringify([{ programs: [p] }]);
		files['excludes.json'] = JSON.stringify([{ channels: ['27', 'GR_1'] }]);
		const first = run('app-scheduler.js')[0];
		assert.equal(first.isAutoSkip, true);
		assert.deepEqual(first.excludedChannels, ['gr1']);
		assert.deepEqual(first.excludedKeywords, []);
		const restored = run('app-cli.js', { mode: 'unskip', id: p.id })[0];
		assert.equal(restored.autoSkipOverride, true);
		assert.deepEqual(restored.excludedChannels, ['gr1']);
		assert.deepEqual(run('app-scheduler.js')[0].excludedChannels, ['gr1']);
		files['excludes.json'] = '[]';
		assert.deepEqual(run('app-scheduler.js')[0].excludedChannels, []);
	});

	it('persists unskip and re-skip through fresh scheduler and CLI instances', function () {
		const p = program();
		files['schedule.json'] = JSON.stringify([{ programs: [p] }]);
		assert.equal(run('app-scheduler.js')[0].isAutoSkip, true);
		assert.equal(run('app-cli.js', { mode: 'unskip', id: p.id })[0].autoSkipOverride, true);
		assert.equal(run('app-scheduler.js')[0].isSkip, undefined);
		assert.equal(run('app-scheduler.js')[0].autoSkipOverride, true);
		assert.equal(run('app-cli.js', { mode: 'skip', id: p.id })[0].isAutoSkip, true);
		assert.equal(run('app-scheduler.js')[0].autoSkipOverride, undefined);
		files['excludes.json'] = '[]';
		assert.equal(run('app-scheduler.js')[0].isSkip, undefined);
		assert.equal(run('app-cli.js', { mode: 'skip', id: p.id })[0].isSkip, true);
		assert.equal(run('app-scheduler.js')[0].isSkip, true);
	});
	it('persists a manual skip and undo through real CLI and scheduler updates', function () {
		const p = program();
		files['schedule.json'] = JSON.stringify([{ programs: [p] }]);
		files['reserves.json'] = JSON.stringify([Object.assign({}, p, { isManualReserved: true })]);
		assert.equal(run('app-cli.js', { mode: 'skip', id: p.id })[0].isSkip, true);
		for (let update = 0; update < 2; update++) {
			const [reserve] = run('app-scheduler.js');
			assert.equal(reserve.isSkip, true);
			assert.equal(reserve.isManualReserved, true);
			assert.equal(reserve.isAutoSkip, undefined);
		}
		const [restored] = run('app-cli.js', { mode: 'unskip', id: p.id });
		assert.equal(restored.isManualReserved, true);
		assert.equal(restored.isSkip, undefined);
		const [reserve] = run('app-scheduler.js');
		assert.equal(reserve.isSkip, undefined);
		assert.equal(reserve.isManualReserved, true);
	});

	it('keeps excluded duplicates visible and does not allocate a tuner to them', function () {
		const p = program({ fullTitle: '再放送' });
		const duplicate = program({ id: 'two', start: p.start, end: p.end, fullTitle: 'Live' });
		p.channel.sid = 2;
		files['schedule.json'] = JSON.stringify([{ programs: [p, duplicate] }]);
		const reserves = run('app-scheduler.js');
		assert.equal(reserves.length, 2);
		assert.equal(reserves.find(r => r.id === p.id).isSkip, true);
		assert.equal(reserves.find(r => r.id === duplicate.id).isConflict, false);
	});

	for (const reversed of [false, true]) {
		for (const skippedSid of [1, 2]) {
			for (const manual of [false, true]) {
				it(`does not replace a manual skip with a duplicate service (reversed=${reversed}, sid=${skippedSid}, manual=${manual})`, function () {
					const first = program({ id: 'first', isManualReserved: manual });
					const second = program({ id: 'second', start: first.start, end: first.end });
					first.channel.sid = skippedSid;
					second.channel.sid = skippedSid === 1 ? 2 : 1;
					files['excludes.json'] = '[]';
					files['reserves.json'] = JSON.stringify([first]);
					files['schedule.json'] = JSON.stringify([{ programs: reversed ? [second, first] : [first, second] }]);
					assert.equal(run('app-cli.js', { mode: 'skip', id: first.id })[0].isSkip, true);
					for (let update = 0; update < 3; update++) {
						const reserves = run('app-scheduler.js');
						assert.equal(reserves.length, 1);
						assert.equal(reserves[0].id, first.id);
						assert.equal(reserves[0].isSkip, true);
						assert.equal(reserves[0].isAutoSkip, undefined);
					}
					run('app-cli.js', { mode: 'unskip', id: first.id });
					const restored = run('app-scheduler.js');
					assert.equal(restored.length, 1);
					assert.equal(restored[0].isSkip, undefined);
				});
			}
		}
	}

	for (const reversed of [false, true]) {
		for (const skippedSid of [1, 2]) {
			it(`preserves a manually added duplicate alongside a skipped service (reversed=${reversed}, sid=${skippedSid})`, function () {
				const first = program({ id: 'first' });
				const second = program({ id: 'second', start: first.start, end: first.end });
				first.channel.sid = skippedSid;
				second.channel.sid = skippedSid === 1 ? 2 : 1;
				files['excludes.json'] = '[]';
				files['reserves.json'] = JSON.stringify([first]);
				files['schedule.json'] = JSON.stringify([{ programs: reversed ? [second, first] : [first, second] }]);
				run('app-cli.js', { mode: 'skip', id: first.id });
				assert.equal(run('app-scheduler.js').length, 1);
				run('app-cli.js', { mode: 'reserve', id: second.id });
				for (let update = 0; update < 3; update++) {
					const reserves = run('app-scheduler.js');
					assert.equal(reserves.length, 2);
					assert.equal(reserves.find(p => p.id === first.id).isSkip, true);
					const manual = reserves.find(p => p.id === second.id);
					assert.equal(manual.isManualReserved, true);
					assert.equal(manual.isSkip, undefined);
					assert.equal(manual.isConflict, false);
				}
			});
		}
	}

	it('preserves undoing a manual reservation skip while its sibling remains skipped', function () {
		const first = program({ id: 'first', isSkip: true });
		const second = program({ id: 'second', start: first.start, end: first.end, isManualReserved: true, isSkip: true });
		second.channel.sid = 2;
		files['excludes.json'] = '[]';
		files['reserves.json'] = JSON.stringify([first, second]);
		files['schedule.json'] = JSON.stringify([{ programs: [first, second] }]);
		run('app-cli.js', { mode: 'unskip', id: second.id });
		for (let update = 0; update < 2; update++) {
			const reserves = run('app-scheduler.js');
			assert.equal(reserves.length, 2);
			assert.equal(reserves.find(p => p.id === first.id).isSkip, true);
			assert.equal(reserves.find(p => p.id === second.id).isSkip, undefined);
		}
	});

	it('preserves a manual reservation among three duplicate services in all six orders', function () {
		const skipped = program({ id: 'skipped', isSkip: true });
		const automatic = program({ id: 'automatic', start: skipped.start, end: skipped.end });
		const manual = program({ id: 'manual', start: skipped.start, end: skipped.end, isManualReserved: true });
		automatic.channel.sid = 2;
		manual.channel.sid = 3;
		for (const order of permutations([skipped, automatic, manual])) {
			files['excludes.json'] = '[]';
			files['reserves.json'] = JSON.stringify([skipped, manual]);
			files['schedule.json'] = JSON.stringify([{ programs: order }]);
			for (let update = 0; update < 3; update++) {
				const reserves = run('app-scheduler.js');
				assert.equal(reserves.length, 2);
				assert.equal(reserves.find(p => p.id === skipped.id).isSkip, true);
				const recording = reserves.find(p => p.id === manual.id);
				assert.equal(recording.isManualReserved, true);
				assert.equal(recording.isSkip, undefined);
				assert.equal(recording.isConflict, false);
			}
		}
	});

	it('keeps an explicitly unskipped duplicate recordable alongside a manually skipped service', function () {
		const first = program({ id: 'first' });
		const second = program({ id: 'second', start: first.start, end: first.end });
		second.channel.sid = 2;
		files['excludes.json'] = JSON.stringify([{ sid: 2, reserve_titles: ['再放送'] }]);
		files['schedule.json'] = JSON.stringify([{ programs: [first, second] }]);
		run('app-scheduler.js');
		run('app-cli.js', { mode: 'skip', id: first.id });
		run('app-cli.js', { mode: 'unskip', id: second.id });
		for (let update = 0; update < 2; update++) {
			const reserves = run('app-scheduler.js');
			assert.equal(reserves.length, 2);
			assert.equal(reserves.find(p => p.id === first.id).isSkip, true);
			const restored = reserves.find(p => p.id === second.id);
			assert.equal(restored.isSkip, undefined);
			assert.equal(restored.autoSkipOverride, true);
			assert.equal(restored.isConflict, false);
		}
	});

	for (const changed of ['type', 'channel', 'start', 'end', 'title']) {
		it(`does not suppress another airing differing in ${changed}`, function () {
			const first = program({ id: 'first', isSkip: true });
			const second = program({ id: 'second', start: first.start, end: first.end });
			second.channel.sid = 2;
			if (changed === 'type') second.channel.type = 'BS';
			else if (changed === 'channel') second.channel.channel = '28';
			else if (changed === 'title') second.title = 'Other';
			else second[changed] += 60000;
			files['excludes.json'] = '[]';
			files['reserves.json'] = JSON.stringify([first]);
			files['schedule.json'] = JSON.stringify([{ programs: [first, second] }]);
			const reserves = run('app-scheduler.js');
			assert.equal(reserves.length, 2);
			assert.equal(reserves.find(p => p.id === first.id).isSkip, true);
			assert.equal(reserves.find(p => p.id === second.id).isSkip, undefined);
		});
	}

	for (const reversed of [false, true]) {
		it(`preserves an overridden duplicate across two updates and re-skip (reversed=${reversed})`, function () {
			const first = program({ id: 'first' });
			const second = program({ id: 'second', start: first.start, end: first.end });
			second.channel.sid = 2;
			files['excludes.json'] = JSON.stringify([{ sid: 2, reserve_titles: ['再放送'] }]);
			files['schedule.json'] = JSON.stringify([{ programs: reversed ? [second, first] : [first, second] }]);
			assert.equal(run('app-scheduler.js').find(p => p.id === second.id).isAutoSkip, true);
			run('app-cli.js', { mode: 'unskip', id: second.id });

			for (let update = 0; update < 2; update++) {
				const reserves = run('app-scheduler.js');
				assert.equal(reserves.length, 1);
				assert.equal(reserves[0].id, second.id);
				assert.equal(reserves[0].autoSkipOverride, true);
				assert.equal(reserves[0].isSkip, undefined);
				assert.equal(reserves[0].isConflict, false);
				assert.deepEqual(reserves[0].excludedKeywords, ['再放送']);
			}

			run('app-cli.js', { mode: 'skip', id: second.id });
			for (let update = 0; update < 2; update++) {
				const reserves = run('app-scheduler.js');
				assert.equal(reserves.length, 2);
				assert.equal(reserves.find(p => p.id === second.id).autoSkipOverride, undefined);
				assert.equal(reserves.find(p => p.id === second.id).isAutoSkip, true);
				assert.equal(reserves.find(p => p.id === first.id).isSkip, undefined);
				assert.equal(reserves.find(p => p.id === first.id).isConflict, false);
			}
		});
	}

	it('preserves every explicit override when both duplicate services are unskipped', function () {
		const first = program({ id: 'first' });
		const second = program({ id: 'second', start: first.start, end: first.end });
		second.channel.sid = 2;
		files['schedule.json'] = JSON.stringify([{ programs: [first, second] }]);
		run('app-scheduler.js');
		run('app-cli.js', { mode: 'unskip', id: first.id });
		run('app-cli.js', { mode: 'unskip', id: second.id });
		for (let update = 0; update < 2; update++) {
			const reserves = run('app-scheduler.js');
			assert.equal(reserves.length, 2);
			assert.ok(reserves.every(p => p.autoSkipOverride && !p.isSkip && !p.isDuplicate));
			assert.equal(reserves.filter(p => p.isConflict).length, 1);
		}
	});
});
