'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const events = require('node:events');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const store = require('../lib/excludes-store');
const configStore = require('../lib/config-store');
const { watchExclusionRules } = require('../lib/exclusion-rule-watcher');

describe('common exclusion rule notifications', function () {
	let directory, excludesFile, configFile, watcher, changes, errors, signals;
	beforeEach(function () {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-exclusion-notify-'));
		excludesFile = path.join(directory, 'excludes.json');
		configFile = path.join(directory, 'config.json');
		fs.writeFileSync(configFile, JSON.stringify({ autoExclusionRules: [{ channels: ['legacy'] }] }));
		changes = []; errors = []; signals = new events.EventEmitter();
	});
	afterEach(async function () {
		if (watcher) {
			const closed = events.once(watcher, 'close');
			watcher.close(); await closed; watcher = null;
		}
		fs.rmSync(directory, { recursive: true, force: true });
	});
	function start() {
		watcher = watchExclusionRules(excludesFile, configFile, () => {
			changes.push(store.read(excludesFile, JSON.parse(fs.readFileSync(configFile, 'utf8'))).rules);
			signals.emit('change');
		}, error => errors.push(error), 10);
	}
	async function change(action) {
		const notified = events.once(signals, 'change');
		action(); await notified;
	}
	function saveConfig(settings) {
		configStore.save(configFile, JSON.stringify(settings), configStore.revision(fs.readFileSync(configFile, 'utf8')));
	}

	it('notifies after migration, repeated atomic saves and removal without creating a file on startup', async function () {
		start();
		assert.equal(fs.existsSync(excludesFile), false);
		let saved;
		await change(() => { saved = store.save(excludesFile, [{ channels: ['first'] }], null, configFile); });
		await change(() => { saved = store.save(excludesFile, [{ channels: ['second'] }], saved.revision, configFile); });
		await change(() => { saved = store.save(excludesFile, [], saved.revision, configFile); });
		await change(() => fs.unlinkSync(excludesFile));
		assert.deepEqual(changes, [[{ channels: ['first'] }], [{ channels: ['second'] }], [], [{ channels: ['legacy'] }]]);
		assert.deepEqual(errors, []);
	});

	it('notifies for legacy rules but ignores unrelated config changes and retired legacy rules', async function () {
		start();
		await change(() => saveConfig({ autoExclusionRules: [{ channels: ['updated'] }] }));
		saveConfig({ autoExclusionRules: [{ channels: ['updated'] }], unrelated: true });
		await new Promise(resolve => setTimeout(resolve, 60));
		assert.equal(changes.length, 1);
		await change(() => store.save(excludesFile, [], null, configFile));
		saveConfig({ autoExclusionRules: [{ channels: ['ignored'] }] });
		await new Promise(resolve => setTimeout(resolve, 60));
		assert.equal(changes.length, 2);
		assert.deepEqual(errors, []);
	});

	it('broadcasts file changes to two clients and resynchronizes on reconnection using the WUI socket handlers', async function () {
		const server = http.createServer();
		let io;
		const context = vm.createContext({
			events, server, basicAuthEnabled: false, openServerEnabled: false,
			config: {}, status: { connectedCount: 0 }, EXCLUDES_FILE: excludesFile, CONFIG_FILE: configFile,
			Server: function (target) { io = new Server(target); return io; },
			watchExclusionRules: (...args) => { watcher = watchExclusionRules(...args); }
		});
		const source = fs.readFileSync(require.resolve('../app-wui.js'), 'utf8').replace(/\r\n/g, '\n');
		const start = source.indexOf('var ios = new events.EventEmitter();');
		const end = source.indexOf('// ファイル更新監視:', start);
		vm.runInContext(source.slice(start, end), context);
		const watchStart = source.indexOf('// Common exclusions include legacy config rules');
		const watchEnd = source.indexOf('// ファイル更新監視:', watchStart);
		vm.runInContext(source.slice(watchStart, watchEnd), context);
		const clients = [];
		try {
			server.listen(0, '127.0.0.1'); await events.once(server, 'listening');
			for (let i = 0; i < 2; i++) {
				const client = createClient('http://127.0.0.1:' + server.address().port, { autoConnect: false, reconnection: false });
				clients.push(client);
				const initial = events.once(client, 'notify-exclusion-rules');
				client.connect(); await initial;
			}
			const broadcasts = clients.map(client => events.once(client, 'notify-exclusion-rules'));
			store.save(excludesFile, [], null, configFile);
			await Promise.all(broadcasts);
			clients[0].disconnect();
			const reconnected = events.once(clients[0], 'notify-exclusion-rules');
			clients[0].connect(); await reconnected;
		} finally {
			clients.forEach(client => client.close());
			await new Promise(resolve => io.close(resolve));
		}
	});
});
