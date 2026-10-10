'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { authenticationSource } = require('./http-security');
const scrypt = promisify(crypto.scrypt);
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const PREFIX = 'scrypt$131072$8$1$';

function validUsername(value) {
	return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 128 && !/[:\s\x00-\x1f\x7f]/.test(value);
}

function parseHash(value) {
	if (typeof value !== 'string' || !/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value)) return null;
	const parts = value.split('$');
	return { salt: Buffer.from(parts[4], 'hex'), key: Buffer.from(parts[5], 'hex') };
}

function validPassword(value) {
	return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
}

function validateNewPassword(value) {
	if (!validPassword(value) || [...value].length < 12) throw new Error('新しいパスワードは12文字以上、UTF-8で1024バイト以内にしてください（制御文字は使用できません）。');
}

// Used only for infrequent administrative writes. Login verification is asynchronous.
function hashPassword(password) {
	if (!validPassword(password)) throw new Error('パスワードの形式が不正です。');
	const salt = crypto.randomBytes(16);
	return PREFIX + salt.toString('hex') + '$' + crypto.scryptSync(password, salt, 32, OPTIONS).toString('hex');
}

function migrateUsers(users, { allowUnset = false } = {}) {
	if (users === undefined) return undefined;
	if (!Array.isArray(users) || users.length > 16) throw new Error('Web認証ユーザーは16件以内の配列にしてください。');
	const names = new Set();
	return users.map(user => {
		if (typeof user === 'string') {
			const colon = user.indexOf(':');
			if (colon < 1) throw new Error('旧Web認証設定の形式が不正です。');
			user = { username: user.slice(0, colon), passwordHash: hashPassword(user.slice(colon + 1)) };
		}
		if (!user || !validUsername(user.username) || names.has(user.username) ||
			(!parseHash(user.passwordHash) && !(allowUnset && user.passwordHash === undefined))) {
			throw new Error('Web認証設定が不正です。npm run password -- <ユーザー名> で設定してください。');
		}
		names.add(user.username);
		return user.passwordHash === undefined ? { username: user.username } : { username: user.username, passwordHash: user.passwordHash };
	});
}

function createVerifier(users, options = {}) {
	if ((users || []).some(user => typeof user === 'string')) {
		throw new Error('平文のWeb認証設定を移行してください: npm run password -- --migrate');
	}
	const accounts = new Map((migrateUsers(users) || []).map(user => [user.username, parseHash(user.passwordHash)]));
	const clock = options.clock || Date.now;
	const derive = options.derive || ((password, salt) => scrypt(password, salt, 32, OPTIONS));
	const secret = crypto.randomBytes(32);
	const cache = new Map(), attempts = new Map(), pending = new Map(), activeSources = new Set();
	let active = 0;
	return async function verify(username, password, request) {
		if (!validUsername(username) || !validPassword(password)) return false;
		const account = accounts.get(username);
		// Unknown names must not consume another account's KDF capacity or attempt allowance.
		if (!account) return false;
		const now = clock();
		const source = authenticationSource(request, options.trustForwarded === true);
		for (const [key, expiry] of cache) if (expiry <= now) cache.delete(key);
		for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
		const token = crypto.createHmac('sha256', secret).update(username).update('\0').update(password).digest('hex');
		// Only successful credentials are cached; no plaintext is retained in the cache.
		if (cache.has(token)) return true;
		const pendingKey = source + '\0' + token;
		if (pending.has(pendingKey)) return pending.get(pendingKey);
		const bucket = attempts.get(source);
		if (bucket && bucket.count >= 5) return false;
		// One source cannot occupy both workers and reject other clients' logins.
		if (active >= 2 || activeSources.has(source)) return false;
		const current = bucket || { count: 0, until: now + 60000 };
		current.count++;
		// Bound retained source counters without locking out every new source.
		if (!bucket && attempts.size >= 1024) attempts.delete(attempts.keys().next().value);
		attempts.delete(source);
		attempts.set(source, current);
		active++;
		activeSources.add(source);
		const task = (async () => {
			try {
				const key = await Promise.resolve().then(() => derive(password, account.salt));
				const equal = crypto.timingSafeEqual(key, account.key);
				if (!equal) return false;
				attempts.delete(source);
				if (cache.size >= 256) cache.delete(cache.keys().next().value);
				cache.set(token, clock() + 60000);
				return true;
			} catch (_) { return false; }
			finally { active--; activeSources.delete(source); pending.delete(pendingKey); }
		})();
		pending.set(pendingKey, task);
		return task;
	};
}

module.exports = { hashPassword, parseHash, validUsername, validateNewPassword, migrateUsers, createVerifier };
