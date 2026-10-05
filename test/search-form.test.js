'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser(query, recorded) {
	class Element {
		constructor(tag) { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ''; }
		appendChild(child) { this.children.push(child); return child; }
		addEventListener(name, handler) { this.handlers[name] = handler; }
		setCustomValidity(message) { this.validationMessage = message; }
		reportValidity() { return this.children.every(label => label.children.every(input => !input.validationMessage)); }
		focus() {}
	}
	let modal;
	const window = { location: { hash: '' } };
	const context = { window, document: { createElement: tag => new Element(tag) },
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
	return { window, modal, form, inputs, page };
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
