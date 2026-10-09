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
async function watch(name, query, vaapiEnabled, type = 'mp4') {
	const calls = [], logs = [], heads = [], streams = [];
	let opened = 0, serviceRequests = 0;
	function stream() {
		const result = new PassThrough();
		streams.push(result);
		return result;
	}
	function child() {
		return Object.assign(new EventEmitter(), { stdin: stream(), stdout: stream(), stderr: stream(), kill() {} });
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
			fs: { closeSync() {}, createReadStream: stream },
			mirakurun: { async getServiceStream() { serviceRequests++; return stream(); } },
			child_process: { spawn(tool, args) { calls.push({ tool, args: Array.from(args) }); return child(); } }
		}, { timeout: 1000 });
		await new Promise(resolve => setImmediate(resolve));
		return { calls, logs, heads, opened, serviceRequests };
	} finally { streams.forEach(s => s.destroy()); }
}

describe('watch API size and debug security', function() {
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
