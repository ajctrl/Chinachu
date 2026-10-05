'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser(query, recorded, data = {}) {
	class Element {
		constructor(tag) {
			this.tagName = tag; this.children = []; this.handlers = {}; this.value = '';
			this.ownerDocument = document;
			this.classList = { add: name => { this.className = name; } };
		}
		set textContent(value) { this.text = value; this.children = []; }
		get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
		setAttribute(name, value) { this[name] = value; }
		dispatchEvent(event) { if (this.handlers[event.type]) this.handlers[event.type](event); }
		appendChild(child) { this.children.push(child); return child; }
		addEventListener(name, handler) { this.handlers[name] = handler; }
		setCustomValidity(message) { this.validationMessage = message; }
		reportValidity() { return this.children.every(label => label.children.every(input => !input.validationMessage)); }
		focus() {}
	}
	const document = { createElement: tag => new Element(tag), defaultView: { Event: class { constructor(type) { this.type = type; } } } };
	let modal;
	const window = { location: { hash: '' } };
	const context = { window, document, global: { chinachu: data },
		ChinachuChannelSelector: require('../web/channel-selector'),
		Chinachu: { serializeQuery: object => new URLSearchParams(object).toString() },
		ChinachuUI: { Modal: function(options) {
			modal = this;
			Object.assign(this, options, { content: new Element('div'), show() { return this; }, close() { this.closed = true; } });
		} }
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/search-form.js'), 'utf8'), context);
	const page = { self: { query }, drawMain() { this.redrawn = true; } };
	window.ChinachuSearchForm.show(page, { recorded });
	const form = modal.content.children[0];
	const inputs = Object.fromEntries(form.children.filter(el => el.tagName === 'label').map(label => [label.children[1].name, label.children[1]]));
	const channelSelector = form.children.find(el => el.tagName === 'div').children[1];
	return { window, modal, form, inputs, page, channelSelector };
}

