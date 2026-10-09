'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const { once } = require('node:events');
const security = require('../lib/http-security');

const source = fs.readFileSync(require.resolve('../app-wui'), 'utf8');

async function fixture(config = {}, bodyOptions = {}) {
	const calls = [];
	const requestGuard = security.createRequestGuard(config);
	const handler = vm.runInNewContext(source.slice(source.indexOf('function httpServer(req, res)'), source.indexOf('function httpServerMain')) + '\nhttpServer;', {
		URL, requestGuard, readBody: (req, res, done) => security.readBody(req, res, done, bodyOptions),
		querystring: require('node:querystring'),
		httpServerMain(req, res, query) { calls.push({ method: req.method, query }); res.end('ok'); }
	});
	const server = http.createServer(handler);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { calls, server, port: server.address().port };
}

function request(context, method = 'GET', url = '/api/rules.json', headers = {}, body = '') {
	return new Promise((resolve, reject) => {
		if (body && !headers['transfer-encoding']) headers = { 'content-length': Buffer.byteLength(body), ...headers };
		const req = http.request({ host: '127.0.0.1', port: context.port, method, path: url, headers }, res => {
			let text = '';
			res.on('data', chunk => { text += chunk; });
			res.on('end', () => resolve({ status: res.statusCode, body: text }));
		});
		req.on('error', reject);
		req.end(body);
	});
}

describe('WUI request security', function() {
	it('keeps all legacy listen addresses local', function() {
		for (const wuiHost of [undefined, '0.0.0.0', '::', '192.168.1.3', 'public.example']) {
			assert.equal(security.listenAddress({ wuiHost }), '127.0.0.1');
		}
		assert.equal(security.listenAddress({ wuiHost: '::1' }), '::1');
	});
	it('rejects wildcard public origins at startup', function() {
		assert.throws(() => security.createRequestGuard({ wuiAllowedOrigins: ['https://*.example'] }), /origin/);
	});
	it('requires an approved Host and rejects foreign/null origins', async function() {
		const context = await fixture({ wuiAllowedOrigins: ['https://tv.example'] });
		try {
			assert.equal((await request(context, 'GET', '/', { host: 'evil.example' })).status, 403);
			assert.equal((await request(context, 'GET', '/', { host: 'tv.example', origin: 'https://evil.example' })).status, 403);
			assert.equal((await request(context, 'GET', '/', { host: 'tv.example', origin: 'null' })).status, 403);
			assert.equal((await request(context, 'GET', '/', { host: 'tv.example', origin: 'http://tv.example' })).status, 403);
			assert.equal((await request(context, 'GET', '/', { host: 'tv.example', origin: 'https://tv.example' })).status, 200);
			assert.equal(context.calls.length, 1);
		} finally { await new Promise(resolve => context.server.close(resolve)); }
	});
	for (const [origin, allowed, rejected] of [
		['https://tv.example', ['tv.example', 'tv.example:443'], ['tv.example:80', 'tv.example:8443']],
		['https://tv.example:80', ['tv.example:80'], ['tv.example', 'tv.example:443']],
		['http://tv.example', ['tv.example', 'tv.example:80'], ['tv.example:443']],
		['http://tv.example:443', ['tv.example:443'], ['tv.example', 'tv.example:80']],
		['https://tv.example:8443', ['tv.example:8443'], ['tv.example', 'tv.example:443']],
		['https://[2001:db8::1]:80', ['[2001:db8::1]:80'], ['[2001:db8::1]', '[2001:db8::1]:443']]
	]) {
		it('matches Host ports to the public scheme for ' + origin, async function() {
			const context = await fixture({ wuiAllowedOrigins: [origin] });
			try {
				for (const host of allowed) {
					assert.equal((await request(context, 'GET', '/', { host, origin })).status, 200, host);
				}
				for (const host of rejected) {
					assert.equal((await request(context, 'GET', '/', { host, origin })).status, 403, host);
				}
				assert.equal(context.calls.length, allowed.length);
			} finally { await new Promise(resolve => context.server.close(resolve)); }
		});
	}
	it('accepts each configured public scheme without accepting other ports', function() {
		const guard = security.createRequestGuard({ wuiAllowedOrigins: ['https://tv.example', 'http://tv.example:8080'] });
		for (const [host, status] of [['tv.example', null], ['tv.example:443', null], ['tv.example:8080', null], ['tv.example:80', 403]]) {
			assert.equal(guard({ headers: { host } }), status, host);
		}
	});
	it('uses the actual connection scheme for local Host and Origin ports', function() {
		const guard = security.createRequestGuard({});
		for (const [encrypted, host, origin, status] of [
			[true, 'localhost:80', 'https://localhost:80', null],
			[true, 'localhost:443', 'https://localhost', null],
			[true, 'localhost:80', 'https://localhost', 403],
			[false, 'localhost:80', 'http://localhost', null],
			[false, 'localhost:443', 'http://localhost:443', null],
			[false, 'localhost:443', 'https://localhost', 403]
		]) {
			assert.equal(guard({ headers: { host, origin }, socket: { encrypted } }), status, origin + ' / ' + host);
		}
	});
	it('blocks cross-site writes and permits the application custom header', async function() {
		const context = await fixture({ wuiAllowedOrigins: ['https://tv.example'] });
		try {
			for (const method of ['POST', 'PUT', 'DELETE']) {
				assert.equal((await request(context, method)).status, 403);
				assert.equal((await request(context, method, '/api/rules.json', { 'x-requested-with': 'XMLHttpRequest', 'sec-fetch-site': 'cross-site' })).status, 403);
				assert.equal((await request(context, method, '/api/rules.json', { host: 'tv.example', origin: 'https://tv.example', 'x-requested-with': 'XMLHttpRequest' }, 'title=日本語')).status, 200);
			}
			assert.equal(context.calls.length, 3);
		} finally { await new Promise(resolve => context.server.close(resolve)); }
	});
	it('never turns query or body method overrides into writes', async function() {
		const context = await fixture();
		try {
			for (const key of ['method', '_method']) {
				assert.equal((await request(context, 'GET', '/api/rules.json?' + key + '=DELETE')).status, 400);
				assert.equal((await request(context, 'POST', '/api/rules.json', { 'x-requested-with': 'XMLHttpRequest' }, key + '=DELETE')).status, 400);
			}
			assert.equal(context.calls.length, 0);
		} finally { await new Promise(resolve => context.server.close(resolve)); }
	});
	it('rejects malformed JSON and oversized bodies, including chunked bodies', async function() {
		const context = await fixture({}, { limit: 64 });
		try {
			const headers = { 'x-requested-with': 'XMLHttpRequest' };
			assert.equal((await request(context, 'PUT', '/api/config.json', headers, '{broken')).status, 400);
			assert.equal((await request(context, 'PUT', '/api/config.json', headers, 'x'.repeat(65))).status, 413);
			assert.equal((await request(context, 'PUT', '/api/config.json', { ...headers, 'transfer-encoding': 'chunked' }, 'x'.repeat(65))).status, 413);
			assert.equal(context.calls.length, 0);
			assert.equal((await request(context, 'PUT', '/api/config.json', headers, JSON.stringify({ title: '日本語' }))).status, 200);
			assert.equal(context.calls[0].query.title, '日本語');
		} finally { await new Promise(resolve => context.server.close(resolve)); }
	});
	it('times out a body that never completes without dispatching it', async function() {
		const context = await fixture({}, { timeout: 40 });
		try {
			const status = await new Promise((resolve, reject) => {
				const req = http.request({ host: '127.0.0.1', port: context.port, method: 'POST', path: '/api/rules.json', headers: { 'x-requested-with': 'XMLHttpRequest', 'content-length': '20' } }, res => {
					res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); });
				});
				req.on('error', reject); req.write('a');
			});
			assert.equal(status, 408);
			assert.equal(context.calls.length, 0);
		} finally { await new Promise(resolve => context.server.close(resolve)); }
	});
	it('uses the authenticated server for a legacy Open Server port', async function() {
		const config = { wuiUsers: ['alice:secret'], wuiHost: '0.0.0.0', wuiOpenServer: true, wuiOpenPort: 12345 };
		let binding;
		const server = vm.runInNewContext(source.slice(source.indexOf('// Basic Auth'), source.indexOf('// HTTP Server')) + '\nserver;', {
			auth: require('http-auth'), https: {}, tlsEnabled: false, config, listenAddress: security.listenAddress,
			http: { createServer(handler) { const server = http.createServer(handler); server.listen = function(port, host) { binding = { port, host }; return this; }; return server; } },
			httpServer: (req, res) => res.end('ok'), log() {}, util: {}
		});
		assert.deepEqual(binding, { port: 12345, host: '127.0.0.1' });
		delete server.listen;
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		try {
			assert.equal((await request({ port: server.address().port })).status, 401);
			assert.equal((await request({ port: server.address().port }, 'GET', '/', { authorization: 'Basic ' + Buffer.from('alice:secret').toString('base64') })).status, 200);
		} finally { await new Promise(resolve => server.close(resolve)); }
	});
});

