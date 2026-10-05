Chinachu.definePage({

	init: function() {

		this.closed = false;
		this.view.content.className = 'loading';

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:reserves', this.onNotify);

		return this;
	}
	,
	deinit: function() {

		if (this.grid) this.grid.destroy();

		Chinachu.off(document, 'chinachu:reserves', this.onNotify);
		this.closed = true;
		this.descriptionSwitch.destroy();
		if (this.unsubscribeDescriptionFontSize) this.unsubscribeDescriptionFontSize();
		this.clearSkipNotice();

		return this;
	}
	,
	refresh: function() {

		this.drawMain();

		return this;
	}
	,
	initToolbar: function _initToolbar() {

		this.descriptionSwitch = ChinachuPreferences.createSwitch(this.refresh.bind(this));
		this.unsubscribeDescriptionFontSize = ChinachuPreferences.subscribeDescriptionFontSize(this.refresh.bind(this));
		var control = new ChinachuUI.ElementView({ tagName: 'span' });
		control.entity.appendChild(this.descriptionSwitch.element);
		this.view.toolbar.add({ key: 'show-description', ui: control });
		return this;
	}
	,
	updateToolbar: function() {

		if (!this.grid) return;

		var selected = this.grid.getSelectedRows();

		if (selected.length === 0) {

		} else if (selected.length === 1) {

		} else {

		}
	}
	,
	draw: function() {

		this.view.content.className = '';
		this.view.content.update();

		this.grid = new ChinachuVirtualGrid({
			multiSelect  : false,
			disableSelect: true,
			stateKey: 'reserves',
			legacyPage: parseInt(this.self.query.page, 10) || 0,
			fill         : true,
			cols: [
				{
					key: 'details', label: '詳細', width: 60, disableSort: true
				},
				{
					key  : 'type',
					label: '放送波',
					width: 45,
					align: 'center',
					disableResize: true
				},
				{
					key  : 'channel',
					label: 'チャンネル',
					width: 140
				},
				{
					key  : 'category',
					label: 'ジャンル',
					width: 70,
					align: 'center',
				},
				{
					key  : 'title',
					label: 'タイトル'
				},
				{
					key  : 'matchedKeywords',
					label: '一致キーワード',
					width: 160
				},
				{
					key  : 'excludedKeywords',
					label: '除外ルール',
					width: 160
				},
				{
					key  : 'datetime',
					label: '放送日時',
					width: 210
				},
				{
					key  : 'duration',
					label: '長さ',
					width: 60
				}
			],
			onClick: this.onRowClick.bind(this),
			onDblClick: this.onRowDoubleClick.bind(this)
		}).insertTo(this.view.content);

		this.drawMain();

		return this;
	}
	,
	onRowClick: function(event, row) {
		if (event.button && event.button !== 0) return;
		if (event.target && event.target.closest && event.target.closest('a, button, input, select, .chinachu-grid-menu')) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		if (ChinachuPreferences.getClickAction() !== 'skip') {
			window.location.href = '#!/program/view/id=' + row.data.id + '/';
			return;
		}
		if (event.detail > 1) return;
		this.manualUnskipClick = row.data.isManualReserved && row.data.isSkip ? row.data : null;
		if (row.data.isManualReserved && !row.data.isSkip) {
			if (!ChinachuReservationActions.isPending(row.data.id)) {
				this.showSkipNotice('手動予約をスキップするには、ダブルクリックしてください。', null, true);
			}
			return;
		}
		this.setProgramSkip(row.data, !row.data.isSkip);
	},
	onRowDoubleClick: function(event, row) {
		if (ChinachuPreferences.getClickAction() !== 'skip' || !row.data.isManualReserved || row.data.isSkip) return;
		if (event.button && event.button !== 0) return;
		if (event.target && event.target.closest && event.target.closest('a, button, input, select, .chinachu-grid-menu')) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		// A fast unskip response must not turn the same double click into a new skip.
		if (this.manualUnskipClick && this.manualUnskipClick.id === row.data.id && this.manualUnskipClick.start === row.data.start) return;
		this.setProgramSkip(row.data, true);
	},
	setProgramSkip: function(program, skip) {
		var current = global.chinachu.reserves.filter(function(item) { return item.id === program.id && item.start === program.start; })[0];
		if (!current) {
			this.showSkipNotice('この番組の予約が変更されています。一覧を確認してください。');
			return;
		}
		if (!!current.isSkip === skip) return;
		ChinachuReservationActions.setSkip(current, skip, function(result) {
			if (this.closed) return;
			if (!result.ok) {
				this.showSkipNotice('「' + program.title + '」の変更に失敗しました。' + (result.message || 'HTTP ' + result.status + '。一覧を確認して再操作してください。'));
				return;
			}
			this.showSkipNotice('「' + program.title + '」' + (skip ? 'をスキップしました。' : 'のスキップを解除しました。'), function() {
				this.setProgramSkip(program, !skip);
			}.bind(this));
		}.bind(this));
	},
	clearSkipNotice: function() {
		clearTimeout(this.skipNoticeTimer);
		this.skipNoticeTimer = null;
		if (this.skipNotice) this.skipNotice.remove();
		this.skipNotice = null;
	},
	showSkipNotice: function(message, undo, isHint) {
		this.clearSkipNotice();
		var notice = this.skipNotice = document.createElement('div');
		notice.className = 'reserve-skip-notice' + (isHint ? ' reserve-skip-hint' : '');
		notice.setAttribute('role', 'status');
		var text = document.createElement('span');
		text.textContent = message;
		notice.appendChild(text);
		if (undo && !isHint) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = '元に戻す';
			button.addEventListener('click', function() { this.clearSkipNotice(); undo(); }.bind(this));
			notice.appendChild(button);
		}
		if (!isHint) {
			var close = document.createElement('button');
			close.type = 'button';
			close.textContent = '閉じる';
			close.addEventListener('click', this.clearSkipNotice.bind(this));
			notice.appendChild(close);
		}
		document.body.appendChild(notice);
		this.skipNoticeTimer = setTimeout(this.clearSkipNotice.bind(this), isHint ? 3000 : 8000);
	},
	addKeywordTooltip: function(td, cell) {
		td.addEventListener('mouseenter', function() {
			if (cell.text && td.clientWidth > 0 && td.scrollWidth > td.clientWidth) {
				td.setAttribute('title', cell.text);
			} else {
				td.removeAttribute('title');
			}
		});
		td.addEventListener('mouseleave', function() { td.removeAttribute('title'); });
	},
	drawMain: function() {

		var rows = [];
		var previousRows = new Map();
		this.grid.rows.forEach(function(row) {
			previousRows.set(row.data.id + ':' + row.data.start, row);
		});

		var programs = [];

		for (var i = 0, l = global.chinachu.reserves.length; i < l; i++) {
			programs.push(global.chinachu.reserves[i]);
		}

		programs.sort(function(a, b) {
			return a.start - b.start;
		});

		var showDescription = ChinachuPreferences.get();
		var descriptionFontSize = ChinachuPreferences.getDescriptionFontSize();
		var page = this;
		programs.forEach(function(program, i) {
			var key = program.id + ':' + program.start;
			var previousRow = previousRows.get(key);
			previousRows.delete(key);
			var pending = ChinachuReservationActions.isPending(program.id);
			// Keep unchanged DOM, DynamicTime instances and measured row heights.
			// Snapshot values because reservation objects can also change in place.
			var signature = JSON.stringify([program, pending, showDescription, descriptionFontSize]);
			if (previousRow && previousRow._reserveSignature === signature) {
				previousRow.data = program;
				previousRow.cell.id.sortAlt = i;
				rows.push(previousRow);
				return;
			}

			var row = {
				_reserveSignature: signature,
				className: showDescription ? 'reserve-description-row' : '',
				data: program,
				cell: {
					id: {
						className: 'id',
						sortAlt  : i,
						text     : program.id
					}
				},
				menuItems: [
					{
						label   : 'ルール作成...',
						icon    : './icons/regular-expression.png',
						onSelect: function() {
							new chinachu.ui.CreateRuleByProgram(program.id);
						}
					},
					'------------------------------------------',
					{
						label   : 'タイトルをコピー...',
						onSelect: function() {
							chinachu.ui.copyStr(program.title);
						}
					},
					{
						label   : '説明をコピー...',
						onSelect: function() {
							chinachu.ui.copyStr(program.detail);
						}
					},
					{
						label   : 'IDをコピー...',
						onSelect: function() {
							chinachu.ui.copyStr(program.id);
						}
					}
					// 追加メニューはここに配置
				]
			};

			row.cell.details = { createElement: function() {
				var details = document.createElement('a');
				details.className = 'reserve-details';
				details.href = '#!/program/view/id=' + encodeURIComponent(program.id) + '/';
				details.textContent = '詳細';
				details.addEventListener('click', function(event) { event.stopPropagation(); });
				return { entity: details, remove: function() { details.remove(); } };
			} };
			if (pending) row.className += ' reserve-pending';

			row.cell.type = {
				sortAlt  : program.channel.type,
				className: 'types',
				html     : '<span class="label-type-' + Chinachu.escapeHTML(program.channel.type) + '">' + Chinachu.escapeHTML(program.channel.type) + '</span>'
			};

			row.cell.category = {
				sortAlt    : program.category,
				className  : 'categories',
				html       : '<span class="label-cat-' + Chinachu.escapeHTML(program.category) + '">' + Chinachu.escapeHTML(program.category) + '</span>'
			};

			row.cell.channel = {
				sortAlt    : program.channel.id,
				text       : program.channel.name,
				attribute  : {
					title: program.channel.id
				}
			};

			var titleHtml = (program.flags || []).map(function(flag) { return '<span class="flag ' + Chinachu.escapeHTML(flag) + '">' + Chinachu.escapeHTML(flag) + '</span>'; }).join('') + Chinachu.escapeHTML(program.title);
			if (program.subTitle && program.title.indexOf(program.subTitle) === -1) {
				titleHtml += '<span class="subtitle">' + Chinachu.escapeHTML(program.subTitle) + '</span>';
			}
			if (typeof program.episode !== 'undefined' && program.episode !== null) {
				titleHtml += '<span class="episode">#' + Chinachu.escapeHTML(program.episode) + '</span>';
			}
			titleHtml += '<span class="id">#' + Chinachu.escapeHTML(program.id) + '</span>';

			row.menuItems.unshift('--');
			if (program.isManualReserved) {
				titleHtml = '<span class="flag manual">手動</span>' + titleHtml;

				row.menuItems.unshift({
					label   : '予約取消...',
					icon    : './icons/cross-script.png',
					onSelect: function() {
						new chinachu.ui.Unreserve(program.id);
					}
				});
			}
			if (program.isSkip) {
				row.menuItems.unshift({
					label   : 'スキップの取消...',
					icon    : './icons/tick-circle.png',
					onSelect: function() {
						new chinachu.ui.Unskip(program.id);
					}
				});
			} else {
				row.menuItems.unshift({
					label   : 'スキップ...',
					icon    : './icons/exclamation-red.png',
					onSelect: function() {
						new chinachu.ui.Skip(program.id);
					}
				});
			}
			if (program.isSkip) {
				titleHtml = '<span class="flag skip">スキップ</span>' + titleHtml;
				row.className += ' disabled reserve-skipped';
			}
			if (program.isConflict) {
				titleHtml = '<span class="flag conflict">競合</span>' + titleHtml;
				row.className += ' disabled';
			}

			if (pending) titleHtml = '<span class="reserve-pending-spinner" role="status" aria-label="処理中" title="処理中"></span>' + titleHtml;

			if (showDescription && program.detail) {
				titleHtml = '<div class="reserve-title">' + titleHtml + '</div><div class="reserve-description" style="font-size: ' + descriptionFontSize + '">' + Chinachu.escapeHTML(String(program.detail).replace(/\r\n|\r|\n/g, ' ')) + '</div>';
			}

			row.cell.title = {
				className  : showDescription && program.detail ? 'reserve-description-cell' : '',
				sortAlt    : program.title,
				html       : titleHtml,
				attribute  : {
					title: program.fullTitle + ' - ' + program.detail
				}
			};

			row.cell.matchedKeywords = {
				text: (program.matchedKeywords || []).join('、'),
				postProcess: page.addKeywordTooltip
			};
			var exclusionReasons = (program.excludedKeywords || []).slice();
			if ((program.excludedChannels || []).length) {
				exclusionReasons.push('[' + Chinachu.escapeHTML(program.channel.type) + '] ' + (program.channel.name || program.channel.id));
			}
			row.cell.excludedKeywords = {
				text: exclusionReasons.map(function(reason) {
					return reason + (program.autoSkipOverride ? '（手動解除）' : '');
				}).join('、'),
				postProcess: page.addKeywordTooltip
			};

			row.cell.duration = {
				sortAlt    : program.seconds,
				text       : program.seconds / 60 + 'm'
			};

			row.cell.datetime = {
				sortAlt    : program.start,
				createElement: function() {
					return new chinachu.ui.DynamicTime({
						tagName: 'div',
						type   : 'full',
						time   : program.start
					});
				}
			};

			rows.push(row);
		});

		this.grid.splice(0, void 0, rows);

		return this;
	}
});
