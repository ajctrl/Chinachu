Chinachu.definePage({

	init: function () {

		this.view.content.className = 'loading';

		this.draw();

		this.onSchedule = this.drawChannels.bind(this);
		Chinachu.on(document, 'chinachu:schedule', this.onSchedule);
		this.timer.channels = setInterval(this.onSchedule, 1000 * 15);

		this.onReserves = this.drawReserves.bind(this);
		Chinachu.on(document, 'chinachu:reserves', this.onReserves);

		this.onRecording = this.drawRecording.bind(this);
		Chinachu.on(document, 'chinachu:recording', this.onRecording);
		this.timer.recording = setInterval(this.onRecording, 1000 * 30);

		this.onRecorded = this.drawRecorded.bind(this);
		Chinachu.on(document, 'chinachu:recorded', this.onRecorded);

		return this;
	},

	deinit: function () {

		Chinachu.off(document, 'chinachu:schedule', this.onSchedule);
		Chinachu.off(document, 'chinachu:reserves', this.onReserves);
		Chinachu.off(document, 'chinachu:recording', this.onRecording);
		Chinachu.off(document, 'chinachu:recorded', this.onRecorded);

		return this;
	},

	draw: function () {

		this.view.content.className = "ex";
		this.view.content.update();

		// create layout grid
		var container = ChinachuUI.createElement("div", { "class": "page-layout" }).insertTo(this.view.content);
		var r1 = ChinachuUI.createElement("div", { "class": "layout-row" }).insertTo(container);
		var r1F = ChinachuUI.createElement("div", { "class": "layout-full" }).insertTo(r1);
		var r2 = this.r2 = ChinachuUI.createElement("div", { "class": "layout-row channel-cards" }).insertTo(container);
		var r3 = ChinachuUI.createElement("div", { "class": "layout-row program-cards" }).insertTo(container);
		this.r3L = ChinachuUI.createElement("div", { "class": "layout-third" }).insertTo(r3);
		this.r3C = ChinachuUI.createElement("div", { "class": "layout-third" }).insertTo(r3);
		this.r3R = ChinachuUI.createElement("div", { "class": "layout-third" }).insertTo(r3);

		var toggleChannels = ChinachuUI.createButton({
			label: "放送中の番組とライブ視聴...",
			className: "toggle-channels",
			onSelect: function () {

				toggleChannels.toggleClassName("dent");
				if (r2.hidden) r2.show(); else r2.hide();

				if (localStorage.getItem("dashboard.showChannels") === "yes") {
					localStorage.setItem("dashboard.showChannels", "no");
				} else {
					localStorage.setItem("dashboard.showChannels", "yes");
					this.drawChannels();
				}
			}.bind(this)
		}).insertTo(r1F);

		if (localStorage.getItem("dashboard.showChannels") === "yes") {
			toggleChannels.addClassName("dent");
		} else {
			r2.hide();
		}

		this.hideChannels = JSON.parse(localStorage.getItem('schedule.hide.channels') || '[]');

		this.timer.drawChannels = setTimeout(this.drawChannels.bind(this), 0);
		this.timer.drawReserves = setTimeout(this.drawReserves.bind(this), 0);
		this.timer.drawRecording = setTimeout(this.drawRecording.bind(this), 0);
		this.timer.drawRecorded = setTimeout(this.drawRecorded.bind(this), 0);

		return this;
	},

	drawChannels: function () {

		if (document.hidden) {
			return;
		}

		if (localStorage.getItem("dashboard.showChannels") !== "yes") {
			return this;
		}

		var r2 = this.r2;
		var hideChannels = this.hideChannels;
		var now = Date.now();

		r2.update();

		global.chinachu.schedule.forEach(function (channel) {

			if (hideChannels.indexOf(channel.id) !== -1) {
				return;
			}

			var onair = channel.programs.find(function(program) {
				return now >= program.start && now < program.end;
			});

			if (!onair) { return; }
			if (onair.title === "放送休止") { return; }

			var col = ChinachuUI.createElement("div", { "class": "layout-quarter" }).insertTo(r2);
			var card = ChinachuUI.createElement("div", { "class": "channel-card" }).insertTo(col);

			var ch = ChinachuUI.createElement("div", {
				"class": "channel label-type-" + channel.type
			}).insertTo(card);

			if (channel.hasLogoData === true) {
				ch.addClassName("has-logo");
				ch.setStyle({
					backgroundImage: "url(./api/channel/" + channel.id + "/logo.png)"
				});
			}

			ChinachuUI.createElement('a', { href: '#!/search/top/skip=1&chid=' + encodeURIComponent(channel.id) + '/' }).insertText(channel.name).insertTo(ch);

			ChinachuUI.createButton({
				className: "live",
				label: "ライブ視聴",
				onSelect: function () {
					location.hash = "!/channel/watch/id=" + channel.id;
				}
			}).insertTo(ch);

			ChinachuUI.createProgress({
				value: Date.now() - onair.start,
				max: onair.end - onair.start
			}).insertTo(card);

			ChinachuUI.createButton({
				className: "program",
				label: onair.category + " " + onair.title,
				color: "@transparent",
				attribute: {
					title: onair.fullTitle + "\n\n" + String(onair.detail || '').slice(0, 300)
				},
				onSelect: function () {
					location.hash = "!/program/view/id=" + onair.id;
				}
			}).insertTo(card);
		});

		return this;
	},

	drawReserves: function () {

		this.drawPrograms(
			Chinachu.t("RESERVES"),
			"reserves",
			"program-panel-reserves",
			this.r3L,
			global.chinachu.reserves
		);

		return this;
	},

	drawRecording: function () {

		if (document.hidden) {
			return;
		}

		this.drawPrograms(
			Chinachu.t("RECORDING"),
			"recording",
			"program-panel-recording",
			this.r3C,
			global.chinachu.recording
		);

		return this;
	},

	drawRecorded: function () {

		this.drawPrograms(
			Chinachu.t("RECORDED"),
			"recorded",
			"program-panel-recorded",
			this.r3R,
			global.chinachu.recorded
		);

		return this;
	},

	drawPrograms: function (title, type, className, container, programs) {

		container.update();

		var panel = ChinachuUI.createElement("div", {
			"class": "program-panel " + className
		}).insertTo(container);

		ChinachuUI.createElement("div", {
			"class": "program-panel-heading"
		}).insertText(
			Chinachu.t('OF{0} {1}', [programs.length.toString(10), title])
		).insertTo(panel);

		if (programs.length === 0) {
			return this;
		}

		var ul = ChinachuUI.createElement("ul", { "class": "program-list" }).insertTo(panel);

		var now = Date.now();
		var hasMore = programs.length > 11;

		programs.slice(0, 11).forEach(function (program, i) {


			program = chinachu.util.getProgramById(program.id);

			var li = ChinachuUI.createElement("li", {
				"class": "program-list-item",
				title: program.fullTitle + "\n\n" + String(program.detail || '').slice(0, 300)
			}).insertTo(ul);
			li.onclick = function () {
				location.hash = "!/program/view/id=" + program.id;
			}

			var title = ChinachuUI.createElement("div", { "class": "title" }).insertTo(li);
			ChinachuUI.createElement('span', { 'class': 'label-cat-' + program.category }).insertText(program.category).insertTo(title);
			(program.flags || []).forEach(function(flag) {
				ChinachuUI.createElement('span', { rel: flag }).insertText(flag).insertTo(title);
			});
			title.insertText(program.title);
			if (program.episode) ChinachuUI.createElement('span', { 'class': 'episode' }).insertText('#' + program.episode).insertTo(title);

			if (program._isRecording && program.pid) {
				ChinachuUI.createElement("img", {
					"class": "program-preview",
					src: "./api/recording/" + program.id + "/preview.jpg?width=480&height=270&_n=" + now
				}).insertTo(li);
			}

			var dt = new chinachu.ui.DynamicTime({
				tagName: 'span',
				type   : 'full',
				time   : (now > program.end) ? program.end : program.start
			}).entity;
			li.insert(dt);

			ChinachuUI.createElement('span', { 'class': 'badge label-type-' + program.channel.type }).insertText(program.channel.type + ': ' + program.channel.name).insertTo(li);

			var contextMenuItems = [
				{
					label   : 'ルール作成...',
					icon    : './icons/regular-expression.png',
					onSelect: function () {
						new chinachu.ui.CreateRuleByProgram(program.id);
					}
				},
				'------------------------------------------',
				{
					label   : 'タイトルをコピー...',
					onSelect: function () {
						chinachu.ui.copyStr(program.title);
					}
				},
				{
					label   : '説明をコピー...',
					onSelect: function () {
						chinachu.ui.copyStr(program.detail);
					}
				},
				{
					label   : 'IDをコピー...',
					onSelect: function () {
						chinachu.ui.copyStr(program.id);
					}
				}
			];

			contextMenuItems.unshift("---");

			if (program._isRecorded) {
				contextMenuItems.unshift({
					label   : '削除...',
					icon    : './icons/cross-script.png',
					onSelect: function () {
						new chinachu.ui.RemoveRecordedProgram(program.id);
					}
				});
			} else if (program._isRecording) {
				contextMenuItems.unshift({
					label   : '録画中止...',
					icon    : './icons/cross.png',
					onSelect: function () {
						new chinachu.ui.StopRecord(program.id);
					}
				});
			} else if (program._isReserves) {
				if (program.isConflict) {
					li.addClassName('conflict');
				}
				if (program.isManualReserved) {
					contextMenuItems.unshift({
						label   : '予約取消...',
						icon    : './icons/cross-script.png',
						onSelect: function () {
							new chinachu.ui.Unreserve(program.id);
						}
					});
				} else {
					if (program.isSkip) {
						li.addClassName('skip');
						contextMenuItems.unshift({
							label   : 'スキップの取消...',
							icon    : './icons/tick-circle.png',
							onSelect: function () {
								new chinachu.ui.Unskip(program.id);
							}
						});
					} else {
						contextMenuItems.unshift({
							label   : 'スキップ...',
							icon    : './icons/exclamation-red.png',
							onSelect: function () {
								new chinachu.ui.Skip(program.id);
							}
						});
					}
				}
			}

			ChinachuUI.createContextMenu({
				target: li,
				items : contextMenuItems
			});
		});

		if (hasMore) {
			ChinachuUI.createElement("div", {
				"class": "program-panel-footer"
			}).insert(
				'<a href="#!/' + type + '/list/">すべて表示 →</a>'
			).insertTo(panel);
		}

		return this;
	}
});
