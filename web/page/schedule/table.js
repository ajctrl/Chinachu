(function () {
	'use strict';

	Chinachu.definePage({

		init: function () {

			this.view.content.className = 'loading';

			this.time = new Date().getTime();

			this.initToolbar();
			this.draw();

			this.onNotify = this.refresh.bind(this);
			Chinachu.on(document, 'chinachu:schedule', this.onNotify);
			Chinachu.on(document, 'chinachu:reserves', this.onNotify);

			return this;
		},

		deinit: function () {
			if (this.view.popoverDrawer) this.view.popoverDrawer.remove();
			if (this.pointerCleanup) this.pointerCleanup();
			if (this.dayControlsObserver) this.dayControlsObserver.disconnect();

			Chinachu.off(document, 'chinachu:schedule', this.onNotify);
			Chinachu.off(document, 'chinachu:reserves', this.onNotify);

			this.tick = function () {};
			this.draw = function () {};
			if (this.view.drawerDt) { this.view.drawerDt.remove(); }

			return this;
		},

		refresh: function () {

			Chinachu.emit(document, 'chinachu:page:unload');

			clearTimeout(this.timer.reloading);
			this.timer.reloading = setTimeout(function () {
				if (this.view.drawerDt) { this.view.drawerDt.remove(); }

				this.time = new Date().getTime();
				this.draw();
			}.bind(this), 50);

			return this;
		},

		initToolbar: function () {

			['GR', 'BS', 'CS', 'SKY'].forEach(function(type) {
				var control = ChinachuUI.createElement('button', {
					class: 'schedule-type-filter', type: 'button', disabled: true,
					'aria-pressed': 'false', 'aria-label': type + 'の番組を表示'
				}).insertText(type);
				Chinachu.on(control, 'click', function() {
					var types = JSON.parse(localStorage.getItem('schedule.visible.types') || '["GR","BS","CS","SKY"]');
					if (types.indexOf(type) !== -1) {
						types = types.filter(function(item) { return item !== type; });
					} else {
						types.push(type);
					}
					localStorage.setItem('schedule.visible.types', JSON.stringify(types));
					control.setAttribute('aria-pressed', String(types.indexOf(type) !== -1));
					this.refresh();
				}.bind(this));
				this.view.toolbar.add({ key: 'type-' + type.toLowerCase(), ui: control });
			}.bind(this));

			var typeMenu = ChinachuUI.createElement('div', { class: 'schedule-type-menu', hidden: true });
			var typeToggle = ChinachuUI.createElement('button', {
				type: 'button', class: 'schedule-type-toggle', popovertarget: 'schedule-type-options',
				'aria-expanded': 'false', 'aria-controls': 'schedule-type-options'
			}).insertText('放送切替⌄').insertTo(typeMenu);
			var typePanel = ChinachuUI.createElement('div', {
				id: 'schedule-type-options', class: 'schedule-type-options', popover: 'auto',
				role: 'group', 'aria-label': '表示する放送'
			}).insertTo(typeMenu);
			ChinachuUI.createElement('strong').insertText('表示する放送').insertTo(typePanel);
			this.view.typeChecks = {};
			['GR', 'BS', 'CS', 'SKY'].forEach(function(type) {
				var label = ChinachuUI.createElement('label').insertTo(typePanel);
				var names = { GR: '地上波（GR）', BS: 'BS放送（BS）', CS: 'CS放送（CS）', SKY: 'SKY' };
				ChinachuUI.createElement('span').insertText(names[type]).insertTo(label);
				var check = ChinachuUI.createElement('input', { type: 'checkbox', 'aria-label': type }).insertTo(label);
				this.view.typeChecks[type] = check;
				Chinachu.on(check, 'change', function() {
					this.view.toolbar.one('type-' + type.toLowerCase()).click();
				}.bind(this));
			}.bind(this));
			Chinachu.on(typePanel, 'beforetoggle', function(event) {
				typeToggle.setAttribute('aria-expanded', String(event.newState === 'open'));
				if (event.newState === 'open') {
					var rect = typeToggle.getBoundingClientRect();
					typePanel.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - parseFloat(getComputedStyle(typePanel).width) - 4)) + 'px';
					typePanel.style.top = Math.min(rect.bottom + 4, Math.max(4, window.innerHeight - 240)) + 'px';
				}
			});
			this.view.toolbar.add({ key: 'type-menu', ui: typeMenu });

			var controls = ChinachuUI.createElement('div', { class: 'schedule-day-controls' });
			var tabs = ChinachuUI.createElement('div', {
				class: 'schedule-day-tabs', role: 'group', 'aria-label': '番組表の日付'
			}).insertTo(controls);
			var navigation = ChinachuUI.createElement('div', { class: 'schedule-day-navigation', hidden: true }).insertTo(controls);
			this.view.previousDay = ChinachuUI.createElement('button', {
				type: 'button', class: 'schedule-day-previous', 'aria-label': '前日の番組表', title: '前日'
			}).insertTo(navigation);
			this.view.daySelect = ChinachuUI.createElement('select', { 'aria-label': '番組表の日付' }).insertTo(navigation);
			this.view.nextDay = ChinachuUI.createElement('button', {
				type: 'button', class: 'schedule-day-next', 'aria-label': '翌日の番組表', title: '翌日'
			}).insertTo(navigation);
			this.view.dayButtons = [];
			for (var day = 0; day < 7; day++) {
				this.view.dayButtons.push(ChinachuUI.createButton({
					className: 'day',
					onSelect: this.selectDay.bind(this, day)
				}).insertTo(tabs));
				ChinachuUI.createElement('option', { value: day }).insertTo(this.view.daySelect);
			}
			Chinachu.on(this.view.previousDay, 'click', function() { this.selectDay(this.getDay() - 1); }.bind(this));
			Chinachu.on(this.view.nextDay, 'click', function() { this.selectDay(this.getDay() + 1); }.bind(this));
			Chinachu.on(this.view.daySelect, 'change', function() { this.selectDay(Number(this.view.daySelect.value)); }.bind(this));
			this.view.toolbar.add({ key: 'days', ui: controls });
			this.updateDayControls();
			var todayButton = this.view.dayButtons[0];
			var todayOption = this.view.daySelect.options[0];
			// Measure off-layout, then display exactly one date control.
			this.dayControlsObserver = new ResizeObserver(function() {
				var compact = window.matchMedia('(max-width: 451px)').matches;
				var fullToday = todayButton.getAttribute('title');
				var shortLabel = fullToday.replace(/^\d+\//, '').replace(/ .*/, '');
				todayButton.setLabel(fullToday);
				todayOption.textContent = compact ? shortLabel : fullToday;
				tabs.hidden = false;
				tabs.style.cssText = 'position:absolute;visibility:hidden;width:max-content';
				var requiredWidth = Math.ceil(tabs.getBoundingClientRect().width);
				tabs.style.cssText = '';
				var toolbar = controls.parentElement;
				navigation.hidden = false;
				navigation.style.cssText = 'position:absolute;visibility:hidden;width:max-content';
				var navigationWidth = Math.ceil(navigation.getBoundingClientRect().width);
				navigation.style.cssText = '';
				var typeButtons = Array.from(toolbar.querySelectorAll('.schedule-type-filter'));
				typeMenu.hidden = true;
				typeButtons.forEach(function(button) { button.hidden = false; });
				var siblings = Array.from(toolbar.children).filter(function(item) {
					return item !== controls && item.getBoundingClientRect().width > 0;
				});
				var header = toolbar.closest('.main-head');
				var headerStyle = getComputedStyle(header);
				var rowWidth = header.clientWidth - parseFloat(headerStyle.paddingLeft) - parseFloat(headerStyle.paddingRight);
				var available = rowWidth - siblings.reduce(function(total, item) {
					return total + item.getBoundingClientRect().width;
				}, 0) - parseFloat(getComputedStyle(toolbar).columnGap) * siblings.length;
				available -= window.matchMedia('(min-width: 801px)').matches ? 12 : 16;
				var shortToday = compact;
				if (compact) available += 18;
				// Try the shorter today label before moving dates onto another row.
				if (!compact && available < requiredWidth) {
					shortToday = true;
					available += 18;
					todayButton.setLabel(shortLabel);
					tabs.style.cssText = 'position:absolute;visibility:hidden;width:max-content';
					requiredWidth = Math.ceil(tabs.getBoundingClientRect().width);
					tabs.style.cssText = '';
				}
				var groupedTypes = compact && available < navigationWidth;
				if (groupedTypes) {
					typeMenu.hidden = false;
					available += typeButtons.reduce(function(total, button) { return total + button.getBoundingClientRect().width; }, 0)
						+ parseFloat(getComputedStyle(toolbar).columnGap) * 3 - typeMenu.getBoundingClientRect().width - 2;
					typeButtons.forEach(function(button) { button.hidden = true; });
				} else if (typePanel.matches(':popover-open')) {
					typePanel.hidePopover();
				}
				var split = available < (compact ? navigationWidth : requiredWidth);
				toolbar.classList.toggle('schedule-toolbar-split', split);
				controls.classList.toggle('schedule-today-short', shortToday);
				controls.style.width = (compact ? Math.min(navigationWidth, rowWidth) : split ? rowWidth : requiredWidth) + 'px';
				tabs.hidden = compact;
				navigation.hidden = !compact;
				controls.classList.toggle('is-compact', compact);
				typeButtons.forEach(function(button) { button.style.translate = ''; });
				if (!split && !groupedTypes && window.matchMedia('(max-width: 800px)').matches) {
					// Center the visible text group between the page edge and date control.
					var firstText = document.createRange(), lastText = document.createRange();
					firstText.selectNodeContents(typeButtons[0]);
					lastText.selectNodeContents(typeButtons[typeButtons.length - 1]);
					var offset = (header.getBoundingClientRect().left + controls.getBoundingClientRect().left - firstText.getBoundingClientRect().left - lastText.getBoundingClientRect().right) / 2;
					typeButtons.forEach(function(button) { button.style.translate = offset + 'px 0'; });
				}
			});
			this.dayControlsObserver.observe(controls);
			this.dayControlsObserver.observe(controls.parentElement);
			this.dayControlsObserver.observe(controls.closest('.main-head'));
			this.view.dayButtons.forEach(function(button) {
				this.dayControlsObserver.observe(button);
			}.bind(this));


			this.view.toolbar.add({
				key: 'config',
				ui : new ChinachuUI.ActionButton({
					className: 'schedule-settings-button',
					attribute: { 'aria-label': '設定', title: '設定' },
					label  : '設定',
					icon   : './icons/wrench-screwdriver.png',
					onClick: function () {

						var form = ChinachuUI.createForm({
							fields: [
								{
									key: 'categories',
									label: '表示ジャンル',
									input: {
										type : 'checkboxes',
										val  : JSON.parse(localStorage.getItem('schedule.visible.categories') || '["anime", "information", "news", "sports", "variety", "drama", "music", "cinema", "theater", "hobby", "welfare", "documentary", "etc"]'),
										items: [
											'anime', 'information', 'news', 'sports', 'variety', 'documentary',
											'drama', 'music', 'cinema', 'theater', 'hobby', 'welfare', 'etc'
										]
									}
								},
								{
									key  : 'hideChannels',
									label: '隠すCH',
									input: {
										type : 'checkboxes',
										val  : JSON.parse(localStorage.getItem('schedule.hide.channels') || '[]'),
										items: global.chinachu.schedule.map(function (a) {
											return {
												label: a.name,
												value: a.id
											};
										})
									}
								}
							]
						});

						ChinachuUI.createModal({
							title: '番組表設定',
							content: form.element,
							buttons: [
								{
									label: '適用',
									color: '@pink',
									onSelect: function (e, modal) {

										var result = form.getResult();

										localStorage.setItem('schedule.visible.categories', JSON.stringify(result.categories));
										localStorage.setItem('schedule.hide.channels', JSON.stringify(result.hideChannels));

										this.refresh();
										modal.close();
									}.bind(this)
								},
								{
									label: Chinachu.t('キャンセル'),
									onSelect: function (e, modal) {
										modal.close();
									}
								}
							]
						}).open();
					}.bind(this)
				})
			});

			return this;
		},

		getDay: function () {
			var day = Number(this.self.query.day || 0);
			return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0;
		},

		selectDay: function (day) {
			if (!Number.isInteger(day) || day < 0 || day > 6) return;
			this.self.query.day = String(day);
			location.hash = '!/schedule/table/' + Chinachu.serializeQuery(this.self.query) + '/';
		},

		updateDayControls: function () {
			var selected = this.getDay();
			var today = new Date(this.time);
			var weekdays = ['日', '月', '火', '水', '木', '金', '土'];
			this.view.dayButtons.forEach(function(button, day) {
				var date = new Date(this.time + 86400000 * day);
				var showMonth = day === 0 || date.getMonth() !== today.getMonth() || date.getFullYear() !== today.getFullYear();
				var label = (showMonth ? (date.getMonth() + 1) + '/' : '') + date.getDate() + '(' + weekdays[date.getDay()] + ')';
				if (day === 0) label += ' ' + date.getHours() + '時〜';
				button.setLabel(label);
				if (day === 0) {
					button.setAttribute('aria-label', label);
					button.setAttribute('title', label);
				}
				button[day === selected ? 'select' : 'unselect']();
				this.view.daySelect.options[day].textContent = day === 0 && window.matchMedia('(max-width: 451px)').matches ? label.replace(/^\d+\//, '').replace(/ .*/, '') : label;
			}, this);
			this.view.daySelect.value = String(selected);
			this.view.daySelect.title = this.view.dayButtons[selected].getAttribute('title') || this.view.daySelect.options[selected].textContent;
			this.view.previousDay.disabled = selected === 0;
			this.view.nextDay.disabled = selected === 6;
		},

		draw: function () {

			if (this.view.popoverDrawer) this.view.popoverDrawer.remove();
			this.updateDayControls();
			this.view.content.className = 'fullscreen timetable';
			this.view.content.update();

			this.view.board = ChinachuUI.createElement('div', {'class': 'board'}).insertTo(this.view.content);

			if (global.chinachu.schedule.length === 0) {
				return;
			}
			var isScrolling = false;
			this.data.scrollStart = [0, 0];
			this.data.scrollEnd   = [0, 0];
			this.data.scrollDelta = [0, 0];
			this.data.target      = null;

			var unitlen = this.unitlen = 50;
			var linelen      = 140;
			var types        = JSON.parse(window.localStorage.getItem('schedule.visible.types') || '["GR", "BS", "CS", "SKY"]');
			var categories   = this.categories = JSON.parse(window.localStorage.getItem('schedule.visible.categories') || '["anime", "information", "news", "sports", "variety", "drama", "theater", "hobby", "welfare", "documentary", "music", "cinema", "etc"]');
			var hideChannels = JSON.parse(window.localStorage.getItem('schedule.hide.channels') || "[]");

			var day = this.getDay();
			var timeRangeStart = this.time + 86400000 * day;
			var timeRangeEnd   = timeRangeStart + 86400000;

			var total  = 0;
			var count  = 0;
			var maxlen = this.time + 86400000 + 3600000;
			var maxH   = (maxlen - this.time) / 1000 / 1000 * unitlen;

			var piece  = this.data.piece  = {};// piece of canvas programs
			var pieces = this.data.pieces = [];// array of program pieces

			var k = 0;

			this.view.head = ChinachuUI.createElement('div', {'class': 'head'}).insertTo(this.view.content);

			// ツールバー
			['GR', 'BS', 'CS', 'SKY'].forEach(function(type) {
				var control = this.view.toolbar.one('type-' + type.toLowerCase());
				control.setAttribute('aria-pressed', String(types.indexOf(type) !== -1));
				control.disabled = false;
				this.view.typeChecks[type].checked = types.indexOf(type) !== -1;
			}.bind(this));

			global.chinachu.schedule.forEach(function (channel, i) {
				if (channel.programs.length === 0) { return; }
				if (types.indexOf(channel.type) === -1) { return; }
				if (hideChannels.indexOf(channel.id) !== -1) { return; }

				var x = k;

				var posX   = (5 + x * (5 + linelen));
				var width  = linelen;

				var ch = new ChinachuUI.Container({
					style: {
						left  : posX + 'px',
						width : width + 'px'
					}
				}).render(this.view.head);
				ch.entity.textContent = channel.name;

				// ライブ視聴用コンテキストメニュー
				var contextMenuItems = [
					{
						label   : 'ライブ視聴',
						icon    : './icons/film.png',
						onSelect: function () {
							window.location.hash = '!/channel/watch/id=' + channel.id;
						}
					}
				];
				ChinachuUI.createContextMenu({
					target: ch.entity,
					items : contextMenuItems
				});

				ch.entity.observe('click', function () {
					window.location.hash = '!/search/top/skip=1&chid=' + channel.id + '/';
				});

				channel.programs.forEach(function (program, j) {
					if (program.end + 7200000 < timeRangeStart || program.start > timeRangeEnd + 3600000) {
						return;
					}

					var posY   = Math.floor((program.start - timeRangeStart) / 1000 / 1000 * unitlen + 100);
					var height = Math.floor(program.seconds / 1000 * unitlen);

					if (posY > maxH) {
						return;
					} else if (posY + height > maxH) {
						height = maxH - posY;
					}

					// color: this.app.def.categoryColor[program.category] || '#ffffff'

					// add to piece
					piece[program.id] = {
						id     : program.id,
						program: program,
						posX   : posX,
						posY   : posY,
						width  : width,
						height : height
					};

					pieces.push(piece[program.id]);
				}.bind(this));

				++k;
				total += channel.programs.length;
			}.bind(this));

			global.chinachu.reserves.forEach(function (program) {
				if (typeof piece[program.id] === 'undefined') { return; }

				piece[program.id].isReserved = true;

				if (program.isManualReserved) {
					piece[program.id].isManualReserved = true;
				}
				if (program.isSkip) {
					piece[program.id].isSkip = true;
				}
				if (program.isConflict) {
					piece[program.id].isConflict = true;
				}
			});

			global.chinachu.recording.forEach(function (program) {
				if (typeof piece[program.id] === 'undefined') { return; }

				piece[program.id].isRecording = true;
			});

			// 現在時刻表示線
			this.view.hand = new ChinachuUI.Container({className: 'handline'}).render(this.view.board);
			this.view.hand.entity.style.top   = 100 + 'px';
			this.view.hand.entity.style.width = (5 + k * (5 + linelen)) + 'px';

			// スケール
			this.view.timescale = ChinachuUI.createElement('div', {'class': 'timescale'}).insertTo(this.view.content);

			this.view.timescale.setStyle({'height': maxH + 20 + 'px'});


			var ld  = -1;
			var lm  = -1;

			var i, lim;
			for (i = this.time, lim = this.time + 60000 * 12000; maxlen > i && lim > i; i += 60000) {
				var date = new Date(i);
				var d    = date.getDate();
				var m    = date.getMinutes();

				if ((m === 0) && (lm !== m) && (ld === d)) {
					lm = m;

					this.view.timescale.insert(
						ChinachuUI.createElement('div', { 'class': 'long h' + date.getHours() }).setStyle({
							top: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
						}).insert(date.getHours())
					);
				}

				if ((m === 30) && (lm !== m)) {
					lm = m;

					this.view.timescale.insert(
						ChinachuUI.createElement('div', { 'class': 'middle' }).setStyle({
							top: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
						})
					);
				}

				if (((m === 10) || (m === 20) || (m === 40) || (m === 50)) && (lm !== m)) {
					lm = m;

					this.view.timescale.insert(
						ChinachuUI.createElement('div', { 'class': 'short' }).setStyle({
							top: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
						})
					);
				}

				if (ld !== d) {
					ld = d;

					if (m === 0) {
						new ChinachuUI.Container({
							className: 'cutline',
							style    : {
								top  : (150 + (i - this.time) / 1000 / 1000 * unitlen) + 'px',
								width: (5 + k * (5 + linelen)) + 'px'
							}
						}).render(this.view.board);
					}
				}
			}

			// 日付上下移動ボタン
			if (day > 0) {
				ChinachuUI.createButton({
					label: '▲',
					color: '@inverse',
					className: 'prev',
					onSelect: function () {
						this.selectDay(day - 1);
					}.bind(this)
				}).insertTo(this.view.timescale);
			}
			if (day < 6) {
				ChinachuUI.createButton({
					label: '▼',
					color: '@inverse',
					className: 'next',
					onSelect: function () {
						this.selectDay(day + 1);
					}.bind(this)
				}).insertTo(this.view.timescale);
			}

			// drawer
			this.view.drawer = ChinachuUI.createElement('div', {'class': 'drawer'});
			this.view.drawerHead = ChinachuUI.createElement('div', {'class': 'head'}).insertTo(this.view.drawer);
			this.view.drawerBody = ChinachuUI.createElement('div', {'class': 'body'}).insertTo(this.view.drawer);
			this.view.drawerFoot = ChinachuUI.createElement('div', {'class': 'foot'}).insertTo(this.view.drawer);

			this.view.popoverDrawer = ChinachuUI.createPopover({
				element: this.view.drawer
			});

			// events
			var viewDrawer = function () {

				if (this.data.target === null) {
					this.view.popoverDrawer.close();
					return;
				}

				this.view.popoverDrawer.open(this.data.piece[this.data.target.id]._rect);

				this.view.drawerHead.update();

				ChinachuUI.createElement('div', {'class': 'date'}).insertText(
					Chinachu.formatDate(this.data.target.start, 'mm/dd HH:MM')
				).insert(
					ChinachuUI.createElement('small').insert('&plus;' + (this.data.target.seconds / 60) + 'min')
				).insertTo(this.view.drawerHead);

				if (this.view.drawerDt) { this.view.drawerDt.remove(); }

				this.view.drawerDt = new chinachu.ui.DynamicTime({
					tagName: 'span',
					type   : 'delta',
					time   : this.data.target.start
				});

				this.view.drawerHead.insert(this.view.drawerDt.entity);

				ChinachuUI.createElement('span', { 'class': 'channel' }).insertText(this.data.target.channel.type + ': ' + this.data.target.channel.name).insertTo(this.view.drawerHead.entity || this.view.drawerHead);

				this.view.drawerBody.update();
				var drawerTitle = ChinachuUI.createElement('div', { 'class': 'title' }).insertTo(this.view.drawerBody.entity || this.view.drawerBody);
				ChinachuUI.createElement('span', { 'class': 'label-cat-' + this.data.target.category }).insertText(this.data.target.category).insertTo(drawerTitle);
				drawerTitle.insertText(' ' + this.data.target.title);
				ChinachuUI.createElement('div', { 'class': 'detail' }).insertText(this.data.target.detail || '').insertTo(this.view.drawerBody.entity || this.view.drawerBody);
				ChinachuUI.createElement('div', { 'class': 'id' }).insertText(this.data.target.id).insertTo(this.view.drawerBody.entity || this.view.drawerBody);

				this.view.drawerFoot.update(
					new ChinachuUI.Button({
						label   : '番組詳細',
						color   : '@pink',
						onSelect: function () {
							location.hash = '!/program/view/id=' + this.data.target.id + '/';
						}.bind(this)
					})
				);
			}.bind(this);

			//
			// イベントとか
			//
			var onKeydown = function (e) {
				if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], wa-input, wa-select, wa-dialog')) return;

				var deltaX = 0;
				var deltaY = 0;

				if (e.keyCode === 37 || e.keyCode === 65) { deltaX = 40; }
				if (e.keyCode === 38 || e.keyCode === 87) { deltaY = 40; }
				if (e.keyCode === 39 || e.keyCode === 68) { deltaX = -40; }
				if (e.keyCode === 40 || e.keyCode === 83) { deltaY = -40; }

				if (this.data.target !== null) {
					if (e.keyCode === 27) {
						this.data.target = null;
						viewDrawer();
					}
				}

				this.data.scrollStat  = 0;
				this.data.scrollStart = [0, 0];
				this.data.scrollEnd   = [0, 0];
				this.data.scrollDelta = [deltaX, deltaY];

				clearTimeout(this.timer.inertiaScroll);
				var inertiaScroll = function () {
					var x = this.data.scrollDelta[0] * 0.75;
					var y = this.data.scrollDelta[1] * 0.75;

					if ((x > 1 || x < -1) || (y > 1 || y < -1)) {
						this.data.scrollEnd[0] += x;
						this.data.scrollEnd[1] += y;
						this.scroller();
						this.timer.inertiaScroll = setTimeout(inertiaScroll, 30);
					}
				}.bind(this);
				inertiaScroll();
			}.bind(this);

			this.bindPointerEvents(this.view.content, function() {
				if (window.innerWidth < 640 && this.data.target) {
					location.hash = '!/program/view/id=' + this.data.target.id + '/';
				} else {
					viewDrawer();
				}
			}.bind(this));

			Chinachu.on(window, 'keydown', onKeydown);
			var removeListenersOnUnload = function () {
				if (this.pointerCleanup) this.pointerCleanup();

				Chinachu.off(window, 'keydown', onKeydown);

				Chinachu.off(document, 'chinachu:page:unload', removeListenersOnUnload);
			}.bind(this);
			Chinachu.on(document, 'chinachu:page:unload', removeListenersOnUnload);

			if (!this.started) {
				this.started = true;

				// start
				this.tick();
			}

			return this;
		},//<--draw


	bindPointerEvents: function(surface, showDetails) {
		if (this.pointerCleanup) this.pointerCleanup();
		var page = this;
		var active = null;
		var origin;
		function down(event) {
			if (event.isPrimary === false || event.button !== 0 || event.target.closest('button, wa-button, input, a, .drawer')) return;
			clearTimeout(page.timer.inertiaScroll);
			active = event.pointerId;
			origin = [event.clientX, event.clientY];
			page.data.scrollStart = origin.slice();
			page.data.scrollEnd = origin.slice();
			page.data.scrollDelta = [0, 0];
			var target = event.target.closest('[rel]');
			var item = target && page.data.piece[target.getAttribute('rel')];
			page.data.target = item ? item.program : null;
			surface.setPointerCapture(active);
			event.preventDefault();
		}
		function move(event) {
			if (event.pointerId !== active) return;
			page.data.scrollEnd = [event.clientX, event.clientY];
			page.scroller();
			event.preventDefault();
		}
		function up(event) {
			if (event.pointerId !== active) return;
			if (surface.hasPointerCapture(active)) surface.releasePointerCapture(active);
			active = null;
			if (event.type !== 'pointerup') return;
			if (Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) <= 5) {
				showDetails();
				return;
			}
			function inertia() {
				var x = page.data.scrollDelta[0] * 0.75;
				var y = page.data.scrollDelta[1] * 0.75;
				if (Math.abs(x) <= 1 && Math.abs(y) <= 1) return;
				page.data.scrollEnd[0] += x;
				page.data.scrollEnd[1] += y;
				page.scroller();
				page.timer.inertiaScroll = setTimeout(inertia, 30);
			}
			inertia();
		}
		surface.style.touchAction = 'none';
		surface.addEventListener('pointerdown', down);
		surface.addEventListener('pointermove', move);
		surface.addEventListener('pointerup', up);
		surface.addEventListener('pointercancel', up);
		surface.addEventListener('lostpointercapture', up);
		this.pointerCleanup = function() {
			active = null;
			clearTimeout(page.timer.inertiaScroll);
			surface.removeEventListener('pointerdown', down);
			surface.removeEventListener('pointermove', move);
			surface.removeEventListener('pointerup', up);
			surface.removeEventListener('pointercancel', up);
			surface.removeEventListener('lostpointercapture', up);
		};
	},

		scroller: function () {
			if (
				(this.data.scrollStart[0] - this.data.scrollEnd[0] !== 0) ||
				(this.data.scrollStart[1] - this.data.scrollEnd[1] !== 0)
			) {
				this.data.scrollDelta = [
					this.data.scrollEnd[0] - this.data.scrollStart[0],
					this.data.scrollEnd[1] - this.data.scrollStart[1]
				];

				this.view.content.scrollLeft -= this.data.scrollDelta[0];
				this.view.content.scrollTop  -= this.data.scrollDelta[1];

				this.data.scrollStart = [this.data.scrollEnd[0], this.data.scrollEnd[1]];
			} else {
				this.data.scrollDelta = [0, 0];
			}

			return this;
		},//<--scroller

		tick: function () {

			// window.requestAnimationFrame
			(
				window.requestAnimationFrame || window.mozRequestAnimationFrame ||
				window.webkitRequestAnimationFrame || window.msRequestAnimationFrame
			)(
				this.tick.bind(this)
			);

			this.render();

			return this;
		},//<--tick

		render: function () {

			var bounds = this.view.content.getBoundingClientRect();
			this.view.head.style.top = bounds.top + 'px';
			this.view.head.style.left = (bounds.left + 20) + 'px';
			var left   = this.view.content.scrollLeft - 200;
			var top    = this.view.content.scrollTop;
			var right  = left + bounds.width + 400;
			var bottom = top + bounds.height;

			this.view.timescale.style.marginLeft = (left + 200) + 'px';
			this.view.head.style.marginLeft = '-' + (left + 200) + 'px';

			this.view.hand.entity.style.top = Math.round((Date.now() - this.time) / 1000 / 1000 * this.unitlen + 100) + 'px';

			this.data.pieces.forEach(function (a, i) {
				// 表示範囲か
				if (
					(a.posX > left) &&
					(a.posY > top || a.posY + a.height > top) &&
					(a.posX < right) &&
					(a.posY < bottom || a.posY + a.height < bottom)
				) {
					if (typeof a._rect === 'undefined') {
						var date = new Date(a.program.start);

						a._rect              = ChinachuUI.createElement('div');
						a._rect.className    = 'rect bg-cat-' + a.program.category + ((this.categories.indexOf(a.program.category) === -1) ? ' muted' : '');
						a._rect.style.left   = a.posX + 'px';
						a._rect.style.top    = a.posY + 'px';
						a._rect.style.width  = a.width + 'px';
						a._rect.style.height = a.height + 'px';

						a._label = ChinachuUI.createElement('div').insertTo(a._rect);
						ChinachuUI.createElement('h4').insertText(Chinachu.pad(date.getHours(), 2) + ':' + Chinachu.pad(date.getMinutes(), 2) + ' ' + a.program.title).insertTo(a._label);
						var flags = ChinachuUI.createElement('div').insertTo(a._label);
						(a.program.flags || []).forEach(function(flag) {
							ChinachuUI.createElement('span', { rel: a.id, 'class': flag }).insertText(flag).insertTo(flags);
						});
						ChinachuUI.createElement('span').insertText(String(a.program.detail || '').slice(0, 200)).insertTo(a._label);

						a._rect.title = a.program.fullTitle;

						a._rect.setAttribute('rel', a.id);

						if (a.isReserved)  { a._rect.addClassName('reserved'); }
						if (a.isRecording) { a._rect.addClassName('recording'); }

						this.view.board.appendChild(a._rect);

						{
							var contextMenuItems = [
								{
									label   : 'ルール作成...',
									icon    : './icons/regular-expression.png',
									onSelect: function () {
										var dummy = new chinachu.ui.CreateRuleByProgram(a.program.id);
									}
								},
								'------------------------------------------',
								{
									label   : 'タイトルをコピー...',
									onSelect: function() {
										chinachu.ui.copyStr(a.program.title);
									}
								},
								{
									label   : '説明をコピー...',
									onSelect: function() {
										chinachu.ui.copyStr(a.program.detail);
									}
								},
								{
									label   : 'IDをコピー...',
									onSelect: function () {
										chinachu.ui.copyStr(a.program.id);
									}
								}
							];

							if (a.isReserved) {
								if (a.isManualReserved) {
									contextMenuItems.unshift({
										label   : '予約取消...',
										icon    : './icons/cross-script.png',
										onSelect: function () {
											var dummy = new chinachu.ui.Unreserve(a.program.id);
										}
									});
								} else if (a.isSkip) {
									a._rect.addClassName('skip');
									contextMenuItems.unshift({
										label   : 'スキップの取消...',
										icon    : './icons/tick-circle.png',
										onSelect: function () {
											var dummy = new chinachu.ui.Unskip(a.program.id);
										}
									});
								} else {
									contextMenuItems.unshift({
										label   : 'スキップ...',
										icon    : './icons/exclamation-red.png',
										onSelect: function () {
											var dummy = new chinachu.ui.Skip(a.program.id);
										}
									});
								}
								if (a.isConflict) {
									a._rect.addClassName('conflict');
								}
							} else {
								contextMenuItems.unshift({
									label   : '予約...',
									icon    : './icons/plus-circle.png',
									onSelect: function () {
										var dummy = new chinachu.ui.Reserve(a.program.id);
									}
								});
							}

							if (a.isRecording) {
								contextMenuItems.unshift({
									label   : '録画中止...',
									icon    : './icons/cross.png',
									onSelect: function () {
										var dummy = new chinachu.ui.StopRecord(a.program.id);
									}
								});
							}

							ChinachuUI.createContextMenu({
								target: a._rect,
								items : contextMenuItems
							});
						}

						a.isVisible = true;
					}

					if (a.isVisible === false) {
						a._rect.style.display = '';
						a.isVisible = true;
					}

					if (this.data.target !== null && this.data.target.id === a.id) {
						a._rect.addClassName('spot');
					} else if (a._rect.hasClassName('spot') === true) {
						a._rect.removeClassName('spot');
					}
				} else {
					if (a._rect && a.isVisible === true) {
						a._rect.style.display = 'none';
						a.isVisible = false;
					}
				}
			}.bind(this));

			return this;
		}//<--render
	});
}());
