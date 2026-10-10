#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const store = require('../lib/config-store');
const passwords = require('../lib/password-auth');

function promptPassword(label) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('パスワードは端末で対話入力してください。引数やパイプからは受け付けません。');
	return new Promise((resolve, reject) => {
		const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
		hidden.isTTY = true;
		hidden.columns = process.stdout.columns;
		const reader = readline.createInterface({ input: process.stdin, output: hidden, terminal: true, historySize: 0 });
		let answered = false;
		reader.on('SIGINT', () => reader.close());
		reader.on('close', () => { if (!answered) reject(new Error('入力を中止しました。')); });
		process.stdout.write(label);
		reader.question('', value => {
			answered = true;
			reader.close();
			process.stdout.write('\n');
			resolve(value);
		});
	});
}

async function main(args, { prompt = promptPassword } = {}) {
	let filename = path.resolve(__dirname, '../config.json');
	const position = args.indexOf('--config');
	if (position !== -1) {
		if (!args[position + 1]) throw new Error('--config に設定ファイルを指定してください。');
		filename = path.resolve(args[position + 1]);
		args.splice(position, 2);
	}
	if (args.length !== 1 || args[0] === '--help') {
		console.log('使い方: npm run password -- <ユーザー名>\n旧設定の移行: npm run password -- --migrate\n別の設定ファイル: --config /path/to/config.json');
		if (args[0] !== '--help') process.exitCode = 1;
		return;
	}
	const before = fs.readFileSync(filename, 'utf8');
	const config = JSON.parse(before);
	if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('設定全体はJSONオブジェクトにしてください。');
	if (args[0] !== '--migrate') {
		const username = args[0];
		if (!passwords.validUsername(username) || username.startsWith('--')) throw new Error('ユーザー名の形式が不正です。');
		const password = await prompt('新しいパスワード: ');
		passwords.validateNewPassword(password);
		if (password !== await prompt('確認のため再入力: ')) throw new Error('パスワードが一致しません。');
		const users = config.wuiUsers === undefined ? [] : config.wuiUsers;
		if (!Array.isArray(users)) throw new Error('Web認証設定の形式が不正です。');
		const replacement = { username, passwordHash: passwords.hashPassword(password) };
		const index = users.findIndex(user => (typeof user === 'string' ? user.split(':')[0] : user && user.username) === username);
		if (index === -1) users.push(replacement);
		else users[index] = replacement;
		config.wuiUsers = users;
	}
	config.wuiUsers = passwords.migrateUsers(config.wuiUsers);
	const next = JSON.stringify(config, null, '  ') + '\n';
	const backupText = store.migratedText(before, { resetUsername: args[0] === '--migrate' ? undefined : args[0] });
	store.save(filename, next, store.revision(before), fs, { secure: true, backupText });
	console.log('認証設定を保存しました。バックアップもハッシュ化済みです。WUIを再起動してください。');
	if (args[0] === '--migrate') console.log('パスワード自体は変更していません。サンプルと同じパスワードは設定コマンドで変更してください。');
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
	// JSON parsing and filesystem errors can include secret data or paths.
	console.error(error instanceof SyntaxError ? '設定JSONをサーバー上で修復してください。' : error.code ? '設定の読み書きに失敗しました（' + error.code + '）。' : error.message);
	process.exitCode = 1;
});

module.exports = { main };
