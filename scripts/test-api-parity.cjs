'use strict';

// Run on Linux with Node 24, ffmpeg and ffprobe on PATH.
// The comparison revision must use the legacy JSON store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { io } = require('socket.io-client');
const { inflateSync } = require('node:zlib');
const repo = path.resolve(__dirname, '..');
const baseline = process.argv[2] || 'f03e945';
const sources = ['api', 'lib', 'common', 'web/config-schema.js', 'app-wui.js', 'app-scheduler.js',
	'app-cli.js', 'chinachu', 'package.json', 'processes.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function routes(dir) {
	const result = [];
	for (const file of fs.readdirSync(dir).filter(name => /^resource-.*\.json$/.test(name))) {
		const group = file.slice(9, -5);
		for (const [suffix, route] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, file))))) {
			for (const method of route.methods) for (const type of route.types) {
				result.push(method.toUpperCase() + ' ' + group + (suffix === '/' ? '' : suffix) + '.' + type);
			}
		}
	}
	return result.sort();
}

function request(port, method, url, { body, headers = {}, prefix } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({ hostname: '127.0.0.1', port, method, path: '/api/' + url,
			headers: { 'x-requested-with': 'XMLHttpRequest', ...(body && { 'content-type': 'application/json' }), ...headers },
			signal: AbortSignal.timeout(25000) }, res => {
			let length = 0;
			const chunks = [];
			const finish = () => resolve({ status: res.statusCode, headers: res.headers,
				bytes: Buffer.concat(chunks).subarray(0, prefix) });
			res.on('error', reject);
			res.on('data', chunk => {
				chunks.push(chunk);
				length += chunk.length;
				if (prefix && length >= prefix) { finish(); res.destroy(); }
			});
			res.on('end', finish);
		});
		req.on('error', reject);
		req.end(body && JSON.stringify(body));
	});
}

function serve(server) {
	server.listen(0, '127.0.0.1');
	return once(server, 'listening').then(() => server.address().port);
}

function tuner(ts, logo, start) {
	const service = { id: 10, serviceId: 1, networkId: 2, name: '試験局', channel: { type: 'GR', channel: '27' } };
	const program = { id: 123, networkId: 2, serviceId: 1, name: '更新後のニュース', startAt: start, duration: 3600000 };
	const docs = {};
	const data = { '/api/services': [service], '/api/programs': [program, { ...program, id: 124, name: '同時刻の競合番組' }], '/api/tuners': [{ types: ['GR'] }] };
	for (const [url, operationId] of [['/services', 'getServices'], ['/programs', 'getPrograms'], ['/tuners', 'getTuners'],
		['/services/{id}/logo', 'getLogoImage'], ['/services/{id}/stream', 'getServiceStream']]) {
		docs[url] = { parameters: url.includes('{id}') ? [{ in: 'path', name: 'id', required: true }] : [],
			get: { operationId, tags: [url.endsWith('/stream') ? 'stream' : 'test'] } };
	}
	return http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost').pathname;
		if (url === '/api/services/10/stream' || url === '/api/services/10/logo') {
			const stream = url.endsWith('/stream');
			res.writeHead(200, { 'content-type': stream ? 'video/MP2T' : 'image/png' });
			res.end(stream ? ts : logo);
		} else {
			const json = url === '/api/docs' ? { paths: docs } : data[url];
			res.writeHead(json ? 200 : 404, { 'content-type': 'application/json' });
			res.end(JSON.stringify(json || {}));
		}
	});
}

function seed(dir, cfg, now, ts) {
	for (const name of ['data', 'log']) fs.mkdirSync(path.join(dir, name));
	const channel = { id: 'a', type: 'GR', channel: '27', sid: 1, name: '試験局' };
	const live = { id: 'live', title: '生放送 &「日本語」', start: now - 3600000, end: now + 3600000,
		channel, category: 'news', flags: ['新'], extra: { 空欄: '', nullable: null } };
	const next = { ...live, id: 'next', start: now + 3600000, end: now + 7200000 };
	const rec = name => ({ ...live, id: name, recorded: path.join(cfg.recordedDir, name + '.m2ts') });
	const history = ['movie', 'gone', 'deletefile', 'deleteraw', 'deleteitem'].map(rec);
	for (const p of history.slice(2)) fs.writeFileSync(p.recorded, ts);
	const files = { 'config.json': cfg, 'rules.json': [{ types: ['GR'] }], 'excludes.json': [{ categories: ['music'] }],
		'data/schedule.json': [{ ...channel, programs: [live, next], n: 0 }, { id: 'b', programs: [] },
			{ id: 'c', programs: [{ ...next, title: '再利用ID', channel: { id: 'c' } }] }],
		'data/recording.json': [{ ...live, recorded: rec('movie').recorded, pid: 1234 }],
		'data/recorded.json': history, 'data/reserves.json': [live] };
	for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
	const clock = new Date(now - 86400000);
	fs.utimesSync(path.join(dir, 'data/schedule.json'), clock, clock);
	for (const [name, text] of Object.entries({ wui: 'web log\n', operator: '録画ログ\n',
		scheduler: 'RUNNING SCHEDULER.\nRESERVE: live\nCONFLICT: next\n' })) {
		const file = path.join(dir, 'log', name);
		fs.writeFileSync(file, text);
		fs.utimesSync(file, clock, clock);
	}
}

