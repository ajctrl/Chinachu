'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildCandidates } = require('../lib/reservation-planner');
const source = fs.readFileSync(path.join(__dirname, '../api/script-exclusion-rules.vm.js'), 'utf8');

describe('common exclusion rule API', function () {
	let dir, configFile;
	function request(method, rule, num, contentType = 'application/json') {
		let status, body;
		vm.runInNewContext(source, {
			fs, configStore: require('../lib/config-store'), define: { CONFIG_FILE: configFile },
			request: { method, query: rule, param: typeof num === 'undefined' ? {} : { num: String(num) }, headers: { 'content-type': contentType } },
			response: { head(code) { status = code; }, end(text) { body = JSON.parse(text); }, error(code) { status = code; } }
		});
		return { status, body };
	}
	function readConfig() { return JSON.parse(fs.readFileSync(configFile, 'utf8')); }
	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-exclusion-api-'));
		configFile = path.join(dir, 'config.json');
		fs.writeFileSync(configFile, JSON.stringify({ recordedDir: '/recordings', wuiUsers: ['secret'] }));
	});
	afterEach(function () { fs.rmSync(dir, { recursive: true }); });

	it('persists keyword operators and rejects invalid operators without writing', function () {
		const rule = { reserve_titles: ['猫'], reserve_fields_operator: 'or', reserve_titles_operator: 'and', reserve_descriptions_operator: 'or' };
		assert.equal(request('POST', rule).status, 201);
		assert.deepEqual(request('GET', null, 0).body, rule);
		const before = fs.readFileSync(configFile, 'utf8');
		for (const key of ['reserve_fields_operator', 'reserve_titles_operator', 'reserve_descriptions_operator']) {
			for (const value of ['xor', null, false, []]) {
				assert.equal(request('PUT', { ...rule, [key]: value }, 0).status, 400);
				assert.equal(fs.readFileSync(configFile, 'utf8'), before);
			}
		}
	});

	it('lists only exclusions and supports create, edit, enable, disable and delete across requests', function () {
		assert.deepEqual(request('GET'), { status: 200, body: [] });
		assert.equal(request('POST', { reserve_titles: ['再放送'], isEnabled: true }).status, 201);
		assert.deepEqual(request('GET', null, 0).body, { reserve_titles: ['再放送'], isDisabled: false });
		assert.equal(request('PUT', { reserve_descriptions: ['総集編'], isEnabled: false }, 0).status, 200);
		assert.equal(request('GET', null, 0).body.isDisabled, true);
		assert.equal(request('PUT', { reserve_descriptions: ['総集編'], isDisabled: true, isEnabled: true }, 0).status, 200);
		assert.equal(request('GET', null, 0).body.isDisabled, false);
		assert.equal(request('DELETE', null, 0).status, 200);
		assert.deepEqual(request('GET').body, []);
		assert.equal(request('GET', null, 0).status, 404);
		assert.deepEqual(readConfig(), { recordedDir: '/recordings', wuiUsers: ['secret'], autoExclusionRules: [] });
	});

	it('merges edits with current settings and supplies the scheduler without a restart', function () {
		request('POST', { reserve_titles: ['再放送'] });
		const current = readConfig();
		current.recordedDir = '/new-recordings';
		fs.writeFileSync(configFile, JSON.stringify(current));
		request('PUT', { reserve_titles: ['特別編'] }, 0);
		assert.equal(readConfig().recordedDir, '/new-recordings');
		const program = { id: 'one', fullTitle: '特別編', detail: '', channel: {}, start: Date.now() + 10000, end: Date.now() + 20000 };
		assert.equal(buildCandidates([{ programs: [program] }], [{}], [], readConfig())[0].isAutoSkip, true);
		request('PUT', { reserve_titles: ['特別編'], isEnabled: false }, 0);
		assert.equal(buildCandidates([{ programs: [program] }], [{}], [], readConfig())[0].isSkip, undefined);
	});

	it('rejects malformed conditions and invalid indices without changing the file', function () {
		const before = fs.readFileSync(configFile, 'utf8');
		for (const rule of [null, [], {}, { reserve_titles: '[' }, { reserve_titles: ['['] }, { reserve_titles: [1] }, { hour: null }, { duration: { min: 'abc' } }, { isEnabled: 'false' }]) {
			assert.equal(request('POST', rule).status, 400);
		}
		assert.equal(request('POST', { reserve_titles: ['再放送'] }, undefined, 'text/plain').status, 400);
		for (const num of [-1, '0oops', 99]) assert.equal(request('DELETE', null, num).status, 404);
		assert.equal(fs.readFileSync(configFile, 'utf8'), before);
	});
});
