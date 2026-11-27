'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { createRequire } = require('node:module');
const { PassThrough } = require('node:stream');
const vm = require('node:vm');
const { stateFixture } = require('./helpers/state');

const { requestStop } = require('../lib/program-state');

const operator = require.resolve('../app-operator');
const requireOperator = createRequire(operator);
const source = fs.readFileSync(operator, 'utf8');

describe('operator recording and SQLite write contention', function() {
	const start = new Date(2026, 0, 1, 19).getTime();
	let fixture, root, locker, checkReserves, onStoreChange;
	let inputs, outputs, retries, service, exits, postprocessed;

	function setup(ids, outputIO = fs, lockAtStartup = false) {
		const programs = ids.map((id, index) => ({
			id, start, end: start + (index + 1) * 60000, isManualReserved: true,
			title: 'Program ' + id, channel: { type: 'GR', channel: String(index + 20), name: 'Station ' + id }
		}));
		fixture = stateFixture({ 'data/reserves.json': programs });
		root = fixture.root;
		for (const dir of ['log', 'web']) fs.mkdirSync(path.join(root, dir));
		locker = fixture.open();
		if (lockAtStartup) {
			locker.replace('recording', [{ id: 'old' }, programs[1]]);
			requestStop(locker, ids[1]);
			locker.db.exec('BEGIN IMMEDIATE');
		}
		const operatorStore = fixture.open();
		operatorStore.watch = callback => { onStoreChange = callback; };
		inputs = new Map();
		outputs = [];
		retries = [];
		exits = [];
		postprocessed = [];
		service = Object.assign(new EventEmitter(), {
			getuid: () => 1000,
			exit(code) {
				exits.push({ code, closed: outputs.every(output => output.closed),
					recording: programIds('recording'), recorded: programIds('recorded') });
			}
		});
		const modules = {
			[path.join(root, 'config.json')]: { recordedDir: root, recordedFormat: require('../config.sample.json').recordedFormat, recordedCommand: 'postprocess' },
			child_process: { spawn(command, [file, json]) {
				assert.equal(command, 'postprocess');
				postprocessed.push(JSON.parse(json));
				return { pid: 1 };
			} },
			'./lib/state-store': { StateStore: function() { return operatorStore; } },
			'./lib/logger': { log() {} },
			mirakurun: { default: class {
				async getProgramStream({ id, signal }) {
					const stream = new PassThrough();
					stream.req = { path: '/stream/' + id };
					stream.stopSignal = signal;
					inputs.set(id.toString(36), stream);
					return stream;
				}
			} },
			fs: { ...fs, existsSync: name => fs.existsSync(path.resolve(root, name)), createWriteStream(name, options) {
				const output = fs.createWriteStream(name, { ...options, fs: outputIO });
				outputs.push(output);
				return output;
			} }
		};
		vm.runInNewContext(source, {
			__dirname: root, require: name => modules[name] || requireOperator(name),
			process: service, console: { info() {} }, AbortController,
			Date: class extends Date { static now() { return start; } },
			setInterval(callback, delay) { if (delay === 3000) checkReserves = callback; },
			setTimeout(callback) { retries.push(callback); return callback; }
		});
	}

	afterEach(function() {
		for (const output of outputs) output.destroy();
		fixture.close();
	});

	const programIds = name => locker.read(name).map(item => item.id);

	it('starts scheduled streams before a startup writer releases SQLite', async function() {
		setup(['one', 'two'], fs, true);
		assert.equal(retries.length, 1);
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(outputs.length, 2);
		onStoreChange('recording');
		inputs.get('two').write('while locked');
		const firstClosed = once(outputs[0], 'close');
		inputs.get('one').end('first');
		await firstClosed;
		locker.db.exec('COMMIT');
		retries.pop()(); // Finish the first stream before publishing the new operator's live state.
		retries.shift()();
		assert.deepEqual(programIds('recording'), ['two']);
		assert.equal(locker.read('recording')[0].abort, undefined);
		assert.deepEqual(programIds('recorded'), ['one']);
		const secondClosed = once(outputs[1], 'close');
		inputs.get('two').end();
		await secondClosed;
		assert.equal(fs.readFileSync(locker.read('recorded')[1].recorded, 'utf8'), 'while locked');
	});

	it('honors a new stop accepted before the first live-state write succeeds', async function() {
		setup(['one', 'two'], fs, true);
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		locker.db.exec('COMMIT');
		requestStop(locker, 'two'); // The previous operator had already set abort on this airing.
		onStoreChange('recording');
		retries.shift()();
		assert.equal(locker.read('recording').find(item => item.id === 'two').abort, true);
		onStoreChange('recording');
		assert.equal(inputs.get('two').stopSignal.aborted, true);
		assert.equal(inputs.get('one').stopSignal.aborted, false);
		const closed = outputs.map(output => once(output, 'close'));
		for (const input of inputs.values()) input.end();
		await Promise.all(closed);
	});

	it('keeps a manual reservation after a file write error and can resume the recording', async function() {
		let full = true;
		setup(['one'], { ...fs, write(fd, buffer, offset, length, position, callback) {
			if (full) return callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }), 0);
			fs.write(fd, buffer, offset, length, position, callback);
		} });
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		const failed = new Promise(resolve => outputs[0].once('close', resolve));
		locker.db.exec('BEGIN IMMEDIATE');
		inputs.get('one').write('lost');
		await failed;
		locker.db.exec('COMMIT');
		retries.shift()();
		assert.deepEqual(programIds('recording'), []);
		assert.deepEqual(programIds('recorded'), []);
		assert.deepEqual(programIds('reserves'), ['one']);
		assert.deepEqual(postprocessed, []);

		full = false;
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		const closed = once(outputs[1], 'close');
		inputs.get('one').end('resumed');
		await closed;
		assert.equal(fs.readFileSync(locker.read('recorded')[0].recorded, 'utf8'), 'resumed');
		assert.deepEqual(programIds('reserves'), []);
		assert.equal(postprocessed.length, 1);
	});

	it('commits the finished airing when a later reservation reuses its ID during a retry', async function() {
		setup(['one']);
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		const [original] = locker.read('reserves');
		const later = { ...original, title: 'Tomorrow', start: start + 86400000, end: original.end + 86400000 };
		locker.db.exec('BEGIN IMMEDIATE');
		const closed = once(outputs[0], 'close');
		inputs.get('one').end('today');
		await closed;
		locker.db.exec('COMMIT');
		locker.replace('reserves', [later]);
		onStoreChange('reserves');
		retries.shift()();
		const [finished] = locker.read('recorded');
		assert.equal(finished.title, original.title);
		assert.equal(finished.start, original.start);
		assert.deepEqual(postprocessed, [finished]);
		assert.deepEqual(locker.read('reserves'), [later]);
	});

	for (const endsUnderLock of [false, true]) {
		it(endsUnderLock ? 'keeps a completed recording out of a delayed live update' :
			'continues recording and publishes its path once SQLite is writable', async function() {
			setup(['one']);
			checkReserves();
			// Take the lock after preparation succeeds and before the stream promise resolves.
			locker.db.exec('BEGIN IMMEDIATE');
			await new Promise(resolve => setImmediate(resolve));
			const input = inputs.get('one');
			assert.equal(input.destroyed, false);
			assert.equal(retries.length, 1);
			const closed = once(outputs[0], 'close');
			input.write('before-');
			if (!endsUnderLock) {
				locker.db.exec('COMMIT');
				retries.shift()();
				assert.ok(fs.existsSync(locker.read('recording')[0].recorded));
			}
			input.end('end');
			await closed;
			if (endsUnderLock) {
				assert.deepEqual(locker.read('recorded'), []);
				locker.db.exec('COMMIT');
				assert.equal(retries.length, 2);
				retries.pop()(); // Complete the recording first.
				retries.shift()(); // Then run the pending live update.
			}
			assert.deepEqual(programIds('recording'), []);
			assert.deepEqual(programIds('reserves'), []);
			assert.deepEqual(programIds('recorded'), ['one']);
			assert.equal(fs.readFileSync(locker.read('recorded')[0].recorded, 'utf8'), 'before-end');
			assert.equal(retries.length, 0);
		});
	}

	it('drains three files and retries all history commits before exiting on SIGQUIT', async function() {
		const ids = ['one', 'two', 'three'];
		setup(ids);
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(programIds('recording'), ids);
		const closed = outputs.map(output => once(output, 'close'));
		for (const [id, stream] of inputs) stream.write(id + '-video');
		locker.db.exec('BEGIN IMMEDIATE');
		service.emit('SIGQUIT');
		service.emit('SIGQUIT');
		await Promise.all(closed);
		assert.deepEqual(exits, []);
		assert.deepEqual(programIds('recorded'), []);
		assert.equal(retries.length, 3);

		locker.db.exec('COMMIT');
		retries.shift()();
		retries.shift()();
		assert.equal(programIds('recorded').length, 2);
		assert.deepEqual(exits, []);
		retries.shift()();
		assert.equal(exits.length, 1);
		assert.deepEqual(exits[0], { code: 0, closed: true, recording: [], recorded: programIds('recorded') });
		assert.deepEqual(programIds('recorded').sort(), [...ids].sort());
		assert.deepEqual(programIds('reserves'), []);
		for (const { id, recorded } of locker.read('recorded')) {
			assert.equal(fs.readFileSync(recorded, 'utf8'), id + '-video');
		}
	});

	it('waits for a delayed file close even when SQLite can commit immediately', async function() {
		const closing = Promise.withResolvers();
		setup(['one'], { ...fs, close(fd, callback) { closing.resolve(() => fs.close(fd, callback)); } });
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		inputs.get('one').write('buffered');
		const closed = once(outputs[0], 'close');
		inputs.get('one').end();
		const release = await closing.promise;
		service.emit('SIGTERM');
		assert.deepEqual(exits, []);
		assert.deepEqual(programIds('recorded'), []);
		release();
		await closed;
		assert.deepEqual(exits, [{ code: 0, closed: true, recording: [], recorded: ['one'] }]);
	});

	it('cancels pending preparations and keeps their reservations for the next start', async function() {
		setup(['one']);
		checkReserves();
		const original = inputs.get('one');
		locker.db.exec('BEGIN IMMEDIATE');
		service.emit('SIGINT'); // Stream requested, but its promise has not been delivered.
		checkReserves();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(inputs.get('one'), original);
		assert.equal(original.destroyed, true);
		assert.equal(outputs.length, 0);
		assert.deepEqual(exits, []);
		locker.db.exec('COMMIT');
		assert.equal(retries.length, 1);
		retries.shift()();
		assert.deepEqual(exits, [{ code: 0, closed: true, recording: [], recorded: [] }]);
		assert.deepEqual(programIds('reserves'), ['one']);
	});

	for (const locked of [false, true]) {
		it('records three 19:00 reservations in one timer tick ' + (locked ? 'with a SQLite writer' : 'without contention'), async function() {
			const ids = ['one', 'two', 'three'];
			setup(ids);
			if (locked) locker.db.exec('BEGIN IMMEDIATE');
			checkReserves();
			await new Promise(resolve => setImmediate(resolve));
			assert.deepEqual([...inputs.keys()], ids);
			assert.equal(outputs.length, 3);
			const closed = outputs.map(output => once(output, 'close'));
			for (const [id, stream] of inputs) stream.write(id + '-start');
			if (locked) {
				assert.deepEqual(programIds('recording'), []);
				locker.db.exec('COMMIT');
				assert.equal(retries.length, 1);
				retries.shift()();
			}
			assert.deepEqual(programIds('recording'), ids);
			assert.equal(new Set(locker.read('recording').map(item => item.recorded)).size, 3);

			if (locked) locker.db.exec('BEGIN IMMEDIATE');
			inputs.get('one').end('-end');
			await closed[0];
			for (const id of ['two', 'three']) inputs.get(id).write('-middle');
			if (locked) {
				assert.deepEqual(programIds('recorded'), []);
				locker.db.exec('COMMIT');
				assert.equal(retries.length, 1);
				retries.shift()();
			}
			assert.deepEqual(programIds('recorded'), ['one']);
			assert.deepEqual(programIds('recording'), ['two', 'three']);
			assert.deepEqual(programIds('reserves'), ['two', 'three']);
			inputs.get('two').end('-end');
			inputs.get('three').end('-end');
			await Promise.all(closed);

			assert.deepEqual(programIds('recording'), []);
			assert.deepEqual(programIds('reserves'), []);
			assert.deepEqual(programIds('recorded').sort(), [...ids].sort());
			for (const { id, recorded } of locker.read('recorded')) {
				const expected = id + (id === 'one' ? '-start-end' : '-start-middle-end');
				assert.equal(fs.readFileSync(recorded, 'utf8'), expected);
			}
			assert.equal(retries.length, 0);
		});
	}
});
