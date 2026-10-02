P = Class.create(P, {

	init: function() {

		this.closed = false;
		this.view.content.className = 'loading';

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bindAsEventListener(this);
		document.observe('chinachu:reserves', this.onNotify);

		return this;
	}
	,
	deinit: function() {

		if (this.grid) this.grid.destroy();

		document.stopObserving('chinachu:reserves', this.onNotify);
		this.closed = true;
		this.descriptionSwitch.destroy();
		if (this.skipNotice) this.skipNotice.remove();

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
		var control = new sakura.ui.Element({ tagName: 'span' });
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
			onClick: this.onRowClick.bind(this)
		}).insertTo(this.view.content);

		this.drawMain();

		return this;
	}
	,
	onRowClick: function(event, row) {
		if (event.button && event.button !== 0) return;
		if (event.target && event.target.closest && event.target.closest('a, button, input, select, .flagrate-grid-cell-menu')) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		if (ChinachuPreferences.getClickAction() !== 'skip' || row.data.isManualReserved) {
			window.location.href = '#!/program/view/id=' + row.data.id + '/';
			return;
		}
		this.setProgramSkip(row.data, !row.data.isSkip);
	},
	setProgramSkip: function(program, skip) {
		var current = global.chinachu.reserves.filter(function(item) { return item.id === program.id && item.start === program.start; })[0];
		if (!current || current.isManualReserved) {
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
	showSkipNotice: function(message, undo) {
		if (this.skipNotice) this.skipNotice.remove();
		var notice = this.skipNotice = document.createElement('div');
		notice.className = 'reserve-skip-notice';
		notice.setAttribute('role', 'status');
		var text = document.createElement('span');
		text.textContent = message;
		notice.appendChild(text);
		if (undo) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = '元に戻す';
			button.addEventListener('click', function() { notice.remove(); undo(); });
			notice.appendChild(button);
		}
		var close = document.createElement('button');
		close.type = 'button';
		close.textContent = '閉じる';
		close.addEventListener('click', function() { notice.remove(); });
		notice.appendChild(close);
		document.body.appendChild(notice);
	},
	drawMain: function() {

		var rows = [];

		var programs = [];

		for (var i = 0, l = global.chinachu.reserves.length; i < l; i++) {
			programs.push(global.chinachu.reserves[i]);
		}

		programs.sort(function(a, b) {
			return a.start - b.start;
		});

		var showDescription = ChinachuPreferences.get();
		var page = this;
		programs.each(function(program, i) {

			var row = {
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
			if (ChinachuReservationActions.isPending(program.id)) row.className += ' reserve-pending';

			row.cell.type = {
				sortAlt  : program.channel.type,
				className: 'types',
				html     : '<span class="label-type-' + program.channel.type + '">' + program.channel.type + '</span>'
			};

			row.cell.category = {
				sortAlt    : program.category,
				className  : 'categories',
				html       : '<span class="label-cat-' + program.category + '">' + program.category + '</span>'
			};

			row.cell.channel = {
				sortAlt    : program.channel.id,
				text       : program.channel.name,
				attribute  : {
					title: program.channel.id
				}
			};

			var titleHtml = program.flags.invoke('sub', /.+/, '<span class="flag #{0}">#{0}</span>').join('') + program.title;
			if (program.subTitle && program.title.indexOf(program.subTitle) === -1) {
				titleHtml += '<span class="subtitle">' + program.subTitle + '</span>';
			}
			if (typeof program.episode !== 'undefined' && program.episode !== null) {
				titleHtml += '<span class="episode">#' + program.episode + '</span>';
			}
			titleHtml += '<span class="id">#' + program.id + '</span>';

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
			} else {
				if (program.isSkip) {
					titleHtml = '<span class="flag skip">スキップ</span>' + titleHtml;
					row.className += ' disabled reserve-skipped';

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
			}
			if (program.isConflict) {
				titleHtml = '<span class="flag conflict">競合</span>' + titleHtml;
				row.className += ' disabled';
			}

			if (showDescription && program.detail) {
				titleHtml = '<div class="reserve-title">' + titleHtml + '</div><div class="reserve-description">' + String(program.detail).escapeHTML() + '</div>';
			}

			if (ChinachuReservationActions.isPending(program.id)) titleHtml = '<span class="reserve-pending-label">処理中… </span>' + titleHtml;
			row.cell.title = {
				className  : showDescription && program.detail ? 'reserve-description-cell' : '',
				sortAlt    : program.title,
				html       : titleHtml,
				attribute  : {
					title: program.fullTitle + ' - ' + program.detail
				}
			};

			row.cell.matchedKeywords = {
				text: (program.matchedKeywords || []).join('、')
			};
			row.cell.excludedKeywords = {
				text: (program.excludedKeywords || []).map(function(keyword) {
					return keyword + (program.autoSkipOverride ? '（手動解除）' : '');
				}).join('、')
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
