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

function createBasicAuthMiddleware(users) {
	return function basicAuthMiddleware(socket, next) {
		const credentials = parseBasicAuthorization(socket.handshake.headers.authorization);
		if (credentials !== null && users.includes(credentials)) {
			next();
			return;
		}

		next(new Error('not authorized'));
	};
}

module.exports = { createBasicAuthMiddleware, parseBasicAuthorization };
