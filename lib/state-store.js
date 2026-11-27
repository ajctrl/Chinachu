'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const legacyFiles = {
	schedule: 'data/schedule.json',
	reserves: 'data/reserves.json',
	recording: 'data/recording.json',
	recorded: 'data/recorded.json',
	rules: 'rules.json',
	excludes: 'excludes.json'
};

function readLegacy(root, name) {
	const filename = path.join(root, legacyFiles[name]);
	try {
		return JSON.parse(fs.readFileSync(filename, 'utf8'));
	} catch (error) {
		if (error.code !== 'ENOENT') throw new Error(filename + ': ' + error.message, { cause: error });
		if (name !== 'excludes') return [];
		const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
		return config.autoExclusionRules === undefined ? [] : config.autoExclusionRules;
	}
}

function checkList(name, items) {
	if (!Array.isArray(items) || !items.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
		throw new Error(name + ' はJSONオブジェクトの配列にしてください。');
	}
}

class StateStore {
	constructor(root, { simulation = false } = {}) {
		const filename = path.join(root, 'data', 'chinachu.sqlite');
		if (!simulation) {
			// Let administrators share the DB through the service group and umask.
			try { fs.closeSync(fs.openSync(filename, 'wx', 0o660)); }
			catch (error) { if (error.code !== 'EEXIST') throw error; }
		}
		// A simulation on a legacy installation imports into memory only.
		const inMemory = simulation && !fs.existsSync(filename);
		this.db = new DatabaseSync(inMemory ? ':memory:' : filename, { readOnly: simulation && !inMemory });
		try {
			this.db.exec('PRAGMA busy_timeout = 10000');
			if (this.version() === 0) {
				if (simulation && !inMemory) {
					// Retry an incomplete legacy migration without changing its DB.
					this.close();
					this.db = new DatabaseSync(':memory:');
				}
				this.transaction(() => {
					if (this.version() === 0) this.importLegacy(root);
				});
			}
			if (this.version() !== 1) throw new Error('未対応のデータベース形式です: ' + filename);
		} catch (error) {
			this.close();
			throw error;
		}
	}

	version() { return this.db.prepare('PRAGMA user_version').get().user_version; }

	close() { this.db.close(); }

	// Acquire the write lock before reading values that will be changed. Nested
	// operations participate in the same commit, including revision changes.
	transaction(work, write = true) {
		if (this.db.isTransaction) return work();
		this.db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
		try {
			const result = work();
			this.db.exec('COMMIT');
			return result;
		} catch (error) {
			if (this.db.isTransaction) this.db.exec('ROLLBACK');
			throw error;
		}
	}

	importLegacy(root) {
		this.db.exec(`
			CREATE TABLE revisions (
				name TEXT PRIMARY KEY, revision INTEGER NOT NULL, modified INTEGER NOT NULL, previous_modified INTEGER NOT NULL
			);
			CREATE TABLE items (
				name TEXT NOT NULL REFERENCES revisions(name), position INTEGER NOT NULL, value TEXT NOT NULL,
				PRIMARY KEY (name, position)
			) WITHOUT ROWID;
			CREATE INDEX recorded_id ON items(json_extract(value, '$.id')) WHERE name = 'recorded';
			CREATE TABLE previous_excludes (position INTEGER PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE channels (
				position INTEGER PRIMARY KEY, value TEXT NOT NULL,
				id GENERATED ALWAYS AS (json_extract(value, '$.id')) VIRTUAL
			);
			CREATE INDEX channel_id ON channels(id);
			CREATE TABLE programs (
				channel_position INTEGER NOT NULL REFERENCES channels(position) ON DELETE CASCADE,
				position INTEGER NOT NULL, value TEXT NOT NULL,
				id GENERATED ALWAYS AS (json_extract(value, '$.id')) VIRTUAL,
				start INTEGER GENERATED ALWAYS AS (json_extract(value, '$.start')) VIRTUAL,
				end INTEGER GENERATED ALWAYS AS (json_extract(value, '$.end')) VIRTUAL,
				PRIMARY KEY (channel_position, position)
			) WITHOUT ROWID;
			CREATE INDEX program_id ON programs(id);
			CREATE INDEX channel_airtime ON programs(channel_position, start, end);
			CREATE INDEX airtime ON programs(start, end);
		`);
		const insert = this.db.prepare('INSERT INTO revisions VALUES (?, 0, 0, 0)');
		for (const [name, filename] of Object.entries(legacyFiles)) {
			const original = readLegacy(root, name);
			insert.run(name);
			try {
				this.replace(name, original);
				if (name === 'schedule') {
					const stat = fs.statSync(path.join(root, filename), { throwIfNoEntry: false });
					if (stat) this.db.prepare("UPDATE revisions SET modified = ? WHERE name = 'schedule'").run(stat.mtime.getTime());
				}
				if (!isDeepStrictEqual(this.read(name), original)) throw new Error('移行後の照合に失敗しました。');
			} catch (error) {
				throw new Error(filename + ': ' + error.message, { cause: error });
			}
		}
		this.db.exec('PRAGMA user_version = 1');
	}

