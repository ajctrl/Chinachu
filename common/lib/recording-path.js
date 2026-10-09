'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validateFormat(name) {
	if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 4096 ||
		/[\x00-\x1f\x7f]/.test(name) || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) ||
		/^[a-z]:/i.test(name) || name.split(/[\\/]/).some(part => part === '..')) {
		throw new Error('録画ファイル名は保存先内の相対パスで指定してください。');
	}
	const extension = path.extname(name);
	if (Buffer.byteLength(extension) >= 255) throw new Error('録画ファイル名の拡張子が長すぎます。');
	for (const match of name.matchAll(/<episode:([0-9]+)>/g)) {
		if (Number(match[1]) > 64) throw new Error('話数の桁数が大きすぎます。');
	}
	return name;
}

function resolveRecordingPath(directory, name, io = fs) {
	validateFormat(name);
	const root = path.resolve(directory);
	const target = path.resolve(root, name);
	const relative = path.relative(root, target);
	if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
		throw new Error('録画ファイルの保存先が録画ディレクトリ外です。');
	}
	// Allow a configured root symlink, but never follow symlinks below that root.
	let current = root;
	for (const part of relative.split(path.sep)) {
		current = path.join(current, part);
		try {
			if (io.lstatSync(current).isSymbolicLink()) throw new Error('録画保存先にシンボリックリンクは使用できません。');
		} catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
	return target;
}

// Node has no openat/unlinkat API. On Linux, /proc/self/fd pins each opened
// directory while the next single component is resolved with O_NOFOLLOW.
// The configured root (including an intentional root symlink) is trusted;
// directories below it must never be resolved again through their old names.
function withParent(directory, filename, create, action, io = fs) {
	if (!directory || typeof filename !== 'string') throw new Error('録画保存先が不正です。');
	const root = path.resolve(directory);
	const relative = path.relative(root, path.resolve(filename));
	validateFormat(relative);
	const parts = relative.split(path.sep);
	const name = parts.pop();
	const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fs.constants;
	if (process.platform !== 'linux' || !O_DIRECTORY || !O_NOFOLLOW) {
		throw new Error('安全な録画ファイル操作にはLinuxと/procが必要です。');
	}
	let parent = io.openSync(root, O_RDONLY | O_DIRECTORY);
	try {
		try { io.statSync('/proc/self/fd/' + parent); }
		catch (cause) {
			// Do not mistake a missing procfs for a missing recording on delete.
			throw Object.assign(new Error('録画ファイル操作に必要な/proc/self/fdを利用できません。', { cause }), { code: 'ENOTSUP' });
		}
		for (const part of parts) {
			const nextPath = '/proc/self/fd/' + parent + '/' + part;
			if (create) {
				try { io.mkdirSync(nextPath); }
				catch (error) { if (error.code !== 'EEXIST') throw error; }
			}
			const next = io.openSync(nextPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
			io.closeSync(parent);
			parent = next;
		}
		return action('/proc/self/fd/' + parent + '/' + name);
	} finally { io.closeSync(parent); }
}

function openRecordingFile(directory, filename, write = false, io = fs) {
	return withParent(directory, filename, write, target => {
		const c = fs.constants;
		const flags = (write ? c.O_WRONLY | c.O_CREAT | c.O_APPEND : c.O_RDONLY) | c.O_NOFOLLOW | c.O_NONBLOCK;
		const fd = io.openSync(target, flags, 0o666);
		try {
			const stat = io.fstatSync(fd);
			if (!stat.isFile() || stat.nlink !== 1) throw new Error('録画ファイルはハードリンクのない通常ファイルである必要があります。');
			return fd;
		} catch (error) { io.closeSync(fd); throw error; }
	}, io);
}

function removeRecordingFile(directory, filename, io = fs) {
	try {
		return withParent(directory, filename, false, target => {
			// unlink never follows the final component, even if it is replaced.
			io.unlinkSync(target);
			return true;
		}, io);
	} catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

module.exports = { validateFormat, resolveRecordingPath, openRecordingFile, removeRecordingFile };
