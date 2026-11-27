'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Only the operator attaches this database. A standalone INSERT can commit
// here while another client has the write lock on the main database.
class RecordingJournal {
	constructor(store, root) {
		this.store = store;
		const filename = path.join(root, 'data', 'recording-pending.sqlite');
		try { fs.closeSync(fs.openSync(filename, 'wx', 0o660)); }
		catch (error) { if (error.code !== 'EEXIST') throw error; }
		store.db.prepare('ATTACH DATABASE ? AS recovery').run(filename);
		try {
			store.db.exec('CREATE TABLE IF NOT EXISTS recovery.pending (sequence INTEGER PRIMARY KEY, program TEXT NOT NULL)');
			this.insert = store.db.prepare('INSERT INTO recovery.pending(program) VALUES (?)');
			this.remove = store.db.prepare('DELETE FROM recovery.pending WHERE sequence = ?');
		} catch (error) {
			store.db.exec('DETACH DATABASE recovery');
			throw error;
		}
	}

	append(program) {
		return this.insert.run(JSON.stringify(program)).lastInsertRowid;
	}

	pending() {
		return this.store.db.prepare('SELECT sequence, program FROM recovery.pending ORDER BY sequence').all()
			.map(row => ({ sequence: row.sequence, program: JSON.parse(row.program) }));
	}

	finish(sequence, work) {
		return this.store.transaction(() => {
			const result = work();
			this.remove.run(sequence);
			return result;
		});
	}
}

module.exports = { RecordingJournal };
