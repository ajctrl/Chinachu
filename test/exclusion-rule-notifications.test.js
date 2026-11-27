'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const events = require('node:events');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const { stateFixture } = require('./helpers/state');

describe('common exclusion rule notifications', function () {
	let fixture, store, writer, watcher;
	beforeEach(function () {
		fixture = stateFixture();
		store = fixture.open();
		writer = fixture.open();
	});
	afterEach(function () {
		if (watcher) watcher.close();
		fixture.close();
	});

	it('notifies only for committed collections across connections', async function () {
		const signals = new events.EventEmitter();
		const changes = [];
		watcher = store.watch(name => { changes.push(name); signals.emit('change'); }, 10);
		assert.throws(() => writer.transaction(() => {
			writer.replace('rules', [{}]);
			throw new Error('rollback');
		}));
		const committed = events.once(signals, 'change');
		writer.replace('excludes', [{ channels: ['first'] }]);
		await committed;
		assert.deepEqual(changes, ['excludes']);
		assert.deepEqual(store.read('excludes'), [{ channels: ['first'] }]);
	});

	it('broadcasts committed edits to two clients and resynchronizes on reconnection', async function () {
		const server = http.createServer();
		let io;
		const context = vm.createContext({
			events, server, basicAuthEnabled: false, openServerEnabled: false,
			config: {}, status: { connectedCount: 0 },
			Server: function (target) { io = new Server(target); return io; }
		});
		const source = fs.readFileSync(require.resolve('../app-wui.js'), 'utf8').replace(/\r\n/g, '\n');
		const start = source.indexOf('var ios = new events.EventEmitter();');
		const end = source.indexOf('// プロセス監視', start);
		vm.runInContext(source.slice(start, end), context);
		watcher = store.watch(context.notifyStateChange, 10);
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
			writer.replace('excludes', [{ channels: ['new'] }]);
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
