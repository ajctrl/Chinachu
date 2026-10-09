'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const common = require('chinachu-common');

describe('media API process isolation', function() {
	let directory, executable, filename;
	beforeEach(function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-media-'));
		executable = path.join(directory, 'tool.cjs');
		fs.writeFileSync(executable, `
			if (process.env.TEST_FAIL) process.exit(1);
			const args = process.argv.slice(2);
			const input = args.includes('/proc/self/fd/3') ? require('node:fs').readFileSync('/proc/self/fd/3', 'utf8') : null;
			if (input !== null && input !== 'recording bytes') process.exit(2);
			if (process.env.TEST_TOOL === 'ffprobe') {
				process.stdout.write(JSON.stringify({ format: { duration: '30', size: '1024', bit_rate: '1000' } }));
			} else if (args.includes('pipe:0')) {
				let input = ''; process.stdin.on('data', chunk => { input += chunk; });
				process.stdin.on('end', () => process.stdout.write(JSON.stringify({ args, input })));
			} else process.stdout.write(JSON.stringify({ args, input }));
		`);
		filename = path.join(directory, '日本語 $(touch injected) `touch second` "quoted".m2ts');
		fs.writeFileSync(filename, 'recording bytes');
	});
	afterEach(function() { fs.rmSync(directory, { recursive: true, force: true }); });

	function run(script, fail = false, replace = false) {
		function replacePath() {
			if (!replace) return;
			fs.renameSync(filename, filename + ".original");
			const outside = path.join(directory, "outside");
			fs.writeFileSync(outside, "wrong bytes");
			fs.symlinkSync(outside, filename);
		}
		const program = { id: 'one', pid: 1, recorded: filename, title: 'test' };
		const calls = [], children = [];
		return new Promise((resolve, reject) => {
			const response = new EventEmitter();
			let status;
			response.head = code => { status = code; };
			response.setHeader = () => {};
			response.write = () => {};
			response.end = body => { resolve({ status, body, calls, children }); response.emit('close'); };
			response.error = code => { status = code; response.end(); };
			try {
				vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/', script), 'utf8'), {
					Buffer, URL, fs, path, chinachu: common, config: { recordedDir: directory }, children, log() {},
					data: { recorded: [program], recording: [program], status: { feature: { previewer: true, streamer: true } } },
					request: { param: { id: 'one' }, query: {}, headers: {}, type: script.includes('watch') ? 'xspf' : 'jpg', url: '/api/recorded/one/watch.xspf' }, response,
					child_process: { spawn(tool, args, options) {
						replacePath();
						calls.push({ tool, args: Array.from(args), options });
						return childProcess.spawn(process.execPath, [executable, ...args], {
							...options, cwd: directory, env: { ...process.env, TEST_TOOL: tool, TEST_FAIL: fail ? '1' : '' }
						});
					}, execFile(tool, args, options, callback) {
						replacePath();
						calls.push({ tool, args: Array.from(args), options });
						assert.notEqual(options.shell, true);
						return childProcess.execFile(process.execPath, [executable, ...args], {
							...options, cwd: directory, env: { ...process.env, TEST_TOOL: tool, TEST_FAIL: fail ? '1' : '' }
						}, callback);
					} }
				});
			} catch (error) { reject(error); }
		});
	}

	it('reads a recorded preview through an inherited descriptor without executing filename substitutions', async function() {
		const result = await run('script-recorded-program-preview.vm.js');
		assert.equal(result.status, 200);
		assert.equal(result.calls[0].tool, 'ffmpeg');
		const args = JSON.parse(Buffer.from(result.body, 'binary').toString('utf8')).args;
		assert.equal(args[args.indexOf('-i') + 1], '/proc/self/fd/3');
		assert.equal(JSON.parse(Buffer.from(result.body, 'binary').toString('utf8')).input, 'recording bytes');
		assert.ok(!fs.existsSync(path.join(directory, 'injected')));
		assert.ok(!fs.existsSync(path.join(directory, 'second')));
	});
	it('reads recording preview bytes using a Node stream rather than a shell pipeline', async function() {
		const result = await run('script-recording-program-preview.vm.js');
		assert.equal(result.status, 200);
		const output = JSON.parse(result.body);
		assert.equal(output.input, 'recording bytes');
		assert.equal(output.args[output.args.indexOf('-i') + 1], 'pipe:0');
		assert.ok(!fs.existsSync(path.join(directory, 'injected')));
		assert.ok(!fs.existsSync(path.join(directory, 'second')));
	});
	it('probes the inherited descriptor and returns its playlist', async function() {
		const result = await run('script-recorded-program-watch.vm.js');
		assert.equal(result.status, 200);
		assert.equal(result.calls[0].tool, 'ffprobe');
		assert.equal(result.calls[0].args.at(-1), '/proc/self/fd/3');
		assert.equal(result.children.length, 0);
		assert.ok(!fs.existsSync(path.join(directory, 'injected')));
		assert.ok(!fs.existsSync(path.join(directory, 'second')));
	});
	for (const script of ['script-recorded-program-preview.vm.js', 'script-recording-program-preview.vm.js', 'script-recorded-program-watch.vm.js']) {
		it('keeps reading the opened file after its name is replaced in ' + script, async function() {
			const result = await run(script, false, true);
			assert.equal(result.status, 200);
			if (!script.includes('watch')) assert.equal(JSON.parse(result.body).input, 'recording bytes');
		});
	}

	it('keeps the same file for playback when its name changes after probing', async function() {
		const response = new PassThrough();
		response.head = code => assert.equal(code, 200);
		response.setHeader = () => {};
		response.error = code => assert.fail('unexpected watch status ' + code);
		const request = new EventEmitter();
		Object.assign(request, { param: { id: 'one' }, query: {}, headers: {}, type: 'm2ts' });
		const children = [];
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/script-recorded-program-watch.vm.js'), 'utf8'), {
			fs, path, request, response, children, chinachu: common, config: { recordedDir: directory }, log() {},
			data: { recorded: [{ id: 'one', recorded: filename }], status: { feature: { streamer: true } } },
			child_process: { spawn(tool, args, options) {
				const child = childProcess.spawn(process.execPath, [executable, ...args], {
					...options, env: { ...process.env, TEST_TOOL: 'ffprobe' }
				});
				child.once('exit', () => {
					fs.renameSync(filename, filename + '.original');
					const outside = path.join(directory, 'outside');
					fs.writeFileSync(outside, 'wrong bytes');
					fs.symlinkSync(outside, filename);
				});
				return child;
			} }
		});
		let body = '';
		for await (const chunk of response) body += chunk;
		assert.equal(body, 'recording bytes');
	});
	for (const query of [{}, { ss: '5' }]) {
		it('inherits the secured live recording for ' + (query.ss ? 'seeked transcoding' : 'tail streaming'), async function() {
			const response = new PassThrough();
			response.head = code => assert.equal(code, 200);
			response.error = code => assert.fail('unexpected watch status ' + code);
			const request = new EventEmitter();
			Object.assign(request, { param: { id: 'one' }, query, headers: {}, type: 'm2ts' });
			const children = [];
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/script-recording-program-watch.vm.js'), 'utf8'), {
				fs, path, request, response, children, chinachu: common, config: { recordedDir: directory }, log() {},
				data: { recording: [{ id: 'one', pid: 1, recorded: filename }], status: { feature: { streamer: true } } },
				child_process: { spawn(tool, args, options) {
					fs.renameSync(filename, filename + '.original');
					fs.symlinkSync(path.join(directory, 'does-not-exist'), filename);
					return childProcess.spawn(process.execPath, ['-e', "process.stdout.write(require('node:fs').readFileSync('/proc/self/fd/3'));"], options);
				} }
			});
			let body = '';
			for await (const chunk of response) body += chunk;
			assert.equal(body, 'recording bytes');
		});
	}

	it('returns an error status when either preview process fails', async function() {
		for (const script of ['script-recorded-program-preview.vm.js', 'script-recording-program-preview.vm.js']) {
			assert.equal((await run(script, true)).status, 503);
		}
	});
});

