'use strict';

const planner = require('./reservation-planner');

function fail(status, message) {
	throw Object.assign(new Error(message), { status });
}

function changeReservation(store, action, id, { start, oneSeg, simulation = false } = {}) {
	return store.transaction(() => {
		const reserves = store.read('reserves');
		const index = reserves.findIndex(program => program.id === id);
		// The legacy lookup returns the last matching ID, while reservation edits
		// affect the first entry. Imported schedules can contain reused IDs.
		let program = reserves.findLast(item => item.id === id);
		if (action === 'reserve') {
			program = store.program(id);
			if (!program) fail(404, '見つかりません');
			if (index >= 0) fail(409, '既に予約されています');
			program.isManualReserved = true;
			if (oneSeg) program['1seg'] = true;
			reserves.push(program);
			reserves.sort((a, b) => a.start - b.start);
		} else {
			if (!program) fail(404, '見つかりません');
			if (start !== undefined && Number(start) !== program.start) fail(409, '番組の開始時刻が変更されています');
			switch (action) {
			case 'unreserve':
				if (!program.isManualReserved) fail(409, '自動予約された番組は解除できません。自動予約ルールを編集してください');
				reserves.splice(index, 1);
				break;
			case 'skip':
				// The legacy HTTP handler returned a CLI failure for repeated actions.
				if (program.isSkip) fail(500, '既にスキップが有効になっています');
				planner.skip(reserves[index]);
				break;
			case 'unskip':
				if (!program.isSkip) fail(500, '既にスキップは解除されています');
				planner.unskip(reserves[index]);
				break;
			default:
				fail(400, '不明な予約操作です');
			}
		}
		if (!simulation) store.replace('reserves', reserves);
		return program;
	}, !simulation);
}

function sameAiring(a, b) {
	return a.id === b.id && (a.start === b.start || (a.start < b.end && b.start < a.end));
}

// Created inside a write transaction so existing v1 databases can still
// start the operator while another process holds the writer lock.
function ensureStopRequests(store) {
	store.db.exec(`CREATE TABLE IF NOT EXISTS recording_stops
		(id TEXT PRIMARY KEY, start INTEGER, end INTEGER, revision INTEGER NOT NULL)`);
}

function requestStop(store, id, { simulation = false } = {}) {
	return store.transaction(() => {
		const recording = store.read('recording');
		const program = recording.findLast(item => item.id === id);
		if (!program) fail(404, '見つかりません');
		program.abort = true;
		if (simulation) return program;
		if (!program.isManualReserved) {
			const reserves = store.read('reserves');
			const reserve = reserves.findLast(item => sameAiring(item, program));
			if (reserve) {
				reserve.isSkip = true;
				store.replace('reserves', reserves);
			}
		}
		store.replace('recording', recording);
		ensureStopRequests(store);
		store.db.prepare('INSERT OR REPLACE INTO recording_stops(id, start, end, revision) VALUES (?, ?, ?, ?)')
			.run(id, program.start ?? null, program.end ?? null, store.revision('recording').revision);
		return program;
	}, !simulation);
}

// The operator owns the live stream objects. The CLI and WUI can set abort
// between stream callbacks, so carry pending stop requests into each update.
function saveRecording(store, recording, startupRevision = 0) {
	store.transaction(() => {
		ensureStopRequests(store);
		store.db.prepare('DELETE FROM recording_stops WHERE revision <= ?').run(startupRevision);
		const stopping = store.db.prepare('SELECT id, start, end FROM recording_stops').all();
		store.replace('recording', recording.map(item =>
			stopping.some(request => sameAiring(request, item)) ? { ...item, abort: true } : item));
	});
}

function finishRecording(store, program) {
	return store.transaction(() => {
		store.addToHistory(program);
		store.replace('recording', store.read('recording').filter(item => !sameAiring(item, program)));
		ensureStopRequests(store);
		store.db.prepare('DELETE FROM recording_stops WHERE id = ? AND (start IS ? OR (start < ? AND ? < end))')
			.run(program.id, program.start ?? null, program.end ?? null, program.start ?? null);
		if (program.isManualReserved) {
			const reserves = store.read('reserves');
			const index = reserves.findIndex(item => item.isManualReserved && sameAiring(item, program));
			if (index >= 0) {
				reserves.splice(index, 1);
				store.replace('reserves', reserves);
			}
			return reserves;
		}
	});
}

module.exports = { changeReservation, requestStop, saveRecording, finishRecording, sameAiring };
