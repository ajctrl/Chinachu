Chinachu.definePage({

	init: function() {

		this.view.content.className = 'loading';

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:recorded', this.onNotify);

		return this;
	}
	,
	deinit: function() {

		this.descriptionSwitch.destroy();
		this.unsubscribeDescriptionFontSize();

		if (this.grid) this.grid.destroy();

		Chinachu.off(document, 'chinachu:recorded', this.onNotify);

		return this;
	}
	,
	refresh: function() {

		this.drawMain();

		return this;
	}
	,
	initToolbar: function _initToolbar() {

		this.descriptionSwitch = ChinachuPreferences.createSwitch(this.drawMain.bind(this), 'recorded');
		this.unsubscribeDescriptionFontSize = ChinachuPreferences.subscribeDescriptionFontSize(this.drawMain.bind(this));
		var control = new ChinachuUI.ElementView({ tagName: 'span' });
		control.entity.appendChild(this.descriptionSwitch.element);
		this.view.toolbar.add({ key: 'show-description', ui: control });

		this.view.toolbar.add({
			key: 'execute-scheduler',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('EXECUTE {0}', [Chinachu.t('CLEANUP')]),
				icon   : './icons/eraser.png',
				onClick: function() {
					new chinachu.ui.Cleanup();
				}.bind(this)
			})
		});

		this.view.toolbar.add({
			key: 'search recored programs',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('SEARCH RECORDED PROGRAMS'),
				icon   : './icons/calendar-search-result.png',
				onClick: function() {
					window.location.href = '#!/recorded/search/'
				}.bind(this)
			})
		});

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
			stateKey: 'recorded',
			legacyPage: parseInt(this.self.query.page, 10) || 0,
			fill         : true,
			cols: [
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
			onClick: function(e, row) {
				window.location.href = '#!/program/view/id=' + row.data.id + '/';
			}
		}).insertTo(this.view.content);

		this.drawMain();

		return this;
	}
	,
	drawMain: function() {

		var rows = [];
		var showDescription = ChinachuPreferences.get('recorded');
		var descriptionFontSize = ChinachuPreferences.getDescriptionFontSize();

		var programs = [];

		for (var i = 0, l = global.chinachu.recorded.length; i < l; i++) {
			programs.push(global.chinachu.recorded[i]);
		}

		programs.sort(function(a, b) {
			return b.start - a.start;
		});

		programs.forEach(function(program, i) {

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
						label   : '削除...',
						icon    : './icons/cross-script.png',
						onSelect: function() {
							new chinachu.ui.RemoveRecordedProgram(program.id);
						}
					},
					'------------------------------------------',
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
				]
			};

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

			if (program.isManualReserved) {
				titleHtml = '<span class="flag manual">手動</span>' + titleHtml;
			}

			if (showDescription && program.detail) {
				titleHtml = '<div class="reserve-title">' + titleHtml + '</div><div class="reserve-description" style="font-size: ' + descriptionFontSize + '">' + Chinachu.escapeHTML(String(program.detail).replace(/\r\n|\r|\n/g, ' ')) + '</div>';
			}

			row.cell.title = {
				className  : showDescription && program.detail ? 'reserve-description-cell' : '',
				sortAlt    : program.title + (program.episode || 0).toString(36),
				html       : titleHtml,
				attribute  : {
					title: program.fullTitle + ' - ' + program.detail
				}
			};

			row.cell.duration = {
				sortAlt    : program.seconds,
				text       : program.seconds / 60 + 'm'
			};

			row.cell.datetime = {
				sortAlt    : program.start,
				text       : chinachu.dateToString(new Date(program.start))
			};

			rows.push(row);
		});

		this.grid.splice(0, void 0, rows);

		return this;
	}
});
