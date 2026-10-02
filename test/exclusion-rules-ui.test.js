'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser() {
	const context = vm.createContext({ console: { log() {} } });
	vm.runInContext(`
		var requests = [], events = [], modals = [], forms = [], handlers = {};
		var result = { duration: {}, reserve_titles: ['再放送'], isEnabled: true };
		var rules = [{ reserve_titles: ['再放送'], isDisabled: true, sid: 2 }];
		var ui = {}, P = {}, window = { location: {} }, global = { chinachu: { rules: [] } };
		var formInputTypeChannels = {}, formInputTypeStrings = {};
		Array.prototype.each = Array.prototype.forEach;
		Array.prototype.first = function() { return this[0]; };
		String.prototype.__ = function() { return String(this); };
		String.prototype.truncate = function() { return String(this); };
		Function.prototype.bindAsEventListener = Function.prototype.bind;
		var Class = { create: function(parent, definition) {
			if (definition) return definition;
			function Constructor() { parent.initialize.apply(this, arguments); }
			Constructor.prototype = parent;
			return Constructor;
		} };
		var document = {
			observe: function(name, handler) { handlers[name] = handler; },
			stopObserving: function(name) { delete handlers[name]; },
			fire: function(name) { events.push(name); if (handlers[name]) handlers[name](); }
		};
		function Button(options) { this.options = options; }
		Button.prototype.disable = function() { this.disabled = true; return this; };
		Button.prototype.enable = function() { this.disabled = false; return this; };
		var sakura = { ui: { Button: Button, Element: function() {} } };
		function Modal(options) {
			Object.assign(this, options);
			(this.buttons || []).forEach(function(button) { button.button = new Button({}); });
			this.show = function() { modals.push(this); return this; };
			this.close = function() { this.closed = true; };
			this.content = { updateText: function() {} };
		}
		var flagrate = {
			Modal: Modal, createModal: function(options) { return new Modal(options); },
			createForm: function(options) { forms.push(options); return { element: {}, getResult: function() { return result; } }; },
			Grid: function(options) {
				this.options = options;
				this.destroy = function() {};
				this.selected = [];
				this.insertTo = function() { return this; };
				this.getSelectedRows = function() { return this.selected; };
				this.splice = function(a, b, rows) { var old = this.rows || []; this.rows = rows; this.selected = []; return old; };
				this.deselect = function() {};
			}
		};
		var Ajax = { Request: function(url, options) {
			requests.push({ method: options.method, url: url });
			if (options.method === 'delete') rules.splice(Number(url.match(/\\/(\\d+)\\.json/)[1]), 1);
			if (options.onSuccess) options.onSuccess({ responseJSON: /\\/\\d+\\.json$/.test(url) ? rules[0] : rules });
		} };
		function XMLHttpRequest() {
			this.addEventListener = function(name, fn) { this.loaded = fn; };
			this.setRequestHeader = function() {};
			this.open = function(method, url) { this.method = method; this.url = url; };
			this.send = function(body) {
				requests.push({ method: this.method, url: this.url, body: JSON.parse(body) });
				this.status = this.method === 'POST' ? 201 : 200;
				this.loaded();
			};
		}
	`, context);
	return context;
}

describe('common exclusion rule GUI', function () {
	it('uses the shared form with separate endpoints and preserves normal rule editing', function () {
		const ctx = browser();
		const source = fs.readFileSync(path.join(__dirname, '../web/class.js'), 'utf8');
		vm.runInContext(source.slice(source.indexOf('\tui.EditRule ='), source.indexOf('\tui.CreateRuleByProgram =')), ctx);
		vm.runInContext('new ui.NewRule(true);', ctx);
		assert.equal(ctx.modals[0].title, '共通除外ルールの新規作成');
		assert.ok(!ctx.forms[0].fields.some(f => f.key === 'recorded_format'));
		vm.runInContext('modals[0].buttons[0].onSelect({ targetButton: new Button({}) }, modals[0]);', ctx);
		assert.equal(ctx.requests[0].url, './api/exclusion-rules.json');
		assert.equal(ctx.events[0], 'chinachu:exclusion-rules');
		vm.runInContext('result.duration = {}; new ui.EditRule(0, true); var editor = modals[modals.length - 1]; editor.buttons[0].onSelect({ targetButton: new Button({}) }, editor);', ctx);
		assert.equal(ctx.requests.at(-1).url, './api/exclusion-rules/0.json');
		assert.equal(ctx.requests.at(-1).body.sid, 2);
		vm.runInContext('result.duration = {}; new ui.NewRule(); var editor = modals[modals.length - 1]; editor.buttons[0].onSelect({ targetButton: new Button({}) }, editor);', ctx);
		assert.equal(ctx.requests.at(-1).url, './api/rules.json');
		assert.ok(ctx.forms.at(-1).fields.some(f => f.key === 'recorded_format'));
	});

	it('loads, edits, refreshes and deletes exclusion rows without touching normal rules', function () {
		const ctx = browser();
		vm.runInContext('var ChinachuVirtualGrid = flagrate.Grid;', ctx);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/rules/list.js'), 'utf8'), ctx);
		vm.runInContext(`
			var edits = [];
			var chinachu = { ui: { EditRule: function(num, exclusion) { edits.push({ num: num, exclusion: exclusion }); } } };
			P.self = { query: { kind: 'exclusion' } };
			P.view = {
				content: { update: function() {} }, title: { update: function(text) { this.text = text; } },
				toolbar: { controls: {}, add: function(item) { this.controls[item.key] = item.ui; }, one: function(key) { return this.controls[key]; } }
			};
			P.init();
			P.grid.selected = [P.grid.rows[0]];
			P.updateToolbar();
			P.view.toolbar.one('edit').options.onClick();
		`, ctx);
		assert.equal(ctx.P.view.title.text, '共通除外ルール');
		assert.equal(ctx.P.grid.rows[0].className, 'disabled');
		assert.equal(ctx.edits[0].exclusion, true);
		assert.equal(ctx.edits[0].num, 0);
		vm.runInContext("document.fire('chinachu:exclusion-rules'); P.grid.selected = [P.grid.rows[0]]; P.view.toolbar.one('delete').options.onClick(); var modal = modals[0]; modal.buttons[0].onSelect({}, modal);", ctx);
		assert.equal(ctx.P.grid.rows.length, 0);
		assert.ok(ctx.requests.some(r => r.method === 'delete' && r.url === './api/exclusion-rules/0.json'));
		assert.ok(ctx.requests.every(r => r.url.includes('exclusion-rules')));
		vm.runInContext("P.view.toolbar.one('rule-kind').options.onClick(); P.deinit();", ctx);
		assert.equal(ctx.window.location.href, '#!/rules/list/');
		assert.equal(ctx.handlers['chinachu:exclusion-rules'], undefined);
	});
});
