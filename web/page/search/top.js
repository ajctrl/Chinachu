Chinachu.definePage({

	init: function() {

		this.view.content.className = 'loading';

		// PageManager already decodes current forms. Only legacy form URLs need
		// another pass; decoding current terms would turn a literal %41 into A.
		if (String(this.self.query.searchVersion) !== '2') {
			['title', 'desc'].forEach(function(key) {
				if (/^[%A-Z0-9\.]+$/.test(this.self.query[key])) {
					try { this.self.query[key] = decodeURIComponent(this.self.query[key] || ''); } catch (error) { /* Preserve malformed escapes. */ }
				}
			}, this);
		}

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:schedule', this.onNotify);

		return this;
	}
	,
	deinit: function() {
		if (this.searchModal) this.searchModal.close();

		if (this.grid) this.grid.destroy();

		this.descriptionSwitch.destroy();
		this.unsubscribeDescriptionFontSize();

		Chinachu.off(document, 'chinachu:schedule', this.onNotify);

		return this;
	}
	,
	refresh: function() {

		this.drawMain();

		return this;
	}
	,
	initToolbar: function _initToolbar() {

		this.descriptionSwitch = ChinachuPreferences.createSwitch(this.drawMain.bind(this), 'search');
		this.unsubscribeDescriptionFontSize = ChinachuPreferences.subscribeDescriptionFontSize(this.drawMain.bind(this));
		var control = new ChinachuUI.ElementView({ tagName: 'span' });
		control.entity.appendChild(this.descriptionSwitch.element);
		this.view.toolbar.add({ key: 'show-description', ui: control });

		this.view.toolbar.add({
			key: 'search',
			ui : new ChinachuUI.ActionButton({
				label  : '番組検索',
				icon   : './icons/magnifier-zoom.png',
				onClick: this.viewSearchModal.bind(this)
			})
		});

		return this;
	}
	,
	draw: function() {

		this.view.content.className = '';
		this.view.content.update();

		this.grid = new ChinachuVirtualGrid({
			multiSelect  : false,
			disableSelect: true,
			stateKey: 'search:' + JSON.stringify(Object.keys(this.self.query).sort().filter(function(key) {
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
			}
		}).insertTo(this.view.content);

		if (!this.self.query.skip) {
			this.viewSearchModal();
		} else {
			this.drawMain();
		}

		return this;
	}
	,
	drawMain: function() {

		if (!this.grid) return this;

		var time = new Date().getTime();

		var rows = [];
		var showDescription = ChinachuPreferences.get('search');
		var descriptionFontSize = ChinachuPreferences.getDescriptionFontSize();

		var programs = [];

		var program;

		// 正規化方法
		var nf;
		if (global.chinachu.status.feature) {
			nf = global.chinachu.status.feature.normalizationForm;
		}

		// query.title, query.descの正規化をキャッシュ
		var query_title_norm, query_desc_norm;
		if (nf) {
			if (this.self.query.title) {
				query_title_norm = this.self.query.title.normalize(nf);
			}
			if (this.self.query.desc) {
				query_desc_norm = this.self.query.desc.normalize(nf);
			}
		}

		for (var i = 0, l = global.chinachu.schedule.length; i < l; i++) {
			for (var j = 0, m = global.chinachu.schedule[i].programs.length; j < m; j++) {
				program = global.chinachu.schedule[i].programs[j];

				if (program.end < time) continue;

				if (this.self.query.pgid && this.self.query.pgid !== program.id) continue;
				if (!ChinachuSearchForm.matchesChannel(this.self.query, program.channel)) continue;
				if (this.self.query.cat && this.self.query.cat !== program.category) continue;
				if (this.self.query.type && this.self.query.type !== program.channel.type) continue;
				if (nf) {
					if (this.self.query.title && program.fullTitle.normalize(nf).match(query_title_norm) === null) continue;
					if (this.self.query.desc && (!program.detail || program.detail.normalize(nf).match(query_desc_norm) === null)) continue;
				}
				else {
					if (this.self.query.title && program.fullTitle.match(this.self.query.title) === null) continue;
					if (this.self.query.desc && (!program.detail || program.detail.match(this.self.query.desc) === null)) continue;
				}

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
						label   : '予約...',
						icon    : './icons/plus-circle.png',
						onSelect: function() {
							new chinachu.ui.Reserve(program.id);
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
	,
	viewSearchModal: function() {
		ChinachuSearchForm.show(this, { recorded: false });
		return this;
	}
});
