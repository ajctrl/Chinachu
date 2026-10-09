'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const security = require('../lib/http-security');

const source = fs.readFileSync(require.resolve('../app-wui'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function httpServer(req, res)');
const end = source.indexOf('\n//\n// socket.io server', start);
const content = Buffer.from('0123456789');

async function fixture(mode = 'normal', data = content) {
	const streams = [];
	let opens = 0;
	const handler = vm.runInNewContext(source.slice(start, end) + '\nhttpServer;', {
		URL, path, config: {}, log() {},
		querystring: require('node:querystring'),
		requestGuard: security.createRequestGuard({}), readBody: security.readBody,
		fs: {
			existsSync: () => true,
			statSync: () => ({ size: data.length, mtime: new Date(0) }),
			createReadStream(filename, range) {
				opens++;
				if (mode === 'throw') throw new Error('File disappeared');
				let stream;
				if (mode === 'error') {
					stream = new Readable({ read() { this.destroy(new Error('Read failed')); } });
				} else if (mode === 'stall') {
					stream = new Readable({ read() {} });
				} else {
					stream = Readable.from([data.subarray(range.start || 0, range.end === undefined ? data.length : range.end + 1)]);
				}
				streams.push(stream);
				return stream;
			}
		}
	});
	const server = http.createServer(handler);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { server, streams, get opens() { return opens; } };
}

function request(context, range, method = 'GET') {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port: context.server.address().port,
			path: '/index.html', method, headers: range === undefined ? {} : { range } }, res => {
			let body = '';
			res.on('data', chunk => { body += chunk; });
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
			res.on('error', reject);
		});
		req.on('error', reject);
		req.setTimeout(1000, () => req.destroy(new Error('Response did not complete')));
		req.end();
	});
}

describe('static file Range security', function() {
	let context;
	afterEach(async function() {
		if (context) {
			context.server.closeAllConnections();
			await new Promise(resolve => context.server.close(resolve));
			context = null;
		}
	});

	for (const [range, expected, header] of [
		['bytes=0-0', '0', 'bytes 0-0/10'],
		['bytes=2-5', '2345', 'bytes 2-5/10'],
		['bytes=7-', '789', 'bytes 7-9/10'],
		['bytes=-3', '789', 'bytes 7-9/10'],
		['bytes=-20', '0123456789', 'bytes 0-9/10'],
		['bytes=8-100', '89', 'bytes 8-9/10']
	]) {
		it('serves the correct bytes for ' + range, async function() {
			context = await fixture();
			const res = await request(context, range);
			assert.equal(res.status, 206);
			assert.equal(res.body, expected);
			assert.equal(res.headers['content-range'], header);
			assert.equal(Number(res.headers['content-length']), expected.length);
		});
	}

	it('completes invalid requests with 416 before opening any stream', async function() {
		context = await fixture();
		for (const range of ['bytes=8-2', 'bytes=wat-', 'bytes=-', 'bytes=-0', 'bytes=10-',
			'bytes=11-20', 'bytes=0-1,3-4', 'bytes=1.5-3', 'bytes=0-9007199254740992',
			'bytes=9007199254740992-', 'items=0-1', 'bytes=0-1junk']) {
			const res = await request(context, range);
			assert.equal(res.status, 416, range);
			assert.equal(res.headers['content-range'], 'bytes */10', range);
		}
		assert.equal(context.opens, 0);
		assert.equal((await request(context)).body, content.toString());
	});

	it('ignores Range for HEAD and never opens a stream', async function() {
		context = await fixture();
		for (const range of ['bytes=0-0', 'bytes=wat-']) {
			const res = await request(context, range, 'HEAD');
			assert.equal(res.status, 200);
			assert.equal(res.body, '');
			assert.equal(res.headers['content-length'], '10');
			assert.equal(res.headers['content-range'], undefined);
		}
		assert.equal(context.opens, 0);
	});

	it('serves empty files and rejects their ranges without hanging', async function() {
		context = await fixture('normal', Buffer.alloc(0));
		const res = await request(context);
		assert.equal(res.status, 200);
		assert.equal(res.body, '');
		for (const range of ['bytes=0-', 'bytes=-1']) {
			const invalid = await request(context, range);
			assert.equal(invalid.status, 416);
			assert.equal(invalid.headers['content-range'], 'bytes */0');
		}
	});

	for (const mode of ['throw', 'error']) {
		it('closes the connection on a ' + mode + ' failure after headers are committed', async function() {
			context = await fixture(mode);
			await assert.rejects(request(context, 'bytes=0-0'), { code: 'ECONNRESET' });
			assert.equal(context.opens, 1);
			assert.equal((await request(context, undefined, 'HEAD')).status, 200);
			for (const stream of context.streams) assert.equal(stream.destroyed, true);
		});
	}

	it('destroys a pending file stream when the client disconnects', async function() {
		context = await fixture('stall');
		await assert.rejects(request(context), /Response did not complete/);
		const stream = context.streams[0];
		if (!stream.closed) await once(stream, 'close');
		assert.equal(stream.destroyed, true);
	});
});