	read(name) {
		if (name === 'schedule') {
			return this.transaction(() => {
				const channels = this.db.prepare('SELECT value FROM channels ORDER BY position').all()
					.map(row => ({ ...JSON.parse(row.value), programs: [] }));
				for (const row of this.db.prepare('SELECT channel_position, value FROM programs ORDER BY channel_position, position').iterate()) {
					channels[row.channel_position].programs.push(JSON.parse(row.value));
				}
				return channels;
			}, false);
		}
		return this.db.prepare('SELECT value FROM items WHERE name = ? ORDER BY position').all(name)
			.map(row => JSON.parse(row.value));
	}

	programs(channelPosition = null, time = null) {
		const conditions = [], params = [];
		if (channelPosition !== null) { conditions.push('channel_position = ?'); params.push(channelPosition); }
		if (time !== null) { conditions.push('start <= ? AND end >= ?'); params.push(time, time); }
		const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
		return this.db.prepare('SELECT value FROM programs' + where + ' ORDER BY channel_position, position').all(...params)
			.map(row => JSON.parse(row.value));
	}

	channelMetadata(id) {
		// Channel rows contain only metadata. Program listings live in the programs table.
		const row = this.db.prepare('SELECT value FROM channels WHERE id = ? ORDER BY position DESC LIMIT 1').get(id);
		return row ? JSON.parse(row.value) : null;
	}

	channel(id, time = null) {
		return this.transaction(() => {
			const row = this.db.prepare('SELECT position, value FROM channels WHERE id = ? ORDER BY position DESC LIMIT 1').get(id);
			return row ? { ...JSON.parse(row.value), programs: this.programs(row.position, time) } : null;
		}, false);
	}

	program(id) {
		if (id == null) return null;
		const row = this.db.prepare('SELECT value FROM programs WHERE id = ? ORDER BY channel_position DESC, position DESC LIMIT 1').get(id);
		return row ? JSON.parse(row.value) : null;
	}

	// Scheduler logs resolve a reused ID to the first airing in schedule order.
	firstProgramsById(ids) {
		const result = new Map();
		if (!ids.length) return result;
		const rows = this.db.prepare(`
			SELECT ids.value AS id, (
				SELECT value FROM programs WHERE id = ids.value
				ORDER BY channel_position, position LIMIT 1
			) AS program FROM json_each(?) AS ids
		`).all(JSON.stringify([...new Set(ids)]));
		for (const row of rows) {
			if (row.program !== null) result.set(row.id, JSON.parse(row.program));
		}
		return result;
	}