describe('media API child process cleanup', function() {
	function fixture(script) {
		const process = new EventEmitter();
		process.pid = 12345;
		process.exitCode = null;
		process.signalCode = null;
		process.stdin = new PassThrough();
		process.stdout = new PassThrough();
		process.stderr = new PassThrough();
		process.kill = signal => { process.signals.push(signal); };
		process.signals = [];
		const other = { pid: 54321, exitCode: null, signalCode: null, signals: [], kill(signal) { this.signals.push(signal); } };
		const children = [other];
		const response = new PassThrough();
		response.head = () => {};
		response.setHeader = () => {};
		response.error = code => { assert.fail('unexpected response error: ' + code); };
		const request = new EventEmitter();
		Object.assign(request, { param: { id: 'one' }, query: {}, headers: {}, type: script.includes('watch') ? 'm2ts' : 'jpg' });
		const input = new PassThrough();
		let complete;
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/', script), 'utf8'), {
			request, response, children, Buffer, URL, path, chinachu: { ...common, openRecordingFile() { return 9; } }, config: {}, log() {},
			data: { recorded: [{ id: 'one', recorded: '/mock/recording.ts' }], recording: [{ id: 'one', pid: 1, recorded: '/mock/recording.ts' }], status: { feature: { streamer: true, previewer: true } } },
			fs: { existsSync: () => true, fstatSync: () => ({ size: 100 }), closeSync() {}, createReadStream: () => input },
			child_process: {
				execFile(tool, args, options, done) { complete = done; return process; },
				spawn() {
					complete = (error, stdout = '', stderr = '') => {
						if (error) process.emit('error', error);
						process.stdout.emit('data', Buffer.from(stdout));
						process.stderr.emit('data', Buffer.from(stderr));
						process.emit('close', error ? 1 : 0, null);
					};
					return process;
				}
			}
		});
		return { process, other, children, response, input, complete };
	}

	for (const script of ['script-recorded-program-watch.vm.js', 'script-recorded-program-preview.vm.js', 'script-recording-program-preview.vm.js']) {
		it('never signals a reused PID after the process exits in ' + script, function() {
			const { process, other, children, response, input, complete } = fixture(script);
			try {
				assert.equal(children.length, 2);
				assert.equal(children[1], process);
				process.exitCode = 0;
				process.emit('exit', 0);
				complete(null, script.includes('watch') ? JSON.stringify({ format: { duration: '7200', size: '900000000', bit_rate: '1000000' } }) : 'image', '');
				if (script.includes('watch')) assert.equal(response.writableEnded, false, 'watch stream remains active after the probe exits');
				const source = fs.readFileSync(path.join(__dirname, '../app-wui.js'), 'utf8').replace(/\r\n/g, '\n');
				const start = source.indexOf('\t\t\tcleanup = function () {');
				const end = source.indexOf("\n\t\t\tres.on('close'", start);
				vm.runInNewContext(source.slice(start, end) + '\ncleanup();', {
					sandbox: { children }, cleanup: null, onResponseClose() {}, emptyFunction() {}, log() {},
					setTimeout(done) { done(); }, res: { removeListener() {} }
				});
				assert.deepEqual(other.signals, ['SIGKILL'], 'cleanup stops the other running child');
				assert.deepEqual(process.signals, [], 'cleanup does not signal the exited child');
			} finally { input.destroy(); response.destroy(); process.stdin.destroy(); }
		});
	}

	it('does not signal a reused PID after the log stream exits', function() {
		const tail = new EventEmitter();
		tail.pid = 23456;
		tail.exitCode = null;
		tail.signalCode = null;
		tail.signals = [];
		tail.kill = signal => tail.signals.push(signal);
		tail.stdout = new PassThrough();
		const children = [];
		const response = new PassThrough();
		response.head = () => {};
		const request = new EventEmitter();
		request.param = { name: 'wui' };
		try {
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/script-log-stream.vm.js'), 'utf8'), {
				request, response, children, define: { WUI_LOG_FILE: '/mock/wui.log' },
				fs: { existsSync: () => true }, child_process: { spawn: () => tail }
			});
			assert.equal(children[0], tail);
			tail.exitCode = 0;
			tail.emit('exit', 0);
			const source = fs.readFileSync(path.join(__dirname, '../app-wui.js'), 'utf8').replace(/\r\n/g, '\n');
			const start = source.indexOf('\t\t\tcleanup = function () {');
			const end = source.indexOf("\n\t\t\tres.on('close'", start);
			vm.runInNewContext(source.slice(start, end) + '\ncleanup();', {
				sandbox: { children }, cleanup: null, onResponseClose() {}, emptyFunction() {}, log() {},
				setTimeout(done) { done(); }, res: { removeListener() {} }
			});
			assert.deepEqual(tail.signals, []);
		} finally { tail.stdout.destroy(); response.destroy(); }
	});

	it('still stops a running probe on disconnect and ignores its later callback', function() {
		const { process, other, children, response, input, complete } = fixture('script-recorded-program-watch.vm.js');
		try {
			response.emit('close');
			assert.deepEqual(process.signals, ['SIGKILL']);
			process.signalCode = 'SIGKILL';
			process.emit('exit', null, 'SIGKILL');
			complete(new Error('probe was killed'));
			assert.deepEqual(children, [other]);
		} finally { input.destroy(); response.destroy(); process.stdin.destroy(); }
	});
});

