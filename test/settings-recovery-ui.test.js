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
		P: {}, Class: { create: (parent, methods) => methods }, ChinachuConfig: schema,
		ace: { edit: () => editor },
		flagrate: { createModal(options) { modal = options; return { open() {} }; } },
		Ajax: { Request: function(url, options) { options.onSuccess({ responseText: text, getHeader: () => '"source-revision"' }); } }
	};
	vm.runInNewContext(source, ctx);
	const buttons = Object.fromEntries(['save', 'editor-toggle'].map(key => [key, { enabled: false, entity: {}, enable() { this.enabled = true; } }]));
	const page = Object.assign(Object.create(ctx.P), {
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
