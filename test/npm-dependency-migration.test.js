'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { EventEmitter, once } = require('node:events');
const { Writable } = require('node:stream');
const { format } = require('node:util');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

describe('updated HTTP authentication', function() {
	let directory, tlsOption;
	before(function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-auth-'));
		execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', path.join(directory, 'key'), '-out', path.join(directory, 'cert')], { stdio: 'ignore' });
		tlsOption = { key: fs.readFileSync(path.join(directory, 'key')), cert: fs.readFileSync(path.join(directory, 'cert')) };
	});
	after(function() { fs.rmSync(directory, { recursive: true, force: true }); });

	for (const tlsEnabled of [false, true]) {
		it('preserves successful and failed Basic authentication over ' + (tlsEnabled ? 'HTTPS' : 'HTTP'), async function() {
			// Run the application's server setup without starting its DVR services.
			const source = read('app-wui.js');
			const server = vm.runInNewContext(source.slice(source.indexOf('// Basic Auth'), source.indexOf('if (config.wuiPort)')) + '\nserver;', {
				auth: require('http-auth'), http, https, tlsEnabled, tlsOption,
				config: { wuiUsers: ['alice:secret'] }, httpServer: (req, res) => res.end('authenticated:' + req.user)
			});
			server.listen(0, '127.0.0.1');
			await once(server, 'listening');
			async function request(credentials) {
				return new Promise((resolve, reject) => {
					const req = (tlsEnabled ? https : http).get({ hostname: '127.0.0.1', port: server.address().port, rejectUnauthorized: false,
						headers: credentials ? { authorization: 'Basic ' + Buffer.from(credentials).toString('base64') } : {} }, res => {
						let body = ''; res.setEncoding('utf8'); res.on('data', text => { body += text; });
						res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
					});
					req.on('error', reject);
				});
			}
			try {
				const missing = await request();
				assert.equal(missing.status, 401);
				assert.match(missing.headers['www-authenticate'], /Basic realm="Authentication\."/);
				assert.equal((await request('alice:wrong')).status, 401);
				const success = await request('alice:secret');
				assert.equal(success.status, 200);
				assert.equal(success.body, 'authenticated:alice');
			} finally { await new Promise(resolve => server.close(resolve)); }
		});
	}
});

function runCLI(args, rules = []) {
	const messages = [], written = [];
	const program = { id: 'fixture-1', title: '日本語の番組', detail: '番組説明', flags: [], category: 'anime', start: Date.now() + 3600000,
		end: Date.now() + 5400000, seconds: 1800, channel: { id: 'channel-1', type: 'GR', channel: '27', sid: 1, name: '放送局' } };
	const data = { 'rules.json': rules, 'schedule.json': [{ programs: [program] }], 'reserves.json': [], 'recording.json': [], 'recorded.json': [program] };
	const process = { argv: ['node', 'app-cli.js', ...args], cwd: () => root, exit(code) { throw Object.assign(new Error('CLI exit'), { exitCode: code }); } };
	const console = { log(...args) { messages.push(format(...args)); }, error(...args) { messages.push(format(...args)); } };
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(require.resolve('opts'), 'utf8'), { module, exports: module.exports, process, console, require });
	const ctx = { __dirname: root, Buffer, process, console, require(name) {
		if (name === 'opts') return module.exports;
		if (name === 'fs') return { existsSync: () => true, readFileSync: name => JSON.stringify(data[path.basename(name)]), writeFileSync(name, value) { written.push({ name, value }); } };
		if (name === path.join(root, 'config.json')) return {};
		if (name === './lib/logger') return { log: console.log };
		if (name.startsWith('./')) return require(path.join(root, name));
		return require(name);
	} };
	let exitCode = 0;
	try { vm.runInNewContext(read('app-cli.js'), ctx); }
	catch (error) { if (error.exitCode === undefined) throw error; exitCode = error.exitCode; }
	return { output: messages.join('\n'), written, exitCode };
}