describe('native search forms', function() {
	function initializeScheduleQuery(query) {
		let definition;
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/search/top.js'), 'utf8'), {
			Chinachu: { definePage(page) { definition = page; }, on() {} }, document: {}
		});
		definition.init.call({ self: { query }, view: { content: {} }, initToolbar() {}, draw() {}, refresh() {} });
		return query;
	}

	it('preserves percent escapes through form submission and schedule page initialization', function() {
		for (const term of ['%41', '%20', '%2F', '%E7%95%AA', '%', '日本語 & 100% / (字幕)']) {
			const { inputs, modal, window } = browser({}, false);
			inputs.title.value = inputs.desc.value = term;
			modal.buttons[0].onSelect({ preventDefault() {} });
			const query = initializeScheduleQuery(Object.fromEntries(new URLSearchParams(window.location.hash.slice('!/search/top/'.length, -1))));
			assert.equal(query.title, term);
			assert.equal(query.desc, term);
		}
	});

	it('still decodes titles and descriptions in legacy double-encoded schedule bookmarks', function() {
		const query = initializeScheduleQuery(Object.fromEntries(new URLSearchParams('skip=1&title=%25E7%2595%25AA%25E7%25B5%2584&desc=%252F')));
		assert.equal(query.title, '番組');
		assert.equal(query.desc, '/');
	});

	for (const recorded of [false, true]) {
		it('filters rendered results by the selected channels for ' + (recorded ? 'recorded' : 'schedule'), function() {
			const { window } = browser({}, recorded);
			const programs = ['gr1', 'gr2', 'bs1'].map((id, index) => ({
				id, channel: { id, name: id, type: id.startsWith('gr') ? 'GR' : 'BS' },
				title: '番組', fullTitle: '番組', category: 'news',
				start: Date.now() + index * 60000, end: Date.now() + 3600000, seconds: 3600
			}));
			let definition, rows;
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/' + (recorded ? 'recorded/search' : 'search/top') + '.js'), 'utf8'), {
				Chinachu: { definePage(value) { definition = value; }, escapeHTML: String },
				ChinachuSearchForm: window.ChinachuSearchForm,
				ChinachuPreferences: { get: () => false, getDescriptionFontSize: () => '12px' },
				chinachu: { dateToString: String },
				global: { chinachu: { status: {}, recorded: programs, schedule: [{ programs }] } }
			});
			const page = { self: { query: { channels: 'gr1,bs1' } }, grid: { splice(start, count, result) { rows = result; } } };
			definition.drawMain.call(page);
			assert.deepEqual(Array.from(rows, row => row.data.id), ['gr1', 'bs1']);
			page.self.query.channels = '';
			definition.drawMain.call(page);
			assert.equal(rows.length, 3);
		});

		it('selects multiple stations, restores legacy IDs and clears channel filters for ' + (recorded ? 'recorded' : 'schedule'), function() {
			const stations = [
				{ id: 'gr1', name: '総合', type: 'GR', channel: '27', sid: 101 },
				{ id: 'bs1', name: 'BS局', type: 'BS', channel: 'BS09_0', sid: 211 }
			];
			const ui = browser({ chid: 'gr1' }, recorded, {
				schedule: recorded ? [] : stations,
				recorded: stations.map(channel => ({ channel }))
			});
			assert.deepEqual(Array.from(ui.channelSelector.getValues()), ['gr1']);
			assert.match(ui.channelSelector.textContent, /総合/);
			const picker = ui.channelSelector.children.find(el => el.className === 'channel-selector-picker');
			picker.open = true;
			picker.handlers.toggle();
			function all(node) { return [node, ...node.children.flatMap(all)]; }
			const checkbox = all(picker).filter(el => el.type === 'checkbox')[1];
			checkbox.checked = true;
			checkbox.handlers.change({ stopPropagation() {} });
			ui.modal.buttons[0].onSelect();
			const query = Object.fromEntries(new URLSearchParams(ui.window.location.hash.split('/')[3]));
			assert.equal(query.channels, 'gr1,bs1');
			assert.equal(query.chid, undefined);
			const reopened = browser(query, recorded);
			assert.deepEqual(Array.from(reopened.channelSelector.getValues()), ['gr1', 'bs1']);
			reopened.channelSelector.setValues([]);
			reopened.modal.buttons[0].onSelect();
			assert.match(reopened.window.location.hash, /channels=&/);
		});
		it('preserves blank filters, literal query characters and resets old pages for ' + (recorded ? 'recorded' : 'schedule') + ' searches', function() {
			const { inputs, modal, window } = browser({ cat: 'anime', type: 'BS', title: '以前', page: '9' }, recorded);
			assert.equal(inputs.cat.children[0].value, '');
			assert.equal(inputs.type.children[0].value, '');
			inputs.cat.value = inputs.type.value = '';
			inputs.title.value = '日本語 & 100% / (字幕)';
			inputs.desc.value = '番組 + 説明';
			modal.buttons[0].onSelect({ preventDefault() {} });
			const route = recorded ? '!/recorded/search/' : '!/search/top/';
			assert.ok(window.location.hash.startsWith(route));
			const query = new URLSearchParams(window.location.hash.slice(route.length, -1));
			assert.equal(query.get('title'), inputs.title.value);
			assert.equal(query.get('desc'), inputs.desc.value);
			assert.equal(query.get('cat'), '');
			assert.equal(query.get('type'), '');
			assert.equal(query.get('skip'), '1');
			assert.equal(query.has('page'), false);
			assert.equal(modal.closed, true);
		});
	}

	it('shows each station once in recorded search alias labels despite repeated recordings', function() {
		const main = { id: 'gr1', name: '総合', type: 'GR', channel: '27', sid: 101 };
		const sub = { id: 'gr2', name: '総合サブ', type: 'GR', channel: '27', sid: 102 };
		const ui = browser({}, true, {
			schedule: [main],
			recorded: [main, main, main, sub, sub].map(channel => ({ channel: { ...channel } }))
		});
		for (const [value, label] of [
			['GR_101', 'GR_101（[GR] 総合）'],
			['27', '27（[GR] 総合 / [GR] 総合サブ）'],
			['GR_102', 'GR_102（[GR] 総合サブ）']
		]) {
			ui.channelSelector.setValues([value]);
			const selected = ui.channelSelector.children[0];
			assert.equal(selected.children[0].children[0].textContent, label);
			assert.deepEqual(Array.from(ui.channelSelector.getValues()), [value]);
		}
	});

	it('matches selected IDs, physical channels and service aliases while preserving old exact-ID URLs', function() {
		const { window } = browser({}, false);
		const matches = window.ChinachuSearchForm.matchesChannel;
		const channel = { id: 'gr1', type: 'GR', channel: '27', sid: 101 };
		for (const channels of ['', 'gr1,bs1', '27', 'GR_101']) assert.equal(matches({ channels }, channel), true);
		for (const channels of ['bs1,gr2', '28', 'GR_102']) assert.equal(matches({ channels }, channel), false);
		assert.equal(matches({ chid: 'gr1' }, channel), true);
		assert.equal(matches({ chid: '27' }, channel), false);
		assert.equal(matches({ channels: '', chid: 'old' }, channel), true);
	});

	it('validates expressions before navigation and submits through the native form', function() {
		const { inputs, form, modal, window } = browser({}, false);
		inputs.title.value = '[';
		form.handlers.submit({ preventDefault() {} });
		assert.equal(window.location.hash, '');
		assert.ok(inputs.title.validationMessage);
		assert.equal(modal.closed, undefined);
		inputs.title.value = '正しい条件';
		form.handlers.submit({ preventDefault() {} });
		assert.equal(inputs.title.validationMessage, '');
		assert.ok(window.location.hash.includes('skip=1'));
		assert.ok(form.children.some(element => element.type === 'submit'));
	});
});
