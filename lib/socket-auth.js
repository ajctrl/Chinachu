'use strict';

function parseBasicAuthorization(header) {
	if (typeof header !== 'string') {
		return null;
	}

	const match = header.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
	if (!match) {
		return null;
	}

	return Buffer.from(match[1], 'base64').toString('utf8');
}

function createBasicAuthMiddleware(verify) {
	return function basicAuthMiddleware(socket, next) {
		const credentials = parseBasicAuthorization(socket.handshake.headers.authorization);
		const colon = credentials === null ? -1 : credentials.indexOf(':');
		if (colon < 1) {
			next(new Error('not authorized'));
			return;
		}
		verify(credentials.slice(0, colon), credentials.slice(colon + 1), socket.request)
			.then(valid => next(valid ? undefined : new Error('not authorized')), () => next(new Error('not authorized')));
	};
}

module.exports = { createBasicAuthMiddleware, parseBasicAuthorization };
