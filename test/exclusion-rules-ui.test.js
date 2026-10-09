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
		var Chinachu = {
			definePage: function(definition) { P = definition; },
			createClass: function(methods) {
				function Action() { this.initialize.apply(this, arguments); }
				Object.assign(Action.prototype, methods);
				return Action;
			},
			t: function(text) { return text; },
			escapeHTML: function(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
			on: function(target, name, handler) { handlers[name] = handler; },
			off: function(target, name) { delete handlers[name]; },
			emit: function(target, name) { events.push(name); if (handlers[name]) handlers[name](); }
		};
		var document = { createElement: function(tag) {
			return { tagName: tag, children: [], append: function() {
				this.children.push.apply(this.children, arguments);
			} };
		} };
		function Button(options) { this.options = options; }
		Button.prototype.disable = function() { this.disabled = true; return this; };
		Button.prototype.enable = function() { this.disabled = false; return this; };

		function Modal(options) {
			Object.assign(this, options);
			(this.buttons || []).forEach(function(button) { button.button = new Button({}); });
			this.show = function() { modals.push(this); return this; };
			this.close = function() { this.closed = true; };
			this.content = { updateText: function() {} };
		}
		var ChinachuUI = {
			createElement: function(tag, attributes) {
				return {
					tag: tag, attributes: attributes, children: [],
					insertText: function(text) { this.text = text; return this; },
					insertTo: function(parent) { this.parentNode = parent; (parent.children || (parent.children = [])).push(this); return this; },
					remove: function() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
				};
			},
			ActionButton: Button, ElementView: function() {},
			Modal: Modal, createModal: function(options) { return new Modal(options); },
			createForm: function(options) { forms.push(options); return { element: {}, getResult: function() { return result; } }; },
			Grid: function(options) {
				this.options = options;
				this.destroy = function() {};
				this.selected = [];
				this.insertTo = function() { return this; };
				this.getSelectedRows = function() { return this.selected; };
				this.splice = function(a, b, rows) { var old = this.rows || []; this.rows = rows; this.selected = []; return old; };
				this.select = function(rows) {
					rows.forEach(function(row) {
						if (this.selected.indexOf(row) !== -1) return;
						row.isSelected = true;
						this.selected.push(row);
						if (options.onSelect) options.onSelect({}, row);
					}, this);
				};
				this.deselect = function(row) {
					row.isSelected = false;
					this.selected = this.selected.filter(function(item) { return item !== row; });
					if (options.onDeselect) options.onDeselect({}, row);
				};
			}
		};
		Chinachu.request = function(url, options) {
			requests.push({ method: options.method, url: url });
			if (options.method === 'delete') rules.splice(Number(url.match(/\\/(\\d+)\\.json/)[1]), 1);
			if (options.onSuccess) options.onSuccess({ responseJSON: /\\/\\d+\\.json$/.test(url) ? rules[0] : rules });
		};
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
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/channel-selector.js'), 'utf8'), context);
	vm.runInContext('var ChinachuChannelSelector = window.ChinachuChannelSelector;', context);
	return context;
}

