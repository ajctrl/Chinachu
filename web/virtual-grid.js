/* Virtual rows for the list screens. Keep Flagrate's column layout and actions. */
(function (root) {
	'use strict';

	var Base = flagrate.Grid;
	var overscan = 300;

	// Prefix sums with O(log n) height updates and viewport lookups.
	function Heights(values) {
		this.values = values.slice();
		this.tree = new Array(values.length + 1).fill(0);
		for (var i = 1; i < this.tree.length; i++) {
			this.tree[i] += values[i - 1];
			var parent = i + (i & -i);
			if (parent < this.tree.length) this.tree[parent] += this.tree[i];
		}
	}
	Heights.prototype.sum = function (end) {
		var total = 0;
		for (var i = end; i > 0; i -= i & -i) total += this.tree[i];
		return total;
	};
	Heights.prototype.set = function (index, height) {
		var delta = height - this.values[index];
		this.values[index] = height;
		for (var i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
	};
	Heights.prototype.at = function (offset) {
		var index = 0, step = 1;
		while (step < this.tree.length) step *= 2;
		for (; step >= 1; step /= 2) {
			var next = index + step;
			if (next < this.tree.length && this.tree[next] <= offset) {
				offset -= this.tree[next];
				index = next;
			}
		}
		return Math.min(index, Math.max(0, this.values.length - 1));
	};

	function VirtualGrid(options) {
		this._mounted = new Set();
		this._heights = new Heights([]);
		this._keys = [];
		this._keyIndexes = new Map();
		this._dirty = true;
		this._storageKey = 'chinachu.virtual-grid.' + options.stateKey;
		try { this._saved = JSON.parse(root.sessionStorage.getItem(this._storageKey)); } catch (e) { /* optional storage */ }
		if (!this._saved && options.legacyPage > 0) {
			this._saved = { index: Math.floor(options.legacyPage) * 20, offset: 0 };
		}
		options.pagination = false;
		options.fill = true;
		Base.call(this, options);
		this.element.addClassName('chinachu-virtual-grid');
		this._body.tabIndex = 0;
		this._topSpacer = this._spacer();
		this._bottomSpacer = this._spacer();
		this._paritySpacer = this._spacer();
		this._body.addEventListener('scroll', this._onScroll = this._requestRender.bind(this));
		root.addEventListener('resize', this._onResize = this._resize.bind(this));
		if (root.ResizeObserver) {
			this._observer = new root.ResizeObserver(this._requestRender.bind(this));
			this._observer.observe(this._body);
			this._cols.forEach(function (col) { this._observer.observe(col._th); }, this);
		}
	}
	VirtualGrid.prototype = Object.create(Base.prototype);
	VirtualGrid.prototype.constructor = VirtualGrid;
	VirtualGrid.Heights = Heights;

	VirtualGrid.prototype._spacer = function () {
		var row = document.createElement('tr');
		row.className = 'virtual-spacer';
		row.setAttribute('aria-hidden', 'true');
		// A cell per column preserves the fixed table's column widths, even when empty.
		if (this._checkbox) row.appendChild(document.createElement('td')).className = 'flagrate-grid-cell-checkbox';
		this._cols.forEach(function (col) {
			row.appendChild(document.createElement('td')).className = col._id;
		});
		row.appendChild(document.createElement('td')).className = this._id + '-col-last';
		return row;
	};
	VirtualGrid.prototype._requestRender = function () {
		if (this._disposed || this._frame) return this;
		this._frame = root.requestAnimationFrame(function () {
			this._frame = null;
			this._render();
		}.bind(this));
		return this;
	};
	VirtualGrid.prototype._anchor = function () {
		var index = this._heights.at(this._body.scrollTop);
		return {
			key: this._keys[index], index: index,
			offset: this._body.scrollTop - this._heights.sum(index),
			left: this._body.scrollLeft,
			sort: this._sortedByKey, ascending: this._sortedByAsc
		};
	};
	VirtualGrid.prototype._anchorTop = function (anchor) {
		var index = this._keyIndexes.has(anchor.key) ? this._keyIndexes.get(anchor.key) : (anchor.index || 0);
		index = Math.max(0, Math.min(index, this._rows.length - 1));
		return this._heights.sum(index) + Math.max(0, Math.min(anchor.offset || 0, (this._heights.values[index] || 1) - 1));
	};
	VirtualGrid.prototype._resize = function () {
		this._pendingAnchor = this._pendingAnchor || this._anchor();
		this._rows.forEach(function (row) { delete row._virtualHeight; });
		this._dirty = true;
		this._requestRender();
	};
	VirtualGrid.prototype.sort = function (key, ascending) {
		this._pendingAnchor = { index: 0, offset: 0, left: this._body.scrollLeft };
		this._dirty = true;
		return Base.prototype.sort.call(this, key, ascending);
	};
	VirtualGrid.prototype.splice = function (index, count, rows) {
		var anchor = this._pendingAnchor || this._saved || this._anchor();
		// Keep the current rows mounted until the next render. Removing them here
		// leaves the viewport empty for a frame whenever the data is refreshed.
		// _render() removes the old row objects before mounting the new visible set.
		var removed = Base.prototype.splice.call(this, index, count, rows);
		var removedSet = new Set(removed);
		this._selectedRows = this._selectedRows.filter(function (row) { return !removedSet.has(row); });
		if (this._checkbox && !this._selectedRows.length) this._checkbox.uncheck();
		if (this._saved && this._rows.length) {
			if (this._cols.some(function (col) { return col.key === this._saved.sort; }, this)) {
				Base.prototype.sort.call(this, this._saved.sort, this._saved.ascending);
			}
			this._saved = null;
		}
		this._pendingAnchor = anchor;
		this._dirty = true;
		return removed;
	};

	// Flagrate's selection methods depend on mounted DOM and can duplicate selected
	// rows. Store selection on the model so select-all also includes unmounted rows.
	VirtualGrid.prototype._select = function (selected, args) {
		var rows = Array.isArray(args[0]) ? args[0] : Array.prototype.slice.call(args);
		if (selected && !this._opt.multiSelect) this.deselectAll();
		rows.forEach(function (row) {
			if (typeof row === 'number') row = this._rows[row];
			if (!row || !!row.isSelected === selected) return;
			row.isSelected = selected;
			if (selected) this._selectedRows.push(row);
			else {
				var index = this._selectedRows.indexOf(row);
				if (index !== -1) this._selectedRows.splice(index, 1);
			}
			this._selectionStyle(row);
			var callback = selected ? 'onSelect' : 'onDeselect';
			if (row[callback]) row[callback].call(this, root.event, row, this);
			if (this[callback]) this[callback](root.event, row, this);
		}, this);
		if (this._checkbox) this._checkbox[this._selectedRows.length ? 'check' : 'uncheck']();
		this.element.fire('change', { targetGrid: this });
		return this;
	};
	VirtualGrid.prototype.select = function () { return this._select(true, arguments); };
	VirtualGrid.prototype.deselect = function () { return this._select(false, arguments); };
	VirtualGrid.prototype._selectionStyle = function (row) {
		if (row._tr) row._tr.classList.toggle('flagrate-grid-row-selected', !!row.isSelected);
		root.clearTimeout(row._selectionTimer);
		if (row._checkbox) {
			row._checkbox[row.isSelected ? 'check' : 'uncheck']();
			// The inherited click handler cancels the input's default action, which
			// rolls back checked after dispatch (including Space-key activation).
			row._selectionTimer = root.setTimeout(function () {
				delete row._selectionTimer;
				if (!this._disposed && row._checkbox) {
					row._checkbox[row.isSelected ? 'check' : 'uncheck']();
				}
			}.bind(this), 0);
		}
	};

	VirtualGrid.prototype._mount = function (row) {
		row._grid = this;
		row._tr = flagrate.createElement('tr', row.attribute || {});
		if (row.id) row._tr.id = row.id;
		if (row.className) row._tr.className = row.className;
		if (row.style) row._tr.setStyle(row.style);
		if (!this._opt.disableSelect) row._tr.addClassName('flagrate-grid-row-selectable');
		if (row.onClick || this.onClick) row._tr.addClassName('flagrate-grid-row-clickable');
		row._tr.onclick = this._createRowOnClickHandler(row);
		row._tr.ondblclick = this._createRowOnDblClickHandler(row);
		if (this._checkbox) {
			row._checkbox = flagrate.createCheckbox({ onChange: this._createRowOnCheckHandler(row) });
			row._checkbox.insertTo(flagrate.createElement('td', { 'class': 'flagrate-grid-cell-checkbox' }).insertTo(row._tr));
		}
		this._selectionStyle(row);
		this._cols.forEach(function (col) {
			var cell = row.cell[col.key];
			if (!cell || typeof cell !== 'object') cell = row.cell[col.key] = { text: cell == null ? '' : cell };
			cell._td = flagrate.createElement('td', cell.attribute || {}).insertTo(row._tr);
			cell._td.className = col._id + ' ' + (cell.className || '');
			if (cell.id) cell._td.id = cell.id;
			if (cell.style) cell._td.setStyle(cell.style);
			if (col.align) cell._td.style.textAlign = col.align;
			cell._div = flagrate.createElement('div').insertTo(cell._td);
			if (cell.text !== undefined) cell._div.updateText(cell.text);
			if (cell.html) cell._div.update(cell.html);
			if (cell.element) cell._div.update(cell.element);
			if (cell.createElement) {
				cell._content = cell.createElement();
				cell._div.update(cell._content.entity);
			}
			if (cell.icon) {
				cell._div.addClassName('flagrate-icon');
				cell._div.style.backgroundImage = 'url(' + cell.icon + ')';
			}
			if (cell.onClick) {
				cell._td.addClassName('flagrate-grid-cell-clickable');
				cell._td.onclick = this._createCellOnClickHandler(cell);
			}
			if (cell.onDblClick) cell._td.ondblclick = this._createCellOnDblClickHandler(cell);
			if (cell.postProcess) cell.postProcess.call(this, cell._td, cell, this);
		}, this);
		row._last = flagrate.createElement('td', { 'class': this._id + '-col-last' }).insertTo(row._tr);
		if (row.menuItems) this._updateRowMenu(row, row.menuItems);
		if (row.postProcess) row.postProcess.call(this, row._tr, row, this);
		if (this.postProcessOfRow) this.postProcessOfRow(row._tr, row, this);
		this._mounted.add(row);
		if (this._observer) this._observer.observe(row._tr);
	};
	VirtualGrid.prototype._unmount = function (row) {
		root.clearTimeout(row._selectionTimer);
		delete row._selectionTimer;
		if (this._observer) this._observer.unobserve(row._tr);
		if (row._menu) row._menu.remove();
		Object.keys(row.cell).forEach(function (key) {
			var cell = row.cell[key];
			if (!cell || typeof cell !== 'object') return;
			if (cell._content) cell._content.remove();
			delete cell._content;
			delete cell._td;
			delete cell._div;
		});
		row._tr.remove();
		delete row._tr;
		delete row._checkbox;
		delete row._last;
		delete row._menu;
		delete row._grid;
		this._mounted.delete(row);
	};

	VirtualGrid.prototype._render = function () {
		if (this._disposed || !this._topSpacer) return this;
		if (this.onRender && this.onRender(this) === false) return this;
		var widths = this._cols.map(function (col) { return col._th.getBoundingClientRect().width; }).join(',');
		if (this._widths !== undefined && widths !== this._widths) this._resize();
		this._widths = widths;
		if (this._dirty) {
			this._keyIndexes.clear();
			var occurrences = new Map();
			this._keys = this._rows.map(function (row, index) {
				var identity = row.data && row.data.id !== undefined ? row.data.id + ':' + row.data.start : JSON.stringify(row.data);
				var occurrence = occurrences.get(identity) || 0;
				occurrences.set(identity, occurrence + 1);
				var key = identity + ':' + occurrence;
				this._keyIndexes.set(key, index);
				return key;
			}, this);
			this._heights = new Heights(this._rows.map(function (row) {
				return row._virtualHeight || (/reserve-description-row/.test(row.className) ? 100 : 30);
			}));
			this._dirty = false;
		}
		var anchor = this._pendingAnchor || this._anchor();
		var top = this._pendingAnchor ? this._anchorTop(anchor) : this._body.scrollTop;
		var viewport = this._body.clientHeight || 600;
		top = Math.max(0, Math.min(top, this._heights.sum(this._rows.length) - viewport));
		var from = this._heights.at(Math.max(0, top - overscan));
		var to = this._rows.length ? this._heights.at(top + viewport + overscan) + 1 : 0;
		var visible = new Set(this._rows.slice(from, to));
		this._mounted.forEach(function (row) { if (!visible.has(row)) this._unmount(row); }, this);
		this._tbody.insertBefore(this._topSpacer, this._tbody.firstChild);
		this._tbody.appendChild(this._bottomSpacer);
		// Keep nth-child striping aligned with the row's index in the full list.
		if (from % 2 === 0) this._tbody.insertBefore(this._paritySpacer, this._topSpacer);
		else if (this._paritySpacer.parentNode) this._paritySpacer.remove();
		var cursor = this._topSpacer.nextSibling;
		for (var i = from; i < to; i++) {
			var row = this._rows[i];
			if (!row._tr) this._mount(row);
			if (cursor !== row._tr) this._tbody.insertBefore(row._tr, cursor);
			cursor = row._tr.nextSibling;
			row._tr.setAttribute('aria-rowindex', i + 2);
		}
		this._tbody.parentNode.setAttribute('aria-rowcount', this._rows.length + 1);
		var changed = false;
		for (var j = from; j < to; j++) {
			var height = this._rows[j]._tr.getBoundingClientRect().height;
			if (height > 0 && Math.abs(height - this._heights.values[j]) > 0.1) {
				this._rows[j]._virtualHeight = height;
				this._heights.set(j, height);
				changed = true;
			}
		}
		this._topSpacer.firstChild.style.height = this._heights.sum(from) + 'px';
		this._bottomSpacer.firstChild.style.height = (this._heights.sum(this._rows.length) - this._heights.sum(to)) + 'px';
		// Removing old rows can temporarily shrink scrollHeight and clamp scrollTop.
		this._body.scrollTop = this._pendingAnchor || changed ? this._anchorTop(anchor) : top;
		if (anchor.left !== undefined) this._body.scrollLeft = anchor.left;
		this._pendingAnchor = null;
		this._head.style.right = (this._body.offsetWidth - this._body.clientWidth) + 'px';
		this._head.scrollLeft = this._body.scrollLeft;
		this._requestUpdateLayout();
		if (changed) this._requestRender();
		if (this.onRendered) this.onRendered(this);
		return this;
	};
	VirtualGrid.prototype.destroy = function () {
		if (this._disposed) return;
		try { root.sessionStorage.setItem(this._storageKey, JSON.stringify(this._anchor())); } catch (e) { /* optional storage */ }
		this._disposed = true;
		root.cancelAnimationFrame(this._frame);
		clearTimeout(this._renderTimer);
		clearTimeout(this._layoutTimer);
		clearInterval(this._layoutInterval);
		this._body.removeEventListener('scroll', this._onScroll);
		this._body.onscroll = null;
		root.removeEventListener('resize', this._onResize);
		if (this._observer) this._observer.disconnect();
		this._mounted.forEach(this._unmount.bind(this));
	};
	root.ChinachuVirtualGrid = VirtualGrid;
}(window));
