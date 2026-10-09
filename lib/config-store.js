'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const schema = require('../web/config-schema');
const { validateFormat } = require('../common/lib/recording-path');

function revision(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function failure(status, message, errors) { return Object.assign(new Error(message), { status, errors }); }

function validate(text) {
	let config;
	try { config = JSON.parse(text); } catch (error) { throw failure(400, 'JSONの構文が正しくありません。'); }
	const errors = schema.validate(config);
	if (config && typeof config.recordedFormat !== 'undefined') {
		try { validateFormat(config.recordedFormat); }
		catch (error) { errors.push({ key: 'recordedFormat', message: error.message }); }
	}
	if (errors.length) throw failure(400, '設定値を確認してください。', errors);
	return config;
}

function writeTemporary(target, content, stat, io) {
	const fd = io.openSync(target, 'wx', 0o600);
	try {
		io.writeFileSync(fd, content, 'utf8');
		// Preserve access for the operator/scheduler when the WUI runs as another user.
		const created = io.fstatSync(fd);
		if (created.uid !== stat.uid || created.gid !== stat.gid) io.fchownSync(fd, stat.uid, stat.gid);
		io.fchmodSync(fd, stat.mode & 0o777);
		io.fsyncSync(fd);
	} finally { io.closeSync(fd); }
}

// Synchronous writes serialize WUI requests. Temporary files live alongside
// the destination so replacement is atomic.
function save(filename, text, expectedRevision, io = fs) {
	let stage = '現在の設定の読み込み', temp, backupTemp;
	try {
		const before = io.readFileSync(filename, 'utf8');
		if (expectedRevision !== revision(before)) throw failure(409, '読み込み後に設定が更新されています。編集内容を控えてから再読み込みしてください。');
		const stat = io.statSync(filename);
		const suffix = '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
		temp = filename + suffix;
		backupTemp = filename + '.bak' + suffix;
		stage = '一時ファイルへの書き込み';
		writeTemporary(temp, text, stat, io);
		stage = 'バックアップの作成';
		writeTemporary(backupTemp, before, stat, io);
		io.renameSync(backupTemp, filename + '.bak');
		stage = '設定の置き換え';
		if (io.readFileSync(filename, 'utf8') !== before) throw failure(409, '保存中に設定が更新されました。再読み込みしてください。');
		io.renameSync(temp, filename);
		return { revision: revision(text) };
	} catch (error) {
		if (error.status) throw error;
		throw failure(500, stage + 'に失敗しました（' + (error.code || 'I/Oエラー') + '）。元の設定は変更していません。');
	} finally {
		[temp, backupTemp].filter(Boolean).forEach(file => { try { io.unlinkSync(file); } catch (error) { /* May already have been renamed. */ } });
	}
}

// Publish a complete new file without overwriting a concurrently created one.
// Inherit the config's access rights so the scheduler can read it too.
function create(filename, text, permissionsFile, io = fs) {
	const temp = filename + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
	try {
		writeTemporary(temp, text, io.statSync(permissionsFile), io);
		io.linkSync(temp, filename);
		return { revision: revision(text) };
	} catch (error) {
		if (error.code === 'EEXIST') throw failure(409, '保存先が作成されています。再読み込みしてください。');
		throw failure(500, 'ファイルの作成に失敗しました（' + (error.code || 'I/Oエラー') + '）。');
	} finally {
		try { io.unlinkSync(temp); } catch (error) { /* May not have been created. */ }
	}
}
module.exports = { save, create, revision, validate };
