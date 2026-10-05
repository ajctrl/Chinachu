Chinachu.definePage({

	init: function() {

		this.view.content.className = 'loading';

		this.program = chinachu.util.getProgramById(this.self.query.id);

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:recording', this.onNotify);
		Chinachu.on(document, 'chinachu:recorded', this.onNotify);

		if (this.program === null) {
			this.modal = new ChinachuUI.Modal({
				title: '番組が見つかりません',
				text : '番組が見つかりません',
				buttons: [
					{
						label: 'ダッシュボード',
						color: '@pink',
						onSelect: function(e, modal) {
							location.hash = '!/dashboard/top/';
						}
					}
				]
			}).show();
			return this;
		}

		this.initToolbar();
		this.draw();

		return this;
	}
	,
	deinit: function() {

		if (this.video) {
			this.video.src = "";
		}

		if (this.modal) setTimeout(function() { this.modal.close(); }.bind(this), 0);

		Chinachu.off(document, 'chinachu:recording', this.onNotify);
		Chinachu.off(document, 'chinachu:recorded', this.onNotify);

		return this;
	}
	,
	refresh: function() {

		if (!this.isPlaying) this.app.pm.realizeHash(true);

		return this;
	}
	,
	initToolbar: function _initToolbar() {

		var program = this.program;

		this.view.toolbar.add({
			key: 'streaming',
			ui : new ChinachuUI.ActionButton({
				label  : '番組詳細',
				icon   : './icons/film.png',
				onClick: function() {
					location.hash = '!/program/view/id=' + program.id + '/';
				}
			})
		});

		return this;
	}
	,
	draw: function() {

		var program = this.program;

		this.view.content.className = 'bg-black';
		this.view.content.update();

		var title = document.createDocumentFragment();
		function titlePart(text, className) {
			var span = document.createElement('span');
			span.className = className;
			span.textContent = text;
			title.appendChild(span);
		}
		if (program.isManualReserved) titlePart('手動', 'flag manual');
		(program.flags || []).forEach(function(flag) { titlePart(flag, 'flag ' + flag); });
		title.appendChild(document.createTextNode(program.title || ''));
		if (program.episode !== undefined && program.episode !== null) titlePart('#' + program.episode, 'episode');
		titlePart('#' + program.id, 'id');
		this.view.title.update(title);

		var saveSettings = function (d) {
			localStorage.setItem('program.watch.settings', JSON.stringify(d));
		};

		var set = JSON.parse(localStorage.getItem('program.watch.settings') || '{}');

		if (!set.s) {
			set.s = '1280x720';
		}
		if (!set.ext) {
			set.ext = 'mp4';
		}
		if (!set['b:v']) {
			set['b:v'] = '1M';
		}
		if (!set['b:a']) {
			set['b:a'] = '128k';
		}

		var buttons = [];

		var video = document.createElement("video");
		var canPlayVideo = video.canPlayType('video/webm; codecs="vp8, vorbis"') === "probably";

		if (/Android|iPhone|iPad/.test(navigator.userAgent) === true || canPlayVideo === false) {
			buttons.push({
				label  : '再生 (VLC)',
				color  : '@pink',
				onSelect: function(e, modal) {

					this.form.validate(function (success) {
						if (!success) { return; }

						var d = this.d = this.form.getResult();
						saveSettings(d);

						var url = location.host + location.pathname.replace(/\/[^\/]*$/, '');

						if (program._isRecording) {
							url += '/api/recording/';
						} else {
							url += '/api/recorded/';
						}

						url += program.id + '/watch.' + d.ext + '?' + Chinachu.serializeQuery(d);

						if (/Android/.test(navigator.userAgent) === true) {
							location.href = "intent://" + url + "#Intent;package=org.videolan.vlc;type=video;scheme=" + location.protocol.replace(':','') + ';end';
						} else {
							location.href = "vlc-x-callback://x-callback-url/stream?url=" + encodeURIComponent(location.protocol + '//' + url);
						}
					}.bind(this));
				}.bind(this)
			});
		} else {
			buttons.push({
				label  : '再生',
				color  : '@pink',
				onSelect: function(e, modal) {

					this.form.validate(function (success) {
						if (!success) { return; }

						var d = this.d = this.form.getResult();
						saveSettings(d);

						if (d.ext === 'm2ts') {
							new ChinachuUI.Modal({
								title: 'エラー',
								text : 'MPEG-2 TSコンテナの再生はサポートしていません。'
							}).show();
							return;
						}

						modal.close();
						this.play();
					}.bind(this));
				}.bind(this)
			});

			buttons.push({
				label  : 'XSPF',
				color  : '@orange',
				onSelect: function(e, modal) {

					this.form.validate(function (success) {
						if (!success) { return; }

						var d = this.form.getResult();
						saveSettings(d);

						var url = d.prefix = location.protocol + '//' + location.host + location.pathname.replace(/\/[^\/]*$/, '');

						if (program._isRecording) {
							d.prefix += '/api/recording/' + program.id + '/';
							url += '/api/recording/';
						} else {
							d.prefix += '/api/recorded/' + program.id + '/';
							url += '/api/recorded/';
						}

						url += program.id + '/watch.xspf?' + Chinachu.serializeQuery(d);
						location.href = url;
					}.bind(this));
				}.bind(this)
			});
		}

		if ('download' in document.createElement('a') && !program._isRecording) {
			buttons.push({
				label: 'ダウンロード',
				color: '@blue',
				onSelect: function(e, model) {

					this.form.validate(function (success) {
						if (!success) { return; }

						var d = this.form.getResult();
						saveSettings(d);

						d.prefix = location.protocol + '//' + location.host + '/api/recording/' + program.id + '/';
						d.mode = 'download';
						location.href = './api/recorded/' + program.id + '/watch.' + d.ext + '?' + Chinachu.serializeQuery(d);
					}.bind(this));
				}.bind(this)
			});
		}

		var modal = this.modal = new ChinachuUI.Modal({
			disableCloseByMask: true,
			disableCloseButton: true,
			target: this.view.content,
			title : 'ストリーミング再生',
			buttons: buttons
		}).show();

		var exts = [];

		exts.push({
			label     : 'M2TS',
			value     : 'm2ts'
		});
		if (canPlayVideo === true) {
			exts.push({
				label     : 'MP4',
				value     : 'mp4'
			});
		}

		this.form = ChinachuUI.createForm({
			fields: [
				{
					key: "ext",
					label: "コンテナ形式",
					input: {
						type: "radios",
						isRequired: true,
						val: set.ext,
						items: exts
					}
				},
				{
					pointer: "/c:v",
					label: "映像コーデック",
					input: {
						type: "radios",
						isRequired: true,
						val: set['c:v'],
						items: [
							{
								label: '無変換',
								value: 'copy'
							},
							{
								label: 'H.264',
								value: 'h264'
							},
							{
								label: 'MPEG-2',
								value: 'mpeg2video'
							}
						]
					},
					depends: [
						{ key: "ext", val: "m2ts" }
					]
				},
				{
					pointer: '/c:a',
					label: '音声コーデック',
					input: {
						type: 'radios',
						isRequired: true,
						val: set['c:a'],
						items: [
							{
								label: '無変換',
								value: 'copy'
							},
							{
								label: 'AAC',
								value: 'aac'
							},
							{
								label: 'Vorbis',
								value: 'libvorbis'
							}
						]
					},
					depends: [
						{ key: 'ext', val: 'm2ts' }
					]
				},
				{
					key: 's',
					label: 'サイズ',
					input: {
						type: 'select',
						isRequired: true,
						val: set.s,
						items: [
							{
								label: '576p (WSVGA)',
								value: '1024x576'
							},
							{
								label: '720p (HD)',
								value: '1280x720'
							},
							{
								label: '1080p (FHD)',
								value: '1920x1080'
							}
						]
					},
					depends: [
						{ pointer: '/c:v', val: 'copy', op: '!==' }
					]
				},
				{
					key: 'b:v',
					label: '映像ビットレート',
					input: {
						type: 'radios',
						isRequired: true,
						val: set['b:v'],
						items: [
							{
								label: '256kbps',
								value: '256k'
							},
							{
								label: '512kbps',
								value: '512k'
							},
							{
								label: '1Mbps',
								value: '1M'
							},
							{
								label: '2Mbps',
								value: '2M'
							},
							{
								label: '3Mbps',
								value: '3M'
							}
						]
					},
					depends: [
						{ pointer: '/c:v', val: 'copy', op: '!==' }
					]
				},
				{
					key: 'b:a',
					label: '音声ビットレート',
					input: {
						type: 'radios',
						isRequired: true,
						val: set['b:a'],
						items: [
							{
								label: '64kbps',
								value: '64k'
							},
							{
								label: '128kbps',
								value: '128k'
							},
							{
								label: '192kbps',
								value: '192k'
							}
						]
					},
					depends: [
						{ pointer: '/c:a', val: 'copy', op: '!==' }
					]
				}
			]
		});

		this.form.insertTo(modal.content);

		return this;
	}
	,
	play: function() {

		this.isPlaying = true;

		var page = this;
		var p = this.program;
		var d = this.d;

		d.ss = d.ss || 0;

		if (p._isRecording) d.ss = '';

		var getRequestURI = function() {

			var r = location.protocol + '//' + location.host + location.pathname.replace(/\/[^\/]*$/, '');
			r += '/api/' + (!!p._isRecording ? 'recording' : 'recorded') + '/' + p.id + '/watch.' + d.ext;
			var q = Chinachu.serializeQuery(d);

			return r + '?' + q;
		};

		var togglePlay = function() {

			if (p._isRecording) return;

			if (video.paused) {
				video.play();
			} else {
				video.pause();
			}
		};

		// create video view

		var videoContainer = new ChinachuUI.Element('div', {
			'class': 'video-container'
		}).insertTo(this.view.content);

		var video = this.video = new ChinachuUI.Element('video', {
			controls: true,
			src: getRequestURI()
		}).insertTo(videoContainer);

		// debug
		window.video = video;

		video.onloadstart = function () {
			control.getElementByKey('play').setLabelHTML('&#8987;');
		};

		video.oncanplay = function () {
			video.play();
			if (video.paused) {
				control.getElementByKey('play').setLabelHTML('▶');
			} else {
				control.getElementByKey('play').setLabelHTML('Ⅱ');
			}
		};

		video.onpause = function () {
			control.getElementByKey('play').setLabelHTML('▶');
			d.ss = seek.getValue() - 2;
		};

		video.onplay = function () {
			video.poster = "";
			control.getElementByKey('play').setLabelHTML('Ⅱ');
		};

		video.volume = 1;

		// create control view

		var control = new ChinachuUI.Toolbar({
			className: 'video-control',
			items: [
				{
					key    : 'play',
					element: new ChinachuUI.Button({ labelHTML: '&#8987;', onSelect: togglePlay})
				},
				'--',
				{
					key    : 'fast-rewind',
					element: new ChinachuUI.Button({ labelHTML: '↶'})
				},
				{
					key    : 'fast-forward',
					element: new ChinachuUI.Button({ labelHTML: '↷'})
				},
				'--',
				{
					key    : 'played',
					element: new ChinachuUI.Element('span').insertText('00:00')
				},
				{
					key    : 'seek',
					element: new ChinachuUI.Slider({ value: 0, max: p.seconds, className: 'seek' })
				},
				{
					key    : 'duration',
					element: new ChinachuUI.Element('span').insertText(
						Chinachu.pad(Math.floor(p.seconds / 60), 2) + ':' + Chinachu.pad((p.seconds % 60), 2)
					)
				},
				'--',
				{
					key    : 'vol',
					element: new ChinachuUI.Slider({ value: 10, max: 10 })
				}
			]
		}).insertTo(this.view.content);

		var seek = control.getElementByKey('seek');

		var seekSlideEvent = function() {
			var value = seek.getValue();

			d.ss = value;
			var uri = getRequestURI();

			seek.disable();
			fastForward.disable();
			fastRewind.disable();

			video.pause();
			video.src = "";

			page.timer.seekSource = setTimeout(function() {
				video.src = uri;
				lastTime = 0;
				currentTime = d.ss * 1000;
			}, 500);

			page.timer.seekReady = setTimeout(function() {
				seek.enable();
				fastForward.enable();
				fastRewind.enable();
			}, 2000);
		};

		var seekValue = function(value) {
			var sec = seek.getValue() + value;
			if(sec < 0) sec = 0;
			else if(sec > p.seconds) sec = p.seconds;
			seek.setValue(sec);
			seekSlideEvent();
		};

		var fastForward = control.getElementByKey('fast-forward');
		fastForward.addEventListener('click', function() {
			seekValue(15);
		});

		var fastRewind = control.getElementByKey('fast-rewind')
		fastRewind.addEventListener('click', function() {
			seekValue(-15);
		});


		if (p._isRecording) {
			fastForward.disable();
			fastRewind.disable();
			seek.disable();
			control.getElementByKey('play').updateText('Live');
			control.getElementByKey('play').disable();
		}

		control.getElementByKey('vol').addEventListener('slide', function() {

			var vol = control.getElementByKey('vol');

			video.volume = vol.getValue() / 10;
		});

		seek.addEventListener('slide', seekSlideEvent);

		var lastTime = 0;
		var currentTime = 0;

		var updateTime = function() {

			if (seek.isEnabled() === false) return;

			if (lastTime && video.paused === false) {
				currentTime += Date.now() - lastTime;
			}

			var current = Math.floor(currentTime / 1000);

			control.getElementByKey('played').updateText(
				Chinachu.pad(Math.floor(current / 60), 2) + ':' + Chinachu.pad((current % 60), 2)
			);
			seek.setValue(current);

			lastTime = Date.now();
		};

		var updateLiveTime = function() {

			var current = (new Date().getTime() - p.start) / 1000;

			current = Math.floor(current);

			if (current > p.seconds) {
				this.app.pm.realizeHash(true);
			}

			control.getElementByKey('played').updateText(
				Chinachu.pad(Math.floor(current / 60), 2) + ':' + Chinachu.pad((current % 60), 2)
			);
			seek.setValue(current);
		}.bind(this);

		if (p._isRecording) {
			this.timer.updateLiveTime = setInterval(updateLiveTime, 250);
		} else {
			this.timer.updateTime = setInterval(updateTime, 100);
		}

		return this;
	}
});
