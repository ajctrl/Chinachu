'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function stressChecks({ origin, ca, authorization, request, check, backend, proxyPort, publicHost }) {
	const proc = '/proc/' + backend.pid;
	function resources() {
		return { descriptors: fs.readdirSync(proc + '/fd').length,
			rssMiB: Math.round(Number(fs.readFileSync(proc + '/status', 'utf8').match(/^VmRSS:\s+(\d+)/m)[1]) / 1024 * 10) / 10,
			children: fs.readFileSync(proc + '/task/' + backend.pid + '/children', 'utf8').trim() };
	}
	const status = async () => JSON.parse((await request('/api/status.json')).body);
	async function sockets(count) {
		const clients = Array.from({ length: count }, () => io(origin, { transports: ['websocket'], ca, forceNew: true,
			extraHeaders: { authorization, origin }, reconnection: false, timeout: 3000 }));
		try {
			await Promise.all(clients.map(client => Promise.race([once(client, 'connect'),
				once(client, 'connect_error').then(([error]) => { throw error; })])));
			return clients;
		} catch (error) { clients.forEach(client => client.close()); throw error; }
	}
	await check('80 WebSocket connect/disconnect cycles restore connection counts and descriptors', async () => {
		await delay(1500);
		const before = resources();
		for (let batch = 0; batch < 10; batch++) {
			const clients = await sockets(8);
			try { assert.equal((await status()).connectedCount, 8); }
			finally { clients.forEach(client => client.close()); }
			await delay(100);
			assert.equal((await status()).connectedCount, 0);
		}
		await delay(1500);
		assert.ok(resources().descriptors <= before.descriptors + 2);
		console.log('RESOURCE reconnect', JSON.stringify({ before, after: resources() }));
	});
	await check('eight simultaneous recorded/live MP4 requests complete and release their encoders', async () => {
		const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => request(index % 2 ?
			'/api/recording/proxy-recording/watch.mp4?ss=2&t=1&s=320x180' : '/api/recorded/proxy-recorded/watch.mp4?t=1&s=320x180')));
		for (const response of responses) { assert.equal(response.status, 200); assert.ok(response.body.includes(Buffer.from('ftyp'))); }
		await delay(1500);
		assert.equal(resources().children, '');
	});
	await check('60 seconds of eight WebSockets and four streams stay responsive and release resources', async () => {
		const before = resources();
		const clients = await sockets(8);
		const streams = [];
		const samples = [];
		try {
			for (const url of ['/api/log/wui/stream.txt', '/api/log/wui/stream.txt',
				'/api/recording/proxy-recording/watch.m2ts', '/api/recording/proxy-recording/watch.m2ts']) {
				streams.push(await new Promise((resolve, reject) => {
					const req = https.get({ hostname: '127.0.0.1', port: proxyPort, servername: 'proxy.chinachu.test', ca,
						path: url, headers: { host: publicHost, authorization }, agent: false }, res => {
						if (res.statusCode !== 200) { res.destroy(); reject(new Error('Stream status ' + res.statusCode)); return; }
						res.resume(); resolve({ req, res });
					});
					req.on('error', reject);
				}));
			}
			const started = Date.now();
			for (let interval = 0; interval < 6; interval++) {
				await delay(10000);
				assert.equal((await status()).connectedCount, 8);
				for (const stream of streams) assert.equal(stream.res.destroyed, false);
				const responses = await Promise.all(Array.from({ length: 8 }, () => request('/api/status.json')));
				assert.ok(responses.every(response => response.status === 200));
				samples.push({ seconds: Math.round((Date.now() - started) / 1000), ...resources() });
			}
		} finally {
			streams.forEach(({ req, res }) => { res.destroy(); req.destroy(); });
			clients.forEach(client => client.close());
		}
		await delay(2000);
		const after = resources();
		assert.equal((await status()).connectedCount, 0);
		assert.equal(after.children, '');
		assert.ok(after.descriptors <= before.descriptors + 2, 'Descriptors did not return to idle levels');
		console.log('RESOURCE sustained', JSON.stringify({ before, samples, after }));
	});
};
