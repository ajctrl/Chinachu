Chinachu.definePage({

	init: function _initPage() {

		this.view.content.className = 'loading';

		this.time = new Date().getTime();

		this.initToolbar();
		this.draw();

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:schedule', this.onNotify);

		return this;
	},

	deinit: function _deinit() {
		if (this.pointerCleanup) this.pointerCleanup();

		Chinachu.off(document, 'chinachu:schedule', this.onNotify);

		this.tick = function () {};
		if (this.view.drawerDt) this.view.drawerDt.remove();
		if (this.view.clock) this.view.clock.remove();

		return this;
	},

	refresh: function _refresh() {

		Chinachu.off(document, 'chinachu:schedule', this.onNotify);

		this.app.pm.realizeHash(true);

		return this;
	},

	initToolbar: function _initToolbar() {

		/*
		this.view.toolbar.add({
			key: 'yesterday',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('TO {0}', Chinachu.t('YESTERDAY')),
				icon   : './icons/arrow-180-medium.png',
				onClick: function() {

				}.bind(this)
			})
		});

		this.view.toolbar.add({
			key: 'tomorrow',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('TO {0}', Chinachu.t('TOMORROW')),
				icon   : './icons/arrow-000-medium.png',
				onClick: function() {

				}.bind(this)
			})
		});

		this.view.toolbar.add({
			key: 'config',
			ui : new ChinachuUI.ActionButton({
				label  : Chinachu.t('CONFIG {0}', Chinachu.t('VIEW')),
				icon   : './icons/wrench-screwdriver.png',
				onClick: function() {

				}.bind(this)
			})
		});
		*/

		return this;
	},

	draw: function _draw() {

		this.view.clock = new ChinachuUI.Container({className: 'clock'}).render(this.app.view.mainHead);

		this.view.content.className = 'fullscreen timeline noscroll';
		this.view.content.update();

		this.view.board  = new ChinachuUI.Container({className: 'board'}).render(this.view.content);

		if (global.chinachu.schedule.length === 0) {
			return;
		}
		var isScrolling = false;
		this.data.scrollStart = [0, 0];
		this.data.scrollEnd   = [0, 0];
		this.data.scrollDelta = [0, 0];
		this.data.target      = null;

		var unitlen = this.unitlen = 25;
		var linelen      = 25;
		var types = JSON.parse(localStorage.getItem('schedule.visible.types') || '["GR","BS","CS","SKY"]');
		var categories = this.categories = JSON.parse(localStorage.getItem('schedule.visible.categories') || '["anime","information","news","sports","variety","drama","theater","hobby","welfare","documentary","music","cinema","etc"]');
		var hideChannels = JSON.parse(localStorage.getItem('schedule.hide.channels') || "[]");

		var total  = 0;
		var count  = 0;
		var maxlen = 0;

		var piece  = this.data.piece  = {};// piece of canvas programs
		var pieces = this.data.pieces = [];// array of program pieces

		var k = 0;

		this.view.head = new ChinachuUI.Container({className: 'head'}).render(this.view.content);

		global.chinachu.schedule.forEach(function(channel, i) {
			if (channel.programs.length === 0) return;
			if (types.indexOf(channel.type) === -1) return;
			if (hideChannels.indexOf(channel.id) !== -1) return;

			var y = k;

			var posY   = (5 + y * (5 + linelen));
			var height = linelen;

			var ch = new ChinachuUI.Container({
				style: {
					top   : posY + 'px',
					height: height + 'px'
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

			ch.entity.observe('click', function() {
				window.location.hash = '!/search/top/skip=1&chid=' + channel.id + '/';
			});

			channel.programs.forEach(function(program, j) {
				if ((program.end - this.time) < 0) {
					channel.programs = channel.programs.filter(function (item) { return item !== program; });
					return;
				}
				//if ((program.start - this.time) > 1000 * 60 * 60 * 24) {
				//	channel.programs = channel.programs.filter(function (item) { return item !== program; });
				//	return;
				//}

				var posX  = Math.floor(1 + (program.start - this.time) / 1000 / 1000 * unitlen + 150);
				var width = Math.floor(program.seconds / 1000 * unitlen - 1);

				if (maxlen < program.end) maxlen = program.end;

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

		var extentWidth = Math.max(150, 150 + (maxlen - this.time) / 1000000 * unitlen);
		var extentHeight = 5 + k * (5 + linelen);
		ChinachuUI.createElement('div', { 'class': 'timeline-extent', 'aria-hidden': 'true' }).setStyle({ width: extentWidth + 'px', height: extentHeight + 'px' }).insertTo(this.view.board.entity);

		global.chinachu.reserves.forEach(function(program) {
			if (typeof piece[program.id] === 'undefined') return;

			piece[program.id].isReserved = true;

			if (program.isManualReserved) piece[program.id].isManualReserved = true;
			if (program.isSkip)           piece[program.id].isSkip = true;
		});

		global.chinachu.recording.forEach(function(program) {
			if (typeof piece[program.id] === 'undefined') return;

			piece[program.id].isRecording = true;
		});

		// 現在時刻表示線
		this.view.hand = new ChinachuUI.Container({className: 'handline'}).render(this.view.board);
		this.view.hand.entity.style.left   = 150 + 'px';
		this.view.hand.entity.style.height = (5 + k * (5 + linelen)) + 'px';

		// スケール
		this.view.timescale = new ChinachuUI.Container({className: 'timescale'}).render(this.view.content);
		ChinachuUI.createElement('div', { 'class': 'timeline-extent', 'aria-hidden': 'true' }).setStyle({ width: Math.max(0, extentWidth - 150) + 'px', height: '1px' }).insertTo(this.view.timescale.entity);

		var ld  = -1;
		var lm  = -1;

		for (var i = this.time, lim = this.time + 60000 * 12000; maxlen > i && lim > i; i += 60000) {
			var date = new Date(i);
			var d    = date.getDate();
			var m    = date.getMinutes();

			if ((m === 0) && (lm !== m) && (ld === d)) {
				lm = m;

				this.view.timescale.insert(
					ChinachuUI.createElement('div', { className: 'long h' + date.getHours() }).setStyle({
						left: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
					}).insert(date.getHours() + 'h')
				);
			}

			if ((m === 30) && (lm !== m)) {
				lm = m;

				this.view.timescale.insert(
					ChinachuUI.createElement('div', { className: 'middle' }).setStyle({
						left: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
					})
				);
			}

			if (((m === 10) || (m === 20) || (m === 40) || (m === 50)) && (lm !== m)) {
				lm = m;

				this.view.timescale.insert(
					ChinachuUI.createElement('div', { className: 'short' }).setStyle({
						left: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
					})
				);
			}

			if (ld !== d) {
				ld = d;

				(m === 0) && new ChinachuUI.Container({
					className: 'cutline',
					style    : {
						left  : (150 + (i - this.time) / 1000 / 1000 * unitlen) + 'px',
						height: (5 + k * (5 + linelen)) + 'px'
					}
				}).render(this.view.board);

				(m === 0) && this.view.timescale.insert(
					ChinachuUI.createElement('div', { className: 'long h' + date.getHours() + ' date' }).setStyle({
						left: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
					}).insert(d + 'd')
				);

				(m !== 0) && this.view.timescale.insert(
					ChinachuUI.createElement('div', { className: 'date' }).setStyle({
						left: ((i - this.time) / 1000 / 1000 * unitlen) + 'px'
					}).insert(d + 'd')
				);
			}
		}

		// drawer
		this.view.drawer = new ChinachuUI.Container({className: 'drawer hide'}).render(this.view.content);
		this.view.drawerHead = new ChinachuUI.Container({className: 'head'}).render(this.view.drawer);
		this.view.drawerBody = new ChinachuUI.Container({className: 'body'}).render(this.view.drawer);
		this.view.drawerFoot = new ChinachuUI.Container({className: 'foot'}).render(this.view.drawer);

		// events
		var viewDrawer = function() {

			if (this.data.target === null) {
				this.view.drawer.entity.addClassName('hide');
				return;
			}

			this.view.drawer.entity.removeClassName('hide');

			this.view.drawerHead.update();

			var drawerDate = ChinachuUI.createElement('div', { 'class': 'date' }).insertText(Chinachu.formatDate(this.data.target.start, 'mm/dd HH:MM')).insertTo(this.view.drawerHead.entity);
			ChinachuUI.createElement('small').insertText('+' + (this.data.target.seconds / 60) + 'min').insertTo(drawerDate);

			if (this.view.drawerDt) this.view.drawerDt.remove();
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
					onSelect: function() {
						window.location.hash = '!/program/view/id=' + this.data.target.id + '/';
					}.bind(this)
				})
			);
		}.bind(this);


		var onMousewheel = function(e) {

			e.preventDefault();
			e.stopPropagation();

			var deltaX = 0;
			var deltaY = 0;

			if (e.wheelDeltaX) deltaX = e.wheelDeltaX / 2;
			if (e.wheelDeltaY) deltaY = e.wheelDeltaY / 2;

			if (e.deltaX) deltaX = -(e.deltaX * 20);
			if (e.deltaY) deltaY = -(e.deltaY * 20);

			this.data.scrollStat  = 0;
			this.data.scrollStart = [0, 0];
			this.data.scrollEnd   = [0, 0];
			this.data.scrollDelta = [deltaX, deltaY];

			clearTimeout(this.timer.inertiaScroll);
			var inertiaScroll = function() {
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

		var onKeydown = function(e) {
				if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], wa-input, wa-select, wa-dialog')) return;

			var deltaX = 0;
			var deltaY = 0;

			if (e.keyCode === 37 || e.keyCode === 65) deltaX = 40;
			if (e.keyCode === 38 || e.keyCode === 87) deltaY = 40;
			if (e.keyCode === 39 || e.keyCode === 68) deltaX = -40;
			if (e.keyCode === 40 || e.keyCode === 83) deltaY = -40;

			if (this.data.target !== null) {
				if (e.keyCode === 27) {
					this.data.target = null;
				}

				if (e.keyCode === 37 || e.keyCode === 65) {
					var previous = chinachu.util.getPrevProgramById(this.data.target.id);
					if (previous && this.data.piece[previous.id]) {
						this.data.target = previous;
						deltaX = this.data.piece[previous.id].width * 0.365 + 1;
					}
				}
				if (e.keyCode === 39 || e.keyCode === 68) {
					var next = chinachu.util.getNextProgramById(this.data.target.id);
					if (next && this.data.piece[next.id]) {
						deltaX = -(this.data.piece[this.data.target.id].width * 0.365 + 1);
						this.data.target = next;
					}
				}

				viewDrawer();
			}

			this.data.scrollStat  = 0;
			this.data.scrollStart = [0, 0];
			this.data.scrollEnd   = [0, 0];
			this.data.scrollDelta = [deltaX, deltaY];

			clearTimeout(this.timer.inertiaScroll);
			var inertiaScroll = function() {
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

		this.bindPointerEvents(this.view.board.entity, viewDrawer);
		Chinachu.on(this.view.board.entity, 'wheel', onMousewheel, { passive: false });

		Chinachu.on(window, 'keydown', onKeydown);
		var removeListenerOnUnload = function() {
			Chinachu.off(window, 'keydown', onKeydown);
			Chinachu.off(document, 'chinachu:page:unload', removeListenerOnUnload);
		};
		Chinachu.on(document, 'chinachu:page:unload', removeListenerOnUnload);

		// start
		this.tick();

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

	scroller: function _scroller() {
		if (
			(this.data.scrollStart[0] - this.data.scrollEnd[0] !== 0) ||
			(this.data.scrollStart[1] - this.data.scrollEnd[1] !== 0)
		) {
			this.data.scrollDelta = [
				this.data.scrollEnd[0] - this.data.scrollStart[0],
				this.data.scrollEnd[1] - this.data.scrollStart[1]
			];

			this.view.timescale.entity.scrollLeft = this.view.board.entity.scrollLeft -= this.data.scrollDelta[0];
			this.view.head.entity.scrollTop = this.view.board.entity.scrollTop -= this.data.scrollDelta[1];

			this.data.scrollStart = [this.data.scrollEnd[0], this.data.scrollEnd[1]];

			//console.log(delta);
		} else {
			this.data.scrollDelta = [0, 0];
		}

		return this;
	},//<--scroller

	tick: function _tick() {

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

	render: function _render() {

		this.view.timescale.entity.scrollLeft = this.view.board.entity.scrollLeft;
		this.view.head.entity.scrollTop = this.view.board.entity.scrollTop;
		this.view.hand.entity.style.left = (150 + (Date.now() - this.time) / 1000000 * this.unitlen) + 'px';
		var left   = this.view.board.entity.scrollLeft - 200;
		var top    = this.view.board.entity.scrollTop - 200;
		var right  = left + this.view.content.getWidth() + 400;
		var bottom = top + this.view.content.getHeight() + 400;

		this.data.pieces.forEach(function(a, i) {
			// 表示範囲か
			if ((a.posX + a.width > left) && (a.posY + a.height > top) && (a.posX < right) && (a.posY < bottom)) {
				if (typeof a._rect === 'undefined') {
					a._rect              = ChinachuUI.createElement('div');
					a._rect.className    = 'rect bg-cat-' + a.program.category + ((this.categories.indexOf(a.program.category) === -1) ? ' muted' : '');
					a._rect.style.left   = a.posX + 'px';
					a._rect.style.top    = a.posY + 'px';
					a._rect.style.width  = a.width + 'px';
					a._rect.style.height = a.height + 'px';
					ChinachuUI.createElement('div').insertText(a.program.title).insertTo(a._rect);

					if (a.program.detail) a._rect.title = a.program.detail;

					a._rect.setAttribute('rel', a.id);

					if (a.isReserved) a._rect.addClassName('reserved');
					if (a.isRecording) a._rect.addClassName('recording');

					{
						this.view.board.entity.appendChild(a._rect);

						var contextMenuItems = [
							{
								label   : 'ルール作成...',
								icon    : './icons/regular-expression.png',
								onSelect: function() {
									new chinachu.ui.CreateRuleByProgram(a.program.id);
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
								onSelect: function() {
									chinachu.ui.copyStr(a.program.id);
								}
							}
						];

						if (a.isReserved) {
							if (a.isManualReserved) {
								contextMenuItems.unshift({
									label   : '予約取消...',
									icon    : './icons/cross-script.png',
									onSelect: function() {
										new chinachu.ui.Unreserve(a.program.id);
									}
								});
							}

							if (a.isSkip) {
								a._rect.addClassName('skip');
								contextMenuItems.unshift({
									label   : 'スキップの取消...',
									icon    : './icons/tick-circle.png',
									onSelect: function() {
										new chinachu.ui.Unskip(a.program.id);
									}
								});
							} else {
								contextMenuItems.unshift({
									label   : 'スキップ...',
									icon    : './icons/exclamation-red.png',
									onSelect: function() {
										new chinachu.ui.Skip(a.program.id);
									}
								});
							}
						} else {
							contextMenuItems.unshift({
								label   : '予約...',
								icon    : './icons/plus-circle.png',
								onSelect: function() {
									new chinachu.ui.Reserve(a.program.id);
								}
							});
						}

						if (a.isRecording) {
							contextMenuItems.unshift({
								label   : '録画中止...',
								icon    : './icons/cross.png',
								onSelect: function() {
									new chinachu.ui.StopRecord(a.program.id);
								}
							});
						}

						new ChinachuUI.ContextMenu({
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

		this.view.clock.entity.textContent = (
			chinachu.dateToString(
				new Date(this.time + (this.view.board.entity.scrollLeft * 1000 * 1000 / this.unitlen))
			)
		);

		return this;
	}//<--render
});
