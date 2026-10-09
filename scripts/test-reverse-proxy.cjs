#!/usr/bin/env node
'use strict';

// Run a real, isolated WUI behind Nginx. Requires nginx, openssl, ffmpeg and
// ffprobe on PATH (or NGINX_BIN). Nothing is written to the live configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('socket.io-client');

const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-proxy-'));
const nginxBin = process.env.NGINX_BIN || 'nginx';
const children = [];
const closers = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
const extended = process.argv.includes('--extended');

async function freePort() {
	const server = net.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = server.address().port;
	await new Promise(resolve => server.close(resolve));
	return port;
}

function launch(command, args, logFile, cwd = root) {
	const fd = fs.openSync(path.join(root, logFile), 'a');
	const env = { ...process.env };
	delete env.pm_id;
	const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd] });
	fs.closeSync(fd);
	child.on('error', error => { child.launchError = error; });
	children.push(child);
	return child;
}

async function ready(child, probe) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.launchError) throw child.launchError;
		assert.equal(child.exitCode, null, 'Server exited during startup');
		try { if (await probe()) return; } catch (_) {}
		await delay(100);
	}
	throw new Error('Server startup timed out');
}

async function check(name, fn) {
	await fn();
	console.log('PASS ' + name);
	passed++;
}

async function main() {
	execFileSync(nginxBin, ['-v'], { stdio: 'inherit' });
	const backendPort = await freePort();
	let proxyPort = await freePort();
	while (proxyPort === backendPort) proxyPort = await freePort();
	const origin = 'https://localhost:' + proxyPort;
	const publicHost = 'proxy.chinachu.test:' + proxyPort;
	const publicOrigin = 'https://' + publicHost;
	const password = crypto.randomBytes(24).toString('hex');
	const authorization = 'Basic ' + Buffer.from('proxy-test:' + password).toString('base64');
	const app = path.join(root, 'app');
	fs.mkdirSync(app);
	for (const name of ['app-wui.js', 'app-cli.js', 'package.json', 'processes.json', 'lib', 'api']) {
		fs.cpSync(path.join(repo, name), path.join(app, name), { recursive: true });
	}
	for (const name of ['node_modules', 'web', 'common']) fs.symlinkSync(path.join(repo, name), path.join(app, name), 'dir');
	for (const name of ['data', 'log', 'recorded']) fs.mkdirSync(path.join(app, name));
	const config = { ...JSON.parse(fs.readFileSync(path.join(repo, 'config.sample.json'))),
		uid: process.getuid(), gid: process.getgid(), wuiPort: backendPort,
		wuiHost: '127.0.0.1', wuiAllowedOrigins: [origin, publicOrigin],
		wuiUsers: ['proxy-test:' + password], wuiXFF: true };
	fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify(config));
	fs.writeFileSync(path.join(app, 'rules.json'), '[]');
	fs.writeFileSync(path.join(app, 'excludes.json'), '[]');
	fs.writeFileSync(path.join(app, 'log', 'wui'), 'proxy-stream-start\n');
	const recordingFile = path.join(app, 'recorded', 'sample $(touch PROXY_SHELL_MARKER).m2ts');
	execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25',
		'-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8',
		'-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', '-y', recordingFile]);
	execFileSync('ffprobe', ['-v', 'error', '-show_format', recordingFile]);
	let upstream;
	if (extended) {
		upstream = await require('./proxy-upstream-fixture.cjs')(fs.readFileSync(recordingFile));
		closers.push(upstream.close);
		config.mirakurunPath = upstream.url;
		fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify(config));
	}
	const channel = { id: 'proxy-channel', name: 'Proxy channel', type: 'GR', channel: '27', sid: 1024 };
	const recording = { id: 'proxy-recording', title: 'Proxy integration test', fullTitle: 'Proxy integration test',
		detail: 'Isolated reverse proxy test', category: 'documentary', flags: [], channel,
		start: Date.now() - 20000, end: Date.now() + 600000, seconds: 8, recorded: recordingFile, pid: process.pid };
	for (const [name, data] of Object.entries({ reserves: [], schedule: [{ ...channel, programs: [] }],
		recording: [recording], recorded: [{ ...recording, id: 'proxy-recorded' }] })) {
		fs.writeFileSync(path.join(app, 'data', name + '.json'), JSON.stringify(data));
	}
	const certFile = path.join(root, 'cert.pem');
	execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
		'-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:proxy.chinachu.test,IP:127.0.0.1',
		'-keyout', path.join(root, 'key.pem'), '-out', certFile], { stdio: 'ignore' });
	const ca = fs.readFileSync(certFile);
	// Keep the location block aligned with docs/reverse-proxy.md.
	const documented = fs.readFileSync(path.join(repo, 'docs/reverse-proxy.md'), 'utf8').match(/```nginx\n([\s\S]*?)\n```/)[1];
	const serverConfig = documented.replace('listen 443 ssl;', 'listen 127.0.0.1:' + proxyPort + ' ssl;')
		.replaceAll('chinachu.example.com', 'proxy.chinachu.test')
		.replace('/etc/letsencrypt/live/proxy.chinachu.test/fullchain.pem', certFile)
		.replace('/etc/letsencrypt/live/proxy.chinachu.test/privkey.pem', path.join(root, 'key.pem'))
		.replace('127.0.0.1:20772', '127.0.0.1:' + backendPort);
	const nginxConfig = path.join(root, 'nginx.conf');
	fs.writeFileSync(nginxConfig, `daemon off;\nmaster_process off;\nerror_log ${root}/nginx-error.log info;\npid ${root}/nginx.pid;\n` +
		`events { worker_connections 128; }\nhttp {\naccess_log ${root}/nginx-access.log;\n` +
		`client_body_temp_path ${root}/body;\nproxy_temp_path ${root}/proxy;\n` +
		`fastcgi_temp_path ${root}/fastcgi;\nuwsgi_temp_path ${root}/uwsgi;\nscgi_temp_path ${root}/scgi;\n${serverConfig}\n}\n`);
	execFileSync(nginxBin, ['-p', root + '/', '-c', nginxConfig, '-t'], { stdio: 'pipe' });
	const backend = launch(process.execPath, ['app-wui.js'], 'backend.log', app);
	await ready(backend, () => new Promise(resolve => {
		const req = http.get('http://127.0.0.1:' + backendPort + '/api/status.json', { headers: { authorization } }, res => {
			res.resume(); res.on('end', () => resolve(res.statusCode === 200));
		});
		req.on('error', () => resolve(false));
	}));
	const proxy = launch(nginxBin, ['-p', root + '/', '-c', nginxConfig], 'nginx.log');
	function request(url = '/', { method = 'GET', headers = {}, body = '', auth = true, stream } = {}) {
		return new Promise((resolve, reject) => {
			const req = https.request({ hostname: '127.0.0.1', port: proxyPort, servername: 'proxy.chinachu.test', ca,
				path: url, method, agent: false, headers: { host: publicHost, ...(auth ? { authorization } : {}), ...headers } }, res => {
				if (stream) return stream(res, resolve, reject);
				const chunks = [];
				res.on('data', chunk => chunks.push(chunk));
				res.on('error', reject);
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
			});
			req.setTimeout(10000, () => req.destroy(new Error('Request timed out: ' + url)));
			req.on('error', reject);
			req.end(body);
		});
	}
	await ready(proxy, async () => (await request('/api/status.json')).status === 200);
	await ready(backend, async () => JSON.parse((await request('/api/recorded.json')).body).length === 1);
	const updates = { origin: publicOrigin, 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
	await check('HTTPS certificate, authenticated page and status API', async () => {
		assert.equal((await request('/')).status, 200);
		const res = await request('/api/status.json');
		assert.equal(res.status, 200);
		assert.equal(JSON.parse(res.body).version, require('../package.json').version);
	});
	await check('unauthenticated UI/API and wrong password return 401', async () => {
		for (const url of ['/', '/api/status.json', '/api/config.json', '/api/recorded/proxy-recorded/file.m2ts']) {
			assert.equal((await request(url, { auth: false })).status, 401, url);
		}
		assert.equal((await request('/', { headers: { authorization: 'Basic ' + Buffer.from('proxy-test:wrong').toString('base64') } })).status, 401);
	});
	await check('foreign Host/Origin, null Origin and cross-site writes return 403', async () => {
		for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, { origin: 'null' }, { origin: publicOrigin.replace('https:', 'http:') }]) {
			assert.equal((await request('/', { headers })).status, 403);
		}
		for (const method of ['POST', 'PUT', 'DELETE']) {
			assert.equal((await request('/api/rules.json', { method, body: '{}', headers: { origin: publicOrigin } })).status, 403);
			for (const site of ['cross-site', 'same-site']) {
				assert.equal((await request('/api/rules.json', { method, body: '{}', headers: { ...updates, 'sec-fetch-site': site } })).status, 403);
			}
		}
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'rules.json'))), []);
	});
	await check('same-origin rule creation and update persist in isolated data', async () => {
		assert.equal((await request('/api/rules.json', { method: 'POST', headers: updates, body: '{"reserve_titles":["proxy-test"]}' })).status, 201);
		assert.equal((await request('/api/rules/0.json', { method: 'PUT', headers: updates, body: '{"reserve_titles":["updated"]}' })).status, 200);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'rules.json'))), [{ reserve_titles: ['updated'] }]);
	});
	await check('method overrides, malformed JSON and unsafe recording formats return 400 without writes', async () => {
		const before = fs.readFileSync(path.join(app, 'rules.json'), 'utf8');
		for (const key of ['method', '_method']) assert.equal((await request('/api/rules.json?' + key + '=DELETE')).status, 400);
		for (const body of ['{broken', '{"method":"DELETE"}', '{"recorded_format":"../escape.m2ts"}']) {
			assert.equal((await request('/api/rules.json', { method: 'POST', headers: updates, body })).status, 400);
		}
		assert.equal(fs.readFileSync(path.join(app, 'rules.json'), 'utf8'), before);
	});
	await check('Nginx rejects oversized Content-Length and chunked bodies with 413', async () => {
		const before = fs.readFileSync(path.join(app, 'rules.json'), 'utf8');
		const body = 'x'.repeat(1024 * 1024 + 1);
		for (const headers of [{ ...updates, 'content-length': Buffer.byteLength(body) }, { ...updates, 'transfer-encoding': 'chunked' }]) {
			assert.equal((await request('/api/rules.json', { method: 'POST', headers, body })).status, 413);
		}
		assert.equal(fs.readFileSync(path.join(app, 'rules.json'), 'utf8'), before);
	});
	await check('Nginx closes an incomplete request after the 15-second body timeout without writes', async () => {
		const before = fs.readFileSync(path.join(app, 'rules.json'), 'utf8');
		const started = Date.now();
		const status = await new Promise((resolve, reject) => {
			const req = https.request({ hostname: '127.0.0.1', port: proxyPort, servername: 'proxy.chinachu.test', ca,
				path: '/api/rules.json', method: 'POST', agent: false,
				headers: { ...updates, host: publicHost, authorization, 'content-length': 100 } }, res => {
				res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); });
			});
			req.setTimeout(20000, () => req.destroy(new Error('Body timeout did not fire')));
			req.on('error', error => { if (error.code === 'ECONNRESET') resolve(null); else reject(error); });
			req.write('{');
		});
		assert.ok(status === 408 || status === null, 'Unexpected timeout response: ' + status);
		assert.ok(Date.now() - started >= 14000, 'Request closed before the body timeout');
		await delay(50);
		assert.match(fs.readFileSync(path.join(root, 'nginx-access.log'), 'utf8'), /"POST \/api\/rules\.json HTTP\/1\.1" 408 /);
		assert.equal(fs.readFileSync(path.join(app, 'rules.json'), 'utf8'), before);
	});
	await check('same-origin DELETE removes only the isolated test rule', async () => {
		assert.equal((await request('/api/rules/0.json', { method: 'DELETE', headers: updates })).status, 200);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app, 'rules.json'))), []);
	});
	await check('static single-byte/suffix ranges, invalid ranges and HEAD complete correctly', async () => {
		const content = fs.readFileSync(path.join(repo, 'web', 'index.html'));
		for (const [range, expected] of [['bytes=0-0', content.subarray(0, 1)], ['bytes=-10', content.subarray(-10)]]) {
			const res = await request('/index.html', { headers: { range } });
			assert.equal(res.status, 206); assert.deepEqual(res.body, expected);
		}
		for (const range of ['bytes=20-10', 'bytes=wat-', 'bytes=0-1,3-4', 'bytes=9007199254740992-']) {
			const res = await request('/index.html', { headers: { range } });
			assert.equal(res.status, 416); assert.equal(res.headers['content-range'], 'bytes */' + content.length);
		}
		const head = await request('/index.html', { method: 'HEAD', headers: { range: 'bytes=wat-' } });
		assert.equal(head.status, 200); assert.equal(head.body.length, 0);
	});
	await check('raw traversal requests cannot retrieve configuration files', async () => {
		for (const url of ['/../config.json', '/%2e%2e/config.json', '/..%2fconfig.json', '/%2e%2e%2fconfig.json']) {
			const res = await request(url);
			assert.ok([400, 404].includes(res.status), url + ': ' + res.status);
			assert.ok(!res.body.includes(Buffer.from(password)));
		}
	});
	await check('polling, WebSocket and polling-to-WebSocket upgrade with authentication', async () => {
		for (const transports of [['polling'], ['websocket'], ['polling', 'websocket']]) {
			const socket = io(origin, { transports, ca, rejectUnauthorized: true, forceNew: true, reconnection: false, timeout: 3000,
				extraHeaders: { authorization, origin } });
			try {
				const upgraded = transports.length > 1 ? once(socket.io.engine, 'upgrade') : null;
				await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([err]) => { throw err; })]);
				if (upgraded) await Promise.race([upgraded, delay(4000).then(() => { throw new Error('WebSocket upgrade timed out'); })]);
				assert.equal(socket.io.engine.transport.name, transports.at(-1));
			} finally { socket.close(); }
		}
	});
	await check('polling and WebSocket reject missing authentication and foreign Origin', async () => {
		for (const transport of ['polling', 'websocket']) {
			for (const extraHeaders of [{ origin }, { authorization, origin: 'https://evil.example' }]) {
				const socket = io(origin, { transports: [transport], ca, rejectUnauthorized: true, forceNew: true,
					extraHeaders, reconnection: false, timeout: 2000 });
				try {
					const error = await Promise.race([once(socket, 'connect_error').then(([err]) => err), once(socket, 'connect').then(() => null)]);
					assert.ok(error, 'Unauthorized Socket.IO connection succeeded');
				} finally { socket.close(); }
			}
		}
	});
	await check('recording download matches actual TS file and preview runs FFmpeg safely', async () => {
		const download = await request('/api/recorded/proxy-recorded/file.m2ts');
		assert.equal(download.status, 200); assert.deepEqual(download.body, fs.readFileSync(recordingFile));
		const preview = await request('/api/recorded/proxy-recorded/preview.png');
		assert.equal(preview.status, 200); assert.deepEqual(preview.body.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
		assert.equal(fs.existsSync(path.join(app, 'PROXY_SHELL_MARKER')), false);
	});
	await check('recorded MP4 streaming and playlist run FFmpeg/ffprobe through HTTPS', async () => {
		const playlist = await request('/api/recorded/proxy-recorded/watch.xspf');
		assert.equal(playlist.status, 200); assert.ok(playlist.body.includes(Buffer.from('<playlist')));
		const video = await request('/api/recorded/proxy-recorded/watch.mp4?t=1&s=320x180');
		assert.equal(video.status, 200); assert.ok(video.body.includes(Buffer.from('ftyp')));
		fs.writeFileSync(path.join(root, 'stream.mp4'), video.body);
		const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(root, 'stream.mp4')]));
		assert.ok(info.streams.some(stream => stream.codec_type === 'video' && stream.width === 320 && stream.height === 180));
	});
	await check('recorded TS playback forwards the exact file contents', async () => {
		const video = await request('/api/recorded/proxy-recorded/watch.m2ts');
		assert.equal(video.status, 200); assert.deepEqual(video.body, fs.readFileSync(recordingFile));
	});
	await check('invalid video sizes return 400 on all three watch APIs', async () => {
		for (const prefix of ['/api/recorded/proxy-recorded', '/api/recording/proxy-recording', '/api/channel/proxy-channel']) {
			for (const query of ['s=scale%3D1%3A1', 's=99999x99999', 's=320x180&s=640x360']) {
				assert.equal((await request(prefix + '/watch.mp4?' + query)).status, 400, prefix);
			}
		}
	});
	await check('log stream forwards new data before response completion and disconnect kills tail', async () => {
		await request('/api/log/wui/stream.txt', { stream(res, resolve, reject) {
			assert.equal(res.statusCode, 200);
			let received = '';
			const timer = setTimeout(() => { res.destroy(); reject(new Error('Stream was buffered')); }, 5000);
			fs.appendFileSync(path.join(app, 'log', 'wui'), 'proxy-stream-new-data\n');
			res.on('data', chunk => {
				received += chunk;
				if (received.includes('proxy-stream-new-data')) { clearTimeout(timer); res.destroy(); resolve(); }
			});
			res.on('error', reject);
		} });
		await delay(1500);
		const descendants = fs.readFileSync('/proc/' + backend.pid + '/task/' + backend.pid + '/children', 'utf8').trim();
		assert.equal(descendants, '', 'Streaming child processes remain after disconnect');
	});
	await check('live recording TS forwards appended bytes and disconnect kills tail', async () => {
		const content = fs.readFileSync(recordingFile);
		const initial = content.subarray(-61440);
		await request('/api/recording/proxy-recording/watch.m2ts', { stream(res, resolve, reject) {
			assert.equal(res.statusCode, 200);
			const chunks = [];
			let length = 0, appended = false;
			const timer = setTimeout(() => { res.destroy(); reject(new Error('Live recording was buffered')); }, 5000);
			res.on('data', chunk => {
				chunks.push(chunk); length += chunk.length;
				if (!appended && length >= initial.length) { appended = true; fs.appendFileSync(recordingFile, content); }
				if (length >= initial.length + content.length) {
					clearTimeout(timer); res.destroy();
					try { assert.deepEqual(Buffer.concat(chunks), Buffer.concat([initial, content])); resolve(); } catch (error) { reject(error); }
				}
			});
			res.on('error', reject);
		} });
		await delay(1500);
		assert.equal(fs.readFileSync('/proc/' + backend.pid + '/task/' + backend.pid + '/children', 'utf8').trim(), '');
	});
	if (extended) {
		const childPids = () => fs.readFileSync('/proc/' + backend.pid + '/task/' + backend.pid + '/children', 'utf8').trim();
		async function noChildren() {
			await delay(1500);
			assert.equal(childPids(), '', 'Media processes remain after the request');
		}
		function playable(video, filename) {
			assert.equal(video.status, 200);
			const file = path.join(root, filename);
			fs.writeFileSync(file, video.body);
			const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));
			assert.ok(info.streams.some(stream => stream.codec_type === 'video' && stream.width === 320 && stream.height === 180));
		}
		await check('live recording PNG preview uses actual FFmpeg', async () => {
			const preview = await request('/api/recording/proxy-recording/preview.png');
			assert.equal(preview.status, 200);
			assert.deepEqual(preview.body.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
			await noChildren();
		});
		await check('live recording seeked MP4 completes without exceptions or remaining children', async () => {
			playable(await request('/api/recording/proxy-recording/watch.mp4?ss=2&t=1&s=320x180'), 'live-seek.mp4');
			await noChildren();
			assert.ok(!fs.readFileSync(path.join(root, 'backend.log'), 'utf8').includes('uncaughtException'));
		});
		await check('live recording tail-to-MP4 completes at the requested duration', async () => {
			const content = fs.readFileSync(recordingFile);
			const writer = setInterval(() => fs.appendFileSync(recordingFile, content), 500);
			try { playable(await request('/api/recording/proxy-recording/watch.mp4?t=1&s=320x180'), 'live-tail.mp4'); }
			finally { clearInterval(writer); }
			await noChildren();
			assert.ok(!fs.readFileSync(path.join(root, 'backend.log'), 'utf8').includes('uncaughtException'));
		});
		await check('MP4 disconnects during probing, seeking and live tail input release every child', async () => {
			for (const url of ['/api/recorded/proxy-recorded/watch.mp4',
				'/api/recording/proxy-recording/watch.mp4?ss=2', '/api/recording/proxy-recording/watch.mp4']) {
				await new Promise((resolve, reject) => {
					const req = https.get({ hostname: '127.0.0.1', port: proxyPort, servername: 'proxy.chinachu.test', ca,
						path: url, headers: { host: publicHost, authorization }, agent: false }, res => res.resume());
					req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
					setTimeout(() => { req.destroy(); resolve(); }, 100);
				});
				await noChildren();
			}
			assert.ok(!fs.readFileSync(path.join(root, 'backend.log'), 'utf8').includes('uncaughtException'));
		});
		await check('channel TS and MP4 use the real Mirakurun client with an isolated HTTP upstream', async () => {
			const video = await request('/api/channel/proxy-channel/watch.m2ts');
			assert.equal(video.status, 200); assert.deepEqual(video.body, fs.readFileSync(recordingFile).subarray(0, upstream.contentLength));
			playable(await request('/api/channel/proxy-channel/watch.mp4?s=320x180'), 'channel.mp4');
			await noChildren(); assert.equal(upstream.active.size, 0);
		});
		await check('channel upstream failures and abrupt disconnects end requests and release resources', async () => {
			try {
				upstream.mode = 'unavailable';
				assert.equal((await request('/api/channel/proxy-channel/watch.m2ts')).status, 503);
				upstream.mode = 'broken';
				await request('/api/channel/proxy-channel/watch.m2ts');
				upstream.mode = 'continuous';
				await request('/api/channel/proxy-channel/watch.mp4?c:v=invalid-codec');
				await noChildren(); assert.equal(upstream.active.size, 0);
				assert.ok(!fs.readFileSync(path.join(root, 'backend.log'), 'utf8').includes('uncaughtException'));
			} finally { upstream.mode = 'normal'; }
		});
		await require('./proxy-stress-checks.cjs')({ origin, ca, authorization, request, check, backend, proxyPort, publicHost });
	}
	if (process.argv.includes('--browser')) {
		await require('./proxy-browser-checks.cjs')({ origin, password, ca, check, root });
		await delay(1500);
	}
	await check('forwarded client IP is overwritten and credentials are absent from WUI logs', async () => {
		await request('/api/status.json?proxy-xff-check=1', { headers: { 'x-forwarded-for': '198.51.100.77' } });
		await delay(100);
		const logs = fs.readFileSync(path.join(root, 'backend.log'), 'utf8');
		const line = logs.split('\n').find(line => line.includes('GET:/api/status.json?proxy-xff-check=1'));
		assert.ok(line && line.includes('127.0.0.1')); assert.ok(!line.includes('198.51.100.77'));
		assert.ok(!logs.includes(password)); assert.ok(!logs.includes(authorization));
		assert.ok(!logs.includes('uncaughtException'));
	});
	console.log(`${passed} reverse proxy integration checks passed (Nginx HTTPS → real WUI).`);
}

async function cleanup() {
	for (const child of children.reverse()) {
		if (child.exitCode !== null || child.signalCode !== null) continue;
		const exited = once(child, 'exit');
		child.kill('SIGTERM');
		await Promise.race([exited, delay(2000)]);
		if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
	}
	for (const close of closers) await close();
}

main().catch(error => {
	console.error(error);
	for (const file of ['backend.log', 'nginx.log', 'nginx-error.log', 'nginx-access.log']) {
		const filename = path.join(root, file);
		if (fs.existsSync(filename)) console.error(file + ':\n' + fs.readFileSync(filename, 'utf8').split('\n').slice(-25).join('\n'));
	}
	process.exitCode = 1;
}).finally(async () => {
	await cleanup();
	fs.rmSync(root, { recursive: true, force: true });
});
