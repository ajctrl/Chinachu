'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const common = require('chinachu-common');

const scripts = ['channel', 'recording-program', 'recorded-program'];

// Run the real API scripts with inert media tools and no DVR/file access.
async function watch(name, query, vaapiEnabled, type = 'mp4', exercise = () => {}) {
	const calls = [], logs = [], heads = [], streams = [];
	let mediaChild, input;
	let opened = 0, serviceRequests = 0;
	function stream() {
		const result = new PassThrough();
		streams.push(result);
		return result;
	}
	function child() {
		return Object.assign(new EventEmitter(), { stdin: stream(), stdout: stream(), stderr: stream(), exitCode: null, signalCode: null,
			signals: [], kill(signal) { this.signals.push(signal); } });
	}
	const request = Object.assign(new EventEmitter(), {
		param: { id: 'one', chid: 'one' }, type, query, url: '/api/' + name + '/one/watch.' + type,
		headers: {
			authorization: 'Basic AUDIT_AUTH_SECRET', cookie: 'session=AUDIT_COOKIE_SECRET',
			'proxy-authorization': 'Basic AUDIT_PROXY_SECRET', 'x-api-key': 'AUDIT_API_SECRET'
		}
	});
	const response = stream();
	response.resume();
	response.head = code => heads.push(code);
	response.error = code => { heads.push(code); response.end(); };
	response.setHeader = () => {};
	const program = { id: 'one', pid: 1, recorded: '/mock/input.ts', title: 'Audit', name: 'Audit' };
	try {
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../api/script-' + name + '-watch.vm.js'), 'utf8'), {
			request, response, children: [], Buffer, URL, AbortController, path,
			log: (...args) => logs.push(args.join(' ')), config: { vaapiEnabled, recordedDir: '/mock' },
			data: { recorded: [program], recording: [program], schedule: [program], status: { feature: { streamer: true } } },
			chinachu: {
				...common, openRecordingFile() { opened++; return 9; },
				execFileWithFd(tool, args, fd, options, done) {
					calls.push({ tool, args: Array.from(args) });
					const result = child();
					queueMicrotask(() => done(null, JSON.stringify({ format: { duration: '30', size: '1024', bit_rate: '1000' } })));
					return result;
				}
			},
			fs: { closeSync() {}, createReadStream() { input = stream(); return input; } },
			mirakurun: { async getServiceStream() { serviceRequests++; return stream(); } },
			child_process: { spawn(tool, args) {
				const process = child(); calls.push({ tool, args: Array.from(args), process });
				if (tool === 'ffmpeg') mediaChild = process;
				return process;
			} }
		}, { timeout: 1000 });
		await new Promise(resolve => setImmediate(resolve));
		await exercise({ mediaChild, input, response, calls });
		return { calls, logs, heads, opened, serviceRequests };
	} finally { streams.forEach(s => s.destroy()); }
}