	replace(name, items) {
		if (!Object.hasOwn(legacyFiles, name)) throw new Error('不明なデータ種別です: ' + name);
		checkList(name, items);
		this.transaction(() => {
			if (name === 'schedule') {
				this.db.exec('DELETE FROM channels');
				const channel = this.db.prepare('INSERT INTO channels(position, value) VALUES (?, ?)');
				const program = this.db.prepare('INSERT INTO programs(channel_position, position, value) VALUES (?, ?, ?)');
				items.forEach((station, index) => {
					checkList('programs', station.programs);
					// Keep the original key position when serializing legacy HTTP responses.
					channel.run(index, JSON.stringify({ ...station, programs: [] }));
					station.programs.forEach((item, position) => program.run(index, position, JSON.stringify(item)));
				});
			} else {
				if (name === 'excludes') {
					this.db.exec(`DELETE FROM previous_excludes;
						INSERT INTO previous_excludes SELECT position, value FROM items WHERE name = 'excludes'`);
				}
				this.db.prepare('DELETE FROM items WHERE name = ?').run(name);
				const insert = this.db.prepare('INSERT INTO items VALUES (?, ?, ?)');
				items.forEach((item, index) => insert.run(name, index, JSON.stringify(item)));
			}
			this.markChanged(name);
		});
	}

	// Mirakurun can reuse a program ID. Retain the older file under its
	// time-suffixed ID, or move the same recording to the end of the history.
	addToHistory(program) {
		this.transaction(() => {
			const previous = this.db.prepare(`SELECT position, value FROM items WHERE name = 'recorded'
				AND json_extract(value, '$.id') = ? ORDER BY position LIMIT 1`).get(program.id);
			if (previous) {
				const item = JSON.parse(previous.value);
				if (item.recorded === program.recorded) {
					this.db.prepare("DELETE FROM items WHERE name = 'recorded' AND position = ?").run(previous.position);
				} else {
					item.id += '-' + item.start.toString(36);
					this.db.prepare("UPDATE items SET value = ? WHERE name = 'recorded' AND position = ?").run(JSON.stringify(item), previous.position);
				}
			}
			this.db.prepare(`INSERT INTO items SELECT 'recorded', coalesce(max(position), -1) + 1, ?
				FROM items WHERE name = 'recorded'`).run(JSON.stringify(program));
			this.markChanged('recorded');
		});
	}

	markChanged(name) {
		this.db.prepare('UPDATE revisions SET revision = revision + 1, previous_modified = modified, modified = ? WHERE name = ?')
			.run(Date.now(), name);
	}

	revision(name) {
		return this.db.prepare('SELECT revision, modified, previous_modified FROM revisions WHERE name = ?').get(name);
	}

	// Initialize the cursor before exposing the watcher, so a separate process
	// can commit immediately after startup without losing its notification.
	watch(onChange, interval = 250) {
		const query = this.db.prepare('SELECT name, revision FROM revisions');
		const seen = new Map(query.all().map(row => [row.name, row.revision]));
		const timer = setInterval(() => {
			try {
				for (const { name, revision } of query.all()) {
					if (seen.get(name) === revision) continue;
					onChange(name);
					seen.set(name, revision);
				}
			} catch (error) { console.error(error); }
		}, interval);
		return { close() { clearInterval(timer); } };
	}
}

module.exports = { StateStore };

if (require.main === module) {
	const root = path.resolve(__dirname, '..');
	const store = new StateStore(root);
	try {
		store.transaction(() => {
			console.log('data/chinachu.sqlite');
			console.log('schedule: ' + store.db.prepare('SELECT count(*) AS count FROM channels').get().count);
			console.log('programs: ' + store.db.prepare('SELECT count(*) AS count FROM programs').get().count);
			const count = store.db.prepare('SELECT count(*) AS count FROM items WHERE name = ?');
			for (const name of Object.keys(legacyFiles)) {
				if (name !== 'schedule') console.log(name + ': ' + count.get(name).count);
			}
		}, false);
	} finally { store.close(); }
}
