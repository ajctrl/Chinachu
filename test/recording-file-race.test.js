'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const common = require('chinachu-common');
const files = require('../common/lib/recording-path');

// Swap real directories at deterministic I/O boundaries; no live DVR data.
describe('recording file directory replacement', function() {
	let base, root, outside, filename, outsideFile;
	beforeEach(function() {
		base = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-race-'));
		root = path.join(base, 'recorded');
		outside = path.join(base, 'outside');
		for (const directory of [root, outside]) fs.mkdirSync(path.join(directory, 'series', 'season'), { recursive: true });
		filename = path.join(root, 'series', 'season', 'episode.ts');
		outsideFile = path.join(outside, 'series', 'season', 'episode.ts');
		fs.writeFileSync(filename, 'inside');
		fs.writeFileSync(outsideFile, 'outside');
	});
	afterEach(function() { fs.rmSync(base, { recursive: true, force: true }); });

	function swap() {
		fs.renameSync(path.join(root, 'series'), path.join(root, 'original'));
		fs.symlinkSync(path.join(outside, 'series'), path.join(root, 'series'));
	}
	function racingIO(beforeOpen = false) {
		let swapped = false;
		return { ...fs, openSync(name, ...args) {
			const replace = !swapped && name.endsWith('/series');
			if (replace && beforeOpen) { swap(); swapped = true; }
			const fd = fs.openSync(name, ...args);
			if (replace && !beforeOpen) { swap(); swapped = true; }
			return fd;
		} };
	}

	it('keeps nested reads on the opened directory after its old name becomes a symlink', function() {
		const fd = files.openRecordingFile(root, filename, false, racingIO());
		try { assert.equal(fs.readFileSync(fd, 'utf8'), 'inside'); }
		finally { fs.closeSync(fd); }
	});
	it('keeps append writes on the opened directory after replacement', function() {
		const fd = files.openRecordingFile(root, filename, true, racingIO());
		try { fs.writeSync(fd, '+recording'); }
		finally { fs.closeSync(fd); }
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
		assert.equal(fs.readFileSync(path.join(root, 'original/season/episode.ts'), 'utf8'), 'inside+recording');
	});
	it('unlinks only inside the opened parent after replacement', function() {
		assert.equal(files.removeRecordingFile(root, filename, racingIO()), true);
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
		assert.equal(fs.existsSync(path.join(root, 'original/season/episode.ts')), false);
	});
	it('rejects a link installed before a directory is opened and closes all acquired descriptors', function() {
		const open = new Set();
		const raced = racingIO(true);
		const io = { ...raced, openSync(...args) { const fd = raced.openSync(...args); open.add(fd); return fd; }, closeSync(fd) { open.delete(fd); fs.closeSync(fd); } };
		assert.throws(() => files.openRecordingFile(root, filename, true, io));
		assert.equal(open.size, 0);
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
	});
	it('rejects a symlink installed immediately after creating a subdirectory', function() {
		const target = path.join(root, 'new', 'file.ts');
		const io = { ...fs, mkdirSync(name) {
			fs.mkdirSync(name);
			fs.rmdirSync(name);
			fs.symlinkSync(outside, name);
		} };
		assert.throws(() => files.openRecordingFile(root, target, true, io));
		assert.equal(fs.existsSync(path.join(outside, 'file.ts')), false);
	});
	it('creates missing nested directories and refuses outside paths and final symlinks', function() {
		const target = path.join(root, 'new/deep/file.ts');
		const fd = files.openRecordingFile(root, target, true);
		fs.closeSync(fd);
		assert.ok(fs.existsSync(target));
		assert.throws(() => files.openRecordingFile(root, outsideFile));
		assert.throws(() => files.removeRecordingFile(root, outsideFile));
		fs.unlinkSync(filename);
		fs.symlinkSync(outsideFile, filename);
		assert.throws(() => files.openRecordingFile(root, filename));
		assert.throws(() => files.openRecordingFile(root, filename, true));
		assert.equal(files.removeRecordingFile(root, filename), true, 'unlink removes the link itself');
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
	});
	it('rejects hard links and directories instead of treating them as recordings', function() {
		fs.unlinkSync(filename);
		fs.linkSync(outsideFile, filename);
		assert.throws(() => files.openRecordingFile(root, filename));
		assert.throws(() => files.openRecordingFile(root, filename, true));
		assert.throws(() => files.openRecordingFile(root, path.join(root, 'series')));
	});
	it('allows a configured root symlink and reports missing deletes without following a subdirectory link', function() {
		const alias = path.join(base, 'alias');
		fs.symlinkSync(root, alias);
		const fd = files.openRecordingFile(alias, path.join(alias, 'series/season/episode.ts'));
		fs.closeSync(fd);
		assert.equal(files.removeRecordingFile(root, path.join(root, 'missing/file.ts')), false);
		swap();
		assert.throws(() => files.removeRecordingFile(root, filename));
	});
	it('reports unavailable procfs as an error instead of claiming a recording is already deleted', function() {
		const io = { ...fs, statSync() { throw Object.assign(new Error('procfs unavailable'), { code: 'ENOENT' }); } };
		assert.throws(() => files.openRecordingFile(root, filename, false, io), { code: 'ENOTSUP' });
		assert.throws(() => files.removeRecordingFile(root, filename, io), { code: 'ENOTSUP' });
		assert.equal(fs.readFileSync(filename, 'utf8'), 'inside');
	});

	function api(script, method, chinachu = common) {
		const response = new PassThrough();
		response.head = code => { response.status = code; };
		response.setHeader = () => {};
		response.error = code => { response.status = code; response.end(); };
		const program = { id: 'one', pid: 1, recorded: filename };
		const data = { recorded: [program], recording: [program], status: { feature: { filer: true, streamer: true, previewer: true } } };
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/', script), 'utf8'), {
			fs, path, chinachu, response, data, config: { recordedDir: root }, log() {},
			request: { method, param: { id: 'one' }, query: {}, type: 'm2ts', headers: {} },
			define: { RECORDED_DATA_FILE: path.join(base, 'recorded.json') }
		});
		return { response, data };
	}

	for (const script of ['script-recorded-program-file.vm.js', 'script-recorded-program-preview.vm.js', 'script-recorded-program-watch.vm.js', 'script-recording-program-preview.vm.js', 'script-recording-program-watch.vm.js']) {
		it('rejects replaced directories before reading or spawning tools in ' + script, function() {
			swap();
			const { response } = api(script, 'GET');
			assert.equal(response.status, 403);
			response.destroy();
		});
	}
	for (const script of ['script-recorded-program-file.vm.js', 'script-recorded-program.vm.js']) {
		it('still deletes a normal recording in ' + script, function() {
			const { response } = api(script, 'DELETE');
			assert.equal(response.status, 200);
			assert.equal(fs.existsSync(filename), false);
			assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
			response.destroy();
		});
		it('rejects replaced directories without deleting files or metadata in ' + script, function() {
			swap();
			const { response, data } = api(script, 'DELETE');
			assert.equal(response.status, 403);
			assert.equal(data.recorded.length, 1);
			assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
			assert.equal(fs.existsSync(path.join(base, 'recorded.json')), false);
			response.destroy();
		});
	}
	it('downloads the original opened file when a directory changes during an API request', async function() {
		const chinachu = { ...common, openRecordingFile(dir, name) { return files.openRecordingFile(dir, name, false, racingIO()); } };
		const { response } = api('script-recorded-program-file.vm.js', 'GET', chinachu);
		let content = '';
		for await (const chunk of response) content += chunk;
		assert.equal(response.status, 200);
		assert.equal(content, 'inside');
	});
	it('deletes only the original directory entry when a directory changes during an API request', function() {
		const chinachu = { ...common, removeRecordingFile(dir, name) { return files.removeRecordingFile(dir, name, racingIO()); } };
		const { response } = api('script-recorded-program-file.vm.js', 'DELETE', chinachu);
		assert.equal(response.status, 200);
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
		response.destroy();
	});
	function storageCleanup(recorded, io = fs) {
		const source = fs.readFileSync(path.join(__dirname, '../app-operator.js'), 'utf8');
		return vm.runInNewContext(source.slice(source.indexOf('function storageChecker()'), source.indexOf('// ファイル更新監視')) + '\nstorageChecker;', {
			fs: { ...io, statfs(dir, callback) { callback(null, { bavail: 0, bsize: 4096 }); } },
			chinachu: { ...common, removeRecordingFile(dir, name) { return files.removeRecordingFile(dir, name, io); } },
			config: { recordedDir: root }, recorded, log() {},
			storageLowSpaceThresholdMB: 10, storageLowSpaceCommand: '', storageLowSpaceAction: 'remove', storageLowSpaceNotifyTo: '',
			RECORDED_DATA_FILE: path.join(base, 'recorded.json')
		});
	}
	it('keeps automatic cleanup from deleting outside files or dropping their recording entries', function() {
		swap();
		const recorded = [{ recorded: filename }];
		storageCleanup(recorded)();
		assert.equal(recorded.length, 1);
		assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
		assert.equal(fs.existsSync(path.join(base, 'recorded.json')), false);
	});
	for (const reason of ['outside root', 'replaced directory', 'permission denied']) {
		it('skips ' + reason + ' entries and removes only one eligible recording per cleanup', function() {
			let blocked = outsideFile, io = fs;
			if (reason === 'replaced directory') { swap(); blocked = filename; }
			if (reason === 'permission denied') {
				blocked = filename;
				io = { ...fs, unlinkSync(target) {
					if (target.endsWith('/episode.ts')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
					return fs.unlinkSync(target);
				} };
			}
			const first = path.join(root, 'first.ts'), second = path.join(root, 'second.ts');
			fs.writeFileSync(first, 'first');
			fs.writeFileSync(second, 'second');
			const protectedEntry = { recorded: blocked };
			const recorded = [protectedEntry, { recorded: first }, { recorded: second }];
			const cleanup = storageCleanup(recorded, io);
			cleanup();
			assert.equal(fs.existsSync(first), false);
			assert.equal(fs.readFileSync(second, 'utf8'), 'second');
			assert.deepEqual(recorded, [protectedEntry, { recorded: second }]);
			assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'recorded.json'), 'utf8')), recorded);
			cleanup();
			assert.equal(fs.existsSync(second), false);
			assert.deepEqual(recorded, [protectedEntry]);
			assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'recorded.json'), 'utf8')), recorded);
			cleanup();
			assert.deepEqual(recorded, [protectedEntry]);
			assert.ok(fs.existsSync(blocked));
			assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
		});
	}
	it('does not delete more recordings when saving cleanup metadata fails', function() {
		const second = path.join(root, 'second.ts');
		fs.writeFileSync(second, 'second');
		const recorded = [{ recorded: filename }, { recorded: second }];
		storageCleanup(recorded, { ...fs, writeFileSync() { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); } })();
		assert.equal(fs.existsSync(filename), false);
		assert.equal(fs.readFileSync(second, 'utf8'), 'second');
		assert.deepEqual(recorded, [{ recorded: second }]);
	});
});
