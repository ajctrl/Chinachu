Chinachu.definePage({

	init: function() {

		this.view.content.className = 'loading';

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:recording', this.onNotify);

		return this;
	}
	,
	deinit: function() {

		this.descriptionSwitch.destroy();
		this.unsubscribeDescriptionFontSize();

		if (this.grid) this.grid.destroy();

		Chinachu.off(document, 'chinachu:recording', this.onNotify);

		return this;
	}
	,
	refresh: function() {

		this.drawMain();

		return this;
	}
	,
	initToolbar: function _initToolbar() {

		this.descriptionSwitch = ChinachuPreferences.createSwitch(this.drawMain.bind(this), 'recording');
		this.unsubscribeDescriptionFontSize = ChinachuPreferences.subscribeDescriptionFontSize(this.drawMain.bind(this));
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
			stateKey: 'recording',
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
					key  : 'matchedKeywords',
					label: '一致キーワード',
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
		var showDescription = ChinachuPreferences.get('recording');
		var descriptionFontSize = ChinachuPreferences.getDescriptionFontSize();

		var programs = [];

		for (var i = 0, l = global.chinachu.recording.length; i < l; i++) {
			programs.push(global.chinachu.recording[i]);
		}

		programs.sort(function(a, b) {
			return a.start - b.start;
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
						label   : '録画中止...',
						icon    : './icons/cross.png',
						onSelect: function() {
							new chinachu.ui.StopRecord(program.id);
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
				sortAlt    : program.title,
				html       : titleHtml,
				attribute  : {
					title: program.fullTitle + ' - ' + program.detail
				}
			};

			var matchedKeywords = program.isManualReserved ? '手動予約' :
				(Array.isArray(program.matchedKeywords) ?
					(program.matchedKeywords.join('、') || 'キーワード条件なし') : '');
			row.cell.matchedKeywords = {
				text: matchedKeywords,
				attribute: { title: matchedKeywords }
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
