'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../../lib/state-store');

function stateFixture(files = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chinachu-state-'));
	fs.mkdirSync(path.join(root, 'data'));
	for (const [name, value] of Object.entries({ 'config.json': {}, ...files })) {
		fs.writeFileSync(path.join(root, name), JSON.stringify(value));
	}
	const stores = [];
	return {
		root,
		open(options) {
			const store = new StateStore(root, options);
			stores.push(store);
			return store;
		},
		close() {
			for (const store of stores) store.close();
			fs.rmSync(root, { recursive: true, force: true });
		}
	};
}

function runRuleApi(source, sandbox, initial) {
	const fixture = stateFixture({ 'rules.json': initial });
	try {
		const store = fixture.open();
		const before = store.revision('rules').revision;
		require('node:vm').runInNewContext(source, { ...sandbox, store, editRule: require('../../lib/rule-state').editRule });
		if (store.revision('rules').revision !== before) return store.read('rules');
	} finally { fixture.close(); }
}

module.exports = { stateFixture, runRuleApi };