describe('updated CLI options and tables', function() {
	const longChannel = 'channel-'.repeat(20);
	const longTitle = '^' + 'long-title-'.repeat(10) + '$';
	const rules = [{ channels: [longChannel], reserve_titles: [longTitle] }, { channels: ['short-channel'], reserve_titles: ['short-title'] }];
	it('limits long rule values to 20 characters in normal, simple and detailed lists', function() {
		for (const flags of [[], ['--simple'], ['--detail'], ['--simple', '--detail']]) {
			const result = runCLI(['--mode', 'rules', ...flags], rules);
			assert.equal(result.exitCode, 0, result.output);
			assert.ok(result.output.includes(longChannel.slice(0, 17) + '...'), result.output);
			assert.ok(!result.output.includes(longChannel), result.output);
			assert.ok(result.output.includes('short-channel'), result.output);
			if (flags.includes('--detail')) {
				assert.ok(result.output.includes(longTitle.slice(0, 17) + '...'), result.output);
				assert.ok(!result.output.includes(longTitle), result.output);
				assert.ok(result.output.includes('short-title'), result.output);
			} else {
				assert.match(result.output, /\[1\]/);
			}
			assert.deepEqual(result.written, []);
		}
	});
	it('keeps rule values at or below the 20-character limit intact', function() {
		const values = ['a'.repeat(19), 'b'.repeat(20)];
		const result = runCLI(['--mode', 'rules'], values.map(value => ({ channels: [value] })));
		assert.equal(result.exitCode, 0, result.output);
		for (const value of values) assert.ok(result.output.includes(value), result.output);
		assert.ok(!result.output.includes('...'), result.output);
		assert.deepEqual(result.written, []);
	});
	it('preserves full values in single-rule and filtered transposed output', function() {
		for (const flags of [[], ['--simple'], ['--detail']]) {
			for (const [selection, options] of [[rules.slice(0, 1), []], [[rules[1], rules[0]], ['--num', '1']]]) {
				const result = runCLI(['--mode', 'rules', ...flags, ...options], selection);
				assert.equal(result.exitCode, 0, result.output);
				assert.ok(result.output.includes(longChannel), result.output);
				if (flags.includes('--detail')) assert.ok(result.output.includes(longTitle), result.output);
				assert.deepEqual(result.written, []);
			}
		}
	});
	it('prints Japanese program titles using both normal and simple list output', function() {
		for (const args of [['--mode', 'recorded'], ['-mode', 'recorded', '-simple']]) {
			const result = runCLI(args);
			assert.equal(result.exitCode, 0, result.output);
			assert.match(result.output, /日本語の番組/);
			assert.match(result.output, /GR:27/);
			assert.deepEqual(result.written, []);
		}
	});
	it('keeps multi-character short options, exclusion options and simulated rule edits', function() {
		const result = runCLI(['-mode', 'rule', '-title', '日本語', '-^title', '除外', '-start', '2', '-end', '23', '-s']);
		assert.equal(result.exitCode, 0, result.output);
		assert.match(result.output, /\[simulation\] Rule config/);
		const rule = JSON.parse(result.output.slice(result.output.indexOf('{')));
		assert.deepEqual(rule.reserve_titles, ['日本語']);
		assert.deepEqual(rule.ignore_titles, ['除外']);
		assert.deepEqual(rule.hour, { start: 2, end: 23 });
		assert.deepEqual(result.written, []);
	});
	it('reserves a program in simulation mode without writing data', function() {
		const result = runCLI(['--mode', 'reserve', '--id', 'fixture-1', '--simulation']);
		assert.equal(result.exitCode, 0, result.output);
		assert.match(result.output, /\[simulation\] reserve/);
		assert.match(result.output, /"isManualReserved": true/);
		assert.deepEqual(result.written, []);
	});
	it('shows help without loading real configuration or writing files', function() {
		const result = runCLI(['--help']);
		assert.equal(result.exitCode, 0, result.output);
		assert.match(result.output, /--mode/);
		assert.deepEqual(result.written, []);
	});
});

