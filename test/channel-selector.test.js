'use strict';
const assert = require('node:assert/strict');
const selector = require('../web/channel-selector');

const channels = [
	{ id: 'gr1', name: 'ＮＨＫ総合', type: 'GR', channel: '27', sid: 101 },
	{ id: 'gr2', name: 'ＮＨＫ総合サブ', type: 'GR', channel: '27', sid: 102 },
	{ id: 'bs1', name: 'BS11', type: 'BS', channel: 'BS09_0', sid: 211 },
	{ id: 'cs1', name: '同名局', type: 'CS', channel: 'CS2', sid: 301 },
	{ id: 'cs2', name: '同名局', type: 'CS', channel: 'CS2', sid: 302 }
];

// Small DOM fixture; the selector uses native controls and no global listeners.
function control(options = {}) {
	class Node {
		constructor(tag, doc) {
			this.tagName = tag;
			this.ownerDocument = doc;
			this.children = [];
			this.handlers = {};
			this.attributes = {};
			this.value = '';
			this.classList = { add: name => { this.className = name; } };
		}
		set textContent(text) { this.text = text; this.children = []; }
		get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
		appendChild(node) { this.children.push(node); node.parent = this; }
		setAttribute(key, value) { this.attributes[key] = value; }
		addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
		dispatchEvent(event) { (this.handlers[event.type] || []).forEach(handler => handler(event)); }
		focus() { this.ownerDocument.activeElement = this; }
	}
	const doc = {
		createElement: tag => new Node(tag, doc),
		defaultView: { Event: class { constructor(type) { this.type = type; } } }
	};
	const root = selector.create({ element: doc.createElement('div'), getChannels: () => channels, ...options });
	function all(node = root) { return [node, ...node.children.flatMap(child => all(child))]; }
	function find(predicate) { return all().find(predicate); }
	function emit(node, type, extra = {}) {
		node.dispatchEvent({ type, stopPropagation() {}, preventDefault() {}, ...extra });
	}
	const picker = find(node => node.className === 'channel-selector-picker');
	picker.open = true;
	emit(picker, 'toggle');
	return { root, doc, all, find, emit, picker };
}

describe('rule channel selector', function() {
	it('shows station names and disambiguates stations with identical names', function() {
		assert.equal(selector.format('gr1', channels), '[GR] ＮＨＫ総合');
		assert.equal(selector.format('cs1', channels), '[CS] 同名局 (SID 301 / cs1)');
		assert.equal(selector.format('cs2', channels), '[CS] 同名局 (SID 302 / cs2)');
		assert.equal(selector.format('removed-channel', channels), 'removed-channel');
		assert.equal(selector.format('gr1'), 'gr1');
	});
	it('labels physical channels and type/SID aliases without reducing their scope', function() {
		assert.equal(selector.format('27', channels), '27（[GR] ＮＨＫ総合 / [GR] ＮＨＫ総合サブ）');
		assert.equal(selector.format('BS_211', channels), 'BS_211（[BS] BS11）');
		const ui = control();
		const original = ['27', 'BS_211', 'removed-channel'];
		ui.root.setValues(original);
		original.push('gr1');
		assert.deepEqual(ui.root.getValues(), ['27', 'BS_211', 'removed-channel']);
		ui.root.getValues().pop();
		assert.deepEqual(ui.root.getValues(), ['27', 'BS_211', 'removed-channel']);
	});
	it('searches names regardless of case or character width and combines the wave filter', function() {
		const ui = control();
		const search = ui.find(node => node.type === 'search');
		const wave = ui.find(node => node.tagName === 'select');
		search.value = 'nhk';
		ui.emit(search, 'input');
		assert.equal(ui.all().filter(node => node.type === 'checkbox').length, 2);
		wave.value = 'BS';
		ui.emit(wave, 'change');
		assert.match(ui.root.textContent, /該当するチャンネルはありません/);
		search.value = 'ｂｓ１１';
		ui.emit(search, 'input');
		assert.equal(ui.all().filter(node => node.type === 'checkbox').length, 1);
	});
	it('stores selected IDs, keeps selections across filters and removes individual selections', function() {
		const ui = control();
		let changes = 0;
		ui.root.addEventListener('change', () => changes++);
		const checkbox = ui.all().filter(node => node.type === 'checkbox')[0];
		checkbox.checked = true;
		ui.emit(checkbox, 'change');
		const search = ui.find(node => node.type === 'search');
		search.value = 'BS11';
		ui.emit(search, 'input');
		const bs = ui.find(node => node.type === 'checkbox');
		bs.checked = true;
		ui.emit(bs, 'change');
		assert.deepEqual(ui.root.getValues(), ['gr1', 'bs1']);
		assert.match(ui.root.textContent, /\[GR\] ＮＨＫ総合/);
		ui.emit(ui.find(node => node.attributes['aria-label'] === '[GR] ＮＨＫ総合を解除'), 'click');
		assert.deepEqual(ui.root.getValues(), ['bs1']);
		assert.equal(changes, 3);
	});
	it('keeps unknown legacy values, deduplicates manual additions and respects disabled state', function() {
		const ui = control({ emptyText: '除外なし' });
		assert.match(ui.root.textContent, /除外なし/);
		ui.root.setValues(['unknown', 'unknown']);
		const raw = ui.find(node => node.attributes['aria-label'] === 'ID・物理CH');
		const add = ui.find(node => node.tagName === 'button' && node.textContent === '追加');
		for (const value of ['27', '27']) { raw.value = value; ui.emit(add, 'click'); }
		assert.deepEqual(ui.root.getValues(), ['unknown', '27']);
		raw.value = '<script>';
		ui.emit(add, 'click');
		assert.match(ui.root.textContent, /半角英数字/);
		assert.deepEqual(ui.root.getValues(), ['unknown', '27']);
		ui.root.disable();
		assert.ok(ui.all().filter(node => ['button', 'select', 'input'].includes(node.tagName)).every(node => node.disabled));
		ui.emit(ui.find(node => node.textContent === '×'), 'click');
		assert.deepEqual(ui.root.getValues(), ['unknown', '27']);
		ui.root.enable();
		ui.emit(ui.find(node => node.textContent === '×'), 'click');
		assert.deepEqual(ui.root.getValues(), ['27']);
	});
	it('handles an empty schedule and reads fresh channels when the picker opens', function() {
		let current = [];
		const ui = control({ getChannels: () => current });
		ui.root.setValues(['bs1']);
		assert.match(ui.root.textContent, /チャンネル一覧がありません/);
		assert.deepEqual(ui.root.getValues(), ['bs1']);
		current = channels;
		ui.emit(ui.picker, 'toggle');
		assert.match(ui.root.textContent, /\[BS\] BS11/);
		assert.ok(ui.all().filter(node => node.type === 'checkbox')[2].checked);
	});
});
