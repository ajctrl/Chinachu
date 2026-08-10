'use strict';

const assert = require('node:assert/strict');
const { createGotifyNotifier, createMessageUrl } = require('../lib/gotify-notifier');

describe('Gotify notifier', function() {
	it('builds a message endpoint without discarding a base path', function() {
		assert.equal(
			createMessageUrl('https://notify.example/gotify/').href,
			'https://notify.example/gotify/message'
		);
		assert.equal(
			createMessageUrl('https://notify.example/gotify/message/').href,
			'https://notify.example/gotify/message'
		);
	});

	it('posts a message using an application token', async function() {
		let request;
		const notify = createGotifyNotifier({
			url: 'https://notify.example/gotify',
			token: 'secret-token',
			title: 'Recorder',
			priority: 7
		}, async (url, options) => {
			request = { url, options };
			return { ok: true, status: 200 };
		});

		await notify('recording started');

		assert.equal(request.url.href, 'https://notify.example/gotify/message');
		assert.equal(request.options.method, 'POST');
		assert.equal(request.options.headers['X-Gotify-Key'], 'secret-token');
		assert.deepEqual(JSON.parse(request.options.body), {
			title: 'Recorder',
			message: 'recording started',
			priority: 7
		});
		assert.ok(request.options.signal instanceof AbortSignal);
	});

	it('rejects an unsuccessful response without exposing the token', async function() {
		const notify = createGotifyNotifier({
			url: 'https://notify.example',
			token: 'secret-token'
		}, async () => ({ ok: false, status: 401 }));

		await assert.rejects(notify('test'), err => {
			assert.equal(err.message, 'Gotify returned HTTP 401.');
			assert.equal(err.message.includes('secret-token'), false);
			return true;
		});
	});
});