describe('storage API without shell expansion', function() {
	it('uses statfs for a directory containing shell characters and returns capacity', function() {
		let status, result;
		const directory = '/recorded/$(touch injected)`echo x`';
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/script-storage.vm.js'), 'utf8'), {
			config: { recordedDir: directory }, data: { recorded: [] }, request: { method: 'GET' }, log() {},
			fs: { statfs(name, done) { assert.equal(name, directory); done(null, { blocks: 100, bfree: 30, bavail: 20, bsize: 4096 }); } },
			response: { head(code) { status = code; }, end(body) { result = JSON.parse(body); }, error() { assert.fail('unexpected statfs error'); } }
		});
		assert.equal(status, 200);
		assert.equal(result.size, 100 * 4096);
		assert.equal(result.used, 70 * 4096);
		assert.equal(result.avail, 20 * 4096);
	});
});

describe('bounded media processes with inherited files', function() {
	let directory, fd;
	beforeEach(function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-media-fd-'));
		const name = path.join(directory, 'recording.ts');
		fs.writeFileSync(name, 'input');
		fd = common.openRecordingFile(directory, name);
	});
	afterEach(function() { fs.closeSync(fd); fs.rmSync(directory, { recursive: true, force: true }); });
	function execute(source, options = {}) {
		return new Promise(resolve => {
			common.execFileWithFd(process.execPath, ['-e', source], fd, { timeout: 1000, maxBuffer: 1024, ...options }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
		});
	}
	it('opens and seeks the inherited descriptor after the original pathname is removed', async function() {
		fs.unlinkSync(path.join(directory, 'recording.ts'));
		const result = await execute("const fs=require('node:fs'); const f=fs.openSync('/proc/self/fd/3','r'); const b=Buffer.alloc(2); fs.readSync(f,b,0,2,2); process.stdout.write(b);");
		assert.equal(result.error, null);
		assert.equal(result.stdout, 'pu');
	});
	it('preserves stderr and reports a failing exit', async function() {
		const result = await execute("process.stderr.write('failure'); process.exitCode=7;");
		assert.ok(result.error);
		assert.equal(result.stderr, 'failure');
	});
	it('kills processes that exceed the stdout or stderr limit', async function() {
		for (const stream of ['stdout', 'stderr']) {
			const result = await execute("process." + stream + ".write('x'.repeat(2048)); setInterval(()=>{},1000);");
			assert.match(result.error.message, /maxBuffer/);
			assert.ok(result.stdout.length <= 1024 && result.stderr.length <= 1024);
		}
	});
	it('kills a process that exceeds its time limit', async function() {
		const result = await execute('setInterval(()=>{},1000);', { timeout: 100 });
		assert.match(result.error.message, /SIGKILL/);
	});
});
