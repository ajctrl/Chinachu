'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function implementation() {
	const storage = new Map();
	const window = {
		sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
		requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}
	};
	const context = vm.createContext({ window, console, document: { createElement: () => ({
		setAttribute() {}, children: [], appendChild(node) { this.children.push(node); }
	}) } });
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/virtual-grid.js'), 'utf8'), context);
	return { Grid: window.ChinachuVirtualGrid, storage, window };
}
function model(id, start, text = id) { return { data: { id, start }, cell: { title: { text } } }; }
function grid() {
	const { Grid } = implementation();
	return new Grid({ stateKey: 'test', multiSelect: true, cols: [{ key: 'title' }] });
}

describe('Tabulator list adapter', function() {
	it('keeps selection on unmounted rows and supports select all without duplicate callbacks', function() {
		const view = grid();
		view.splice(0, undefined, [model('first', 1), model('offscreen', 2), model('last', 3)]);
		let selected = 0, deselected = 0;
		view.onSelect = () => selected++;
		view.onDeselect = () => deselected++;
		view.select(1);
		view.select(1);
		view.deselect(0);
		assert.equal(view.getSelectedRows().length, 1);
		assert.equal(view.getSelectedRows()[0], view.rows[1]);
		view.selectAll();
		assert.equal(view.getSelectedRows().length, 3);
		assert.equal(selected, 3);
		view.deselectAll();
		assert.equal(view.getSelectedRows().length, 0);
		assert.equal(deselected, 3);
	});

	it('discards selection of replaced rules while preserving selected rows that remain', function() {
		const view = grid();
		const rows = [model('one', 1), model('two', 2)];
		view.splice(0, undefined, rows);
		view.selectAll();
		view.splice(0, undefined, [model('one', 1), rows[1]]);
		assert.equal(view.getSelectedRows().length, 1);
		assert.equal(view.getSelectedRows()[0], rows[1]);
	});

	it('uses broadcast identity and occurrence for distinct stable keys and numeric sorting', function() {
		const view = grid();
		const first = model('one', 1);
		first.cell.title.sortAlt = 123;
		view.splice(0, undefined, [first, model('one', 2), model('one', 1)]);
		const data = view._data();
		assert.deepEqual(Array.from(data, item => item._key), ['one:1:0', 'one:2:0', 'one:1:1']);
		assert.equal(data[0].title, 123);
	});

	it('updates only changed models without replacing the table or unmounting unaffected rows', async function() {
		const view = grid();
		const first = model('one', 1), second = model('two', 2);
		view.splice(0, undefined, [first, second]);
		view._lastData = view._data();
		view._ready = true;
		view._pendingAnchor = { key: first._key };
		const changed = model('one', 1, 'updated');
		view._rows[0] = changed;
		let updates, reformatted = 0;
		view.table = {
			async updateData(data) { updates = data; },
			replaceData() { throw new Error('full replacement is unnecessary'); },
			getRow() { return { reformat() { reformatted++; } }; }
		};
		view._restore = async () => {};
		view._syncContent = () => {};
		await view._render();
		assert.equal(updates.length, 1);
		assert.equal(updates[0]._model, changed);
		assert.equal(reformatted, 1);
		assert.equal(view._lastData[1]._model, second);
	});

	it('restores a visible row by identity after insertion and corrects measured variable heights', async function() {
		const view = grid();
		view._rows = [model('new', 0), model('anchor', 1)];
		let requested;
		const row = {
			getData: () => ({ _key: 'anchor:1:0' }),
			getElement: () => ({ getBoundingClientRect: () => ({ top: 198, height: 110 }) })
		};
		view._body = { scrollTop: 2000, scrollLeft: 0, getBoundingClientRect: () => ({ top: 100 }) };
		view.table = { getRows: () => [row], async scrollToRow(target) { requested = target; } };
		await view._restore({ key: 'anchor:1:0', index: 0, offset: 25, left: 40 });
		assert.equal(requested, row);
		assert.equal(view._body.scrollTop, 2123);
		assert.equal(view._body.scrollLeft, 40);
	});

	it('preserves row callbacks and excludes buttons and links from row activation', function() {
		const view = grid();
		let clicks = 0, doubles = 0;
		view._opt.disableSelect = true;
		view._opt.onClick = () => clicks++;
		view._opt.onDblClick = () => doubles++;
		const row = model('one', 1);
		view._click({ target: { closest: () => true } }, row, false);
		view._click({ target: { closest: () => false } }, row, false);
		view._click({ target: { closest: () => false } }, row, true);
		assert.equal(clicks, 1);
		assert.equal(doubles, 1);
		assert.equal(view.getSelectedRows().length, 0);
	});

	it('does not select or activate a row when expanding its additional information', function() {
		const view = grid();
		let clicks = 0;
		view._opt.onClick = () => clicks++;
		view._opt.onDblClick = () => clicks++;
		const row = model('one', 1);
		for (const selector of ['[role="button"]', '.tabulator-responsive-collapse']) {
			const event = { target: { closest: candidates => candidates.split(', ').includes(selector) } };
			view._click(event, row, false);
			view._click(event, row, true);
		}
		assert.equal(clicks, 0);
		assert.equal(view.getSelectedRows().length, 0);
	});

	it('snapshots collapsed dynamic values without moving live content or leaking a new timer', function() {
		const view = grid(), row = model('one', 1);
		const snapshot = { textContent: '2026/10/08' };
		let cloned = 0, removed = 0;
		const dynamic = { entity: { cloneNode(deep) { assert.equal(deep, true); cloned++; return snapshot; } }, remove() { removed++; } };
		row.cell.datetime = { createElement: () => dynamic };
		const component = { getRow: () => ({ getData: () => ({ _model: row }) }) };
		const fallback = view._formatCollapsedCell(component, { key: 'datetime' });
		assert.equal(fallback.children[0], snapshot);
		assert.equal(removed, 1);
		assert.equal(row.cell.datetime._content, undefined);
		row.cell.datetime._content = dynamic;
		row.cell.datetime._div = dynamic.entity;
		const mounted = view._formatCollapsedCell(component, { key: 'datetime' });
		assert.equal(mounted.children[0], snapshot);
		assert.equal(row.cell.datetime._content, dynamic);
		assert.equal(cloned, 2);
		assert.equal(removed, 1);
		// A virtual row keeps its cell wrapper after its live content is removed.
		delete row.cell.datetime._content;
		view._formatCollapsedCell(component, { key: 'datetime' });
		assert.equal(removed, 2);
	});

	it('renders raw collapsed values and column labels as text instead of HTML', function() {
		const view = grid(), row = model('one', 1, '<img src=x onerror=alert(1)>');
		const value = view._formatCollapsedCell({ getRow: () => ({ getData: () => ({ _model: row }) }) }, { key: 'title' });
		assert.equal(value.textContent, row.cell.title.text);
		assert.equal(value.innerHTML, undefined);
		const list = view._collapsedDetails([{ title: '<b>タイトル</b>', value: row.cell.title.text }]);
		assert.equal(list.children[0].textContent, '<b>タイトル</b>');
		assert.equal(list.children[1].textContent, row.cell.title.text);
		assert.equal(list.children[1].innerHTML, undefined);
	});

	it('preserves selection, sort and scroll anchor while rebuilding across the compact breakpoint', function() {
		const view = grid(), row = model('one', 1);
		view.splice(0, undefined, [row]);
		view.select(row);
		let removed = 0, destroyed = 0, rebuilt = 0;
		row.cell.title._content = { remove() { removed++; } };
		view._renderedModels.add(row);
		view._compact = false;
		view._isCompact = () => true;
		view.table = { destroy() { destroyed++; } };
		view._build = () => { rebuilt++; view._compact = true; };
		const anchor = { key: 'one:1:0', offset: 17, sort: 'channel', ascending: false };
		assert.equal(view._updateCompactLayout(anchor), true);
		assert.equal(view._saved, anchor);
		assert.equal(view._pendingAnchor, anchor);
		assert.equal(view.getSelectedRows()[0], row);
		assert.equal(removed, 1);
		assert.equal(destroyed, 1);
		assert.equal(rebuilt, 1);
		assert.equal(view._updateCompactLayout(anchor), false);
	});

	it('includes both dates for overnight broadcasts and escapes channel metadata', function() {
		const view = grid(), row = model('overnight', new Date(2026, 9, 8, 23, 45).getTime());
		row.data.end = new Date(2026, 9, 9, 0, 15).getTime();
		row.data.seconds = 1800;
		row.data.channel = { name: '<img src=x>', type: 'GR' };
		let metadata;
		const description = {};
		const title = { children: [], appendChild(value) { this.children.push(value); } };
		view._compactSummary({ classList: { add() {} }, querySelector: selector => selector === '.reserve-description' ? description : title,
			insertBefore(value, before) { metadata = value; assert.equal(before, description); } }, row);
		assert.equal(title.children[0].className, 'chinachu-program-title-link');
		assert.equal(metadata.children[0].textContent, '<img src=x> · GR');
		assert.equal(metadata.children[0].innerHTML, undefined);
		assert.equal(metadata.children[1].textContent, '10/8(木) 23:45–10/9(金) 00:15 · 30分');
	});

	it('restores page scope for actions invoked by the table and ignores departed pages', function() {
		const env = implementation(), owner = { _disposed: false };
		env.window.Chinachu = { scope: owner, withScope(scope, fn) { const previous = this.scope; this.scope = scope; try { return fn(); } finally { this.scope = previous; } } };
		let observed, clicks = 0;
		const view = new env.Grid({ cols: [], disableSelect: true, onClick() { observed = env.window.Chinachu.scope; clicks++; } });
		env.window.Chinachu.scope = null;
		view._click({ target: { closest: () => false } }, model('one', 1));
		assert.equal(observed, owner);
		assert.equal(env.window.Chinachu.scope, null);
		owner._disposed = true;
		view._click({ target: { closest: () => false } }, model('one', 1));
		assert.equal(clicks, 1);
	});

	it('stops dynamic cell content and persists state when destroyed', function() {
		const { Grid, storage } = implementation();
		const view = new Grid({ stateKey: 'test', cols: [] });
		let removed = 0, destroyed = 0;
		const row = model('one', 1);
		row.cell.title._content = { remove() { removed++; } };
		view._renderedModels.add(row);
		view.table = { destroy() { destroyed++; } };
		view._ready = true;
		view._anchor = () => ({ key: 'one:1:0', index: 50, offset: 9, sort: 'title', ascending: false });
		view.destroy();
		view.destroy();
		assert.equal(removed, 1);
		assert.equal(destroyed, 1);
		assert.equal(JSON.parse(storage.get('chinachu.virtual-grid.test')).key, 'one:1:0');
	});
});