describe('native recorded filename formatting', function() {
	it('preserves zero padding, overflow digits and unknown episode placeholders', function() {
		const common = require('chinachu-common');
		for (const [episode, expected] of [[0, '000'], [9, '009'], [1234, '1234'], [null, 'n']]) {
			assert.equal(common.formatRecordedName({ episode }, '<episode:3>.m2ts'), expected + '.m2ts');
		}
	});
});

describe('native operator disk space checks', function() {
	function check(error, info) {
		const source = read('app-operator.js');
		const messages = [];
		vm.runInNewContext(source.slice(source.indexOf('function storageChecker()'), source.indexOf('// ファイル更新監視')) + '\nstorageChecker();', {
			fs: { statfs(directory, callback) { assert.equal(directory, '/fixture'); callback(error, info); } }, config: { recordedDir: '/fixture' },
			storageLowSpaceThresholdMB: 10, storageLowSpaceCommand: '', storageLowSpaceAction: 'none', storageLowSpaceNotifyTo: 'test@example.invalid',
			clock: 1000, stNotified: 0, notifyIntervalTime: 0, log() {}, console,
			transporter: { sendMail(message, callback) { messages.push(message); callback(null, {}); } }
		});
		return messages;
	}
	it('uses unprivileged available blocks for low-space notification', function() {
		const messages = check(null, { bsize: 4096, bavail: 1, bfree: 99999 });
		assert.equal(messages.length, 1);
		assert.equal(messages[0].subject, '[Chinachu] ALERT: Storage Low Space!');
		assert.match(messages[0].text, /Current Free Space is 0\.00390625 MB/);
	});
	it('does not take low-space actions when statfs fails or free space is sufficient', function() {
		assert.deepEqual(check(new Error('ENOENT')), []);
		assert.deepEqual(check(null, { bsize: 4096, bavail: 99999 }), []);
	});
});

describe('updated sendmail transport', function() {
	it('passes notification recipients and content to sendmail without delivering real mail', async function() {
		const transport = require('nodemailer').createTransport({ sendmail: true });
		const chunks = [];
		let command, args;
		transport.transporter._spawn = (name, options) => {
			command = name; args = options;
			const child = new EventEmitter();
			child.stdin = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
			child.stdin.once('finish', () => child.emit('exit', 0));
			return child;
		};
		const result = await transport.sendMail({ from: 'Chinachu <chinachu@localhost>', to: 'test@example.invalid',
			subject: '[Chinachu] ALERT: Storage Low Space!', text: 'Current Free Space is 1 MB.\nThreshold is 3000 MB.' });
		assert.equal(command, 'sendmail');
		assert.deepEqual(args, ['-i', '-f', 'chinachu@localhost', 'test@example.invalid']);
		assert.deepEqual(result.envelope.to, ['test@example.invalid']);
		const message = Buffer.concat(chunks).toString();
		assert.match(message, /Subject: \[Chinachu\] ALERT: Storage Low Space!/);
		assert.match(message, /Current Free Space is 1 MB/);
	});
});

describe('Mirakurun JSON-RPC uuid override', function() {
	it('generates connection identifiers and exchanges RPC responses with the patched uuid', async function() {
		const { Server } = require('jsonrpc2-ws');
		const WebSocket = require('ws');
		const rpc = new Server({ wss: { port: 0, host: '127.0.0.1' } });
		let client;
		try {
			rpc.methods.set('connectionId', socket => socket.id);
			await once(rpc, 'listening');
			client = new WebSocket('ws://127.0.0.1:' + rpc.wss.address().port);
			await once(client, 'open');
			const response = once(client, 'message');
			client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'connectionId' }));
			const result = JSON.parse((await response)[0].toString());
			assert.equal(result.id, 1);
			assert.match(result.result, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		} finally {
			if (client) client.terminate();
			await rpc.close();
		}
	});
});
