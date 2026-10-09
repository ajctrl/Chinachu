'use strict';

const http = require('node:http');
const { once } = require('node:events');

// A bounded Mirakurun-compatible HTTP fixture, not a tuner or a real broadcast.
module.exports = async function upstreamFixture(content) {
	const active = new Set();
	const state = { mode: 'normal', active, requests: 0, contentLength: content.length };
	const server = http.createServer((req, res) => {
		if (req.url === '/api/docs') {
			res.setHeader('content-type', 'application/json');
			return res.end(JSON.stringify({ paths: { '/services/{id}/stream': {
				parameters: [{ name: 'id', in: 'path', required: true }, { name: 'decode', in: 'query' }],
				get: { operationId: 'getServiceStream', tags: ['stream'] }
			} } }));
		}
		if (!/^\/api\/services\/\d+\/stream/.test(req.url)) { res.writeHead(404); return res.end(); }
		state.requests++;
		if (state.mode === 'unavailable') { res.writeHead(503); return res.end('unavailable'); }
		res.setHeader('content-type', 'video/MP2T');
		active.add(res);
		let offset = 0;
		const mode = state.mode;
		const timer = setInterval(() => {
			if (mode === 'broken' && offset > 0) return res.destroy();
			if (offset >= content.length) {
				if (mode === 'continuous') offset = 0;
				else return res.end();
			}
			const next = Math.min(content.length, offset + 188 * 128);
			res.write(content.subarray(offset, next)); offset = next;
		}, 20);
		res.once('close', () => { clearInterval(timer); active.delete(res); });
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	state.url = 'http://127.0.0.1:' + server.address().port;
	state.close = async () => {
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
	};
	return state;
};
