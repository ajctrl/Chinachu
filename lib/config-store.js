'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const schema = require('../web/config-schema');
const { validateFormat } = require('../common/lib/recording-path');
const passwords = require('./password-auth');

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

function writeTemporary(target, content, stat, io, secure = false) {
	const fd = io.openSync(target, 'wx', 0o600);
	try {
		io.writeFileSync(fd, content, 'utf8');
		// Preserve access for the operator/scheduler when the WUI runs as another user.
		const created = io.fstatSync(fd);
		if (created.uid !== stat.uid || created.gid !== stat.gid) io.fchownSync(fd, stat.uid, stat.gid);
		// Retain deliberate group sharing, but make world-accessible configs private.
		const privateMode = 0o600 | ((stat.mode & 0o007) ? 0 : stat.mode & 0o040);
		io.fchmodSync(fd, secure ? privateMode : stat.mode & 0o777);
		io.fsyncSync(fd);
	} finally { io.closeSync(fd); }
}

// Synchronous writes serialize WUI requests. Temporary files live alongside
// the destination so replacement is atomic.
function save(filename, text, expectedRevision, io = fs, options = {}) {
	let stage = '現在の設定の読み込み', temp, backupTemp;
	try {
		const before = io.readFileSync(filename, 'utf8');
		if (expectedRevision !== revision(before)) throw failure(409, '読み込み後に設定が更新されています。編集内容を控えてから再読み込みしてください。');
		const stat = io.statSync(filename);
		const suffix = '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
		temp = filename + suffix;
		backupTemp = filename + '.bak' + suffix;
		stage = '一時ファイルへの書き込み';
		writeTemporary(temp, text, stat, io, options.secure);
		stage = 'バックアップの作成';
		writeTemporary(backupTemp, options.backupText === undefined ? before : options.backupText, stat, io, options.secure);
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

function publicText(text) {
	const config = JSON.parse(text);
	if (!config || typeof config !== 'object' || Array.isArray(config)) throw failure(500, '設定ファイルをサーバー上で修復してください。');
	if (config.wuiUsers === undefined) return text;
	if (!Array.isArray(config.wuiUsers)) throw failure(500, 'Web認証設定をサーバー上で修復してください。');
	config.wuiUsers = config.wuiUsers.map(user => {
		if (typeof user === 'string' && (user.indexOf(':') < 1 || user.indexOf(':') === user.length - 1)) {
			throw failure(500, 'Web認証設定をサーバー上で修復してください。');
		}
		const username = typeof user === 'string' ? user.slice(0, user.indexOf(':')) : user && user.username;
		if (!passwords.validUsername(username)) throw failure(500, 'Web認証設定をサーバー上で修復してください。');
		return { username, passwordSet: typeof user === 'string' || !!user.passwordHash };
	});
	return JSON.stringify(config, null, '  ');
}

function migratedText(text, { resetUsername } = {}) {
	const config = JSON.parse(text);
	if (!config || typeof config !== 'object' || Array.isArray(config)) throw failure(400, '設定全体はJSONオブジェクトにしてください。');
	if (config.wuiUsers === undefined) return text;
	if (resetUsername !== undefined && Array.isArray(config.wuiUsers)) {
		config.wuiUsers = config.wuiUsers.map(user => {
			const username = typeof user === 'string' ? user.split(':')[0] : user && user.username;
			if (username !== resetUsername) return user;
			try { return passwords.migrateUsers([user], { allowUnset: true })[0]; }
			catch (_) {
				// A reset can repair this credential. Keep its name in the backup,
				// but never preserve a damaged value that might contain plaintext.
				return { username };
			}
		});
	}
	config.wuiUsers = passwords.migrateUsers(config.wuiUsers, { allowUnset: true });
	return JSON.stringify(config, null, '  ') + '\n';
}

// Merge write-only passwords with the stored credentials, never with client hashes.
function prepare(text, before) {
	const config = validate(text);
	let previous;
	try { previous = JSON.parse(migratedText(before)); }
	catch (_) { throw failure(409, '現在の認証設定を安全に引き継げません。サーバー上で設定を修復してください。'); }
	const oldUsers = previous.wuiUsers || [];
	if (config.wuiUsers === undefined) {
		if (previous.wuiUsers !== undefined) config.wuiUsers = oldUsers;
	} else {
		config.wuiUsers = config.wuiUsers.map(user => {
			if (!passwords.validUsername(user.username)) throw failure(400, 'ユーザー名の形式が不正です。');
			if (Object.hasOwn(user, 'passwordHash')) throw failure(400, 'パスワードハッシュはAPIから設定できません。');
			const old = oldUsers.find(item => item.username === user.username);
			if (!user.password) {
				if (!old || !old.passwordHash) throw failure(400, '新しいユーザーにはパスワードを設定してください。');
				return old;
			}
			try { passwords.validateNewPassword(user.password); }
			catch (error) { throw failure(400, error.message, [{ key: 'wuiUsers', message: error.message }]); }
			return { username: user.username, passwordHash: passwords.hashPassword(user.password) };
		});
	}
	// Preserve formatting where credentials are absent, including existing API clients.
	return {
		text: config.wuiUsers === undefined ? text : JSON.stringify(config, null, '  ') + '\n',
		backupText: previous.wuiUsers === undefined ? before : JSON.stringify(previous, null, '  ') + '\n'
	};
}

module.exports = { save, create, revision, validate, publicText, migratedText, prepare };
