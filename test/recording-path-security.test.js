'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('chinachu-common');
const vm = require('node:vm');

describe('recording path security', function() {
	let directory;
	beforeEach(function() { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-path-')); });
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });
	const program = { title: '日本語 $(printf marker) `echo marker`', channel: { name: '放送局' }, episode: 1, start: Date.now() };
	it('allows nested relative filenames and preserves literal shell characters', function() {
		const name = common.formatRecordedName(program, 'series/<title>.m2ts');
		assert.ok(name.includes('$(printf marker)'));
		assert.equal(common.resolveRecordingPath(directory, name), path.join(directory, name));
	});
	it('rejects traversal, absolute paths and control characters before expansion', function() {
		for (const name of ['../outside.m2ts', 'series/../../outside', 'series/../outside', '/tmp/outside', 'C:\\outside', '..\\outside', '\\\\server\\file', 'name\0.ts', 'name\n.ts']) {
			assert.throws(() => common.formatRecordedName(program, name), undefined, name);
			assert.throws(() => common.resolveRecordingPath(directory, name), undefined, name);
		}
	});
	it('rejects traversal introduced through a metadata placeholder', function() {
		assert.throws(() => common.formatRecordedName({ category: '../outside' }, '<category>.m2ts'));
	});
	it('rejects overlong extensions and bounded episode padding without looping', function() {
		for (const suffix of ['a'.repeat(256), '字'.repeat(85)]) {
			assert.throws(() => common.formatRecordedName(program, 'name.' + suffix), /拡張子/);
		}
		assert.throws(() => common.formatRecordedName(program, '<episode:999999999>.m2ts'), /桁数/);
		const name = common.formatRecordedName({ ...program, title: '😀'.repeat(180) }, '<title>.m2ts');
		assert.ok(Buffer.byteLength(name) <= 255);
		assert.ok(!name.includes('\ufffd'));
	});
	it('rejects a symlink directory or existing symlink file inside the recording root', function() {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-outside-'));
		try {
			fs.symlinkSync(outside, path.join(directory, 'linked'));
			fs.symlinkSync(path.join(outside, 'file'), path.join(directory, 'file'));
			assert.throws(() => common.resolveRecordingPath(directory, 'linked/file'), /シンボリックリンク/);
			assert.throws(() => common.resolveRecordingPath(directory, 'file'), /シンボリックリンク/);
		} finally { fs.rmSync(outside, { recursive: true, force: true }); }
	});
});

describe('rule API recording format validation', function() {
	for (const [script, method] of [['script-rules.vm.js', 'POST'], ['script-rules-rule.vm.js', 'PUT']]) {
		function saveRule(query) {
			let status, saved, reply;
			const rules = [{ reserve_titles: ['original'], recorded_format: 'original/<title>.ts' }];
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/', script), 'utf8'), {
				chinachu: common, data: { rules }, define: { RULES_FILE: 'mock-rules.json' },
				request: { method, query, param: { num: '0' }, headers: { 'content-type': 'application/json' } },
				response: { error(code) { status = code; }, head(code) { status = code; }, end(body) { reply = JSON.parse(body); } },
				fs: { writeFileSync(file, body) { assert.equal(file, 'mock-rules.json'); saved = JSON.parse(body); } }
			});
			return { status, saved, reply };
		}
		it('uses the global format for blank, null or omitted ' + method + ' overrides', function() {
			for (const format of ['', null, undefined]) {
				const query = { reserve_titles: ['番組'] };
				if (format !== undefined) query.recorded_format = format;
				const { status, saved, reply } = saveRule(query);
				assert.equal(status, method === 'POST' ? 201 : 200);
				assert.deepEqual(reply, { reserve_titles: ['番組'] });
				assert.deepEqual(saved[method === 'POST' ? 1 : 0], reply);
			}
		});
		it('preserves a safe nonempty ' + method + ' format override', function() {
			const { status, saved, reply } = saveRule({ recorded_format: 'series/<title>.m2ts' });
			assert.equal(status, method === 'POST' ? 201 : 200);
			assert.equal(reply.recorded_format, 'series/<title>.m2ts');
			assert.deepEqual(saved[method === 'POST' ? 1 : 0], reply);
		});
		it('rejects invalid types for ' + method + ' format overrides without saving', function() {
			for (const recorded_format of [false, 0, [], {}]) {
				const { status, saved } = saveRule({ reserve_titles: ['番組'], recorded_format });
				assert.equal(status, 400);
				assert.equal(saved, undefined);
			}
		});
		it('rejects unsafe ' + method + ' formats before changing rules or files', function() {
			for (const format of ['../outside.ts', '/tmp/outside.ts', 'name.' + 'x'.repeat(255), '<episode:1000000000>.ts']) {
				let status;
				const rules = [{ reserve_titles: ['original'] }];
				vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/', script), 'utf8'), {
					chinachu: common, data: { rules },
					request: { method, query: { recorded_format: format }, param: { num: '0' }, headers: { 'content-type': 'application/json' } },
					response: { error(code) { status = code; }, head() { assert.fail('unsafe rule was accepted'); } },
					fs: { writeFileSync() { assert.fail('unsafe rule was written'); } }
				});
				assert.equal(status, 400, format);
				assert.deepEqual(rules, [{ reserve_titles: ['original'] }]);
			}
		});
	}
});
