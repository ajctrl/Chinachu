'use strict';

const net = require('node:net');

const BODY_LIMIT = 1024 * 1024;
const BODY_TIMEOUT = 15000;

function isLoopback(address) {
	return address === '::1' || (net.isIP(address) === 4 && address.startsWith('127.')) ||
		(address && address.startsWith('::ffff:') && isLoopback(address.slice(7)));
}

function authenticationSource(req, trustForwarded = false) {
	function normalize(address) {
		if (typeof address !== 'string') return null;
		address = address.trim();
		if (address.startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) address = address.slice(7);
		if (net.isIP(address) === 4) return address;
		if (net.isIP(address) === 6) {
			try { return new URL('http://[' + address + ']').hostname.slice(1, -1); }
			catch (_) { return null; }
		}
		return null;
	}
	const peer = normalize(req && (req.socket || req.client || {}).remoteAddress);
	// The local proxy must overwrite X-Forwarded-For with one client IP.
	// Never trust forwarded headers from a remote peer or accept an IP list.
	if (trustForwarded && isLoopback(peer)) {
		const forwarded = normalize(req.headers && req.headers['x-forwarded-for']);
		if (forwarded) return forwarded;
	}
	return peer || 'unknown';
}

function listenAddress(config) {
	// Legacy public/LAN addresses never widen the application's exposure.
	return config.wuiHost === '::1' ? '::1' : '127.0.0.1';
}

function normalizeOrigin(value) {
	const url = new URL(value);
	if (!['http:', 'https:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password ||
		url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid public origin');
	return url.origin;
}

function createRequestGuard(config) {
	const publicOrigins = new Set((config.wuiAllowedOrigins || []).map(normalizeOrigin));
	const publicUrls = Array.from(publicOrigins, origin => new URL(origin));
	return function requestError(req, update = false) {
		let url;
		try {
			const host = req.headers.host;
			if (typeof host !== 'string' || /[\s\\/@?#]/.test(host)) return 400;
			url = new URL((req.socket && req.socket.encrypted ? 'https://' : 'http://') + host);
			// Default ports depend on the public scheme, which may differ from the proxy connection.
			const publicHost = publicUrls.some(publicUrl => new URL(publicUrl.protocol + '//' + host).origin === publicUrl.origin);
			if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !publicHost) return 403;
		} catch (_) { return 400; }
		const origin = req.headers.origin;
		if (origin !== undefined) {
			let normalized;
			try { normalized = normalizeOrigin(origin); } catch (_) { return 403; }
			const localOrigin = url.origin;
			const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
			if (!publicOrigins.has(normalized) && !(localHost && normalized === localOrigin)) return 403;
		}
		if (update && (req.headers['x-requested-with'] !== 'XMLHttpRequest' ||
			['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))) return 403;
		return null;
	};
}

function readBody(req, res, callback, options = {}) {
	const limit = options.limit || BODY_LIMIT;
	let chunks = [], size = 0, finished = false;
	const timer = setTimeout(() => fail(408), options.timeout || BODY_TIMEOUT);
	timer.unref();
	function cleanup() {
		clearTimeout(timer);
		req.removeListener('data', onData);
		req.removeListener('end', onEnd);
		req.removeListener('aborted', abort);
		req.removeListener('error', abort);
		chunks = [];
	}
	function abort() { if (!finished) { finished = true; cleanup(); } }
	function fail(code) {
		if (finished) return;
		finished = true;
		cleanup();
		res.once('finish', () => { if (!req.complete) req.destroy(); });
		res.writeHead(code, { 'Content-Type': 'text/plain', Connection: 'close' });
		res.end(code + '\n');
		req.resume();
	}
	function onData(chunk) {
		size += chunk.length;
		if (size > limit) return fail(413);
		chunks.push(chunk);
	}
	function onEnd() {
		if (finished) return;
		finished = true;
		const body = Buffer.concat(chunks, size).toString('utf8');
		cleanup();
		callback(body);
	}
	const contentLength = req.headers['content-length'];
	if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) return fail(413);
	req.on('data', onData);
	req.once('end', onEnd);
	req.once('aborted', abort);
	req.once('error', abort);
}

module.exports = { BODY_LIMIT, BODY_TIMEOUT, isLoopback, authenticationSource, listenAddress, normalizeOrigin, createRequestGuard, readBody };
