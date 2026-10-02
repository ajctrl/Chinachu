'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const schema = require('../web/config-schema');

function revision(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function failure(status, message, errors) { return Object.assign(new Error(message), { status, errors }); }

function validate(text) {
	let config;
	try { config = JSON.parse(text); } catch (error) { throw failure(400, 'JSONの構文が正しくありません。'); }
	const errors = schema.validate(config);
	if (errors.length) throw failure(400, '設定値を確認してください。', errors);
	return config;
}

// Synchronous writes serialize WUI requests, including exclusion rule updates.
// Both temporary files live alongside the destination so rename is atomic.
function save(filename, text, expectedRevision, io = fs) {
	let stage = '現在の設定の読み込み', temp, backupTemp;
	function writeTemporary(target, content, stat) {
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
	try {
		const before = io.readFileSync(filename, 'utf8');
		if (expectedRevision !== revision(before)) throw failure(409, '読み込み後に設定が更新されています。編集内容を控えてから再読み込みしてください。');
		const stat = io.statSync(filename);
		const suffix = '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
		temp = filename + suffix;
		backupTemp = filename + '.bak' + suffix;
		stage = '一時ファイルへの書き込み';
		writeTemporary(temp, text, stat);
		stage = 'バックアップの作成';
		writeTemporary(backupTemp, before, stat);
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
module.exports = { save, revision, validate };
