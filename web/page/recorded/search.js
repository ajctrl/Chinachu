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
		if (this.searchModal) this.searchModal.close();
		if (this.searchControls) this.searchControls.destroy();

		if (this.grid) this.grid.destroy();

		this.descriptionSwitch.destroy();
		this.unsubscribeDescriptionFontSize();

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

		this.descriptionSwitch = ChinachuPreferences.createSwitch(this.drawMain.bind(this), 'recorded.search');
		this.unsubscribeDescriptionFontSize = ChinachuPreferences.subscribeDescriptionFontSize(this.drawMain.bind(this));
		var control = new ChinachuUI.ElementView({ tagName: 'span' });
		control.entity.appendChild(this.descriptionSwitch.element);
		this.view.toolbar.add({ key: 'show-description', ui: control });

		this.view.toolbar.add({
			key: 'search',
			ui : new ChinachuUI.ActionButton({
				className: 'chinachu-search-mobile-button',
				label  : '録画番組検索',
				icon   : './icons/magnifier-zoom.png',
				onClick: this.viewSearchModal.bind(this)
			})
		});

		return this;
	}
	,
	draw: function() {

		this.view.content.className = 'search-results-page';
		this.view.content.update();
		ChinachuSearchForm.mount(this, true);

		this.grid = new ChinachuVirtualGrid({
			multiSelect  : false,
			disableSelect: true,
			stateKey: 'recorded.search:' + JSON.stringify(Object.keys(this.self.query).sort().filter(function(key) {
				return key !== 'page' && key !== 'skip';
			}).map(function(key) { return [key, this.self.query[key]]; }, this)),
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
			}.bind(this)
		}).insertTo(this.view.content);

		this.drawMain();
		if (!this.self.query.skip && ChinachuSearchForm.isMobile()) this.viewSearchModal();

		return this;
	}
	,
	drawMain: function() {

		if (!this.grid || !ChinachuSearchForm.hasSearch(this.self.query)) return this;

		var rows = [];
		var showDescription = ChinachuPreferences.get('recorded.search');
		var descriptionFontSize = ChinachuPreferences.getDescriptionFontSize();

		var programs = [];

		var program;

		// 正規化方法
		var nf;
		if (global.chinachu.status.feature) {
			nf = global.chinachu.status.feature.normalizationForm;
		}

		var matchesText = ChinachuSearchForm.textMatcher(this.self.query, nf, true);
		var matchesCategory = ChinachuSearchForm.categoryMatcher(this.self.query);

		for (var i = 0, l = global.chinachu.recorded.length; i < l; i++) {
			program = global.chinachu.recorded[i];

			if (this.self.query.pgid && this.self.query.pgid !== program.id) continue;
			if (!ChinachuSearchForm.matchesChannel(this.self.query, program.channel)) continue;
			if (!matchesCategory(program.category)) continue;
			if (this.self.query.type && this.self.query.type !== program.channel.type) continue;
			if (!matchesText(program)) continue;

			if (this.self.query.start || this.self.query.end) {
				var ruleStart = parseInt(this.self.query.start || 0, 10);
				var ruleEnd   = parseInt(this.self.query.end || 24, 10);

				var progStart = new Date(program.start).getHours();
				var progEnd   = new Date(program.end).getHours();

				if (progStart > progEnd) {
					progEnd += 24;
				}

				if (ruleStart > ruleEnd) {
					if ((ruleStart > progStart) && (ruleEnd < progEnd)) continue;
				} else {
					if ((ruleStart > progStart) || (ruleEnd < progEnd)) continue;
				}
			}

			programs.push(program);
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
			if (typeof program.episode !== 'undefined' && program.episode !== null) {
				titleHtml += '<span class="episode">#' + Chinachu.escapeHTML(program.episode) + '</span>';
			}
			titleHtml += '<span class="id">#' + Chinachu.escapeHTML(program.id) + '</span>';

			if (showDescription && program.detail) {
				titleHtml = '<div class="reserve-title">' + titleHtml + '</div><div class="reserve-description" style="font-size: ' + descriptionFontSize + '">' + Chinachu.escapeHTML(String(program.detail).replace(/\r\n|\r|\n/g, ' ')) + '</div>';
			}

			row.cell.title = {
				className  : showDescription && program.detail ? 'reserve-description-cell' : '',
				sortAlt    : program.title + (program.episode || 0).toString(36),
				html       : titleHtml,
				attribute  : {
					title: program.detail
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
		ChinachuSearchForm.updateSummary(this, true, rows.length);

		return this;
	}
	,
	viewSearchModal: function() {
		ChinachuSearchForm.show(this, { recorded: true });
		return this;
	}
});
