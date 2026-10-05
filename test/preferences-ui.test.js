'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../web/config-schema');

function browser() {
	const ctx = vm.createContext({ console });
	vm.runInContext(`
		var values = {}, events = {}, failStorage = false;
		var window = { location: {}, addEventListener: function(name, fn) { events[name] = fn; }, localStorage: {
			getItem: function(key) { if (failStorage) throw Error('denied'); return values[key] || null; },
			setItem: function(key, value) { if (failStorage) throw Error('denied'); values[key] = value; }
		} };
		function Element(tag) { this.tagName = tag; this.children = []; this.handlers = {}; }
		Element.prototype.appendChild = function(child) { this.children.push(child); };
		Element.prototype.setAttribute = function(key, value) { this[key] = value; };
		Element.prototype.addEventListener = function(key, fn) { this.handlers[key] = fn; };
		var document = { createElement: function(tag) { return new Element(tag); }, createTextNode: function(text) { return text; } };
	`, ctx);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/preferences.js'), 'utf8'), ctx);
	vm.runInContext('var ChinachuPreferences = window.ChinachuPreferences;', ctx);
	return ctx;
}

describe('browser display preferences and reservation descriptions', function() {
	it('defaults to hidden, synchronizes controls and storage events, and unsubscribes on leaving', function() {
		const ctx = browser();
		vm.runInContext(`
			var updates = 0, pref = ChinachuPreferences;
			var first = pref.createSwitch(function() { updates++; }), second = pref.createSwitch();
			var a = first.element.children[0], b = second.element.children[0];
		`, ctx);
		assert.equal(ctx.a.checked, false);
		vm.runInContext('a.checked = true; a.handlers.change();', ctx);
		assert.equal(ctx.b.checked, true);
		assert.equal(ctx.values['chinachu.reserves.showDescription'], 'true');
		vm.runInContext("values['chinachu.reserves.showDescription'] = 'false'; events.storage({ key: 'chinachu.reserves.showDescription' });", ctx);
		assert.equal(ctx.a.checked, false);
		assert.equal(ctx.b.checked, false);
		vm.runInContext('first.destroy(); second.destroy(); pref.set(true);', ctx);
		assert.equal(ctx.updates, 2);
	});
	it('stores visibility independently per list and only notifies matching controls', function() {
		const ctx = browser();
		vm.runInContext(`
			var pref = ChinachuPreferences, updates = {};
			var scopes = ['reserves', 'recording', 'recorded', 'search', 'recorded.search'];
			pref.set(true);
			var controls = scopes.map(function(scope) {
				updates[scope] = 0;
				return pref.createSwitch(function() { updates[scope]++; }, scope);
			});
		`, ctx);
		assert.deepEqual(Array.from(ctx.controls, control => control.element.children[0].checked), [true, false, false, false, false]);
		for (const scope of Array.from(ctx.scopes)) {
			ctx.scope = scope;
			vm.runInContext(`
				var input = controls[scopes.indexOf(scope)].element.children[0];
				input.checked = true; input.handlers.change();
			`, ctx);
			assert.equal(ctx.values['chinachu.' + scope + '.showDescription'], 'true');
			assert.equal(ctx.updates[scope], 1);
		}
		vm.runInContext("values['chinachu.recorded.showDescription'] = 'false'; events.storage({ key: 'chinachu.recorded.showDescription' });", ctx);
		assert.deepEqual(Array.from(ctx.controls, control => control.element.children[0].checked), [true, true, false, true, true]);
		assert.deepEqual(Array.from(ctx.scopes, scope => ctx.updates[scope]), [1, 1, 2, 1, 1]);
		vm.runInContext('values = {}; events.storage({ key: null });', ctx);
		assert.ok(ctx.controls.every(control => !control.element.children[0].checked));
		vm.runInContext("controls.forEach(function(control) { control.destroy(); }); pref.set(true, 'recorded');", ctx);
		assert.equal(ctx.updates.recorded, 3);
	});
	it('synchronizes click action selectors and restores the selection if storage fails', function() {
		const ctx = browser();
		vm.runInContext(`
			var first = ChinachuPreferences.createClickActionSelect(), second = ChinachuPreferences.createClickActionSelect();
			var a = first.element.children[1], b = second.element.children[1];
			a.value = 'skip'; a.handlers.change();
		`,ctx);
		assert.equal(ctx.b.value,'skip');
		vm.runInContext("values['chinachu.reserves.clickAction'] = 'details'; events.storage({key:'chinachu.reserves.clickAction'});",ctx);
		assert.equal(ctx.a.value,'details');
		assert.equal(ctx.b.value,'details');
		vm.runInContext("failStorage = true; a.value = 'skip'; a.handlers.change();",ctx);
		assert.equal(ctx.a.value,'details');
		assert.match(ctx.first.element.children[2].textContent,/保存できません/);
		vm.runInContext("failStorage = false; first.destroy(); second.destroy(); ChinachuPreferences.setClickAction('skip');",ctx);
		assert.equal(ctx.b.value,'details');
	});
	it('reports storage failure and restores the displayed choice', function() {
		const ctx = browser();
		vm.runInContext('var control = ChinachuPreferences.createSwitch(); failStorage = true; var input = control.element.children[0]; input.checked = true; input.handlers.change();', ctx);
		assert.equal(ctx.input.checked, false);
		assert.match(ctx.control.element.children[2].textContent, /保存できません/);
	});
	it('persists description font sizes, synchronizes tabs and handles invalid values and storage failure', function() {
		const ctx = browser();
		vm.runInContext(`
			var pref = ChinachuPreferences, updates = 0;
			var first = pref.createDescriptionFontSizeSelect(), second = pref.createDescriptionFontSizeSelect();
			var a = first.element.children[1], b = second.element.children[1];
			var unsubscribe = pref.subscribeDescriptionFontSize(function() { updates++; });
		`, ctx);
		assert.equal(ctx.a.value, '12px');
		vm.runInContext("a.value = '11px'; a.handlers.change();", ctx);
		assert.equal(ctx.values['chinachu.reserves.descriptionFontSize'], '11px');
		assert.equal(ctx.b.value, '11px');
		vm.runInContext("values['chinachu.reserves.descriptionFontSize'] = '0.9rem'; events.storage({ key: 'chinachu.reserves.descriptionFontSize' });", ctx);
		assert.equal(ctx.a.value, '14px');
		assert.equal(ctx.b.value, '14px');
		vm.runInContext("failStorage = true; a.value = '16px'; a.handlers.change();", ctx);
		assert.equal(ctx.a.value, '12px');
		assert.match(ctx.first.element.children[2].textContent, /保存できません/);
		assert.equal(ctx.values['chinachu.reserves.descriptionFontSize'], '0.9rem');
		vm.runInContext("failStorage = false; values['chinachu.reserves.descriptionFontSize'] = 'invalid'; events.storage({ key: null });", ctx);
		assert.equal(ctx.a.value, '12px');
		assert.equal(ctx.b.value, '12px');
		vm.runInContext("first.destroy(); second.destroy(); unsubscribe(); pref.setDescriptionFontSize('16px');", ctx);
		assert.equal(ctx.b.value, '12px');
		assert.equal(ctx.updates, 3);
	});
	it('escapes descriptions, omits empty descriptions and keeps navigation to program details', function() {
		const ctx = browser();
		vm.runInContext(`
			var P = {};
			var Chinachu = {
				definePage: function(methods) { P = methods; },
				escapeHTML: function(text) { return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
			};
			var ChinachuReservationActions = { isPending: function() { return false; } };
			var chinachu = { ui: { DynamicTime: function() { this.entity = {}; } } };
			var global = { chinachu: { reserves: [
				{ id: 'one', title: '番組', fullTitle: '番組', detail: '<img src=x onerror=alert(1)>', flags: [], channel: {}, seconds: 60, start: 1 },
				{ id: 'two', title: '説明なし', flags: [], channel: {}, seconds: 60, start: 2 },
				{ id: 'manual', title: '手動予約', flags: [], channel: {}, seconds: 60, start: 3, isManualReserved: true, isSkip: true }
			] } };
			var ChinachuVirtualGrid = function(options) {
				this.options = options;
				this.rows = [];
				this.destroy = function() {};
				this.insertTo = function() { return this; };
				this.splice = function(start, count, rows) {
					count = typeof count === 'undefined' ? this.rows.length - start : count;
					return this.rows.splice.apply(this.rows, [start, count].concat(rows));
				};
			};
		`, ctx);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/reserves/list.js'), 'utf8'), ctx);
		vm.runInContext('P.view = { content: { update: function() {} } }; P.self = { query: {} }; P.draw();', ctx);
		assert.ok(!ctx.P.grid.rows[0].cell.title.html.includes('reserve-description'));
		vm.runInContext('ChinachuPreferences.set(true); P.drawMain();', ctx);
		assert.match(ctx.P.grid.rows[0].cell.title.html, /&lt;img/);
		assert.ok(!ctx.P.grid.rows[0].cell.title.html.includes('<img'));
		assert.ok(!ctx.P.grid.rows[1].cell.title.html.includes('reserve-description'));
		assert.match(ctx.P.grid.rows[0].cell.title.html, /font-size: 12px/);
		vm.runInContext("ChinachuPreferences.setDescriptionFontSize('11px'); P.drawMain();", ctx);
		assert.match(ctx.P.grid.rows[0].cell.title.html, /font-size: 11px/);
		assert.match(ctx.P.grid.rows[2].className, /reserve-skipped/);
		assert.match(ctx.P.grid.rows[2].cell.title.html, /class="flag skip"/);
		assert.match(ctx.P.grid.rows[2].cell.title.html, /class="flag manual"/);
		assert.equal(ctx.P.grid.rows[2].cell.details.createElement().entity.href, '#!/program/view/id=manual/');
		assert.equal(typeof ctx.P.grid.options.onDblClick, 'function');
		vm.runInContext('P.grid.options.onClick({}, P.grid.rows[0]);', ctx);
		assert.equal(ctx.window.location.href, '#!/program/view/id=one/');
		for (const [page, scope] of Object.entries({ 'recording/list': 'recording', 'recorded/list': 'recorded', 'search/top': 'search', 'recorded/search': 'recorded.search' })) {
			ctx.scope = scope;
			vm.runInContext(`
				global.chinachu.recording = global.chinachu.recorded = global.chinachu.reserves;
				global.chinachu.schedule = [{ programs: global.chinachu.reserves }];
				global.chinachu.status = {};
				global.chinachu.reserves.forEach(function(program) { program.end = Date.now() + 60000; });
				chinachu.dateToString = function() { return ''; };
				ChinachuPreferences.set(false, scope);
			`, ctx);
			vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/page/' + page + '.js'), 'utf8'), ctx);
			vm.runInContext("P.view = { content: { update: function() {} } }; P.self = { query: { skip: 1 } }; P.draw();", ctx);
			const row = () => ctx.P.grid.rows.find(row => row.data.id === 'one');
			assert.ok(!row().cell.title.html.includes('reserve-description'), page);
			vm.runInContext('ChinachuPreferences.set(true, scope); P.drawMain();', ctx);
			assert.equal(ctx.P.grid.rows.length, 3, page + ': enabling descriptions must replace existing rows');
			assert.match(row().cell.title.html, /&lt;img/, page);
			assert.ok(!row().cell.title.html.includes('<img'), page);
			assert.match(row().className, /reserve-description-row/, page);
			assert.equal(row().cell.title.className, 'reserve-description-cell', page);
			assert.match(row().cell.title.html, /font-size: 11px/, page);
			assert.ok(!ctx.P.grid.rows.find(row => row.data.id === 'two').cell.title.html.includes('reserve-description'), page);
			vm.runInContext('ChinachuPreferences.set(false, scope); P.drawMain();', ctx);
			assert.equal(ctx.P.grid.rows.length, 3, page + ': disabling descriptions must replace existing rows');
			assert.ok(ctx.P.grid.rows.every(row => !row.cell.title.html.includes('reserve-description')), page);
			assert.equal(row().cell.title.className, '', page);
			assert.equal(row().className, '', page);
		}
	});
	it('keeps invalid nullable numbers invalid after switching through JSON', function() {
		const field = schema.fields.find(field => field.key === 'wuiPort');
		for (const value of ['abc', 'Infinity', ' ']) {
			const config = JSON.parse(JSON.stringify({ wuiPort: schema.parse(field, value) }));
			assert.equal(schema.validate(config)[0].key, 'wuiPort');
		}
		assert.equal(schema.parse(field, ''), null);
		assert.equal(schema.parse(field, '20772'), 20772);
	});
});
