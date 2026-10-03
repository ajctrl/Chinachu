'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/excludes-store');
const configStore = require('../lib/config-store');

describe('excludes storage', function () {
	let dir, file, configFile;
	beforeEach(function () {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-excludes-'));
		file = path.join(dir, 'excludes.json');
		configFile = path.join(dir, 'config.json');
		fs.writeFileSync(configFile, '{}', { mode: 0o640 });
	});
	afterEach(function () { fs.rmSync(dir, { recursive: true }); });

	it('uses legacy rules only when the new file is missing, including an empty new file', function () {
		const config = { autoExclusionRules: [{ reserve_titles: ['legacy'] }] };
		assert.deepEqual(store.read(file, config), { rules: config.autoExclusionRules, revision: null });
		assert.deepEqual(store.read(file, {}).rules, []);
		for (const rules of [[], [{ reserve_titles: ['new'] }]]) {
			fs.writeFileSync(file, JSON.stringify(rules));
			assert.deepEqual(store.read(file, config).rules, rules);
		}
		assert.deepEqual(store.read(file, { autoExclusionRules: null }).rules, [{ reserve_titles: ['new'] }]);
	});

	it('rejects malformed files and read errors instead of silently reusing legacy rules', function () {
		for (const text of ['{', '{}', 'null', '[1]', '[[]]']) {
			fs.writeFileSync(file, text);
			assert.throws(() => store.read(file, {}));
		}
		assert.throws(() => store.read(file, {}, {
			readFileSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
		}), error => error.code === 'EACCES');
	});

	it('preserves permissions, backs up exclusions, and rejects stale saves', function () {
		const first = [{ reserve_titles: ['first'] }];
		const saved = store.save(file, first, null, configFile);
		assert.equal(fs.statSync(file).mode & 0o777, 0o640);
		assert.equal(fs.existsSync(file + '.bak'), false);
		assert.equal(store.read(file, {}).revision, saved.revision);
		store.save(file, [], saved.revision, configFile);
		assert.deepEqual(store.read(file + '.bak', {}).rules, first);
		assert.equal(fs.statSync(file + '.bak').mode & 0o777, 0o640);
		assert.throws(() => store.save(file, first, saved.revision, configFile), error => error.status === 409);
		assert.deepEqual(store.read(file, {}).rules, []);
	});

	it('does not overwrite a file created by another writer during the first save', function () {
		const other = '[{"reserve_titles":["other"]}]';
		const io = new Proxy(fs, { get(target, property) {
			if (property === 'linkSync') return function (from, to) {
				fs.writeFileSync(file, other);
				return fs.linkSync(from, to);
			};
			return target[property];
		} });
		assert.throws(() => configStore.create(file, '[]', configFile, io), error => error.status === 409);
		assert.equal(fs.readFileSync(file, 'utf8'), other);
		assert.ok(!fs.readdirSync(dir).some(name => name.endsWith('.tmp')));
	});

	for (const operation of ['writeFileSync', 'fsyncSync', 'fchmodSync', 'linkSync']) {
		it('leaves no partially created file when ' + operation + ' fails', function () {
			const io = new Proxy(fs, { get(target, property) {
				if (property === operation) return function () { throw Object.assign(new Error('failure'), { code: 'ENOSPC' }); };
				return target[property];
			} });
			assert.throws(() => configStore.create(file, '[]', configFile, io), error => error.status === 500);
			assert.deepEqual(fs.readdirSync(dir), ['config.json']);
		});
	}
});
