Chinachu.definePage({

	init: function() {

		this.isExclusion = this.self.query.kind === 'exclusion';
		this.ruleResource = this.isExclusion ? 'exclusion-rules' : 'rules';
		this.ruleEvent = 'chinachu:' + this.ruleResource;
		this.exclusionRules = [];
		this.disposed = false;
		this.refreshGeneration = 0;
		this.view.content.className = 'loading';

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, this.ruleEvent, this.onNotify);
		this.onSchedule = function() { this.drawMain(true); }.bind(this);
		Chinachu.on(document, 'chinachu:schedule', this.onSchedule);
		if (this.isExclusion) { this.refresh(); }

		return this;
	}
	,
	deinit: function() {

		if (this.grid) this.grid.destroy();
		if (this.ruleTabs) this.ruleTabs.remove();
		this.view.title.hidden = false;

		this.disposed = true;
		Chinachu.off(document, this.ruleEvent, this.onNotify);
		Chinachu.off(document, 'chinachu:schedule', this.onSchedule);

		return this;
	}
	,
	refresh: function() {

		if (this.isExclusion) {
			var generation = ++this.refreshGeneration;
			Chinachu.request('./api/exclusion-rules.json', {
				method: 'get',
				onSuccess: function(t) {
					if (this.disposed || generation !== this.refreshGeneration) return;
					this.exclusionRules = t.responseJSON;
					this.drawMain();
				}.bind(this),
				onFailure: function(t) {
					if (!this.disposed && generation === this.refreshGeneration) new ChinachuUI.Modal({ title: '失敗', text: '共通除外ルールを読み込めませんでした (' + t.status + ')' }).show();
				}.bind(this)
			});
		} else {
			this.drawMain();
		}
		return this;
	}
	,
	getRules: function() {
		return this.isExclusion ? this.exclusionRules : global.chinachu.rules;
	}
	,
	initToolbar: function _initToolbar() {
		this.view.toolbar.add({
			key: 'execute-scheduler',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('EXECUTE {0}', [Chinachu.t('SCHEDULER')]),
				icon   : './icons/calendar-import.png',
				onClick: function() {
					new chinachu.ui.ExecuteScheduler();
				}.bind(this)
			})
		});

		this.view.toolbar.add({ key: '--', ui: new ChinachuUI.ElementView({ tagName: 'hr' }) });

		this.view.toolbar.add({
			key: 'add',
			ui : new ChinachuUI.ActionButton({
				label  : this.isExclusion ? '共通除外ルールを追加' : Chinachu.t('ADD'),
				icon   : './icons/plus-circle.png',
				onClick: function() {
					new chinachu.ui.NewRule(this.isExclusion);
				}.bind(this)
			})
		});

		this.view.toolbar.add({
			key: 'edit',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('EDIT'),
				icon   : './icons/hammer.png',
				onClick: function() {
					new chinachu.ui.EditRule(this.getRules().indexOf(this.grid.getSelectedRows()[0].data), this.isExclusion);
				}.bind(this)
			}).disable()
		});

		/*this.view.toolbar.add({
			key: 'copy',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('COPY'),
				icon   : './icons/document-copy.png',
				onClick: function() {
					//console.log(this.grid.getSelectedRows()[0]);
					//new chinachu.ui.CreateRuleByProgram(this.grid.getSelectedRows()[0].data.id);
				}.bind(this)
			}).disable()
		});*/

		this.view.toolbar.add({
			key: 'delete',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('DELETE'),
				icon   : './icons/cross-script.png',
				onClick: function() {

					var selected = this.grid.getSelectedRows();
					var nums = [];
					var rules = this.getRules();
					var resource = this.ruleResource;
					var refresh = this.refresh.bind(this);
					selected.forEach(function(row) {
						nums.push(rules.indexOf(row.data));
					});
					nums.sort(function (a, b) {
						return a - b;
					});

					var modal  = new ChinachuUI.Modal({
						title: 'ルール削除',
						text : 'これらの ' + selected.length + ' ルールを削除します',
						buttons: [
							{
								label: '削除',
								color: '@red',
								onSelect: function(e, modal) {

									modal.buttons.forEach(function(a) {
										a.button.disable();
									});

									main();
								}
							},
							{
								label: 'キャンセル',
								onSelect: function(e, modal) {
									modal.close();
								}
							}
						]
					}).show();

					var main = function() {

						if (nums.length === 0) {
							refresh();
							modal.close();
							return;
						}

						var num  = nums.pop();
						console.log(num, nums);

						modal.content.updateText('ルール#' + num.toString(10) + ' を削除しています...');

						Chinachu.request('./api/' + resource + '/' + num.toString(10) + '.json', {
							method    : 'delete',
							onSuccess: function() {

								modal.content.updateText('ルール#' + num.toString(10) + ' を削除しました');
								main();
							},
							onFailure: function(t) {
								modal.close();
								refresh();

								new ChinachuUI.Modal({
									title: '失敗',
									text : 'ルール#' + num.toString(10) + ' の削除に失敗しました (' + t.status + ')'
								}).show();
							}
						});
					};
				}.bind(this)
			}).disable()
		});

		return this;
	}
	,
	updateToolbar: function() {

		if (!this.grid) return;

		var selected = this.grid.getSelectedRows();

		if (selected.length === 0) {
			this.view.toolbar.one('edit').disable();
			//this.view.toolbar.one('copy').disable();
			this.view.toolbar.one('delete').disable();
		} else if (selected.length === 1) {
			this.view.toolbar.one('edit').enable();
			//this.view.toolbar.one('copy').enable();
			this.view.toolbar.one('delete').enable();
		} else {
			this.view.toolbar.one('edit').disable();
			//this.view.toolbar.one('copy').disable();
		}
	}
	,
	draw: function() {

		this.view.content.className = 'list';
		this.view.content.update();
		if (this.isExclusion) { this.view.title.update('共通除外ルール'); }

		var tabs = ChinachuUI.createElement('nav', { class: 'rule-kind-tabs', 'aria-label': 'ルールの種類' })
			.insertTo(this.view.title.parentNode);
		this.ruleTabs = tabs;
		this.view.title.hidden = true;
		[
			{ label: '通常ルール', href: '#!/rules/list/', active: !this.isExclusion },
			{ label: '共通除外ルール', href: '#!/rules/list/kind=exclusion/', active: this.isExclusion }
		].forEach(function(tab) {
			ChinachuUI.createElement('a', { href: tab.href, 'aria-current': tab.active ? 'page' : null })
				.insertText(tab.label).insertTo(tabs);
		});

		this.grid = new ChinachuVirtualGrid({
			multiSelect: true,
			stateKey: this.isExclusion ? 'exclusion-rules' : 'rules',
			legacyPage: parseInt(this.self.query.page, 10) || 0,
			fill       : true,
			cols: [
				{
					key  : 'n',
					label: '#',
					width: 40,
					disableResize: true
				},
				{
					key  : 'types',
					label: '放送波',
					width: 70
				},
				{
					key  : 'categories',
					label: 'ジャンル',
					width: 70
				},
				{
					key  : 'channels',
					label: '対象CH',
					width: 180
				},
				{
					key  : 'ignore_channels',
					label: '無視CH',
					width: 180
				},
				{
					key  : 'reserve_flags',
					label: 'フラグ',
					width: 60
				},
				{
					key  : 'ignore_flags',
					label: '無視ﾌﾗｸﾞ',
					width: 60
				},
				{
					key  : 'hour',
					label: '時間帯',
					width: 55
				},
				{
					key  : 'duration',
					label: '長さ(分)',
					width: 70
				},
				{ key: 'reserve_fields_operator', label: 'タイトル・説明文', width: 110 },
				{
					key  : 'reserve_titles',
					label: this.isExclusion ? '除外するタイトル' : '対象タイトル'
				},
				{
					key  : 'ignore_titles',
					label: '無視タイトル'
				},
				{
					key  : 'reserve_descriptions',
					label: this.isExclusion ? '除外する説明文' : '対象説明文'
				},
				{
					key  : 'ignore_descriptions',
					label: '無視説明文'
				},
				{
					key  : 'recorded_format',
					label: '録画ファイル名フォーマット'
				}
			].filter(function(col) { return !this.isExclusion || col.key !== 'recorded_format'; }.bind(this)),
			onSelect  : this.updateToolbar.bind(this),
			onDeselect: this.updateToolbar.bind(this),
			onDblClick: function(e, row) {
				new chinachu.ui.EditRule(this.getRules().indexOf(row.data), this.isExclusion);
			}.bind(this)
		}).insertTo(this.view.content);

		this.drawMain();

		return this;
	}
	,
	drawMain: function(preserveSelection) {

		// Schedule updates only change channel labels; keep selection by rule identity.
		var selectedRules = preserveSelection === true ? this.grid.getSelectedRows().map(function(row) {
			return row.data;
		}) : [];
		var rows = [];
		function channelName(value) {
			return ChinachuChannelSelector.format(value, global.chinachu.schedule);
		}

		this.getRules().forEach(function(rule, i) {

			var row = {
				data: rule,
				cell: {
					n: {
						sortAlt: i,
						text   : i.toString(10)
					}
				}
			};

			if (rule.isDisabled) row.className = 'disabled';

			if (rule.types) {
				row.cell.types = {
					sortKey  : rule.types[0],
					className: 'types',
					html     : rule.types.map(function(type) { return '<span class="label-type-' + Chinachu.escapeHTML(type) + '">' + Chinachu.escapeHTML(type.slice(0, 1)) + '</span>'; }).join('')
				};
			} else {
				row.cell.types = {
					className: 'default',
					sortKey  : 0,
					text     : 'any'
				};
			}

			if (rule.categories) {
				row.cell.categories = {
					sortKey    : rule.categories[0],
					className  : 'categories',
					html       : rule.categories.map(function(category) { return '<span class="label-cat-' + Chinachu.escapeHTML(category) + '">' + Chinachu.escapeHTML(category) + '</span>'; }).join(''),
					attribute  : { title: rule.categories.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.categories = {
					className: 'default',
					sortKey  : 0,
					text     : 'any'
				};
			}

			if (rule.channels && rule.channels.length) {
				row.cell.channels = {
					text       : rule.channels.map(channelName).join(', '),
					attribute  : { title: (rule.channels.map(channelName).join(', ') + '\nID: ' + rule.channels.join(', ')).slice(0, 256) }
				};
			} else {
				row.cell.channels = {
					className: 'default',
					sortKey  : 0,
					text     : 'CH指定なし'
				};
			}

			if (rule.ignore_channels && rule.ignore_channels.length) {
				row.cell.ignore_channels = {
					text       : rule.ignore_channels.map(channelName).join(', '),
					attribute  : { title: (rule.ignore_channels.map(channelName).join(', ') + '\nID: ' + rule.ignore_channels.join(', ')).slice(0, 256) }
				};
			} else {
				row.cell.ignore_channels = {
					className: 'default',
					sortKey  : 0,
					text     : '除外なし'
				};
			}

			if (rule.reserve_flags) {
				row.cell.reserve_flags = {
					text       : rule.reserve_flags.join(', '),
					attribute  : { title: rule.reserve_flags.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.reserve_flags = {
					className: 'default',
					sortKey  : 0,
					text     : 'any'
				};
			}

			if (rule.ignore_flags) {
				row.cell.ignore_flags = {
					text       : rule.ignore_flags.join(', '),
					attribute  : { title: rule.ignore_flags.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.ignore_flags = {
					className: 'default',
					sortKey  : 0,
					text     : 'none'
				};
			}

			if (rule.hour) {
				row.cell.hour = {
					sortKey  : rule.hour.start || 0,
					text     : [rule.hour.start || 0, rule.hour.end || 0].map(function(value) { return String(value).padStart(2, '0'); }).join('~')
				};
			} else {
				row.cell.hour = {
					className: 'default',
					sortKey  : 0,
					text     : 'all'
				};
			}

			if (rule.duration) {
				row.cell.duration = {
					sortKey  : rule.duration.min || 0,
					text     : [
						Math.round((rule.duration.min || 0) / 60),
						Math.round((rule.duration.max || 0) / 60)
					].map(function(value) { return String(value).padStart(2, '0'); }).join('~')
				};
			} else {
				row.cell.duration = {
					className: 'default',
					sortKey  : 0,
					text     : 'all'
				};
			}

			row.cell.reserve_fields_operator = { text: (rule.reserve_fields_operator || 'and').toUpperCase() };

			if (rule.reserve_titles) {
				row.cell.reserve_titles = {
					text       : '[' + (rule.reserve_titles_operator || 'or').toUpperCase() + '] ' + rule.reserve_titles.join(', '),
					attribute  : { title: rule.reserve_titles.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.reserve_titles = {
					className: 'default',
					sortKey  : 0,
					text     : 'any'
				};
			}

			if (rule.ignore_titles) {
				row.cell.ignore_titles = {
					text       : rule.ignore_titles.join(', '),
					attribute  : { title: rule.ignore_titles.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.ignore_titles = {
					className: 'default',
					sortKey  : 0,
					text     : 'none'
				};
			}

			if (rule.reserve_descriptions) {
				row.cell.reserve_descriptions = {
					text       : '[' + (rule.reserve_descriptions_operator || 'or').toUpperCase() + '] ' + rule.reserve_descriptions.join(', '),
					attribute  : { title: rule.reserve_descriptions.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.reserve_descriptions = {
					className: 'default',
					sortKey  : 0,
					text     : 'any'
				};
			}

			if (rule.ignore_descriptions) {
				row.cell.ignore_descriptions = {
					text       : rule.ignore_descriptions.join(', '),
					attribute  : { title: rule.ignore_descriptions.join(', ').slice(0, 256) }
				};
			} else {
				row.cell.ignore_descriptions = {
					className: 'default',
					sortKey  : 0,
					text     : 'none'
				};
			}

			if (rule.recorded_format) {
				row.cell.recorded_format = {
					text       : rule.recorded_format,
					attribute  : { title: rule.recorded_format.slice(0, 256) }
				};
			} else {
				row.cell.recorded_format = {
					className: 'default',
					sortKey  : 0,
					text     : 'default'
				};
			}

			rows.push(row);
		});

		this.grid.splice(0, void 0, rows).forEach(function(row) {
			this.grid.deselect(row);
		}.bind(this));
		if (selectedRules.length) {
			this.grid.select(rows.filter(function(row) { return selectedRules.indexOf(row.data) !== -1; }));
		}

		this.updateToolbar();
		return this;
	}
});