describe('watch API size and debug security', function() {
	it('stops live tail input on EPIPE while allowing the final encoded frame to drain', async function() {
		await watch('recording-program', { t: '1' }, false, 'mp4', async ({ mediaChild, response, calls }) => {
			const tail = calls.find(call => call.tool === 'tail').process;
			mediaChild.stdin.emit('error', Object.assign(new Error('closed input'), { code: 'EPIPE' }));
			assert.deepEqual(tail.signals, ['SIGKILL']);
			assert.deepEqual(mediaChild.signals, []);
			assert.equal(response.destroyed, false);
			let output = '';
			response.on('data', chunk => { output += chunk; });
			mediaChild.exitCode = 0; mediaChild.emit('exit', 0);
			assert.equal(response.writableEnded, false, 'process exit must not truncate stdout');
			mediaChild.stdout.end('final encoded frame');
			await new Promise(resolve => response.once('finish', resolve));
			mediaChild.emit('close', 0);
			assert.equal(output, 'final encoded frame');
			assert.deepEqual(mediaChild.signals, []);
		});
	});
	it('ends FFmpeg input when live tail exits without killing the encoder before it drains', async function() {
		await watch('recording-program', {}, false, 'mp4', ({ mediaChild, calls }) => {
			const tail = calls.find(call => call.tool === 'tail').process;
			tail.exitCode = 0; tail.emit('close', 0);
			assert.equal(mediaChild.stdin.writableEnded, true);
			assert.deepEqual(mediaChild.signals, []);
		});
	});
	for (const seeked of [false, true]) {
		it('stops every live media process on response disconnect (seek ' + seeked + ')', async function() {
			await watch('recording-program', seeked ? { ss: '2' } : {}, false, 'mp4', ({ response, calls }) => {
				response.emit('close');
				for (const call of calls) assert.deepEqual(call.process.signals, ['SIGKILL']);
			});
		});
		it('never signals an exited live media process on a late response disconnect (seek ' + seeked + ')', async function() {
			await watch('recording-program', seeked ? { ss: '2' } : {}, false, 'mp4', ({ mediaChild, response, calls }) => {
				for (const call of calls) call.process.exitCode = 0;
				mediaChild.emit('close', 0); response.emit('close');
				for (const call of calls) assert.deepEqual(call.process.signals, []);
			});
		});
	}
	for (const tool of ['ffmpeg', 'tail']) {
		it('closes live playback and stops its sibling when ' + tool + ' fails to start', async function() {
			await watch('recording-program', {}, false, 'mp4', ({ response, calls }) => {
				calls.find(call => call.tool === tool).process.emit('error', new Error('spawn failed'));
				assert.equal(response.destroyed, true);
				assert.deepEqual(calls.find(call => call.tool !== tool).process.signals, ['SIGKILL']);
			});
		});
	}
	it('stops reading on an early FFmpeg input close while preserving encoded output', async function() {
		await watch('recorded-program', { t: '1' }, false, 'mp4', async ({ mediaChild, input, response }) => {
			let output = '';
			response.on('data', chunk => { output += chunk; });
			mediaChild.stdin.emit('error', Object.assign(new Error('closed input'), { code: 'EPIPE' }));
			assert.equal(input.destroyed, true);
			assert.equal(response.destroyed, false);
			mediaChild.stdout.end('last encoded frame');
			await new Promise(resolve => response.once('finish', resolve));
			assert.equal(output, 'last encoded frame');
		});
	});
	for (const event of ['input error', 'spawn error', 'close']) {
		it('releases recording input after FFmpeg ' + event, async function() {
			await watch('recorded-program', {}, false, 'mp4', ({ mediaChild, input, response }) => {
				if (event === 'input error') mediaChild.stdin.emit('error', Object.assign(new Error('input failed'), { code: 'EIO' }));
				if (event === 'spawn error') mediaChild.emit('error', Object.assign(new Error('missing executable'), { code: 'ENOENT' }));
				if (event === 'close') mediaChild.emit('close', 0);
				assert.equal(input.destroyed, true);
				if (event !== 'close') assert.equal(response.destroyed, true);
			});
		});
	}
	for (const name of scripts) {
		for (const vaapi of [false, true]) {
			it('rejects unsafe sizes before any media access in ' + name + ' (VAAPI ' + vaapi + ')', async function() {
				const invalid = [
					'320x180,negate', '320x180;null', '320x180[out]', '320x180:format=nv12',
					'320,negatex180', '320x180\n', '320x180\r\n', '320x180\0',
					['320x180'], ['320x180', '640x360'], {}, null, true, 320,
					'', '0x180', '-1x180', '320x-1', '0320x180', '320X180', '320x180x1',
					'8193x1', '1x8193', '8192x4321', '999999999999x1'
				];
				for (const s of invalid) {
					const result = await watch(name, { s }, vaapi);
					assert.deepEqual(result.heads, [400], JSON.stringify(s));
					assert.equal(result.opened, 0);
					assert.equal(result.serviceRequests, 0);
					assert.deepEqual(result.calls, []);
				}
			});
			it('preserves valid and omitted sizes in ' + name + ' (VAAPI ' + vaapi + ')', async function() {
				for (const s of [undefined, '1024x576', '1280x720', '1920x1080', '3840x2160', '8192x4320']) {
					const result = await watch(name, s === undefined ? {} : { s }, vaapi);
					assert.deepEqual(result.heads, [200]);
					const args = result.calls.find(call => call.tool === 'ffmpeg').args;
					if (vaapi) {
						const scale = s ? ',scale_vaapi=w=' + s.replace('x', ':h=') : '';
						assert.equal(args[args.indexOf('-vf') + 1], 'format=nv12|vaapi,hwupload,deinterlace_vaapi' + scale);
					} else if (s) {
						assert.equal(args[args.indexOf('-s') + 1], s);
					} else assert.equal(args.includes('-s'), false);
				}
			});
		}
		for (const type of ['mp4', 'xspf']) {
			it('does not log credentials during debug ' + type + ' requests in ' + name, async function() {
				const result = await watch(name, { debug: '1' }, true, type);
				assert.deepEqual(result.heads, [200]);
				assert.doesNotMatch(result.logs.join('\n'), /AUDIT_(AUTH|COOKIE|PROXY|API)_SECRET/);
			});
		}
	}
});
