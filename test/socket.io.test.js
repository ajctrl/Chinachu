'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const { createBasicAuthMiddleware } = require('../lib/socket-auth');

async function startServer(options) {
	const server = http.createServer();
	const io = new Server(server, { path: options.path });
	if (options.users) {
		io.use(createBasicAuthMiddleware(options.users));
	}
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return { io, server, url: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(context) {
	await new Promise(resolve => context.io.close(resolve));
}

function connect(url, options) {
	return new Promise((resolve, reject) => {
		const socket = createClient(url, {
			reconnection: false,
			timeout: 1000,
			...options
		});
		socket.once('connect', () => resolve(socket));
		socket.once('connect_error', reject);
	});
}

describe('Socket.IO 4', function() {
	const path = '/custom/socket.io';

	it('connects without authentication on a custom path', async function() {
		const context = await startServer({ path });
		try {
			const socket = await connect(context.url, { path });
			assert.equal(socket.connected, true);
			socket.close();
		} finally {
			await stopServer(context);
		}
	});

	it('accepts valid Basic authentication', async function() {
		const context = await startServer({ path, users: ['alice:secret'] });
		try {
			const socket = await connect(context.url, {
				path,
				extraHeaders: { authorization: `Basic ${Buffer.from('alice:secret').toString('base64')}` }
			});
			assert.equal(socket.connected, true);
			socket.close();
		} finally {
			await stopServer(context);
		}
	});

	it('rejects missing Basic authentication', async function() {
		const context = await startServer({ path, users: ['alice:secret'] });
		try {
			await assert.rejects(connect(context.url, { path }), /not authorized/);
		} finally {
			await stopServer(context);
		}
	});
});
