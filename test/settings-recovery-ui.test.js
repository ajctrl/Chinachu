'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../web/config-schema');
const source = fs.readFileSync(path.join(__dirname, '../web/page/pref/config.js'), 'utf8');

function load(text) {
	let content, modal, saved;
	const editor = {
		setTheme() {}, setShowPrintMargin() {},
		getSession: () => ({ setMode() {}, setTabSize() {} }),
		setValue(value) { content = value; }, getValue: () => content, resize() {}
	};
	const ctx = {
		ChinachuConfig: schema,
		Chinachu: {
			definePage(methods) { ctx.page = methods; },
			request(url, options) { options.onSuccess({ responseText: text, getHeader: () => '"source-revision"' }); }
		},
		ace: { edit: () => editor },
		ChinachuUI: { createModal(options) { modal = options; return { open() {} }; } }
	};
	vm.runInNewContext(source, ctx);
	const buttons = Object.fromEntries(['save', 'editor-toggle'].map(key => [key, { enabled: false, entity: {}, enable() { this.enabled = true; } }]));
	const page = Object.assign(Object.create(ctx.page), {
		activeTab: 'form', data: {}, formPanel: { hidden: false }, jsonPanel: { hidden: true },
		view: { toolbar: { one: key => buttons[key] } },
		message(message) { this.status = message; }, renderForm() { this.rendered = true; },
		persist(text, restart) { saved = { text, restart, revision: this.data.revision }; }
	});
	page.load();
	return { page, editor, buttons, modal: () => modal, saved: () => saved };
}

describe('settings JSON recovery', function() {
	for (const source of ['{"recordedDir":', 'null', '[]']) {
		it('allows repairing ' + source + ' without losing its text or revision', function() {
			const ui = load(source);
			assert.equal(ui.page.activeTab, 'json');
			assert.equal(ui.editor.getValue(), source);
			assert.equal(ui.page.data.revision, 'source-revision');
			assert.equal(ui.buttons.save.enabled, true);
			assert.equal(ui.buttons['editor-toggle'].enabled, true);
			ui.page.selectTab('form');
			assert.equal(ui.page.activeTab, 'json');
			ui.page.save();
			assert.equal(ui.modal(), undefined);
			ui.editor.setValue('{"wuiPort":70000}');
			ui.page.save();
			assert.match(ui.page.status, /Web待受ポート/);
			assert.equal(ui.modal(), undefined);
			ui.editor.setValue('{"recordedDir":"./recorded/"}');
			ui.page.selectTab('form');
			assert.equal(ui.page.activeTab, 'form');
			assert.equal(ui.page.rendered, true);
			ui.page.save();
			assert.match(ui.modal().text, /設定ファイルの修復/);
			ui.modal().buttons[0].onSelect({}, { close() {} });
			assert.deepEqual(JSON.parse(ui.saved().text), { recordedDir: './recorded/' });
			assert.equal(ui.saved().revision, 'source-revision');
			assert.equal(ui.saved().restart, true);
		});
	}
	it('allows saving a repaired empty object directly from JSON mode', function() {
		const ui = load('{');
		ui.editor.setValue('{}');
		ui.page.save();
		assert.match(ui.modal().text, /設定ファイルの修復/);
	});
	it('keeps valid configuration in form mode and does not save unchanged settings', function() {
		const ui = load('{"recordedDir":"./recorded/"}');
		assert.equal(ui.page.activeTab, 'form');
		assert.equal(ui.page.rendered, true);
		ui.page.save();
		assert.equal(ui.modal(), undefined);
		assert.match(ui.page.status, /変更はありません/);
	});
});

describe('settings password edits across form and JSON', function() {
	const original = { wuiUsers: [{ username: 'alice', passwordSet: true }] };
	function setup() { return load(JSON.stringify(original)); }
	function passwordInput(ui) {
		const row = { children: [] };
		ui.page.node = function(tag, parent, text) {
			const node = { tag, textContent: text, children: [], handlers: {},
				setAttribute() {}, removeAttribute() {}, focus() {},
				addEventListener(name, handler) { this.handlers[name] = handler; } };
			if (parent) parent.children.push(node);
			return node;
		};
		ui.page.inputs = {};
		ui.page.renderUsers(row, schema.fields.find(field => field.key === 'wuiUsers'), 'users', ui.page.data.config.wuiUsers);
		return row.children[0].children.find(node => node.tag === 'input');
	}
	function enter(input, value) { input.value = value; input.handlers.input(); }
	function confirm(ui) { ui.page.save(); ui.modal().buttons[0].onSelect({}, { close() {} }); return JSON.parse(ui.saved().text); }
	it('uses an explicit JSON password instead of the earlier form password', function() {
		const ui = setup();
		enter(passwordInput(ui), 'older-form-password');
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify({ wuiUsers: [{ ...original.wuiUsers[0], password: 'new-json-password' }] }));
		assert.equal(confirm(ui).wuiUsers[0].password, 'new-json-password');
	});
	it('cancels a pending form password when JSON explicitly supplies an empty string', function() {
		const ui = setup();
		enter(passwordInput(ui), 'older-form-password');
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify({ wuiUsers: [{ ...original.wuiUsers[0], password: '' }] }));
		ui.page.save();
		assert.equal(Object.keys(ui.page.pendingPasswords).length, 0);
		assert.equal(ui.modal(), undefined);
		assert.match(ui.page.status, /変更はありません/);
	});
	it('shows the JSON password in the masked form and lets a later form edit replace it', function() {
		const ui = setup();
		enter(passwordInput(ui), 'older-form-password');
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify({ wuiUsers: [{ ...original.wuiUsers[0], password: 'new-json-password' }] }));
		ui.page.selectTab('form');
		const input = passwordInput(ui);
		assert.equal(input.type, 'password');
		assert.equal(input.value, 'new-json-password');
		assert.ok(!ui.editor.getValue().includes('new-json-password'));
		enter(input, 'latest-form-password');
		ui.page.selectTab('json');
		assert.ok(!ui.editor.getValue().includes('latest-form-password'));
		assert.equal(confirm(ui).wuiUsers[0].password, 'latest-form-password');
	});
	it('does not restore a JSON password after the user clears it in the form', function() {
		const ui = setup();
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify({ wuiUsers: [{ ...original.wuiUsers[0], password: 'new-json-password' }] }));
		ui.page.selectTab('form');
		enter(passwordInput(ui), '');
		ui.page.selectTab('json');
		ui.page.save();
		assert.equal(ui.modal(), undefined);
		assert.equal(Object.keys(ui.page.pendingPasswords).length, 0);
	});
	it('discards pending passwords for users removed in JSON', function() {
		const ui = setup();
		enter(passwordInput(ui), 'older-form-password');
		ui.page.selectTab('json');
		ui.editor.setValue('{"wuiUsers":[]}');
		ui.page.selectTab('form');
		assert.equal(Object.keys(ui.page.pendingPasswords).length, 0);
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify(original));
		ui.page.save();
		assert.equal(ui.modal(), undefined);
	});
	it('retains invalid JSON password types for validation instead of silently dropping them', function() {
		const ui = setup();
		ui.page.selectTab('json');
		ui.editor.setValue(JSON.stringify({ wuiUsers: [{ ...original.wuiUsers[0], password: null }] }));
		ui.page.save();
		assert.equal(ui.page.data.config.wuiUsers[0].password, null);
		assert.equal(ui.modal(), undefined);
		assert.match(ui.page.status, /Web認証ユーザー/);
	});
});
