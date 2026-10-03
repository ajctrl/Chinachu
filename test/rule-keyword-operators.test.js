'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const chinachu = require('chinachu-common');
const keys = ['reserve_fields_operator', 'reserve_titles_operator', 'reserve_descriptions_operator'];
const program = { title: '猫 映画', fullTitle: '猫 映画', detail: '猫 吹替', channel: { type: 'GR' }, flags: [] };
const cliSource = fs.readFileSync(require.resolve('../app-cli.js'), 'utf8');

function cliMatch(rule, p) {
	const context = { chinachu, rule, config: {}, opts: { get() {} } };
	vm.runInNewContext(cliSource.slice(cliSource.indexOf('function isMatchedProgram(program)')), context);
	return context.isMatchedProgram(p);
}

describe('rule keyword operators', function () {
	for (const [name, match] of [
		['scheduler', (r, p) => chinachu.programMatchesRule(r, p)], ['CLI', cliMatch]
	]) {
		describe(name, function () {
			it('defaults to OR within fields and AND between fields', function () {
				assert.equal(match({ reserve_titles: ['猫', '犬'], reserve_descriptions: ['吹替', '字幕'] }, program), true);
				assert.equal(match({ reserve_titles: ['猫'], reserve_descriptions: ['字幕'] }, program), false);
			});
			it('combines every choice of field and keyword operators', function () {
				for (const fields of ['and', 'or']) for (const titles of ['and', 'or']) for (const descriptions of ['and', 'or']) {
					const rule = { reserve_titles: ['猫', '犬'], reserve_descriptions: ['吹替', '字幕'],
						reserve_fields_operator: fields, reserve_titles_operator: titles, reserve_descriptions_operator: descriptions };
					assert.equal(match(rule, program), fields === 'and' ? titles === 'or' && descriptions === 'or' : titles === 'or' || descriptions === 'or');
				}
				assert.equal(match({ reserve_titles: ['猫', '映画'], reserve_titles_operator: 'and', reserve_descriptions: ['猫', '吹替'], reserve_descriptions_operator: 'and' }, program), true);
			});
			it('does not let missing fields satisfy OR and permits title-only matches without detail', function () {
				assert.equal(match({ reserve_titles: ['犬'], reserve_fields_operator: 'or' }, program), false);
				assert.equal(match({ reserve_titles: [], reserve_descriptions: ['字幕'], reserve_fields_operator: 'or' }, program), false);
				assert.equal(match({ reserve_fields_operator: 'or' }, program), true);
				assert.equal(match({ reserve_titles: [], reserve_descriptions: ['猫'] }, program), false);
				assert.equal(match({ reserve_titles: ['^$'] }, { ...program, title: '', fullTitle: '' }), true);
				assert.equal(match({ reserve_titles: ['猫'], reserve_descriptions: ['猫'], reserve_fields_operator: 'or' }, { ...program, detail: undefined }), true);
				assert.equal(match({ reserve_descriptions: ['.*'], reserve_fields_operator: 'or' }, { ...program, detail: undefined }), false);
			});
			it('still enforces other conditions and ignore keywords', function () {
				const rule = { reserve_titles: ['猫'], reserve_descriptions: ['犬'], reserve_fields_operator: 'or' };
				for (const condition of [{ types: ['BS'] }, { ignore_titles: ['映画'] }, { ignore_descriptions: ['吹替'] }, { duration: { min: 10, max: 20 } }]) {
					assert.equal(match({ ...rule, ...condition }, { ...program, seconds: 30 }), false);
				}
			});
		});
	}
	it('preserves normalization, regexes, and actual match evidence', function () {
		const rule = { reserve_titles: ['^ABC', '映画$'], reserve_titles_operator: 'and', reserve_descriptions: ['字幕'], reserve_fields_operator: 'or' };
		const p = { ...program, fullTitle: 'ＡＢＣ 映画' };
		assert.equal(chinachu.programMatchesRule(rule, p), false);
		assert.deepEqual(chinachu.getProgramMatchInfo([rule], p, 'NFKC'), { isMatched: true, keywords: ['^ABC', '映画$'] });
	});
});

describe('recording rule API operators', function () {
	for (const [file, method] of [['script-rules.vm.js', 'POST'], ['script-rules-rule.vm.js', 'PUT']]) {
		function request(query) {
			let status, saved;
			vm.runInNewContext(fs.readFileSync(require.resolve('../api/' + file), 'utf8'), {
				request: { method, query, param: { num: '0' }, headers: { 'content-type': 'application/json' } },
				data: { rules: [{}] }, define: { RULES_FILE: 'unused' },
				fs: { writeFileSync(file, body) { saved = JSON.parse(body); } },
				response: { head(code) { status = code; }, end() {}, error(code) { status = code; } }
			});
			return { status, saved };
		}
		it(method + ' persists operators and rejects invalid values before saving', function () {
			const rule = { reserve_titles: ['猫'], reserve_fields_operator: 'or', reserve_titles_operator: 'and', reserve_descriptions_operator: 'or' };
			assert.deepEqual(request(rule), { status: method === 'POST' ? 201 : 200, saved: method === 'POST' ? [{}, rule] : [rule] });
			for (const key of keys) for (const value of ['xor', '', null, false, []]) {
				assert.deepEqual(request({ ...rule, [key]: value }), { status: 400, saved: undefined });
			}
		});
	}
});