describe('WUI Socket.IO request security', function() {
	it('applies the public origin guard and authentication to polling and WebSocket connections', async function() {
		const config = { wuiUsers: ['alice:secret'], wuiAllowedOrigins: ['https://tv.example'] };
		const server = http.createServer((req, res) => res.end());
		const start = vm.runInNewContext(source.slice(source.indexOf('function ioAddListener(server)'), source.indexOf('\nioAddListener(server);')) + '\nioAddListener;', {
			Server: require('socket.io').Server, config, basicAuthEnabled: true,
			requestGuard: security.createRequestGuard(config),
			createBasicAuthMiddleware: require('../lib/socket-auth').createBasicAuthMiddleware,
			ioServer() {}, iosAddEventListner() {}
		});
		const io = start(server);
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const url = 'http://127.0.0.1:' + server.address().port;
		async function connect(transport, headers) {
			const socket = require('socket.io-client').io(url, { transports: [transport], extraHeaders: headers, reconnection: false, timeout: 500 });
			try {
				return await new Promise(resolve => {
					socket.once('connect', () => resolve(true));
					socket.once('connect_error', () => resolve(false));
				});
			} finally { socket.close(); }
		}
		const headers = { Host: 'tv.example', Origin: 'https://tv.example', Authorization: 'Basic ' + Buffer.from('alice:secret').toString('base64') };
		try {
			assert.equal((await request({ port: server.address().port }, 'GET', '/socket.io/?EIO=4&transport=polling', { ...headers, Host: 'evil.example' })).status, 403);
			for (const transport of ['polling', 'websocket']) {
				assert.equal(await connect(transport, headers), true, transport + ' valid request');
				assert.equal(await connect(transport, { ...headers, Origin: 'https://evil.example' }), false, transport + ' foreign origin');
				// The polling client's XMLHttpRequest implementation forbids overriding Host.
				if (transport === 'websocket') assert.equal(await connect(transport, { ...headers, Host: 'evil.example' }), false, transport + ' foreign host');
				assert.equal(await connect(transport, { ...headers, Authorization: '' }), false, transport + ' missing authentication');
			}
		} finally { await new Promise(resolve => io.close(resolve)); }
	});
});
