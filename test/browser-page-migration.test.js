'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(name, globals = {}) {
	let page;
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/', name + '.js'), 'utf8'), {
		Chinachu: { definePage(methods) { page = methods; } }, URL, clearTimeout, setTimeout, ...globals
	});
	return page;
}

class TextNode {
	constructor(text) { this.textContent = text; }
}
class ElementNode {
	constructor(tag) { this.tagName = tag; this.children = []; }
	appendChild(node) { this.children.push(node); return node; }
	set innerHTML(value) { throw new Error('Program text must not become HTML'); }
	get textContent() { return this.children.map(node => node.textContent).join(''); }
	set textContent(value) { this.children = [new TextNode(value)]; }
}

describe('program description links', function() {
	function render(text) {
		const page = loadPage('program/view', { document: {
			createElement: tag => new ElementNode(tag), createTextNode: text => new TextNode(text)
		} });
		const parent = new ElementNode('p');
		page.appendDescription(parent, text);
		return parent;
	}
	it('keeps markup and malicious URL attributes as text while linking HTTP URLs', function() {
		const text = '<img src=x onerror=alert(1)> https://example.test/" onclick="alert(1)';
		const rendered = render(text);
		assert.equal(rendered.textContent, text);
		const links = rendered.children.filter(node => node.tagName === 'a');
		assert.equal(links.length, 1);
		assert.equal(links[0].href, 'https://example.test/');
		assert.equal(links[0].rel, 'noopener noreferrer');
		assert.equal(links[0].onclick, undefined);
	});
	it('normalizes full-width HTTP URLs only for the destination and preserves the label', function() {
		const text = '説明 ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｔｅｓｔ／？ａ＝１＆ｂ＝２＂ onclick=x';
		const rendered = render(text);
		const link = rendered.children.find(node => node.tagName === 'a');
		assert.equal(rendered.textContent, text);
		assert.equal(link.href, 'https://example.test/?a=1&b=2');
		assert.equal(link.textContent, 'ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｔｅｓｔ／？ａ＝１＆ｂ＝２');
	});
	it('leaves unsupported schemes and malformed HTTP addresses as plain text', function() {
		const text = 'javascript:alert(1) data:text/html,<script> ｊａｖａｓｃｒｉｐｔ：alert(1) https://[invalid';
		const rendered = render(text);
		assert.equal(rendered.textContent, text);
		assert.equal(rendered.children.filter(node => node.tagName === 'a').length, 0);
	});
});

for (const pageName of ['schedule/table', 'schedule/timeline']) {
	describe(pageName + ' native pointer interaction', function() {
		function setup() {
			const handlers = new Map();
			let captured, opened = 0;
			const surface = {
				style: {}, addEventListener: (type, callback) => handlers.set(type, callback),
				removeEventListener: type => handlers.delete(type),
				setPointerCapture: id => { captured = id; }, hasPointerCapture: id => captured === id,
				releasePointerCapture: () => { captured = undefined; }
			};
			const page = loadPage(pageName);
			page.timer = {};
			page.data = { piece: { example: { program: { id: 'example' } } } };
			page.scroller = function() { this.data.scrollDelta = [0, 0]; };
			page.bindPointerEvents(surface, () => { opened++; });
			function dispatch(type, fields = {}) {
				const target = { closest: selector => selector === '[rel]' ? { getAttribute: () => 'example' } : null };
				handlers.get(type)({ type, target, pointerId: 1, button: 0, clientX: 0, clientY: 0, preventDefault() {}, ...fields });
			}
			return { page, surface, handlers, dispatch, opened: () => opened };
		}
		it('opens a program tapped at zero coordinates using mouse or touch pointers', function() {
			for (const pointerType of ['mouse', 'touch']) {
				const ui = setup();
				ui.dispatch('pointerdown', { pointerType });
				ui.dispatch('pointerup', { pointerType });
				assert.equal(ui.opened(), 1);
				assert.equal(ui.page.data.target.id, 'example');
				ui.page.pointerCleanup();
			}
		});
		it('ignores other pointers and does not open details after a drag or cancellation', function() {
			const ui = setup();
			ui.dispatch('pointerdown');
			ui.dispatch('pointerup', { pointerId: 2 });
			assert.equal(ui.opened(), 0);
			ui.dispatch('pointermove', { clientX: 40, clientY: 0 });
			assert.deepEqual(Array.from(ui.page.data.scrollEnd), [40, 0]);
			ui.dispatch('pointerup', { clientX: 40, clientY: 0 });
			assert.equal(ui.opened(), 0);
			ui.dispatch('pointerdown');
			ui.dispatch('pointercancel');
			assert.equal(ui.opened(), 0);
			ui.page.pointerCleanup();
			assert.equal(ui.handlers.size, 0);
		});
	});
}
