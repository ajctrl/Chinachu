'use strict';

function createMessageUrl(baseUrl) {
	const url = new URL(baseUrl);
	const path = url.pathname.replace(/\/+$/, '');
	url.pathname = path.endsWith('/message') ? path : `${path}/message`;
	return url;
}

function createGotifyNotifier(options, fetchImpl = globalThis.fetch) {
	if (!options || !options.url) {
		throw new TypeError('Gotify URL is required.');
	}
	if (!options.token) {
		throw new TypeError('Gotify application token is required.');
	}
	if (typeof fetchImpl !== 'function') {
		throw new TypeError('Fetch implementation is required.');
	}

	const url = createMessageUrl(options.url);
	const title = options.title || 'Chinachu';
	const priority = Number.isInteger(options.priority) ? options.priority : 5;
	const timeout = Number.isFinite(options.timeout) && options.timeout > 0 ? options.timeout : 10000;

	return async message => {
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Gotify-Key': options.token
			},
			body: JSON.stringify({
				title,
				message,
				priority
			}),
			signal: AbortSignal.timeout(timeout)
		});

		if (!response.ok) {
			throw new Error(`Gotify returned HTTP ${response.status}.`);
		}
	};
}

module.exports = { createGotifyNotifier, createMessageUrl };
