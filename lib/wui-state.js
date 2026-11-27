'use strict';

const { Worker } = require('node:worker_threads');

// Socket, file descriptor and stream ownership stays with the HTTP server.
const mediaCollections = new Map([
	['channel-logo', 'channel'], ['channel-watch', 'channel'],
	['recorded-program-file', 'recorded'], ['recorded-program-preview', 'recorded'], ['recorded-program-watch', 'recorded'],
	['recording-program-preview', 'recording'], ['recording-program-watch', 'recording']
]);

const stateScripts = new Set([
	'exclusion-rules', 'rules', 'rules-rule', 'rules-rule-action', 'program',
	'reserves', 'reserves-program', 'reserves-program-action', 'recording', 'recording-program',
	'recorded', 'recorded-program', 'schedule', 'schedule-programs', 'schedule-broadcasting',
	'schedule-channel', 'schedule-channel-programs', 'schedule-channel-broadcasting', 'scheduler', 'storage'
]);

function openWuiState(root, onChange, onFatal) {
	let nextId = 0;
	const pending = new Map();
	const worker = new Worker(require.resolve('./wui-state-worker'), { workerData: root });
	const ready = Promise.withResolvers();
	worker.on('message', message => {
		if (message.ready) return ready.resolve();
		if (message.change) return onChange(message.change);
		const job = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) job.reject(Object.assign(new Error(message.error.message), { status: message.error.status }));
		else job.resolve(message.result);
	});
	let failure;
	function fail(error) {
		if (failure) return;
		failure = error;
		ready.reject(error);
		for (const job of pending.values()) job.reject(error);
		pending.clear();
		onFatal(error);
	}
	worker.on('error', fail);
	worker.once('exit', code => fail(new Error('WUI database worker exited: ' + code)));
	function send(message) {
		if (failure) return Promise.reject(failure);
		const id = ++nextId;
		return new Promise((resolve, reject) => {
			worker.postMessage({ id, ...message });
			pending.set(id, { resolve, reject });
		});
	}
	let draining;
	return {
		ready: ready.promise,
		request(script, request) {
			if (draining) return Promise.reject(Object.assign(new Error('WUI shutting down'), { status: 503 }));
			return send({ script, request });
		},
		drainWrites() {
			draining ??= send({ drain: true });
			return draining;
		}
	};
}

module.exports = { openWuiState, stateScripts, mediaCollections };
