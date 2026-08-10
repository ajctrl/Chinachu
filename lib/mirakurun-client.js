'use strict';

const path = require('path');

function joinBasePath(prefix, basePath) {
	return path.posix.join('/', prefix || '/', basePath || '/');
}

function configureMirakurunClient(client, endpoint) {
	const standardUnix = endpoint.match(/^http\+unix:\/\/([^/]+)(\/?.*)$/i);
	if (standardUnix) {
		client.host = '';
		client.socketPath = decodeURIComponent(standardUnix[1]);
		client.basePath = joinBasePath(standardUnix[2], client.basePath);
		return client;
	}

	const legacyUnix = endpoint.match(/^http:\/\/unix:([^:]+):?(.*)$/i);
	if (legacyUnix) {
		client.host = '';
		client.socketPath = decodeURIComponent(legacyUnix[1]);
		client.basePath = joinBasePath(legacyUnix[2], client.basePath);
		return client;
	}

	const parsed = new URL(endpoint);
	if (parsed.protocol !== 'http:') {
		throw new TypeError(`Unsupported Mirakurun protocol: ${parsed.protocol}`);
	}

	client.host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
	client.port = parsed.port === '' ? 80 : Number(parsed.port);
	client.basePath = joinBasePath(parsed.pathname, client.basePath);
	return client;
}

module.exports = { configureMirakurunClient };
