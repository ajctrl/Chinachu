Chinachu.definePage({

	init: function() {

		this.view.content.className = 'loading';

		this.program = chinachu.util.getProgramById(this.self.query.id);

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:schedule', this.onNotify);
		Chinachu.on(document, 'chinachu:reserves', this.onNotify);
		Chinachu.on(document, 'chinachu:recording', this.onNotify);
		Chinachu.on(document, 'chinachu:recorded', this.onNotify);

		if (this.program === null) {
			this.timer.notFound = setTimeout(function () {
				window.location.hash = '!/dashboard/top/';
			}, 3000);

			return this;
		}

		this.initToolbar();
		this.draw();

		// ホットキー
		Chinachu.shortcuts.add("Left", function () {
			try { document.getElementById("program-view-link-to-prev").click(); } catch (e) {}
		});
		Chinachu.shortcuts.add("Right", function () {
			try { document.getElementById("program-view-link-to-next").click(); } catch (e) {}
		});

		return this;
	},

	deinit: function() {

		// ホットキー
		Chinachu.shortcuts.remove("Left");
		Chinachu.shortcuts.remove("Right");

		Chinachu.off(document, 'chinachu:schedule', this.onNotify);
		Chinachu.off(document, 'chinachu:reserves', this.onNotify);
		Chinachu.off(document, 'chinachu:recording', this.onNotify);
		Chinachu.off(document, 'chinachu:recorded', this.onNotify);

		this.app.view.mainBody.entity.style.backgroundImage = '';

		return this;
	},

	refresh: function() {

		this.app.pm.realizeHash(true);

		return this;
	},

	initToolbar: function _initToolbar() {

		var program = this.program;

		this.view.toolbar.add({
			key: null,
			ui : new ChinachuUI.ActionButton({
				label  : 'ルールを作成',
				icon   : './icons/regular-expression.png',
				onClick: function() {
					new chinachu.ui.CreateRuleByProgram(program.id);
				}
			})
		});

		if (program._isReserves) {
			if (program.isManualReserved) {
				this.view.toolbar.add({
					key: null,
					ui : new ChinachuUI.ActionButton({
						label   : '予約取消',
						icon    : './icons/cross-script.png',
						onClick: function() {
							new chinachu.ui.Unreserve(program.id);
						}
					})
				});
			}
			if (program.isSkip) {
				this.view.toolbar.add({
					key: null,
					ui : new ChinachuUI.ActionButton({
						label   : 'スキップの取消',
						icon    : './icons/tick-circle.png',
						onClick: function() {
							new chinachu.ui.Unskip(program.id);
						}
					})
				});
			} else {
				this.view.toolbar.add({
					key: null,
					ui : new ChinachuUI.ActionButton({
						label   : 'スキップ',
						icon    : './icons/exclamation-red.png',
						onClick: function() {
							new chinachu.ui.Skip(program.id);
						}
					})
				});
			}
		} else {
			if (!program._isRecorded) {
				this.view.toolbar.add({
					key: null,
					ui : new ChinachuUI.ActionButton({
						label   : '手動予約',
						icon    : './icons/plus-circle.png',
						onClick: function() {
							new chinachu.ui.Reserve(program.id);
						}
					})
				});
			}
		}

		if (program._isRecording) {
			this.view.toolbar.add({
				key: null,
				ui : new ChinachuUI.ActionButton({
					label   : '録画中止',
					icon    : './icons/cross.png',
					onClick: function() {
						new chinachu.ui.StopRecord(program.id);
					}
				})
			});
		}

		if (program._isRecorded) {
			this.view.toolbar.add({
				key: null,
				ui : new ChinachuUI.ActionButton({
					label  : '削除',
					icon   : './icons/cross-script.png',
					onClick: function() {
						new chinachu.ui.RemoveRecordedProgram(program.id);
					}
				})
			});
		}

		if (program.recorded) {
			if (global.chinachu.status.feature.filer) {
				this.view.toolbar.add({
					key: 'download',
					ui : new ChinachuUI.ActionButton({
						label  : 'ダウンロード',
						icon   : './icons/disk.png',
						onClick: function() {
							new chinachu.ui.DownloadRecordedFile(program.id);
						}
					})
				});
			}

			if (global.chinachu.status.feature.streamer && !program.tuner.isScrambling) {
				this.view.toolbar.add({
					key: 'streaming',
					ui : new ChinachuUI.ActionButton({
						label  : 'ストリーミング再生',
						icon   : './icons/film-youtube.png',
						onClick: function() {
							new chinachu.ui.Streamer(program.id);
						}
					})
				});
			}
		}

		return this;
	},

	appendDescription: function(parent, value) {
		var text = String(value || '');
		var pattern = /https?:\/\/[^\s<>"']+|ｈｔｔｐｓ?：／／[^\s<>"'＜＞＂＇]+/gi;
		var offset = 0;
		var match;
		while ((match = pattern.exec(text))) {
			parent.appendChild(document.createTextNode(text.slice(offset, match.index)));
			var source = match[0];
			var normalized = source.replace(/[！-～]/g, function(character) {
				return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
			});
			try {
				var url = new URL(normalized);
				if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL');
				var link = document.createElement('a');
				link.href = url.href;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				link.textContent = source;
				parent.appendChild(link);
			} catch (error) {
				parent.appendChild(document.createTextNode(source));
			}
			offset = pattern.lastIndex;
		}
		parent.appendChild(document.createTextNode(text.slice(offset)));
	},

	draw: function() {

		var program = this.program;

		this.view.content.className = 'ex program-page';
		this.view.content.update();

		var title = document.createDocumentFragment();
		function titlePart(text, className) {
			var span = document.createElement('span');
			span.className = className;
			span.textContent = text;
			title.appendChild(span);
		}
		if (program.isManualReserved) titlePart('手動', 'flag manual');
		if (program.isSkip) titlePart('スキップ', 'flag skip');
		(program.flags || []).forEach(function(flag) { titlePart(flag, 'flag ' + flag); });
		title.appendChild(document.createTextNode(program.title || ''));
		if (program.subTitle && program.title.indexOf(program.subTitle) === -1) titlePart(' ' + program.subTitle, 'subtitle');
		if (program.episode !== undefined && program.episode !== null) titlePart(' #' + program.episode, 'episode');
		titlePart(' #' + program.id, 'id');
		this.view.title.update(title);

		if (program._isReserves) {
			if (program.isSkip) {
				new ChinachuUI.Alert({
					title       : 'スキップ',
					type        : 'yellow',
					body        : 'この番組はスキップするように設定されています',
					disableClose: true
				}).render(this.view.content);
			} else if (program.isConflict) {
				new ChinachuUI.Alert({
					title       : '競合',
					type        : 'red',
					body        : 'この番組は録画予約されていますが競合のため録画できない可能性があります',
					disableClose: true
				}).render(this.view.content);
			} else {
				new ChinachuUI.Alert({
					title       : '予約済',
					type        : 'blue',
					body        : 'この番組は録画予約されています',
					disableClose: true
				}).render(this.view.content);
			}
		}

		if (program._isRecording) {
			new ChinachuUI.Alert({
				title       : '録画中',
				type        : 'red',
				body        : program.recorded,
				disableClose: true
			}).render(this.view.content);
		}

		// create layout grid
		var container = ChinachuUI.createElement("div", { "class": "page-layout" }).insertTo(this.view.content);
		var r1 = ChinachuUI.createElement("div", { "class": "layout-row" }).insertTo(container);
		var r1L = ChinachuUI.createElement("div", { "class": "layout-main" }).insertTo(r1);
		var r1R = ChinachuUI.createElement("div", { "class": "layout-third" }).insertTo(r1);
		var r2 = ChinachuUI.createElement("div", { "class": "layout-row" }).insertTo(container);
		var r2F = ChinachuUI.createElement("div", { "class": "layout-full" }).insertTo(r2);

		var meta = ChinachuUI.createElement('div', { 'class': 'program-meta' }).insertTo(r1L);
		meta.appendChild(new chinachu.ui.DynamicTime({ tagName: 'span', type: 'full', time: program.start }).entity);
		meta.appendChild(document.createTextNode(' – ' + Chinachu.formatDate(program.end, 'HH:MM') + ' (' + (program.seconds / 60) + '分間)'));
		meta.appendChild(document.createElement('br'));
		var category = ChinachuUI.createElement('span', { 'class': 'badge label-cat-' + program.category }).insertText(program.category).insertTo(meta);
		var channel = ChinachuUI.createElement('span', { 'class': 'badge label-type-' + program.channel.type }).insertText(program.channel.type + ': ').insertTo(meta);
		ChinachuUI.createElement('a', { href: '#!/search/top/skip=1&chid=' + encodeURIComponent(program.channel.id) + '/' }).insertText(program.channel.name).insertTo(channel);

		// Program data is plain text. Construct links as DOM nodes so quotes and markup
		// can never create attributes, even after normalizing full-width URLs.
		var detail = ChinachuUI.createElement('p', { 'class': 'program-detail' }).insertTo(r1L);
		this.appendDescription(detail, program.detail);

		var fullTitle = ChinachuUI.createElement('div', { 'class': 'program-full-title' }).insertTo(r1L);
		ChinachuUI.createElement('div', { 'class': 'program-full-title-label' }).insertText('完全なタイトル').insertTo(fullTitle);
		ChinachuUI.createElement('p', { 'class': 'program-full-title-text' }).insertText(program.fullTitle || '').insertTo(fullTitle);

		if (program.command) {
			new ChinachuUI.Alert({
				title       : '録画パラメーター',
				type        : 'white',
				body        : program.command,
				disableClose: true
			}).render(r1L);
		}

		if (program._isRecorded) {
			var alertRecorded = new ChinachuUI.Alert({
				title       : '録画済',
				type        : 'green',
				body        : program.recorded,
				disableClose: true
			});
			this.view.content.insert({ top: alertRecorded.entity });

			Chinachu.request('./api/recorded/' + program.id + '/file.json', {
				method: 'get',
				onSuccess: function(t) {

					if (this.app.pm.p.id !== this.id) return;

					new ChinachuUI.Alert({
						title       : 'ファイルサイズ',
						type        : 'white',
						body        : (t.responseJSON.size / 1024 / 1024 / 1024 / 1).toFixed(2) + 'GB',
						disableClose: true
					}).render(r1L);

					// 録画済みサムネイル
					var imgurl = "./api/recorded/" + program.id + "/preview.jpg?width=480&height=270";

					ChinachuUI.createElement("img", {
						"class": "program-thumbnail",
						src: imgurl + "&pos=3"
					}).insertTo(r1R);

					ChinachuUI.createElement("img", {
						"class": "program-thumbnail",
						src: imgurl + "&pos=" + Math.floor(program.seconds / 2)
					}).insertTo(r1R);

					ChinachuUI.createElement("img", {
						"class": "program-thumbnail",
						src: imgurl + "&pos=" + (program.seconds - 3)
					}).insertTo(r1R);
				}.bind(this),
				onFailure: function(t) {

					if (this.app.pm.p.id !== this.id) return;

					if (t.status === 410) {
						var alert = new ChinachuUI.Alert({
							type        : 'red',
							body        : 'この番組の録画ファイルは移動または削除されています',
							disableClose: true
						});
						alertRecorded.entity.insert({ after: alert.entity });

						['download', 'streaming'].forEach(function(key) {
							var button = this.view.toolbar.one(key);
							if (button) button.disable();
						}, this);
					}
				}.bind(this)
			});
		}

		if (program._isRecording) {
			// 録画中サムネイル
			var imgurl = "./api/recording/" + program.id + "/preview.jpg?width=480&height=270";

			ChinachuUI.createElement("img", {
				"class": "program-thumbnail",
				src: imgurl
			}).insertTo(r1R);
		}

		// pager
		var nav = ChinachuUI.createElement("nav").insertTo(r2F);
		var pager = ChinachuUI.createElement("ul", { "class": "program-pager" }).insertTo(nav);
		var programs = null;

		if (program._isRecorded) {
			programs = global.chinachu.recorded;
		} else if (program._isRecording) {
			programs = global.chinachu.recording;
		} else if (program._isReserves) {
			programs = global.chinachu.reserves;
		}

		if (programs !== null) {
			var prev = null;
			var next = null;

			for (var i = 0, l = programs.length; i < l; i++) {
				if (programs[i].id === program.id) {
					if (i >= 0) {
						prev = programs[i - 1];
					}
					if (i < l) {
						next = programs[i + 1];
					}
					break;
				}
			}

			var prevLi = ChinachuUI.createElement("li", { "class": "previous" }).insertTo(pager);
			var nextLi = ChinachuUI.createElement("li", { "class": "next" }).insertTo(pager);

			if (prev) {
				ChinachuUI.createElement("a", {
					id: "program-view-link-to-prev",
					title: prev.fullTitle,
					href: "#!/program/view/id=" + prev.id + "/"
				})
					.insertText("← " + prev.title)
					.insertTo(prevLi);
			}
			if (next) {
				ChinachuUI.createElement("a", {
					id: "program-view-link-to-next",
					title: next.fullTitle,
					href: "#!/program/view/id=" + next.id + "/"
				})
					.insertText(next.title + " →")
					.insertTo(nextLi);
			}

			ChinachuUI.createElement("p", {
				className: "muted"
			}).insert("ホットキー [ページ移動]: <code>←</code> / <code>→</code>").insertTo(r2F);
		}

		return this;
	}
});
