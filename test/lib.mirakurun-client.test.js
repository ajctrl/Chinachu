'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const Mirakurun = require('mirakurun').default;
const { configureMirakurunClient } = require('../lib/mirakurun-client');

const docs = {
	swagger: '2.0',
	basePath: '/api',
	paths: {
		'/services': operation('getServices'),
		'/programs': operation('getPrograms'),
		'/tuners': operation('getTuners'),
		'/services/{id}/logo': operation('getLogoImage', ['id']),
		'/programs/{id}/stream': operation('getProgramStream', ['id'], true),
		'/services/{id}/stream': operation('getServiceStream', ['id'], true)
	}
};

function operation(operationId, pathParameters, stream) {
	return {
		parameters: (pathParameters || []).map(name => ({ in: 'path', name, required: true })),
		get: {
			operationId,
			parameters: [],
			tags: stream ? ['stream'] : ['test']
		}
	};
}

function createMockMirakurun() {
	return http.createServer((req, res) => {
		if (req.url === '/api/docs') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(docs));
			return;
		}

		if (req.url.startsWith('/api/services/') && req.url.includes('/logo')) {
			res.writeHead(200, { 'content-type': 'image/png' });
			res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
			return;
		}

		if (req.url.includes('/stream')) {
			res.writeHead(200, { 'content-type': 'video/MP2T' });
			res.write(Buffer.from([0x47, 0x00, 0x00, 0x00]));
			return;
		}

		const values = req.url.startsWith('/api/tuners') ? [{ index: 0 }]
			: req.url.startsWith('/api/programs') ? [{ id: 1 }]
				: [{ id: 1 }];
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(values));
	});
}

async function exerciseClient(endpoint) {
	const client = configureMirakurunClient(new Mirakurun(), endpoint);
	assert.deepEqual(await client.getServices(), [{ id: 1 }]);
	assert.deepEqual(await client.getPrograms(), [{ id: 1 }]);
	assert.deepEqual(await client.getTuners(), [{ index: 0 }]);
	assert.deepEqual(await client.getLogoImage(1), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

	for (const getStream of [
		signal => client.getProgramStream({ id: 1, decode: true, signal }),
		signal => client.getServiceStream({ id: 1, decode: true, signal })
	]) {
		const controller = new AbortController();
		const stream = await getStream(controller.signal);
		stream.on('error', () => {});
		const closed = new Promise(resolve => stream.once('close', resolve));
		controller.abort();
		await closed;
	}
}

describe('Mirakurun 4 client', function() {
	it('exports the CommonJS default client', function() {
		assert.equal(typeof Mirakurun, 'function');
	});

	it('supports TCP API and abortable streams', async function() {
		const server = createMockMirakurun();
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');

		try {
			const address = server.address();
			await exerciseClient(`http://127.0.0.1:${address.port}/`);
		} finally {
			server.close();
			await once(server, 'close');
		}
	});

	it('supports an encoded Unix socket endpoint', async function() {
		const socketPath = path.join(os.tmpdir(), `chinachu-mirakurun-${process.pid}-${Date.now()}.sock`);
		const server = createMockMirakurun();
		server.listen(socketPath);
		await once(server, 'listening');

		try {
			await exerciseClient(`http+unix://${encodeURIComponent(socketPath)}/`);
		} finally {
			server.close();
			await once(server, 'close');
			if (fs.existsSync(socketPath)) {
				fs.unlinkSync(socketPath);
			}
		}
	});

	it('preserves endpoint base paths', function() {
		const client = configureMirakurunClient(new Mirakurun(), 'http://localhost:40772/proxy/');
		assert.equal(client.host, 'localhost');
		assert.equal(client.port, 40772);
		assert.equal(client.basePath, '/proxy/api');
	});

	it('normalizes IPv6 hostnames for http.request', function() {
		const client = configureMirakurunClient(new Mirakurun(), 'http://[::1]:40772/');
		assert.equal(client.host, '::1');
		assert.equal(client.port, 40772);
	});
});
