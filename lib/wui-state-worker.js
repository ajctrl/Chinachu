'use strict';

const { parentPort, workerData: root } = require('node:worker_threads');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const child_process = require('node:child_process');
const chinachu = require('chinachu-common');
const { StateStore } = require('./state-store');
const { stateScripts, mediaCollections } = require('./wui-state');
const { changeReservation, requestStop } = require('./program-state');
const { editRule } = require('./rule-state');
const { log } = require('./logger');

const define = { CONFIG_FILE: path.join(root, 'config.json'), SCHEDULER_LOG_FILE: path.join(root, 'log/scheduler') };
const config = require(define.CONFIG_FILE);
const store = new StateStore(root);
let historyRevision, historySnapshot;
const data = {
	get reserves() { return store.read('reserves'); },
	get recording() { return store.read('recording'); },
	get recorded() {
		// Detail requests annotate this revision's snapshot with isRemoved.
		return store.transaction(() => {
			const { revision } = store.revision('recorded');
			if (historyRevision !== revision) {
				historySnapshot = store.read('recorded');
				historyRevision = revision;
			}
			return historySnapshot;
		}, false);
	}
};

// Yield between attempts to acquire the write lock, so reads and notifications
// can still run. Once the transaction starts, never replay its side effects.
async function write(work, deadline) {
	for (;;) {
		let started = false;
		try {
			store.db.exec('PRAGMA busy_timeout = 0');
			return store.transaction(() => {
				started = true;
				store.db.exec('PRAGMA busy_timeout = 10000');
				return work();
			});
		} catch (error) {
			if (started || (error.errcode & 255) !== 5 || performance.now() >= deadline) throw error;
		} finally {
			store.db.exec('PRAGMA busy_timeout = 10000');
		}
		await delay(25);
	}
}

async function dispatch(script, request, deadline) {
	const collection = mediaCollections.get(script);
	if (collection === 'channel') return { channel: store.channelMetadata(request.param.chid) };
	if (collection) {
		const program = chinachu.getProgramById(request.param.id, data[collection]);
		return { [collection]: program ? [program] : [] };
	}
	if (!stateScripts.has(script)) throw new Error('Unknown WUI state API: ' + script);
	const filename = path.join(root, 'api', 'script-' + script + '.vm.js');
	const done = Promise.withResolvers();
	const headers = {};
	let status;
	const response = {
		setHeader(name, value) { headers[name] = value; },
		head(code) { status = code; },
		end(body) { done.resolve({ status, headers, body }); },
		error(code) { done.resolve({ error: code }); }
	};
	function run() {
		vm.runInNewContext(fs.readFileSync(filename), {
			request, response, store, changeReservation, requestStop, editRule,
			chinachu, config, data, define, fs, zlib, child_process, log
		}, { filename });
	}
	if (deadline !== undefined) await write(run, deadline);
	else run();
	return done.promise;
}

async function reply(id, script, request, deadline) {
	try {
		const result = await dispatch(script, request, deadline);
		parentPort.postMessage({ id, result });
	} catch (error) {
		parentPort.postMessage({ id, error: { message: error.message, status: error.status || 500 } });
	}
}

let writes = Promise.resolve();
store.watch(change => parentPort.postMessage({ change }));
parentPort.on('message', ({ id, script, request, drain }) => {
	if (drain) {
		writes.then(() => parentPort.postMessage({ id }));
	} else if (stateScripts.has(script) && script !== 'scheduler' && ['PUT', 'POST', 'DELETE'].includes(request.method)) {
		const deadline = performance.now() + 10000;
		writes = writes.then(() => reply(id, script, request, deadline));
	} else {
		// Scheduler PUT launches a separate process whose hooks can call back into the WUI.
		reply(id, script, request);
	}
});
parentPort.postMessage({ ready: true });
