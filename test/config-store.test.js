'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../lib/config-store');
const schema = require('../web/config-schema');
const api = fs.readFileSync(path.join(__dirname, '../api/script-config.vm.js'), 'utf8');

describe('configuration validation and atomic storage', function() {
	let dir, file, before;
	beforeEach(function() {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-config-'));
		file = path.join(dir, 'config.json');
		before = '{"recordedDir":"./recorded/","custom":{"keep":true}}\n';
		fs.writeFileSync(file, before, { mode: 0o640 });
	});
	afterEach(function() { fs.rmSync(dir, { recursive: true, force: true }); });
	function request(method, query = {}, configurator = true, configStore = store) {
		let status, body;
		const headers = {};
		vm.runInNewContext(api, {
			fs, configStore, define: { CONFIG_FILE: file }, data: { status: { feature: { configurator } } },
			request: { method, query }, response: {
				setHeader(key, value) { headers[key] = value; }, head(code) { status = code; },
				end(text) { body = JSON.parse(text); }, error(code) { status = code; }
			}
		});
		return { status, body, headers };
	}
	it('round-trips unknown keys, preserves permissions and backs up the previous file on each save', function() {
		const loaded = request('GET');
		assert.equal(loaded.headers.ETag, '"' + store.revision(before) + '"');
		const first = JSON.stringify({ ...loaded.body, operGotify: false });
		assert.equal(request('PUT', { json: first, revision: store.revision(before) }).status, 200);
		assert.equal(fs.readFileSync(file + '.bak', 'utf8'), before);
		assert.equal(fs.statSync(file).mode & 0o777, 0o640);
		assert.equal(fs.statSync(file + '.bak').mode & 0o777, 0o640);
		assert.equal(request('GET').body.custom.keep, true);
		const second = JSON.stringify({ ...loaded.body, operGotifyPriority: 7 });
		assert.equal(request('PUT', { json: second, revision: store.revision(first) }).status, 200);
		assert.equal(fs.readFileSync(file + '.bak', 'utf8'), first);
		assert.deepEqual(fs.readdirSync(dir).sort(), ['config.json', 'config.json.bak']);
	});
	it('rejects malformed JSON, form values and incomplete notification/TLS settings', function() {
		for (const json of ['{', 'null', '[]', 'false', '{"wuiPort":70000}', '{"operGotify":"true"}',
			'{"recordedDir":""}', '{"storageLowSpaceAction":"delete"}', '{"operGotifyTimeout":-1}',
			'{"operGotify":true}', '{"operGotifyFormat":[]}', '{"wuiTlsKeyPath":"key.pem"}', '{"mirakurunPath":"file:///tmp/a"}']) {
			assert.equal(request('PUT', { json, revision: store.revision(before) }).status, 400, json);
			assert.equal(fs.readFileSync(file, 'utf8'), before);
		}
		assert.deepEqual(fs.readdirSync(dir), ['config.json']);
		assert.deepEqual(schema.validate(JSON.parse(fs.readFileSync(path.join(__dirname, '../config.sample.json'), 'utf8'))), []);
	});
	it('rejects stale or missing revisions and respects the configurator feature gate', function() {
		assert.equal(request('PUT', { json: '{}' }).status, 428);
		assert.equal(request('PUT', { json: '{}', revision: 'stale' }).status, 409);
		assert.equal(request('PUT', { json: '{}', revision: store.revision(before) }, false).status, 403);
		assert.equal(request('GET', {}, false).status, 403);
		assert.equal(fs.readFileSync(file, 'utf8'), before);
	});
	it('rejects unsafe recording formats and invalid public origins without saving', function() {
		for (const recordedFormat of ['../outside.ts', '/tmp/outside.ts', 'name.' + 'x'.repeat(255), '<episode:1000000000>.ts']) {
			assert.equal(request('PUT', { json: JSON.stringify({ recordedFormat }), revision: store.revision(before) }).status, 400);
		}
		for (const origin of ['https://tv.example/path', 'https://user:password@tv.example', 'https://*.example', 'null', 'file:///tmp']) {
			assert.equal(request('PUT', { json: JSON.stringify({ wuiAllowedOrigins: [origin] }), revision: store.revision(before) }).status, 400);
		}
		assert.equal(fs.readFileSync(file, 'utf8'), before);
		assert.deepEqual(schema.validate({ wuiAllowedOrigins: ['https://tv.example:8443', 'http://localhost:20772'] }), []);
	});
	for (const operation of ['writeFileSync', 'fsyncSync', 'fchmodSync', 'backup-write', 'backup-rename', 'config-rename']) {
		it('keeps the original config and removes temporary files when ' + operation + ' fails', function() {
			let writes = 0;
			const io = new Proxy(fs, { get(target, property) {
				if (property === operation) return function() { throw Object.assign(new Error('test failure'), { code: 'ENOSPC' }); };
				if (property === 'writeFileSync' && operation === 'backup-write') return function() {
					if (++writes === 2) throw Object.assign(new Error('backup failure'), { code: 'EACCES' });
					return fs.writeFileSync.apply(fs, arguments);
				};
				if (property === 'renameSync') return function(from, to) {
					if ((operation === 'backup-rename' && to.endsWith('.bak')) || (operation === 'config-rename' && to === file)) throw Object.assign(new Error('rename failure'), { code: 'EACCES' });
					return fs.renameSync(from, to);
				};
				return target[property];
			} });
			const result = request('PUT', { json: '{}', revision: store.revision(before) }, true, {
				...store, save: (name, text, revision) => store.save(name, text, revision, io)
			});
			assert.equal(result.status, 500);
			assert.match(result.body.message, /失敗/);
			assert.equal(fs.readFileSync(file, 'utf8'), before);
			assert.ok(!fs.readdirSync(dir).some(name => name.endsWith('.tmp')));
		});
	}
	it('detects a change during preparation without overwriting the other writer', function() {
		const changed = '{"other":true}';
		const io = new Proxy(fs, { get(target, property) {
			if (property === 'renameSync') return function(from, to) {
				fs.renameSync(from, to);
				if (to.endsWith('.bak')) fs.writeFileSync(file, changed);
			};
			return target[property];
		} });
		assert.throws(() => store.save(file, '{}', store.revision(before), io), error => error.status === 409);
		assert.equal(fs.readFileSync(file, 'utf8'), changed);
	});
	it('validates Mirakurun endpoints using the client-supported formats while retaining Gotify HTTPS', function() {
		const { configureMirakurunClient } = require('../lib/mirakurun-client');
		const endpoints = [
			'http://localhost:40772/proxy/', 'http://[::1]:40772/',
			'http+unix://%2Fvar%2Frun%2Fmirakurun.sock/',
			'http://unix:%2Fvar%2Frun%2Fmirakurun.sock:/', 'http://unix:/var/run/mirakurun.sock:/',
			'https://localhost:40772/', 'file:///tmp/mirakurun.sock', 'http+unix://%ZZ/'
		];
		for (const endpoint of endpoints) {
			let supported = true;
			try { configureMirakurunClient({ basePath: '/api' }, endpoint); } catch (error) { supported = false; }
			assert.equal(schema.validate({ mirakurunPath: endpoint }).length === 0, supported, endpoint);
			const result = request('PUT', { json: JSON.stringify({ mirakurunPath: endpoint }), revision: store.revision(fs.readFileSync(file, 'utf8')) });
			assert.equal(result.status, supported ? 200 : 400, endpoint);
		}
		assert.deepEqual(schema.validate({ operGotifyUrl: 'https://gotify.example.com/' }), []);
	});
	it('repairs malformed source JSON with a backup and still rejects a stale revision', function() {
		const damaged = '{"recordedDir":';
		fs.writeFileSync(file, damaged);
		assert.equal(request('PUT', { json: before, revision: store.revision(damaged) }).status, 200);
		assert.equal(fs.readFileSync(file, 'utf8'), before);
		assert.equal(fs.readFileSync(file + '.bak', 'utf8'), damaged);
		assert.equal(request('PUT', { json: '{}', revision: store.revision(damaged) }).status, 409);
		assert.equal(fs.readFileSync(file, 'utf8'), before);
	});
	it('edits nested form fields without losing unknown notification options', function() {
		const config = { operGotifyFormat: { custom: 'keep', start: 'before' }, extra: { keep: true } };
		schema.set(config, 'operGotifyFormat.start', 'after');
		assert.deepEqual(config, { operGotifyFormat: { custom: 'keep', start: 'after' }, extra: { keep: true } });
		assert.deepEqual(schema.changes({ extra: true }, { extra: true, operGotify: false }), ['operGotify']);
	});
});
