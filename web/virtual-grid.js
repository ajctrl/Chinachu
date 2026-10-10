/* Chinachu's list model backed by Tabulator's virtual renderer. */
(function(root) {
	'use strict';

	function Grid(options) {
		this._opt = options;
		this._scope = root.Chinachu && root.Chinachu.scope;
		this._rows = [];
		this._selectedRows = [];
		this._renderedModels = new Set();
		this._storageKey = 'chinachu.virtual-grid.' + options.stateKey;
		this.element = document.createElement('div');
		this.element.className = 'chinachu-virtual-grid';
		this.element.setAttribute('aria-label', '番組・ルール一覧');
		try { this._saved = JSON.parse(root.sessionStorage.getItem(this._storageKey)); } catch (error) { /* Storage is optional. */ }
		if (!this._saved && options.legacyPage > 0) this._saved = { index: Math.floor(options.legacyPage) * 20 };
		this.onSelect = options.onSelect;
		this.onDeselect = options.onDeselect;
	}
	Object.defineProperty(Grid.prototype, 'rows', { get: function() { return this._rows; } });
	Grid.prototype.insertTo = function(parent) {
		(parent.entity || parent).appendChild(this.element);
		this._build();
		return this;
	};
	Grid.prototype._columns = function() {
		var grid = this;
		var options = this._opt;
		var primary = options.cols.find(function(column) { return column.key === 'title' || column.key === 'reserve_titles'; }) || options.cols[0];
		var columns = options.cols.map(function(column) {
			return {
				title: column.label,
				field: column.key, width: column.width, minWidth: column.width || 128,
				visible: !grid._compact || column === primary,
				responsive: column === primary ? 0 : column.key === 'channel' || column.key === 'datetime' ? 1 : 2,
				headerSort: !column.disableSort, resizable: !column.disableResize,
				hozAlign: column.align || 'left', variableHeight: true,
				formatter: function(cell) {
					// Responsive collapse supplies a lightweight cell. Keep its snapshot
					// separate from the mounted cell and its DynamicTime lifecycle.
					return typeof cell.getField === 'function' ? grid._formatCell(cell, column) : grid._formatCollapsedCell(cell, column);
				},
				sorter: function(a, b) {
					if (typeof a === 'number' && typeof b === 'number') return a - b;
					return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'ja', { numeric: true });
				}
			};
		});
		if (!this._compact && options.responsiveLayout !== false) columns.unshift({
			title: '', field: '_collapse', width: 40, minWidth: 40, responsive: 0,
			headerSort: false, resizable: false, formatter: 'responsiveCollapse'
		});
		if (!options.disableSelect) columns.unshift({
			title: '', field: '_selection', width: 36, minWidth: 36, responsive: 0, headerSort: false, resizable: false,
			titleFormatter: function() {
				var checkbox = grid._selectAll = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.setAttribute('aria-label', 'すべて選択');
				checkbox.addEventListener('click', function(event) { event.stopPropagation(); });
				checkbox.addEventListener('change', function() { grid[checkbox.checked ? 'selectAll' : 'deselectAll'](); });
				return checkbox;
			},
			formatter: function(cell) {
				var model = cell.getRow().getData()._model;
				var checkbox = model._checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = !!model.isSelected;
				checkbox.setAttribute('aria-label', '行を選択');
				checkbox.addEventListener('click', function(event) { event.stopPropagation(); });
				checkbox.addEventListener('change', function() { grid[checkbox.checked ? 'select' : 'deselect'](model); });
				return checkbox;
			}
		});
		if (options.disableSelect || this._compact && options.compactFormatter) columns.push({
			title: '', field: '_menu', width: 34, minWidth: 34, responsive: 0, headerSort: false, resizable: false,
			formatter: function(cell) {
				var model = cell.getRow().getData()._model;
				if (!model.menuItems || !model.menuItems.length) return '';
				var button = document.createElement('button');
				button.type = 'button';
				button.className = 'chinachu-grid-menu';
				button.textContent = '⋮';
				button.setAttribute('aria-label', options.compactFormatter ? 'ルールの操作' : '番組の操作');
				button.addEventListener('click', function(event) {
					event.stopPropagation();
					var rect = button.getBoundingClientRect();
					grid._showMenu({ clientX: rect.left, clientY: rect.bottom }, model);
				});
				return button;
			}
		});
		return columns;
	};
	Grid.prototype._isCompact = function() {
		var options = this._opt;
		if (options.compactWhenOverflow) {
			// Use the full table's minimum width, independent of the current layout.
			// Reserve scrollbar space to avoid switching back and forth as row heights change.
			var minimum = options.cols.reduce(function(width, column) { return width + (column.width || 128); }, 24);
			minimum += options.disableSelect ? 34 : 36;
			if (options.responsiveLayout !== false) minimum += 40;
			if (this.element.clientWidth < minimum) return true;
		}
		return this._opt.cols.some(function(column) { return column.key === 'title' || column.key === this._opt.compactColumn; }, this) &&
			!!root.matchMedia && root.matchMedia('(max-width: 800px)').matches;
	};
	Grid.prototype._updateCompactLayout = function(anchor) {
		if (this._compact === this._isCompact()) return false;
		if (this._resizeObserver) this._resizeObserver.disconnect();
		if (this._body) this._body.removeEventListener('scroll', this._onScroll);
		this._renderedModels.forEach(this._disposeModel.bind(this));
		this.table.destroy();
		this._ready = false;
		this._lastData = null;
		this._saved = this._pendingAnchor = anchor;
		this._build();
		return true;
	};
	Grid.prototype._build = function() {
		var grid = this, options = this._opt;
		this._compact = this._isCompact();
		var columns = this._columns();
		var initialSort = this._saved && options.cols.some(function(col) { return col.key === grid._saved.sort; }) ?
			[{ column: this._saved.sort, dir: this._saved.ascending === false ? 'desc' : 'asc' }] : [];
		// Capture the visible program before Tabulator remeasures wrapped cells on resize.
		if (root.ResizeObserver) {
			this._width = this.element.getBoundingClientRect().width;
			this._resizeObserver = new root.ResizeObserver(function() {
				var width = grid._body ? grid._body.clientWidth : grid.element.getBoundingClientRect().width;
				if (!grid._ready || grid._disposed || width === grid._width) return;
				grid._width = width;
				grid._resizeAnchor = grid._resizeAnchor || grid._anchor();
				if (grid._resizeFrame) return;
				grid._resizeFrame = root.requestAnimationFrame(function resize() {
					if (grid._rendering && !grid._disposed) {
						grid._resizeFrame = root.requestAnimationFrame(resize);
						return;
					}
					grid._resizeFrame = null;
					var anchor = grid._resizeAnchor;
					grid._resizeAnchor = null;
					if (!grid._disposed) {
						// Tabulator bases collapse thresholds on the header width. Match
						// the scrollable body so its scrollbar does not hide the last cell.
						grid._header.style.maxWidth = grid._body.clientWidth + 'px';
						if (grid._updateCompactLayout(anchor)) return;
						grid.table.redraw(true);
						grid._restore(anchor).catch(function(error) { console.error(error); });
					}
				});
			});
			this._resizeObserver.observe(this.element);
		}
		this.table = new root.Tabulator(this.element, {
			index: '_key', height: '100%', layout: 'fitColumns', renderVertical: 'virtual', renderVerticalBuffer: 300,
			headerVisible: !this._compact,
			responsiveLayout: this._compact || options.responsiveLayout === false ? false : 'collapse', responsiveLayoutCollapseStartOpen: false,
			responsiveLayoutCollapseFormatter: function(fields) { return grid._collapsedDetails(fields); },
			placeholder: '該当する項目がありません', columns: columns, data: [],
			selectableRows: false, initialSort: initialSort,
			rowFormatter: function(row) {
				var model = row.getData()._model;
				model._tr = row.getElement();
				(model._tr._chinachuClasses || []).forEach(function(name) { model._tr.classList.remove(name); });
				model._tr._chinachuClasses = (model.className || '').split(/\s+/).filter(Boolean);
				model._tr._chinachuClasses.forEach(function(name) { model._tr.classList.add(name); });
				if (model.attribute) Object.keys(model.attribute).forEach(function(name) { model._tr.setAttribute(name, model.attribute[name]); });
				grid._selectionStyle(model);
				grid._renderedModels.add(model);
			}
		});
		this.table.on('tableBuilt', function() {
			if (grid._disposed) { grid.table.destroy(); return; }
			grid._ready = true;
			grid._body = grid.element.querySelector('.tabulator-tableholder');
			grid._header = grid.element.querySelector('.tabulator-header');
			if (grid._resizeObserver) grid._resizeObserver.observe(grid._body);
			grid._body.tabIndex = 0;
			grid._body.addEventListener('scroll', grid._onScroll = function() { grid._closeMenu(); });
			grid._updateSelectionHeader();
			grid._queueRender();
		});
		this.table.on('rowClick', function(event, row) { grid._click(event, row.getData()._model, false); });
		this.table.on('rowDblClick', function(event, row) { grid._click(event, row.getData()._model, true); });
		['rowContext', 'rowTapHold'].forEach(function(name) {
			grid.table.on(name, function(event, row) { event.preventDefault(); grid._showMenu(event, row.getData()._model); });
		});
		this.table.on('renderComplete', function() { grid._syncContent(); });
		this.table.on('dataSorted', function(sorters) {
			if (sorters.length) { grid._sortedByKey = sorters[0].field; grid._sortedByAsc = sorters[0].dir === 'asc'; }
		});
	};
	Grid.prototype._showMenu = function(event, model) {
		this._closeMenu();
		if (!model.menuItems || !model.menuItems.length) return;
		this._menu = new root.ChinachuUI.ContextMenu({ items: model.menuItems });
		this._menu.open(event);
	};
	Grid.prototype._closeMenu = function() {
		if (this._menu) this._menu.remove();
		this._menu = null;
	};
	Grid.prototype._click = function(event, model, doubleClick) {
		if (event.target.closest && event.target.closest('a, button, input, select, wa-button, [role="button"], .tabulator-responsive-collapse')) return;
		if (!doubleClick && !this._opt.disableSelect) this[model.isSelected ? 'deselect' : 'select'](model);
		var callback = doubleClick ? 'onDblClick' : 'onClick';
		if (model[callback]) model[callback](event, model, this);
		if (this._opt[callback]) this._opt[callback](event, model, this);
	};
	Grid.prototype._formatCollapsedCell = function(component, column) {
		var model = component.getRow().getData()._model;
		var cell = model.cell[column.key];
		var content = document.createElement('div');
		if (!cell || typeof cell !== 'object') content.textContent = cell == null ? '' : cell;
		else if (cell.html !== undefined) content.innerHTML = cell.html;
		else if (cell.createElement) {
			// Clone a snapshot so collapsing never steals a live cell or retains
			// timers for a second copy of the same value.
			if (cell._div && cell._content) content.appendChild(cell._div.cloneNode(true));
			else {
				var view = cell.createElement();
				try { content.appendChild((view.entity || view).cloneNode(true)); }
				finally { view.remove(); }
			}
		} else if (cell.element) content.appendChild((cell.element.entity || cell.element).cloneNode(true));
		else content.textContent = cell.text == null ? '' : cell.text;
		return content;
	};
	Grid.prototype._compactSummary = function(content, model) {
		content.classList.add('chinachu-program-summary');
		var metadata = document.createElement('div');
		metadata.className = 'chinachu-program-metadata';
		var program = model.data || {}, channel = program.channel || {};
		var title = content.querySelector('.reserve-title');
		if (!title) {
			title = document.createElement('div');
			title.className = 'reserve-title';
			while (content.firstChild) title.appendChild(content.firstChild);
			content.appendChild(title);
		}
		var link = document.createElement('a');
		link.className = 'chinachu-program-title-link';
		link.href = '#!/program/view/id=' + encodeURIComponent(program.id) + '/';
		link.setAttribute('aria-label', '番組の詳細を見る：' + (program.title || '番組'));
		title.appendChild(link);
		var station = document.createElement('span');
		station.textContent = [channel.name || channel.id, channel.type].filter(Boolean).join(' · ');
		if (station.textContent) metadata.appendChild(station);
		if (model.cell.category) {
			var genre = this._formatCollapsedCell({ getRow: function() {
				return { getData: function() { return { _model: model }; } };
			} }, { key: 'category' });
			genre.className = 'chinachu-program-genre';
			metadata.appendChild(genre);
		}
		var start = new Date(program.start), end = new Date(program.end);
		function date(value) { return (value.getMonth() + 1) + '/' + value.getDate() + '(' + ['日', '月', '火', '水', '木', '金', '土'][value.getDay()] + ')'; }
		function time(value) { return String(value.getHours()).padStart(2, '0') + ':' + String(value.getMinutes()).padStart(2, '0'); }
		var timing = [];
		if (program.start != null && !isNaN(start.getTime())) {
			var range = date(start) + ' ' + time(start);
			if (program.end != null && !isNaN(end.getTime())) {
				range += '–' + (start.toDateString() === end.toDateString() ? '' : date(end) + ' ') + time(end);
			}
			timing.push(range);
		}
		if (typeof program.seconds === 'number' && isFinite(program.seconds)) timing.push(Math.round(program.seconds / 60 * 10) / 10 + '分');
		if (timing.length) {
			var broadcast = document.createElement('span');
			broadcast.textContent = timing.join(' · ');
			metadata.appendChild(broadcast);
		}
		content.insertBefore(metadata, content.querySelector('.reserve-description'));
		['matchedKeywords', 'excludedKeywords'].forEach(function(key) {
			var cell = model.cell[key];
			var text = cell && typeof cell === 'object' ? cell.text : cell;
			if (text == null || !String(text).trim()) return;
			var line = document.createElement('div');
			line.className = 'chinachu-program-keywords';
			line.textContent = (key === 'matchedKeywords' ? '該当キーワード：' : '除外キーワード：') + text;
			content.appendChild(line);
		});
	};
	Grid.prototype._collapsedDetails = function(fields) {
		if (!fields.length) return '';
		var list = document.createElement('dl');
		list.className = 'chinachu-grid-details';
		fields.forEach(function(field) {
			var label = document.createElement('dt');
			label.textContent = field.title;
			var value = document.createElement('dd');
			if (field.value && field.value.nodeType) value.appendChild(field.value);
			else value.textContent = field.value == null ? '' : field.value;
			list.appendChild(label);
			list.appendChild(value);
		});
		return list;
	};
	Grid.prototype._formatCell = function(component, column) {
		var model = component.getRow().getData()._model;
		if (this._compact && column.key === this._opt.compactColumn) return this._opt.compactFormatter(model);
		var cell = model.cell[column.key];
		if (!cell || typeof cell !== 'object') cell = model.cell[column.key] = { text: cell == null ? '' : cell };
		if (cell._content) { cell._content.remove(); delete cell._content; }
		var element = cell._td = component.getElement();
		if (cell.className) cell.className.split(/\s+/).filter(Boolean).forEach(function(name) { element.classList.add(name); });
		if (cell.attribute) Object.keys(cell.attribute).forEach(function(name) { element.setAttribute(name, cell.attribute[name]); });
		if (cell.style) Object.assign(element.style, cell.style);
		var content = cell._div = document.createElement('div');
		if (cell.html !== undefined) content.innerHTML = cell.html;
		else if (cell.element) content.appendChild(cell.element.entity || cell.element);
		else content.textContent = cell.text == null ? '' : cell.text;
		if (this._compact && column.key === 'title') this._compactSummary(content, model);
		if (cell.createElement) this._createContent(cell);
		if (cell.onClick) element.onclick = function(event) { cell.onClick(event, cell, this); }.bind(this);
		if (cell.postProcess) cell.postProcess(element, cell, this);
		return content;
	};
	Grid.prototype._createContent = function(cell) {
		cell._content = cell.createElement();
		cell._div.replaceChildren(cell._content.entity || cell._content);
	};
	Grid.prototype._syncContent = function() {
		this._renderedModels.forEach(function(model) {
			var mounted = model._tr && model._tr.isConnected;
			if (mounted) {
				var toggle = model._tr.querySelector('.tabulator-responsive-collapse-toggle');
				if (toggle && !toggle.hasAttribute('role')) {
					toggle.setAttribute('role', 'button');
					toggle.tabIndex = 0;
					toggle.setAttribute('aria-label', '行の追加情報');
					toggle.addEventListener('click', function() {
						toggle.setAttribute('aria-expanded', String(!toggle.classList.contains('open')));
					}, true);
					toggle.addEventListener('keydown', function(event) {
						if (event.key !== 'Enter' && event.key !== ' ') return;
						event.preventDefault();
						event.stopPropagation();
						toggle.click();
					});
				}
				if (toggle) toggle.setAttribute('aria-expanded', String(toggle.classList.contains('open')));
			}
			Object.keys(model.cell).forEach(function(key) {
				var cell = model.cell[key];
				if (!cell || !cell.createElement) return;
				if (!mounted && cell._content) { cell._content.remove(); delete cell._content; }
				if (mounted && !cell._content && cell._div) this._createContent(cell);
			}, this);
		}, this);
	};
	Grid.prototype._disposeModel = function(model) {
		Object.keys(model.cell || {}).forEach(function(key) {
			var cell = model.cell[key];
			if (cell && cell._content) { cell._content.remove(); delete cell._content; }
		});
		this._renderedModels.delete(model);
		delete model._tr;
		delete model._checkbox;
	};
	Grid.prototype._identity = function(model) {
		return model.data && model.data.id !== undefined ? model.data.id + ':' + model.data.start : JSON.stringify(model.data);
	};
	Grid.prototype._data = function() {
		var occurrences = new Map();
		return this._rows.map(function(model) {
			var identity = this._identity(model);
			var count = occurrences.get(identity) || 0;
			occurrences.set(identity, count + 1);
			model._key = identity + ':' + count;
			var data = { _key: model._key, _model: model };
			this._opt.cols.forEach(function(column) {
				var cell = model.cell[column.key];
				data[column.key] = cell && typeof cell === 'object' ?
					(cell.sortAlt !== undefined ? cell.sortAlt : cell.sortKey !== undefined ? cell.sortKey : cell.text || '') : cell || '';
			});
			return data;
		}, this);
	};
	Grid.prototype._anchor = function() {
		if (!this._ready) return this._saved || { index: 0 };
		var body = this._body;
		var top = body.getBoundingClientRect().top;
		var rows = this.table.getRows('visible');
		var row = rows.find(function(row) { return row.getElement().getBoundingClientRect().bottom > top; });
		var all = this.table.getRows('active');
		return {
			key: row && row.getData()._key, index: row ? all.indexOf(row) : 0,
			offset: row ? top - row.getElement().getBoundingClientRect().top : 0,
			left: body.scrollLeft, sort: this._sortedByKey, ascending: this._sortedByAsc
		};
	};
	Grid.prototype._restore = async function(anchor) {
		if (this._disposed || !this._rows.length || !anchor) return;
		var rows = this.table.getRows('active');
		var row = rows.find(function(row) { return row.getData()._key === anchor.key; }) || rows[Math.min(anchor.index || 0, rows.length - 1)];
		if (row) {
			await this.table.scrollToRow(row, 'top', false);
			if (this._disposed) return;
			// Variable-height rows can be remeasured during scrollToRow; correct its estimate from the mounted row.
			var rect = row.getElement().getBoundingClientRect();
			this._body.scrollTop += rect.top - this._body.getBoundingClientRect().top + Math.max(0, Math.min(anchor.offset || 0, rect.height - 1));
		}
		this._body.scrollLeft = anchor.left || 0;
	};
	Grid.prototype._queueRender = function() {
		if (!this._ready || this._disposed || this._frame || this._rendering) return;
		this._frame = root.requestAnimationFrame(function() {
			this._frame = null;
			this._render();
		}.bind(this));
	};
	Grid.prototype._render = async function() {
		if (this._disposed || !this._ready) return;
		this._rendering = true;
		var revision = this._revision;
		var anchor = this._pendingAnchor || this._saved || this._anchor();
		this._pendingAnchor = null;
		this._saved = null;
		try {
			var data = this._data();
			var previous = this._lastData || [];
			var sameOrder = data.length === previous.length && data.every(function(row, i) { return row._key === previous[i]._key; });
			var changed = sameOrder ? data.filter(function(row, i) { return row._model !== previous[i]._model; }) : data;
			// Keep unaffected DOM during small live updates. A settings change can replace every row;
			// use the linear full-data path instead of thousands of individual row lookups.
			if (sameOrder && changed.length <= Math.max(50, data.length / 10)) {
				if (changed.length) {
					changed.forEach(function(row) {
						var old = previous.find(function(item) { return item._key === row._key; });
						if (old) this._disposeModel(old._model);
					}, this);
					await this.table.updateData(changed);
					changed.forEach(function(row) {
						var component = this.table.getRow(row._key);
						if (component) {
							component.reformat();
						}
					}, this);
				}
			} else {
				previous.forEach(function(row) { this._disposeModel(row._model); }, this);
				await this.table.replaceData(data);
			}
			this._lastData = data;
			await this._restore(anchor);
			this._syncContent();
		} catch (error) {
			if (!this._disposed) console.error('一覧の更新に失敗しました', error);
		} finally {
			this._rendering = false;
			if (revision !== this._revision) this._queueRender();
		}
	};
	Grid.prototype.splice = function(index, count, rows) {
		this._closeMenu();
		this._pendingAnchor = this._pendingAnchor || this._saved || this._anchor();
		var removed = this._rows.splice.apply(this._rows, [index, count === undefined ? this._rows.length - index : count].concat(rows || []));
		this._selectedRows = this._selectedRows.filter(function(row) { return this._rows.indexOf(row) !== -1; }, this);
		this._updateSelectionHeader();
		this._revision = (this._revision || 0) + 1;
		this._queueRender();
		return removed;
	};
	Grid.prototype.sort = function(key, ascending) {
		this._sortedByKey = key;
		this._sortedByAsc = ascending !== false;
		if (this._ready) this.table.setSort(key, ascending === false ? 'desc' : 'asc');
		return this;
	};
	Grid.prototype._selectionStyle = function(row) {
		if (row._tr) row._tr.classList.toggle('tabulator-selected', !!row.isSelected);
		if (row._checkbox) row._checkbox.checked = !!row.isSelected;
	};
	Grid.prototype._updateSelectionHeader = function() {
		if (!this._selectAll) return;
		this._selectAll.checked = this._rows.length > 0 && this._selectedRows.length === this._rows.length;
		this._selectAll.indeterminate = this._selectedRows.length > 0 && !this._selectAll.checked;
	};
	Grid.prototype._select = function(selected, args) {
		var rows = Array.isArray(args[0]) ? args[0] : Array.prototype.slice.call(args);
		if (selected && !this._opt.multiSelect) this.deselectAll();
		rows.forEach(function(row) {
			if (typeof row === 'number') row = this._rows[row];
			if (!row || !!row.isSelected === selected) return;
			row.isSelected = selected;
			if (selected) this._selectedRows.push(row);
			else this._selectedRows = this._selectedRows.filter(function(item) { return item !== row; });
			this._selectionStyle(row);
			var callback = selected ? 'onSelect' : 'onDeselect';
			if (row[callback]) row[callback](undefined, row, this);
			if (this[callback]) this[callback](undefined, row, this);
		}, this);
		this._updateSelectionHeader();
		return this;
	};
	Grid.prototype.select = function() { return this._select(true, arguments); };
	Grid.prototype.deselect = function() { return this._select(false, arguments); };
	Grid.prototype.selectAll = function() { return this.select(this._rows); };
	Grid.prototype.deselectAll = function() { return this.deselect(this._selectedRows.slice()); };
	Grid.prototype.getSelectedRows = function() { return this._selectedRows.slice(); };
	Grid.prototype.destroy = function() {
		if (this._disposed) return;
		try { root.sessionStorage.setItem(this._storageKey, JSON.stringify(this._anchor())); } catch (error) { /* Storage is optional. */ }
		this._disposed = true;
		this._closeMenu();
		if (this._body) this._body.removeEventListener('scroll', this._onScroll);
		root.cancelAnimationFrame(this._frame);
		root.cancelAnimationFrame(this._resizeFrame);
		if (this._resizeObserver) this._resizeObserver.disconnect();
		this._renderedModels.forEach(this._disposeModel.bind(this));
		// Tabulator initializes on the next turn. Destroying it earlier would let that
		// pending initialization recreate DOM and listeners after the page has gone.
		if (this.table && this._ready) this.table.destroy();
	};
	// Tabulator dispatches outside page initialization. Restore the owning page
	// when actions create dialogs or requests, so navigation can clean them up.
	['_click', '_showMenu', '_select'].forEach(function(name) {
		var method = Grid.prototype[name];
		Grid.prototype[name] = function() {
			if (this._disposed || this._scope && this._scope._disposed) return;
			var args = arguments, grid = this;
			return root.Chinachu ? root.Chinachu.withScope(this._scope, function() { return method.apply(grid, args); }) : method.apply(this, args);
		};
	});
	root.ChinachuVirtualGrid = Grid;
}(window));
