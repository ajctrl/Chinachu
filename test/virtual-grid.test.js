'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sinon = require('sinon');

function implementation(timers = { setTimeout, clearTimeout }, Base = function() {}) {
	const context = vm.createContext({ window: timers, flagrate: { Grid: Base } });
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/virtual-grid.js'), 'utf8'), context);
	return context.window.ChinachuVirtualGrid;
}

describe('virtual list geometry and selection', function() {
	it('keeps the current viewport mounted until the scheduled refresh', function() {
		function Base() {}
		Base.prototype.splice = function(index, count, rows) {
			const removed = this._rows.splice(index, count === undefined ? this._rows.length - index : count, ...rows);
			this._requestRender();
			return removed;
		};
		const Grid = implementation(undefined, Base);
		const grid = Object.create(Grid.prototype);
		const current = { data: { id: 'one', start: 100 }, _tr: {} };
		const updated = { data: { id: 'one', start: 100, isSkip: true } };
		grid._rows = [current];
		grid._selectedRows = [];
		grid._mounted = new Set([current]);
		grid._heights = new Grid.Heights([61]);
		grid._keys = ['one:100:0'];
		grid._body = { scrollTop: 10, scrollLeft: 20 };
		grid._requestRender = sinon.spy();
		grid._unmount = sinon.spy();
		grid.splice(0, undefined, [updated]);
		assert.equal(grid._unmount.callCount, 0);
		assert.ok(grid._mounted.has(current));
		assert.strictEqual(grid._rows[0], updated);
		assert.equal(grid._requestRender.callCount, 1);
		assert.equal(grid._pendingAnchor.key, 'one:100:0');
		assert.equal(grid._pendingAnchor.offset, 10);
		assert.equal(grid._pendingAnchor.left, 20);
	});

	it('locates variable-height rows at boundaries and after height corrections', function() {
		const Grid = implementation();
		const values = Array.from({ length: 10000 }, (_, i) => 30 + i % 91);
		const heights = new Grid.Heights(values);
		for (let i = 0; i < values.length; i += 113) {
			values[i] = 145.5;
			heights.set(i, values[i]);
		}
		let sum = 0;
		values.forEach((height, index) => {
			assert.equal(heights.sum(index), sum);
			assert.equal(heights.at(sum), index);
			assert.equal(heights.at(sum + height - 0.01), index);
			sum += height;
		});
		assert.equal(heights.sum(values.length), sum);
		assert.equal(heights.at(sum + 100), values.length - 1);
		assert.equal(new Grid.Heights([]).at(0), 0);
		assert.equal(new Grid.Heights([]).sum(0), 0);
	});

	it('keeps selection on unmounted rows, without duplicates or accidental deselection', function() {
		const Grid = implementation();
		const grid = Object.create(Grid.prototype);
		grid._opt = { multiSelect: true };
		grid._rows = [{ data: 'first' }, { data: 'offscreen' }, { data: 'last' }];
		grid._selectedRows = [];
		grid.element = { fire() {} };
		let selected = 0, deselected = 0;
		grid.onSelect = () => selected++;
		grid.onDeselect = () => deselected++;
		grid.select(1);
		grid.select(1);
		grid.deselect(0);
		assert.equal(grid._selectedRows.length, 1);
		assert.equal(grid._selectedRows[0], grid._rows[1]);
		grid.select(grid._rows);
		assert.equal(grid._selectedRows.length, 3);
		assert.equal(selected, 3);
		grid.deselect(grid._rows);
		assert.equal(grid._selectedRows.length, 0);
		assert.equal(deselected, 3);
	});

	it('restores the anchor by identity after insertions and clamps missing rows and offsets', function() {
		const Grid = implementation();
		const grid = Object.create(Grid.prototype);
		grid._rows = [{}, {}, {}];
		grid._heights = new Grid.Heights([30, 80, 40]);
		grid._keyIndexes = new Map([['first', 0], ['anchor', 1], ['last', 2]]);
		assert.equal(grid._anchorTop({ key: 'anchor', index: 0, offset: 20 }), 50);
		assert.equal(grid._anchorTop({ key: 'deleted', index: 50, offset: 100 }), 149);
		assert.equal(grid._anchorTop({ key: 'anchor', offset: -10 }), 30);
	});

	it('resynchronizes checkbox state after cancelled input activation and rapid toggles', function() {
		const clock = sinon.useFakeTimers();
		try {
			const Grid = implementation();
			const grid = Object.create(Grid.prototype);
			const checkbox = { checked: false, check() { this.checked = true; }, uncheck() { this.checked = false; } };
			const row = { _checkbox: checkbox };
			grid._opt = { multiSelect: true };
			grid._rows = [row];
			grid._selectedRows = [];
			grid.element = { fire() {} };
			grid.select(0);
			checkbox.checked = false; // Browser rollback after the click is cancelled.
			clock.tick(0);
			assert.equal(checkbox.checked, true);
			assert.equal(grid._selectedRows.length, 1);
			grid.deselect(0);
			checkbox.checked = true;
			clock.tick(0);
			assert.equal(checkbox.checked, false);
			assert.equal(grid._selectedRows.length, 0);
			grid.select(0);
			grid.deselect(0);
			assert.equal(clock.countTimers(), 1);
			clock.tick(0);
			assert.equal(checkbox.checked, false);
		} finally { clock.restore(); }
	});

	it('cancels pending checkbox synchronization when a row is unmounted', function() {
		const clock = sinon.useFakeTimers();
		try {
			const Grid = implementation();
			const grid = Object.create(Grid.prototype);
			const checkbox = { check: sinon.spy(), uncheck: sinon.spy() };
			const row = { cell: {}, isSelected: true, _checkbox: checkbox, _tr: { classList: { toggle() {} }, remove() {} } };
			grid._mounted = new Set([row]);
			grid._selectionStyle(row);
			assert.equal(clock.countTimers(), 1);
			grid._unmount(row);
			assert.equal(clock.countTimers(), 0);
			clock.tick(0);
			assert.equal(checkbox.check.callCount, 1);
			assert.equal(row._checkbox, undefined);
			assert.equal(row._selectionTimer, undefined);
		} finally { clock.restore(); }
	});
});
