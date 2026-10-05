(function _chinachu() {

	"use strict";

	console.log('----', 'launched', '----');

	// notify
	app.notify = new ChinachuUI.Notify({
		title  : 'Chinachu',
		hMargin: (10 + 25)
	});

	// apiクライアントの初期化
	app.api = new chinachu.api.Client({
		apiRoot: app.def.apiRoot
	});

	app.socket = io(window.location.protocol + '//' + window.location.host, {
		timeout: 3000,
		path: window.location.pathname.replace(/[^\/]*$/g, '') + 'socket.io',
	});

	// コントロールビュー初期化
	app.f.enterControlView = function _enterControlView() {
		console.log('entering to control view');

		// クリーンアップ
		ChinachuDOM.all('.no-ctrl, .header, .middle, .footer').forEach(function (ele) {
  ele.remove();
});

		// リセット
		Chinachu.off(document, "chinachu:page:reload");
		Chinachu.off(document, "chinachu:page:unload");
		Chinachu.off(document, "chinachu:page:load");
		Chinachu.off(document, "chinachu:page:complete");

		app.pm.category = 'status';

		Chinachu.on(document, "chinachu:page:reload", function () {
  app.pm.disableHashControl();
  app.pm.title.update('...');
  document.title = '...';
  Chinachu.emit(document, 'chinachu:reload');
});

		Chinachu.on(document, "chinachu:page:unload", function () {
  app.view.sideBody.removeAll();
});

		Chinachu.on(document, "chinachu:page:load", function () {
  if (app.pm.pageData.nohead) {
    app.view.main.entity.addClassName('nohead');
  } else {
    app.view.main.entity.removeClassName('nohead');
  }
  if (app.pm.pageData.background) {
    app.view.mainBody.entity.style.background = app.pm.pageData.background;
  } else {
    app.view.mainBody.entity.style.background = '';
  }
  document.title = 'Chinachu: ' + [Chinachu.t(app.pm.page), Chinachu.t(app.pm.category)].join(' - ');
  ChinachuDOM.all(".app-navigation > li").forEach(function (li) {
    li.removeClassName("selected");
  });
  try {
    ChinachuDOM.all(".app-navigation > li.category-" + app.pm.category).forEach(function (li) {
      li.addClassName("selected");
    });
  } catch (e) {}
  app.view.sideBody.removeAll();
  if (app.pm.index.category[app.pm.category].pageIndex) {
    app.view.middle.entity.removeClassName('noside');
    app.pm.index.category[app.pm.category].pageIndex.forEach(function (pageName) {
      var page = app.pm.index.category[app.pm.category].page[pageName];
      app.view.sideBody.add({
        key: 'page-index-' + pageName,
        ui: new ChinachuUI.ActionButton({
          label: Chinachu.t(page.label),
          icon: page.icon || null,
          onClick: function () {
            window.location.hash = '!/' + app.pm.category + '/' + pageName + '/';
          }
        })
      }); //<--app.view.sideBody.add

      if (pageName === app.pm.page) {
        app.view.sideBody.one('page-index-' + pageName).select();
        if (app.pm.pageData.background) {
          app.view.sideBody.one('page-index-' + pageName).entity.style.boxShadow = 'inset -2px 0 0 ' + app.pm.pageData.background;
        }
      }
      new ChinachuUI.Tooltip({
        target: app.view.sideBody.one('page-index-' + pageName).entity,
        html: Chinachu.t(page.label)
      }).render();
    }); //<--each category
  } else {
    app.view.middle.entity.addClassName('noside');
  }
});//<--observe chinachu:page:load

		Chinachu.on(document, "chinachu:page:complete", function () {
  app.pm.enableHashControl();
});

		// 構造体
		app.view.header   = ChinachuUI.createElement("nav", { "class": "header" }).insertTo(app.view.body.entity);
		app.view.middle   = new ChinachuUI.Container({ className: 'middle' }).render(app.view.body);
		app.view.side     = new ChinachuUI.Container({ className: 'side' }).render(app.view.middle);
		app.view.sideHead = new ChinachuUI.Headbar({ className: 'side-head' }).render(app.view.side);
		app.view.sideBody = new ChinachuUI.Sidebar({ className: 'side-body' }).render(app.view.side);
		app.view.main     = new ChinachuUI.Container({ className: 'main' }).render(app.view.middle);
		app.view.mainHead = new ChinachuUI.Container({ className: 'main-head' }).render(app.view.main);
		app.view.title    = new ChinachuUI.Container({ className: 'main-head-title' }).render(app.view.mainHead).insert(app.pm.title);
		app.view.toolbar  = new ChinachuUI.Container({ className: 'main-head-toolbar' }).render(app.view.mainHead).insert(app.pm.toolbar);
		app.view.mainBody = new ChinachuUI.Container({ className: 'main-body' }).render(app.view.main).insert(app.pm.content);
		app.view.footer   = new ChinachuUI.Navbar({ className: 'footer' }).render(app.view.body);

		// Navigation uses local icons and a native responsive layout.
		ChinachuUI.createElement('a', { class: 'app-brand', href: '#!/dashboard/top/' })
			.insertText('Chinachu')
			.insert(ChinachuUI.createElement('span', { class: 'app-brand-gamma' }).insertText('γ'))
			.insertTo(app.view.header);
		var menuToggle = ChinachuUI.createButton({
			label: 'メニュー', className: 'app-menu-toggle',
			attribute: { 'aria-expanded': 'false', 'aria-controls': 'app-navigation' },
			onSelect: function () {
				var open = app.view.header.classList.toggle('menu-open');
				menuToggle.setAttribute('aria-expanded', String(open));
			}
		}).insertTo(app.view.header);
		var nav = ChinachuUI.createElement('ul', { id: 'app-navigation', class: 'app-navigation' })
			.insertTo(app.view.header);
		Chinachu.on(nav, 'click', function (event) {
			if (!event.target.closest('a')) return;
			app.view.header.classList.remove('menu-open');
			menuToggle.setAttribute('aria-expanded', 'false');
		});
		var hotkeyMap = {
			dashboard: "H",
			schedule: "S",
			rules: "R",
			reserves: "E",
			recording: "C",
			recorded: "O",
			pref: "P",
			search: "F"
		};

		app.pm.index.categoryIndex.forEach(function (categoryName, i) {
  ChinachuUI.createElement("li", {
    "class": "category-" + categoryName
  }).insert(ChinachuUI.createElement("a", {
    id: "category-" + categoryName + "-a",
    title: Chinachu.t(categoryName) + " (" + hotkeyMap[categoryName] + ")",
    href: "#!/" + categoryName + "/" + app.pm.index.category[categoryName].defaultPage + "/"
  }).insert(ChinachuUI.createIcon(app.pm.index.category[categoryName].icon))
    .insert(ChinachuUI.createElement("span", { class: "nav-label" }).insertText(Chinachu.t(categoryName)))).insertTo(nav);
  if (['rules', 'reserves', 'recording', 'recorded'].indexOf(categoryName) !== -1) {
    ChinachuUI.createElement("i", {
      "class": "nav-count",
      id: "category-" + categoryName + "-badge"
    }).insertTo(ChinachuDOM.get("category-" + categoryName + "-a"));
  }

  // ホットキー
  Chinachu.shortcuts.add(hotkeyMap[categoryName], function () {
    window.location.hash = "!/" + categoryName + "/" + app.pm.index.category[categoryName].defaultPage + "/";
  }, {
    protectInput: true
  });
});

		//
		app.view.middle.entity.addClassName('extend');

		app.pm.content.stopObserving('scroll');
		app.pm.content.observe('scroll', app.f.contentOnScroll);
		clearInterval(app.timer.intervalOverline);
		app.timer.intervalOverline = setInterval(app.f.contentOnScroll, 1000);

		app.view.footer.add({
			key: 'chinachu',
			ui : new ChinachuUI.ActionButton({
				label  : 'Chinachu',
				style  : { 'float': 'right' },
				icon   : './icons/information-italic.png',
				onClick: function() {
					var status = app.chinachu.status || {};
					var system = status.system || {};
					var content = ChinachuUI.createElement('div');
					ChinachuUI.createElement('div', { class: 'chinachu-about-label' }).insertText('バージョン').insertTo(content);
					ChinachuUI.createElement('p', { class: 'chinachu-about-version' }).insertText(status.version || '未取得').insertTo(content);
					var environment = ChinachuUI.createElement('dl', { class: 'chinachu-about-environment' }).insertTo(content);
					[
						['サーバーOS', [system.platform, system.release].filter(Boolean).join(' ')],
						['アーキテクチャ', system.arch],
						['Node.js', system.node]
					].forEach(function(row) {
						ChinachuUI.createElement('dt').insertText(row[0]).insertTo(environment);
						ChinachuUI.createElement('dd').insertText(row[1] || '未取得').insertTo(environment);
					});
					new ChinachuUI.Modal({
						title    : 'Chinachu γ',
						className: 'chinachu-about-dialog',
						content  : content
					}).show();
				}
			})
		});

		app.view.footer.add({
			key: 'operator-status',
			ui : new ChinachuUI.ActionButton({
				style: { 'float': 'right', 'cursor': 'default' },
				label: 'Operator',
				icon : './icons/status-offline.png',
			})
		});
		app.pm.enableHashControl(true);
	};

	// オーバーラインハンドラ
	app.f.contentOnScroll = function _contentOnScroll() {
		if (app.pm.content.scrollTop > 0) {
			app.view.mainHead.entity.addClassName('overline');
		} else {
			app.view.mainHead.entity.removeClassName('overline');
		}

		if (app.pm.content.scrollHeight - app.pm.content.offsetHeight > app.pm.content.scrollTop) {
			app.view.mainBody.entity.addClassName('overline');
		} else {
			app.view.mainBody.entity.removeClassName('overline');
		}
	};

	app.f.getProgramById = function _getProgramById(id) {
		for (var i = 0; i < app.chinachu.recording.length; i++) {
			if ((app.chinachu.recording[i].id === id) && (app.chinachu.recording[i].pid)) {
				app.chinachu.recording[i]._isRecording = true;
				return app.chinachu.recording[i];
			}
		}

		for (var i = 0; i < app.chinachu.recorded.length; i++) {
			if (app.chinachu.recorded[i].id === id) {
				app.chinachu.recorded[i]._isRecorded = true;
				return app.chinachu.recorded[i];
			}
		}

		for (var i = 0; i < app.chinachu.reserves.length; i++) {
			if (app.chinachu.reserves[i].id === id) {
				app.chinachu.reserves[i]._isReserves = true;
				return app.chinachu.reserves[i];
			}
		}

		for (var i = 0; i < app.chinachu.schedule.length; i++) {
			for (var j = 0; j < app.chinachu.schedule[i].programs.length; j++) {
				if (app.chinachu.schedule[i].programs[j].id === id) {
					return app.chinachu.schedule[i].programs[j];
				}
			}
		}

		return null;
	};

	var socketOnConnect = function _socketOnConnect() {
		app.view.loadingMask.hide();

		Chinachu.emit(document, 'chinachu:connect');
	};

	var socketOnDisconnect = function _socketOnDisconnect() {
		app.view.loadingMask.show();

		Chinachu.emit(document, 'chinachu:disconnect');

		app.notify.create({ title: 'Chinachu', message: Chinachu.t('DISCONNECTED') });
	};

	var socketOnStatus = function _socketOnStatus(data) {
		app.chinachu.status = data;
		Chinachu.emit(document, 'chinachu:status', app.chinachu.status);

		if (app.view.footer.one('operator-status')._status !== data.operator.alive) {
			if (data.operator.alive) {
				app.view.footer.one('operator-status').setIcon('./icons/status.png');
			} else {
				app.view.footer.one('operator-status').setIcon('./icons/status-offline.png');
			}
		}
		app.view.footer.one('operator-status')._status = data.operator.alive;

		if (app.view.footer.one('count') === null) {
			app.view.footer.add({
				key: 'count',
				ui : new ChinachuUI.ActionButton({
					style: { 'float': 'right', 'cursor': 'default' },
					label: data.connectedCount,
					icon : './icons/user-medium-silhouette.png'
				})
			});
		}
		app.view.footer.one('count').setLabel(data.connectedCount);
	};

	var socketOnRules = function _socketOnRules(data) {
		app.chinachu.rules = data;
		Chinachu.emit(document, 'chinachu:rules', app.chinachu.rules);
	};

	var socketOnNotifyExclusionRules = function () {
		Chinachu.emit(document, 'chinachu:exclusion-rules');
	};

	var socketOnNotifyRules = function () {
		Chinachu.request('./api/rules.json', {
  method: 'get',
  onSuccess: function (t) {
    app.chinachu.rules = t.responseJSON;
    Chinachu.emit(document, 'chinachu:rules', app.chinachu.rules);
  }
});
	};

	Chinachu.on(document, 'chinachu:rules', function (e) {
  ChinachuDOM.get("category-rules-badge").update(e.memo.length.toString(10));
});

	var socketOnReserves = function _socketOnReserves(data) {
		var dt = new Date().getTime();
		data.forEach(function (program, i) {
  if (program.start - dt < 1000 * 60) {
    delete data[i];
  }
});
		data = data.filter(item => item != null);

		app.chinachu.reserves = data;
		Chinachu.emit(document, 'chinachu:reserves', app.chinachu.reserves);
	};

	var socketOnNotifyReserves = function () {
		Chinachu.request('./api/reserves.json', {
  method: 'get',
  onSuccess: function (t) {
    var data = t.responseJSON;
    var dt = new Date().getTime();
    data.forEach(function (program, i) {
      if (program.start - dt < 1000 * 60) {
        delete data[i];
      }
    });
    data = data.filter(item => item != null);
    app.chinachu.reserves = data;
    Chinachu.emit(document, 'chinachu:reserves', app.chinachu.reserves);
  }
});
	};

	Chinachu.on(document, 'chinachu:reserves', function (e) {
  ChinachuDOM.get("category-reserves-badge").update(e.memo.length.toString(10));
  var hasConflict = false;
  e.memo.forEach(function (p) {
    if (p.isConflict) {
      hasConflict = true;
    }
  });
  if (hasConflict) {
    ChinachuDOM.get("category-reserves-a").addClassName("warning");
  } else {
    ChinachuDOM.get("category-reserves-a").removeClassName("warning");
  }
});

	var socketOnSchedule = function _socketOnSchedule(data) {
		app.chinachu.schedule = data;
		Chinachu.emit(document, 'chinachu:schedule', app.chinachu.schedule);
	};

	var socketOnNotifySchedule = function () {
		Chinachu.request('./api/schedule.json', {
  method: 'get',
  onSuccess: function (t) {
    app.chinachu.schedule = t.responseJSON;
    Chinachu.emit(document, 'chinachu:schedule', app.chinachu.schedule);
  }
});
	};

	var socketOnRecording = function _socketOnRecording(data) {
		app.chinachu.recording = data;
		Chinachu.emit(document, 'chinachu:recording', app.chinachu.recording);
	};

	var socketOnNotifyRecording = function () {
		Chinachu.request('./api/recording.json', {
  method: 'get',
  onSuccess: function (t) {
    app.chinachu.recording = t.responseJSON;
    Chinachu.emit(document, 'chinachu:recording', app.chinachu.recording);
  }
});
	};

	Chinachu.on(document, 'chinachu:recording', function (e) {
  ChinachuDOM.get("category-recording-badge").update(e.memo.length.toString(10));
  if (e.memo.length === 0) {
    ChinachuDOM.get('favicon').href = './favicon.ico';
  } else {
    ChinachuDOM.get('favicon').href = './favicon-active.ico';
  }
  if (app.stat.lastRecordingCount) {
    if (app.stat.lastRecordingCount < e.memo.length) {
      app.notify.create({
        text: '録画開始: ' + e.memo.at(-1).title,
        timeout: 10,
        onClick: function () {
          window.location.hash = '!/program/view/id=' + e.memo.at(-1).id + '/';
        }
      });
    }
  }
  app.stat.lastRecordingCount = e.memo.length;
  setTimeout(socketOnNotifyReserves, 0);
});

	var socketOnRecorded = function _socketOnRecorded(data) {
		data = data.reverse();

		app.chinachu.recorded = data;
		Chinachu.emit(document, 'chinachu:recorded', app.chinachu.recorded);
	};

	var socketOnNotifyRecorded = function () {
		Chinachu.request('./api/recorded.json', {
  method: 'get',
  onSuccess: function (t) {
    app.chinachu.recorded = t.responseJSON.reverse();
    Chinachu.emit(document, 'chinachu:recorded', app.chinachu.recorded);
  }
});
	};

	Chinachu.on(document, 'chinachu:recorded', function (e) {
  ChinachuDOM.get("category-recorded-badge").update(e.memo.length.toString(10));
  if (app.stat.lastRecordedCount) {
    if (app.stat.lastRecordedCount < e.memo.length) {
      app.notify.create({
        text: '録画終了: ' + e.memo.at(0).title,
        timeout: 10,
        onClick: function () {
          window.location.hash = '!/program/view/id=' + e.memo.at(0).id + '/';
        }
      });
    }
  }
  app.stat.lastRecordedCount = e.memo.length;
});

	app.socket.on('connect'   , socketOnConnect);
	app.socket.on('disconnect', socketOnDisconnect);

	app.socket.on('status'    , socketOnStatus);

	app.socket.on('notify-rules'    , socketOnNotifyRules);
	app.socket.on('notify-exclusion-rules', socketOnNotifyExclusionRules);
	app.socket.on('notify-reserves' , socketOnNotifyReserves);
	app.socket.on('notify-recording', socketOnNotifyRecording);
	app.socket.on('notify-recorded' , socketOnNotifyRecorded);
	app.socket.on('notify-schedule' , socketOnNotifySchedule);

	// go
	app.f.enterControlView();

})();