async function exercise(dir, cfg, ts, logo, sqlite) {
	const answers = new Map(), covered = new Set(), failures = [];
	const routeList = routes(path.join(dir, 'api'));
	let child, socket, output = '';
	const call = (method, url, options) => request(cfg.wuiPort, method, url, options);
	async function waitFor(check, label) {
		for (let i = 0; i < 110; i++) {
			if (child.exitCode !== null || child.signalCode) throw Error('WUI stopped: ' + output.slice(-1800));
			if (await check()) return;
			await delay(80);
		}
		throw Error('Timed out: ' + label + '\n' + output.slice(-2000));
	}
	async function start() {
		child = spawn(process.execPath, ['app-wui.js'], { cwd: dir, env: { ...process.env, pm_id: '' } });
		for (const stream of [child.stdout, child.stderr]) stream.on('data', part => { output = (output + part).slice(-4000); });
		await waitFor(async () => {
			try { const res = await call('GET', 'schedule.json'); return res.status === 200 && JSON.parse(res.bytes).length > 0; } catch { return false; }
		}, 'startup');
	}
	async function stop() {
		if (!child || child.exitCode !== null || child.signalCode) return;
		const exited = once(child, 'exit');
		child.kill('SIGQUIT');
		await exited;
	}
	async function check(method, url, status = 200, options = {}) {
		const response = await call(method, url, options);
		const { headers, bytes } = response;
		const key = method + ' ' + url + (options.label ? ' (' + options.label + ')' : '');
		assert.ok(!answers.has(key), 'duplicate case ' + key);
		// Use the most specific resource template, just as static paths override parameters.
		const target = method + ' ' + url.split('?')[0];
		const matches = routeList.filter(route => new RegExp('^' + route.replace(/\./g, '\\.').replace(/:\w+/g, '[^/.]+') + '$').test(target));
		matches.sort((a, b) => (a.match(/:/g) || []).length - (b.match(/:/g) || []).length);
		if (matches.length && response.status < 300) covered.add(matches[0]);
		const selected = {};
		for (const field of ['content-type', 'content-encoding', 'content-disposition', 'content-range', 'accept-ranges', 'allow', 'cache-control']) {
			if (headers[field]) selected[field] = headers[field];
		}
		if (url === 'schedule.json' && !['scheduled', 'after force', 'empty'].includes(options.label)) {
			selected['last-modified'] = headers['last-modified'];
			if (headers['content-length']) selected['content-length'] = headers['content-length'];
			selected.wireDigest = digest(bytes);
		}
		if (url === 'config.json' && headers.etag) selected.etag = headers.etag;
		let value;
		if (headers['content-encoding'] === 'deflate' && bytes.length) value = JSON.parse(inflateSync(bytes));
		else if (bytes.length && /application\/json/.test(headers['content-type'])) value = JSON.parse(bytes);
		else if (!bytes.length || /text\/|xml|xspf/.test(headers['content-type'])) value = bytes.toString();
		else value = { length: bytes.length, sha256: digest(bytes) };
		try {
			assert.equal(response.status, status);
			if (options.verify) options.verify(value, response);
			if (options.project) value = options.project(value, response);
		} catch (err) { failures.push(key + ': ' + err.message.slice(0, 400)); }
		answers.set(key, { status: response.status, headers: selected, value });
		return { ...response, value };
	}
	const get = (url, status, options) => check('GET', url, status, options);
	const put = (url, body, status = 200, label) => check('PUT', url, status, { body, label });
	// The JSON WUI debounces file events for one second after a CLI write.
	const settled = () => sqlite ? Promise.resolve() : delay(1200);
	try {
		await start();
		await get('status.json');
		const schedule = await get('schedule.json');
		assert.equal(schedule.value.length, 3);
		if (sqlite) {
			assert.ok(schedule.headers.etag);
			assert.equal((await call('GET', 'schedule.json', { headers: { 'if-none-match': schedule.headers.etag } })).status, 304);
		}
		await check('HEAD', 'schedule.json');
		const compression = { headers: { 'accept-encoding': 'deflate' }, label: 'deflate' };
		const zipped = await get('schedule.json', 200, compression);
		const zippedHead = await check('HEAD', 'schedule.json', 200, compression);
		assert.equal(zipped.bytes.length, Number(zippedHead.headers['content-length']));
		assert.deepEqual(JSON.parse(inflateSync(zipped.bytes)), schedule.value);
		for (const method of ['GET', 'HEAD']) {
			await check(method, 'schedule.json', 304, { headers: { 'if-modified-since': schedule.headers['last-modified'] }, label: 'unchanged' });
		}
		for (const url of ['schedule/a', 'schedule/b', 'schedule/programs', 'schedule/broadcasting', 'schedule/a/programs',
			'schedule/b/programs', 'schedule/a/broadcasting', 'schedule/b/broadcasting', 'program/live', 'program/next',
			'reserves', 'reserves/live', 'recording', 'recording/live', 'recorded', 'rules', 'rules/0', 'exclusion-rules', 'exclusion-rules/0']) {
			await get(url + '.json');
		}
		for (const url of ['schedule/absent', 'schedule/absent/programs', 'schedule/absent/broadcasting', 'program/absent',
			'reserves/absent', 'recorded/absent', 'recording/absent', 'rules/9', 'exclusion-rules/9']) await get(url + '.json', 404);
		await check('POST', 'schedule.json', 405);
		await get('schedule.xml', 415);
		await get('rules/00.json');
		await get('rules/0suffix.json');
		await get('scheduler.json');
		await get('scheduler.txt');
		for (const name of ['wui', 'operator', 'scheduler']) {
			const bytes = fs.readFileSync(path.join(dir, 'log', name));
			await get('log/' + name + '.txt', 200, { verify: (_, r) => assert.deepEqual(r.bytes, bytes) });
			const stream = Buffer.concat([Buffer.alloc(1023, 32), bytes]);
			await get('log/' + name + '/stream.txt', 200, { prefix: stream.length, verify: (_, r) => assert.deepEqual(r.bytes, stream) });
		}
		await get('log/missing.txt', 404);
		const beforeDisk = fs.statfsSync(cfg.recordedDir);
		await get('storage.json', 200, { project(v) {
			const disk = fs.statfsSync(cfg.recordedDir);
			assert.equal(v.size, disk.blocks * disk.bsize);
			assert.equal(v.recorded, 4 * fs.statSync(path.join(cfg.recordedDir, 'movie.m2ts')).blocks * 512);
			for (const [key, measure] of [['used', d => (d.blocks - d.bfree) * d.bsize], ['avail', d => d.bavail * d.bsize]]) {
				const ends = [measure(beforeDisk), measure(disk)];
				assert.ok(v[key] >= Math.min(...ends) && v[key] <= Math.max(...ends), key + ' differs from statfs');
			}
			return { ...v, used: 'live filesystem usage', avail: 'live filesystem space' };
		} });
		await get('recorded/movie/file.json', 200, { verify(v) { assert.equal(v.size, ts.length); } });
		await get('recorded/movie/file.m2ts', 200, { verify: (_, r) => assert.deepEqual(r.bytes, ts) });
		await get('channel/a/logo.png', 200, { verify: (_, r) => assert.deepEqual(r.bytes, logo) });
		for (const root of ['channel/a', 'recorded/movie', 'recording/live']) {
			await get(root + '/watch.xspf?ext=mp4&prefix=./', 200, { verify: (_, r) => assert.match(r.bytes.toString(), /<trackList>/) });
			const recording = root.startsWith('recording/');
			const tail = ts.subarray(-61440);
			await get(root + '/watch.m2ts', 200, { ...(recording && { prefix: tail.length }),
				verify: (_, r) => assert.deepEqual(r.bytes, recording ? tail : ts) });
			await get(root + '/watch.mp4' + (recording ? '?ss=1&t=2' : ''), 200,
				{ verify: (_, r) => { assert.ok(r.bytes.length > 1000); assert.equal(r.bytes.toString('ascii', 4, 8), 'ftyp'); } });
			if (root.startsWith('channel/')) continue;
			for (const ext of ['png', 'jpg', 'txt']) await get(root + '/preview.' + ext, 200, { verify(_, r) {
				if (ext === 'txt') assert.match(r.bytes.toString(), /^data:image\/jpeg;base64,\/9j\//);
				else assert.equal(r.bytes.subarray(0, 2).toString('hex'), ext === 'jpg' ? 'ffd8' : '8950');
			} });
		}
		await get('recorded/movie/watch.m2ts', 206, { label: 'range', headers: { range: 'bytes=188-375' },
			verify: (_, r) => assert.deepEqual(r.bytes, ts.subarray(188, 376)) });
		await get('recorded/movie/watch.m2ts?ss=999', 416);
		await get('recorded/gone/preview.png', 410);
		await get('recorded/gone/file.json', 410);
		const initialConfig = await get('config.json');
		const revision = initialConfig.headers.etag.slice(1, -1);
		const configText = JSON.stringify({ ...initialConfig.value, storageLowSpaceThresholdMB: 321 });
		await put('config.json', { json: configText }, 428, 'missing revision');
		await put('config.json', { json: configText, revision: 'stale' }, 409, 'stale revision');
		await put('config.json', { json: configText, revision });
		await get('config.json', 200, { label: 'after update' });
		await put('program/next.json', { mode: '1seg' }); await settled();
		await get('reserves/next.json');
		await put('program/next.json', {}, 409, 'duplicate');
		await put('program/absent.json', {}, 404);
		await put('reserves/next/skip.json', { start: 0 }, 409, 'stale start');
		await put('reserves/next/skip.json', {}); await settled();
		await put('reserves/next/skip.json', {}, 500, 'already skipped');
		await put('reserves/next/unskip.json', {}); await settled();
		await put('reserves/next/unskip.json', {}, 500, 'already unskipped');
		await put('reserves/absent/other.json', {}, 404);
		await put('reserves/next/other.json', {}, 400);
		await put('reserves/next/other.json', { start: 0 }, 409, 'stale start');
		await put('reserves/next/unreserve.json', {}, 400);
		await get('reserves/next.json', 200, { label: 'after invalid action' });
		await put('rules/1/other.json', {}, 404);
		await put('rules/0/other.json', {}, 500);
		await put('rules/0/DELETE.json', {}, 500);
		await check('DELETE', 'reserves/live.json', 409);
		await check('DELETE', 'reserves/next.json'); await settled();
		await get('reserves/next.json', 404, { label: 'after delete' });
		for (const name of ['rules', 'exclusion-rules']) {
			await check('POST', name + '.json', 400, { body: {}, label: 'empty' });
			await check('POST', name + '.json', 201, { body: { reserve_titles: ['音楽'], isEnabled: false } });
			await settled();
			await get(name + '/1.json');
			await put(name + '/1.json', { categories: ['news'], isEnabled: true });
			await put(name + '/9.json', {}, 404, 'missing with invalid body');
			await settled();
			if (name === 'rules') for (const action of ['disable', 'enable']) {
				await put('rules/1/' + action + '.json', {}); await settled();
				await get('rules/1.json', 200, { label: action });
			}
			await check('DELETE', name + '/0.json'); await settled();
			await get(name + '.json', 200, { label: 'after delete' });
		}
		await check('DELETE', 'recording/live.json'); await settled();
		await get('recording/live.json', 200, { label: 'stopped' });
		await get('reserves/live.json', 200, { label: 'stopped' });
		await get('recorded/movie.json');
		await get('recorded/gone.json');
		await get('recorded.json', 200, { label: 'after detail' });
		await check('DELETE', 'recorded/deletefile/file.json');
		await check('DELETE', 'recorded/deleteraw/file.m2ts');
		await check('DELETE', 'recorded/deletefile/file.json', 410, { label: 'already removed' });
		await check('DELETE', 'recorded/deleteitem.json'); await settled();
		await put('recorded.json', {}); await settled();
		await get('recorded.json', 200, { label: 'after cleanup' });
		await stop(); await start();
		for (const name of ['recorded', 'recording', 'reserves', 'rules', 'exclusion-rules']) await get(name + '.json', 200, { label: 'after restart' });
		// Scheduler log timestamps belong to the local run. Verify them against its actual file.
		const logfile = path.join(dir, 'log/scheduler');
		await put('rules/0.json', { types: ['GR'] }, 200, 'schedule overlapping programs');
		await check('PUT', 'scheduler.json', 200, { project(v) {
			assert.equal(v.time, fs.statSync(logfile).mtime.getTime());
			return { ...v, time: 'scheduler log mtime' };
		} });
		await settled();
		await get('schedule.json', 200, { label: 'scheduled', verify(v) { assert.equal(v[0].programs[0].title, '更新後のニュース'); } });
		await get('reserves.json', 200, { label: 'scheduled', verify(v) {
			assert.deepEqual(v.map(p => p.isConflict), [false, true]);
		} });
		await get('scheduler.json', 200, { label: 'settled', project(v) {
			assert.equal(v.time, fs.statSync(logfile).mtime.getTime());
			assert.equal(v.reserves[0].id, '3f');
			assert.equal(v.conflicts[0].id, '3g');
			return { ...v, time: 'scheduler log mtime' };
		} });
		await check('PUT', 'scheduler.txt', 200, { project(v) {
			assert.equal(v, fs.readFileSync(logfile, 'ascii'));
			return v.split('\n').filter(line => !line.includes('WRITE:')).map(line => line.replace(/^\d+ \w+ [\d:]+ - /, '')).join('\n');
		} });
		// A no-op force handler must not pass with the previous update's data.
		if (sqlite) {
			const store = new (require(path.join(dir, 'lib/state-store')).StateStore)(dir);
			try {
				store.transaction(() => {
					store.replace('schedule', []);
					store.replace('reserves', []);
				});
			} finally { store.close(); }
			for (const name of ['schedule', 'reserves']) assert.deepEqual(JSON.parse((await call('GET', name + '.json')).bytes), []);
		}
		const priorLength = fs.statSync(logfile).size;
		await check('PUT', 'scheduler/force.json', 202);
		await waitFor(() => /WRITE:|Unknown option: --force/.test(fs.readFileSync(logfile).subarray(priorLength).toString()) &&
			!fs.existsSync(path.join(dir, 'data/scheduler.pid')), 'forced scheduler result');
		const forceLog = fs.readFileSync(logfile).subarray(priorLength).toString();
		if (sqlite) assert.match(forceLog, /WRITE: schedule, reserves/);
		console.log('scheduler/force: ' + (forceLog.includes('Unknown option: --force') ? 'legacy CLI rejected --force' : 'scheduler ran'));
		await settled();
		for (const name of ['schedule', 'reserves']) {
			await get(name + '.json', 200, { label: 'after force', verify(value) {
				assert.deepEqual(value, answers.get('GET ' + name + '.json (scheduled)').value);
			} });
		}
		for (const name of ['wui', 'operator', 'scheduler']) fs.unlinkSync(path.join(dir, 'log', name));
		const lists = { schedule: 'data/schedule.json', reserves: 'data/reserves.json', recording: 'data/recording.json',
			recorded: 'data/recorded.json', rules: 'rules.json', excludes: 'excludes.json' };
		socket = io('http://127.0.0.1:' + cfg.wuiPort, { autoConnect: false, reconnection: false });
		const notifications = new Map();
		for (const name of ['schedule', 'reserves', 'recording', 'recorded', 'rules', 'exclusion-rules']) {
			socket.on('notify-' + name, (...args) => notifications.set(name, args));
		}
		socket.connect();
		await waitFor(() => notifications.size === 6, 'initial Socket.IO notifications');
		assert.ok([...notifications.values()].every(args => args.length === 0));
		notifications.clear();
		if (sqlite) {
			const store = new (require(path.join(dir, 'lib/state-store')).StateStore)(dir);
			try { for (const name of Object.keys(lists)) store.replace(name, []); }
			finally { store.close(); }
		} else {
			for (const filename of Object.values(lists)) fs.writeFileSync(path.join(dir, filename), '[]');
		}
		await waitFor(() => notifications.size === 6, 'six committed collection notifications');
		assert.ok([...notifications.values()].every(args => args.length === 0));
		for (const name of ['schedule', 'schedule/programs', 'schedule/broadcasting', 'reserves', 'recording', 'recorded', 'rules', 'exclusion-rules']) {
			await get(name + '.json', 200, { label: 'empty', verify: value => assert.deepEqual(value, []) });
		}
		for (const url of ['scheduler.json', 'scheduler.txt', 'log/operator.txt', 'log/operator/stream.txt']) {
			await get(url, 204, { label: 'empty' });
		}
		return { answers, failures, covered };
	} finally { socket?.close(); await stop(); }
}

async function main() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-api-parity-'));
	let upstream;
	try {
		const now = Date.now(), media = path.join(tmp, 'media');
		fs.mkdirSync(media);
		const movie = path.join(media, 'movie.m2ts');
		execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10',
			'-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '7', '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', movie]);
		const ts = fs.readFileSync(movie);
		const logo = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', movie, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', '-']);
		execFileSync('ffprobe', ['-v', 'error', '-show_format', movie]);
		// Both APIs stat the same inode. Keep relatime from moving atime between runs.
		fs.utimesSync(movie, new Date(now + 86400000), new Date(now));
		upstream = tuner(ts, logo, now + 3600000);
		const upstreamPort = await serve(upstream);
		const probe = http.createServer(), port = await serve(probe);
		await new Promise(resolve => probe.close(resolve));
		const cfg = { ...require('../config.sample.json'), uid: process.getuid(), gid: process.getgid(), wuiUsers: [],
			wuiPort: port, recordedDir: media + '/', mirakurunPath: 'http://127.0.0.1:' + upstreamPort, excludeServices: [] };
		const oldDir = path.join(tmp, 'json'), newDir = path.join(tmp, 'sqlite');
		fs.mkdirSync(oldDir); fs.mkdirSync(newDir);
		const archive = execFileSync('git', ['archive', baseline, '--', ...sources], { cwd: repo, maxBuffer: 16000000 });
		execFileSync('tar', ['-x', '-C', oldDir], { input: archive });
		for (const name of sources) fs.cpSync(path.join(repo, name), path.join(newDir, name), { recursive: true });
		const declared = routes(path.join(newDir, 'api'));
		assert.deepEqual(declared, routes(path.join(oldDir, 'api')));
		const results = [];
		for (const [index, dir] of [oldDir, newDir].entries()) {
			const modules = path.join(dir, 'node_modules');
			fs.mkdirSync(modules);
			for (const name of fs.readdirSync(path.join(repo, 'node_modules'))) {
				const source = name === 'chinachu-common' ? path.join(dir, 'common') : path.join(repo, 'node_modules', name);
				fs.symlinkSync(source, path.join(modules, name));
			}
			seed(dir, cfg, now, ts);
			if (index) {
				execFileSync(process.execPath, ['lib/state-store.js'], { cwd: dir });
				for (const filename of ['rules.json', 'excludes.json', 'data/schedule.json', 'data/reserves.json',
					'data/recording.json', 'data/recorded.json']) fs.unlinkSync(path.join(dir, filename));
			}
			console.log('Checking ' + (index ? 'SQLite' : 'legacy JSON at ' + baseline));
			results.push(await exercise(dir, cfg, ts, logo, index === 1));
		}
		const [legacy, sqlite] = results;
		const failures = [];
		for (const [i, result] of results.entries()) {
			for (const err of result.failures) failures.push((i ? 'SQLite ' : 'JSON ') + err);
			for (const key of declared) if (!result.covered.has(key)) failures.push('No successful response: ' + key);
		}
		assert.deepEqual([...legacy.answers.keys()], [...sqlite.answers.keys()]);
		let freshnessDifferences = 0;
		for (const [key, expected] of legacy.answers) {
			const actual = sqlite.answers.get(key);
			try {
				if (key === 'PUT scheduler.json') {
					// The file watcher in the old server may still see the pre-update EPG.
					// SQLite must return the newly committed entries even on the first response.
					assert.deepEqual(actual, sqlite.answers.get('GET scheduler.json (settled)'));
					assert.deepEqual(actual, legacy.answers.get('GET scheduler.json (settled)'));
					if (expected.value.reserves[0] === null || expected.value.conflicts[0] === null) {
						const stale = structuredClone(actual);
						for (const key of ['reserves', 'conflicts']) {
							if (expected.value[key][0] === null) stale.value[key][0] = null;
						}
						assert.deepEqual(expected, stale);
						freshnessDifferences++;
						continue;
					}
				}
				assert.deepEqual(actual, expected);
			}
			catch (err) { failures.push(key + '\n' + err.message.slice(0, 1200)); }
		}
		console.log(declared.length + ' method/route/format combinations, ' + legacy.answers.size + ' HTTP comparisons');
		if (failures.length) throw Error(failures.join('\n'));
		console.log('PASS; ' + freshnessDifferences + ' first scheduler response(s) had stale JSON entries and fresh SQLite entries; six Socket.IO notifications verified');
	} finally {
		if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