describe('common exclusion rule GUI', function () {
	it('shows defaults in creation and restores saved keyword operators in editing', function () {
		const ctx = browser();
		const source = fs.readFileSync(path.join(__dirname, '../web/class.js'), 'utf8');
		vm.runInContext(source.slice(source.indexOf('\tui.EditRule ='), source.indexOf('\tui.CreateRuleByProgram =')), ctx);
		const keys = ['reserve_fields_operator', 'reserve_titles_operator', 'reserve_descriptions_operator'];
		vm.runInContext('new ui.NewRule();', ctx);
		for (const [i, key] of keys.entries()) {
			assert.equal(ctx.forms[0].fields.find(f => f.key === key).input.val, i === 0 ? 'and' : 'or');
		}
		vm.runInContext("Object.assign(rules[0], { reserve_fields_operator: 'or', reserve_titles_operator: 'and', reserve_descriptions_operator: 'and' }); new ui.EditRule(0);", ctx);
		for (const [i, key] of keys.entries()) {
			assert.equal(ctx.forms[1].fields.find(f => f.key === key).input.val, i === 0 ? 'or' : 'and');
		}
		vm.runInContext("Object.assign(result, rules[0]); var editor = modals[modals.length - 1]; editor.buttons[0].onSelect({ targetButton: new Button({}) }, editor);", ctx);
		for (const [i, key] of keys.entries()) {
			assert.equal(ctx.requests.at(-1).body[key], i === 0 ? 'or' : 'and');
		}
	});

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
		vm.runInContext('var ChinachuVirtualGrid = ChinachuUI.Grid;', ctx);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/rules/list.js'), 'utf8'), ctx);
		vm.runInContext(`
			var edits = [];
			var chinachu = { ui: { EditRule: function(num, exclusion) { edits.push({ num: num, exclusion: exclusion }); } } };
			P.self = { query: { kind: 'exclusion' } };
			P.view = {
				content: { update: function() {} }, title: { update: function(text) { this.text = text; } },
				toolbar: { controls: {}, add: function(item) { this.controls[item.key] = item.ui; }, one: function(key) { return this.controls[key]; } }
			};
			P.view.title.parentNode = { children: [] };
			P.init();
			P.grid.selected = [P.grid.rows[0]];
			P.updateToolbar();
			P.view.toolbar.one('edit').options.onClick();
		`, ctx);
		assert.equal(ctx.P.view.title.text, '共通除外ルール');
		assert.equal(ctx.P.view.toolbar.one('refresh'), undefined);
		assert.equal(ctx.P.grid.rows[0].className, 'disabled');
		assert.equal(ctx.edits[0].exclusion, true);
		assert.equal(ctx.edits[0].num, 0);
		vm.runInContext("rules.push({ channels: ['another-tab'] }); Chinachu.emit(document, 'chinachu:exclusion-rules');", ctx);
		assert.equal(ctx.P.grid.rows.length, 2);
		assert.equal(ctx.P.grid.rows[1].data.channels[0], 'another-tab');
		vm.runInContext("Chinachu.emit(document, 'chinachu:exclusion-rules'); P.grid.selected = [P.grid.rows[0]]; P.view.toolbar.one('delete').options.onClick(); var modal = modals[0]; modal.buttons[0].onSelect({}, modal);", ctx);
		assert.equal(ctx.P.grid.rows.length, 1);
		assert.ok(ctx.requests.some(r => r.method === 'delete' && r.url === './api/exclusion-rules/0.json'));
		assert.ok(ctx.requests.every(r => r.url.includes('exclusion-rules')));
		assert.equal(ctx.P.view.title.hidden, true);
		const tabs = ctx.P.view.title.parentNode.children[0].children;
		assert.equal(tabs[0].attributes.href, '#!/rules/list/');
		assert.equal(tabs[0].attributes['aria-current'], null);
		assert.equal(tabs[1].attributes.href, '#!/rules/list/kind=exclusion/');
		assert.equal(tabs[1].attributes['aria-current'], 'page');
		assert.equal(ctx.P.view.toolbar.one('rule-kind'), undefined);
		vm.runInContext('P.deinit();', ctx);
		assert.equal(ctx.P.view.title.hidden, false);
		assert.equal(ctx.P.view.title.parentNode.children.length, 0);
		assert.equal(ctx.handlers['chinachu:exclusion-rules'], undefined);
		assert.equal(ctx.handlers['chinachu:schedule'], undefined);
	});

	it('fetches on server notification and keeps the latest response when refreshes overlap', function () {
		const ctx = browser();
		vm.runInContext('var ChinachuVirtualGrid = ChinachuUI.Grid;', ctx);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/rules/list.js'), 'utf8'), ctx);
		const source = fs.readFileSync(path.join(__dirname, '../web/chinachu.js'), 'utf8').replace(/\r\n/g, '\n');
		const handlerStart = source.indexOf('\tvar socketOnNotifyExclusionRules =');
		const handlerEnd = source.indexOf('\n\tvar socketOnNotifyRules =', handlerStart);
		vm.runInContext(`
			var pending = [], socketCallbacks = {};
			Chinachu.request = function(url, options) { pending.push(options); };
			var app = { socket: { on: function(name, handler) { socketCallbacks[name] = handler; } } };
			P.self = { query: { kind: 'exclusion' } };
			P.view = {
				content: { update: function() {} }, title: { update: function() {} },
				toolbar: { controls: {}, add: function(item) { this.controls[item.key] = item.ui; }, one: function(key) { return this.controls[key]; } }
			};
			P.view.title.parentNode = { children: [] };
			P.init();
		`, ctx);
		vm.runInContext(source.slice(handlerStart, handlerEnd), ctx);
		vm.runInContext(source.split('\n').find(line => line.includes("app.socket.on('notify-exclusion-rules'")), ctx);
		vm.runInContext(`
			socketCallbacks['notify-exclusion-rules']();
			pending[1].onSuccess({ responseJSON: [{ channels: ['latest'] }] });
			pending[0].onSuccess({ responseJSON: [{ channels: ['stale'] }] });
			pending[0].onFailure({ status: 500 });
		`, ctx);
		assert.equal(ctx.P.grid.rows[0].data.channels[0], 'latest');
		assert.equal(ctx.modals.length, 0);
		vm.runInContext("P.deinit(); socketCallbacks['notify-exclusion-rules']();", ctx);
		assert.equal(ctx.pending.length, 2);
	});

	it('shows channel names after schedule loading, preserves raw IDs and updates on renaming', function() {
		const ctx = browser();
		vm.runInContext('var ChinachuVirtualGrid = ChinachuUI.Grid;', ctx);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/rules/list.js'), 'utf8'), ctx);
		vm.runInContext(`
			global.chinachu.rules = [{ channels: ['station', 'missing'], ignore_channels: ['BS_211'] }, {}];
			global.chinachu.schedule = [];
			P.self = { query: {} };
			P.view = {
				content: { update: function() {} }, title: { update: function() {} },
				toolbar: { controls: {}, add: function(item) { this.controls[item.key] = item.ui; }, one: function(key) { return this.controls[key]; } }
			};
			P.view.title.parentNode = { children: [] };
			P.init();
		`, ctx);
		assert.equal(ctx.P.grid.rows[0].cell.channels.text, 'station, missing');
		vm.runInContext(`
			global.chinachu.schedule = [{ id: 'station', name: '<b>BS11</b>', type: 'BS', channel: 'BS09_0', sid: 211 }];
			Chinachu.emit(document, 'chinachu:schedule');
		`, ctx);
		assert.equal(ctx.P.grid.rows[0].cell.channels.text, '[BS] <b>BS11</b>, missing');
		assert.equal(ctx.P.grid.rows[0].cell.channels.html, undefined);
		assert.equal(ctx.P.grid.rows[0].cell.ignore_channels.text, 'BS_211（[BS] <b>BS11</b>）');
		assert.match(ctx.P.grid.rows[0].cell.channels.attribute.title, /ID: station, missing/);
		assert.equal(ctx.P.grid.rows[1].cell.channels.text, 'CH指定なし');
		assert.equal(ctx.P.grid.rows[1].cell.ignore_channels.text, '除外なし');
		vm.runInContext(`global.chinachu.schedule[0].name = '新しい局名'; Chinachu.emit(document, 'chinachu:schedule');`, ctx);
		assert.equal(ctx.P.grid.rows[0].cell.channels.text, '[BS] 新しい局名, missing');
		assert.deepEqual(Array.from(ctx.global.chinachu.rules[0].channels), ['station', 'missing']);
		vm.runInContext('P.deinit();', ctx);
		assert.equal(ctx.handlers['chinachu:schedule'], undefined);
	});

	for (const isExclusion of [false, true]) {
		it('retains single and multiple selections across schedule updates for ' + (isExclusion ? 'exclusion' : 'normal') + ' rules', function() {
			const ctx = browser();
			ctx.isExclusion = isExclusion;
			vm.runInContext('var ChinachuVirtualGrid = ChinachuUI.Grid;', ctx);
			vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/rules/list.js'), 'utf8'), ctx);
			vm.runInContext(`
				rules = [{ channels: ['station'] }, { ignore_channels: ['station'] }, {}];
				global.chinachu.rules = rules;
				global.chinachu.schedule = [{ id: 'station', name: 'BS11', type: 'BS', channel: 'BS09_0', sid: 211 }];
				P.self = { query: { kind: isExclusion ? 'exclusion' : undefined } };
				P.view = {
					content: { update: function() {} }, title: { update: function() {} },
					toolbar: { controls: {}, add: function(item) { this.controls[item.key] = item.ui; }, one: function(key) { return this.controls[key]; } }
				};
				P.view.title.parentNode = { children: [] };
			P.init();
				P.grid.select([P.grid.rows[1]]);
				Chinachu.emit(document, 'chinachu:schedule');
			`, ctx);
			assert.equal(ctx.P.grid.getSelectedRows().length, 1);
			assert.equal(ctx.P.grid.getSelectedRows()[0], ctx.P.grid.rows[1]);
			assert.equal(ctx.P.grid.getSelectedRows()[0].data, ctx.rules[1]);
			assert.equal(ctx.P.view.toolbar.one('edit').disabled, false);
			assert.equal(ctx.P.view.toolbar.one('delete').disabled, false);
			vm.runInContext(`
				P.grid.select([P.grid.rows[2]]);
				// Sorting changes display order, so selection must follow rule identity.
				P.grid.rows.reverse();
				global.chinachu.schedule[0].name = '新しい局名';
				Chinachu.emit(document, 'chinachu:schedule');
			`, ctx);
			assert.deepEqual(Array.from(ctx.P.grid.getSelectedRows(), row => row.data), [ctx.rules[1], ctx.rules[2]]);
			assert.ok(ctx.P.grid.getSelectedRows().every(row => row.isSelected && ctx.P.grid.rows.includes(row)));
			assert.equal(ctx.P.grid.rows[1].cell.ignore_channels.text, '[BS] 新しい局名');
			assert.equal(ctx.P.view.toolbar.one('edit').disabled, true);
			assert.equal(ctx.P.view.toolbar.one('delete').disabled, false);
			// A rule change continues to clear selection, avoiding actions on stale rules.
			vm.runInContext('Chinachu.emit(document, P.ruleEvent);', ctx);
			assert.equal(ctx.P.grid.getSelectedRows().length, 0);
			assert.equal(ctx.P.view.toolbar.one('edit').disabled, true);
			assert.equal(ctx.P.view.toolbar.one('delete').disabled, true);
		});
	}
});
