/*jslint browser:true, nomen:true, plusplus:true, regexp:true, vars:true */
/* global Chinachu, ChinachuUI, ChinachuDOM */
(function () {

	"use strict";

	// for debug
	var PARAM = Chinachu.query(window.location.search.replace('?', ''));
	var DEBUG = (PARAM.debug === 'on');
	var console = {};
	if ((typeof window.console !== 'object') || (DEBUG === false)) {
		console = {
			log       : Chinachu.noop,
			debug     : Chinachu.noop,
			info      : Chinachu.noop,
			warn      : Chinachu.noop,
			error     : Chinachu.noop,
			assert    : Chinachu.noop,
			dir       : Chinachu.noop,
			dirxml    : Chinachu.noop,
			trace     : Chinachu.noop,
			group     : Chinachu.noop,
			groupEnd  : Chinachu.noop,
			time      : Chinachu.noop,
			timeEnd   : Chinachu.noop,
			profile   : Chinachu.noop,
			profileEnd: Chinachu.noop,
			count     : Chinachu.noop
		};
	} else {
		console = window.console;
	}

	// global
	var global = window.global;

	// chinachu global scope
	if (typeof window.chinachu !== 'undefined') {
		console.error('[conflict]', 'chinachu is already defined.');

		return false;
	}
	var chinachu = window.chinachu = {};

	console.info('[welcome]', 'initializing chinachu class.');

	// Objectをディープコピー
	var objectCloner = chinachu.objectCloner = function _objectCloner(object) {
		return JSON.parse(JSON.stringify(object));
	};

	// Dateオブジェクトを見やすい文字列に変換する
	var dateToString = chinachu.dateToString = function _dateToString(date, type) {
		var d = date;

		var dStr = Chinachu.pad(d.getMonth() + 1, 2) + "/" + Chinachu.pad(d.getDate(), 2);

		if (d.getFullYear() !== new Date().getFullYear()) {
			dStr = d.getFullYear().toString(10).slice(2) + "/" + dStr;
		}

		var weekDays = ["日", "月", "火", "水", "木", "金", "土"];
		dStr += " (" + weekDays[d.getDay()] + ")";

		dStr += ' ' + [
			Chinachu.pad(d.getHours(), 2),
			Chinachu.pad(d.getMinutes(), 2)
		].join(':');

		var dDelta = ((new Date().getTime() - d.getTime()) / 1000);
		var dDeltaStr = '';

		if (dDelta < 0) {
			dDelta -= dDelta * 2;

			if (dDelta < 60) {
				dDeltaStr = Chinachu.t('after {0} seconds', [Math.round(dDelta) || '0']);
			} else {
				dDelta = dDelta / 60;

				if (dDelta < 60) {
					dDeltaStr = Chinachu.t('after {0} minutes', [Math.round(dDelta) || '0']);
				} else {
					dDelta = dDelta / 60;

					if (dDelta < 24) {
						dDeltaStr = Chinachu.t('after {0} hours', [Math.round(dDelta * 10) / 10 || '0']);
					} else {
						dDelta = dDelta / 24;

						dDeltaStr = Chinachu.t('after {0} days', [Math.round(dDelta) || '0']);
					}
				}
			}
		} else {
			if (dDelta < 60) {
				dDeltaStr = Chinachu.t('{0} seconds ago', [Math.round(dDelta) || '0']);
			} else {
				dDelta = dDelta / 60;

				if (dDelta < 60) {
					dDeltaStr = Chinachu.t('{0} minutes ago', [Math.round(dDelta) || '0']);
				} else {
					dDelta = dDelta / 60;

					if (dDelta < 24) {
						dDeltaStr = Chinachu.t('{0} hours ago', [Math.round(dDelta * 10) / 10 || '0']);
					} else {
						dDelta = dDelta / 24;

						dDeltaStr = Chinachu.t('{0} days ago', [Math.round(dDelta) || '0']);
					}
				}
			}
		}

		if (typeof type === 'undefined' || type === 'full') {
			return dStr + ' [' + dDeltaStr + ']';
		} else if (type === 'short') {
			return dStr;
		} else if (type === 'delta') {
			return dDeltaStr;
		}
	};

	// inputType
	var formInputTypeChannels = {
		create: function () {
			return ChinachuChannelSelector.create({
				element: ChinachuUI.createElement('div'),
				getChannels: function () { return global.chinachu.schedule; },
				emptyText: this.emptyText,
				label: this.emptyText === '除外なし' ? '無視CH' : '対象CH'
			});
		},
		getVal: function () {
			return this.element.getValues();
		},
		setVal: function (val) {
			this.element.setValues(val);
		},
		enable: function () {
			this.element.enable();
		},
		disable: function () {
			this.element.disable();
		}
	};
	var formInputTypeStrings = {
		create: function () {
			return ChinachuUI.createTokenizer({
				placeholder: '...'
			});
		},
		getVal: function (options) {
			return this.element.getValues(options);
		},
		setVal: function (val) {
			this.element.setValues(val);
		},
		enable: function () {
			this.element.enable();
		},
		disable: function () {
			this.element.disable();
		}
	};

	var util = chinachu.util = {};

	/** section: util
	 * class util
	**/

	/**
	 *  util.scotify(program) -> String
	 *  - program (Program Object): Program Data.
	 *
	 *  プログラムデータをSCOT形式の文字列にします
	**/
	util.scotify = function (program) {
		var scot = '';

		scot = program.channel.name + ': ' + program.title +
			' (' + dateToString(new Date(program.start), 'short') + ') ' +
			'[chinachu://' + program.id + ']';

		return scot;
	};

	/**
	 *  util.getProgramById(programId) -> Program Object | null
	 *  - programId (String): Program ID.
	 *
	 *  プログラムIDでプログラムデータを取得します
	**/
	util.getProgramById = function (id) {
		var i, l, j, m;

		for (i = 0, l = global.chinachu.recorded.length; i < l; i++) {
			if (global.chinachu.recorded[i].id === id) {
				global.chinachu.recorded[i]._isRecorded = true;
				return global.chinachu.recorded[i];
			}
		}

		for (i = 0, l = global.chinachu.recording.length; i < l; i++) {
			if ((global.chinachu.recording[i].id === id) && (global.chinachu.recording[i].pid)) {
				global.chinachu.recording[i]._isRecording = true;
				return global.chinachu.recording[i];
			}
		}

		for (i = 0, l = global.chinachu.reserves.length; i < l; i++) {
			if (global.chinachu.reserves[i].id === id) {
				global.chinachu.reserves[i]._isReserves = true;
				return global.chinachu.reserves[i];
			}
		}

		for (i = 0; i < global.chinachu.schedule.length; i++) {
			for (j = 0, m = global.chinachu.schedule[i].programs.length; j < m; j++) {
				if (global.chinachu.schedule[i].programs[j].id === id) {
					return global.chinachu.schedule[i].programs[j];
				}
			}
		}

		return null;
	};

	/**
	 *  util.getNextProgramById(programId) -> Program Object | null
	 *  - programId (String): Program ID.
	 *
	 *  プログラムIDの次のプログラムを取得します
	**/
	util.getNextProgramById = function (id) {
		var i, l, j, m;

		for (i = 0, l = global.chinachu.schedule.length; i < l; i++) {
			for (j = 0, m = global.chinachu.schedule[i].programs.length; j < m; j++) {
				if (global.chinachu.schedule[i].programs[j].id === id) {
					if (typeof global.chinachu.schedule[i].programs[j + 1] !== 'undefined') {
						return util.getProgramById(global.chinachu.schedule[i].programs[j + 1].id);
					}
				}
			}
		}

		return null;
	};

	/**
	 *  util.getPrevProgramById(programId) -> Program Object | null
	 *  - programId (String): Program ID.
	 *
	 *  プログラムIDの前のプログラムを取得します
	**/
	util.getPrevProgramById = function (id) {
		var i, l, j, m;

		for (i = 0, l = global.chinachu.schedule.length; i < l; i++) {
			for (j = 0, m = global.chinachu.schedule[i].programs.length; j < m; j++) {
				if (global.chinachu.schedule[i].programs[j].id === id) {
					if (j - 1 < 0) { return null; }

					if (typeof global.chinachu.schedule[i].programs[j - 1] !== 'undefined') {
						return util.getProgramById(global.chinachu.schedule[i].programs[j - 1].id);
					}
				}
			}
		}

		return null;
	};

	var api = chinachu.api = {};

	/** section: api
	 * class chinachu.api.Client
	**/
	api.Client = Chinachu.createClass({

		/**
		 *  new chinachu.api.Client(parameter) -> chinachu.api.Client
		 *  - parameter (Object)
		 *
		 *  ##### Parameter
		 *
		 *  * `apiRoot`          (String; default `"./"`):
		 *  * `retryCount`       (Number; default `0`):
		 *  * `onRequest`        (Function):
		 *  * `onRequested`      (Function):
		**/
		initialize: function _initApiClient(p) {
			this.apiRoot = p.apiRoot || './';

			this.onCreateRequest   = p.onCreateRequest   || Chinachu.noop;
			this.onCompleteRequest = p.onCompleteRequest || Chinachu.noop;

			this.requestCount = 0;
			this.requestTable = [];

			this.optionalRequestHeaders = [];
			this.optionalRequestParameter = {};

			return this;
		},

		request: function _requestApiClient(url, p, retryCount) {
			// 完全なURLかどうかを判定
			if (url.match(/^http/) === null) {
				url = this.apiRoot + url;
			}

			var param  = p.param  || {};
			var method = p.method || 'get';

			var requestHeaders = [
				'X-Chinachu-Client-Version', '3'
			].concat(this.optionalRequestHeaders);

			param = Object.assign(param, {
				Count: param.Count || 0
			});

			param = Object.assign(param, this.optionalRequestParameter);

			// インクリメント
			++this.requestCount;

			retryCount  = retryCount || this.retryCount;

			var requestState = this.requestTable[this.requestCount] = {
				id         : this.requestCount,
				requestedAt: new Date().getTime(),
				createdAt  : null,
				completedAt: null,
				latency    : null,
				execution  : null,
				transport  : null,
				param      : param,
				method     : method.toUpperCase(),
				headers    : requestHeaders,
				url        : url,
				p          : p,
				status     : 'init'
			};

			var dummy = Chinachu.request(url, {
  method: method,
  requestHeaders: requestHeaders,
  parameters: JSON.stringify(param).replace(/%/g, '\\u0025'),
  // リクエスト作成時
  onCreate: function _onCreateRequest(t) {
    requestState.status = 'create';
    requestState.transport = t;
    console.log('api.Client', 'req#' + requestState.id, '(create)', '->', requestState.method, url.replace(this.apiRoot, ''), t);
    requestState.createdAt = new Date().getTime();
    if (p.onCreate) {
      p.onCreate(t);
    }
    this.onCreateRequest(t);
    Chinachu.emit(document, 'chinachu:api:client:request:create', requestState);
  }.bind(this),
  // リクエスト完了時
  onComplete: function _onCompleteRequest(t) {
    requestState.status = 'complete';
    requestState.transport = t;
    requestState.completedAt = new Date().getTime();
    requestState.execution = Math.round((t.getHeader('X-Sakura-Proxy-Microtime') || 0) / 1000);
    requestState.latency = requestState.completedAt - requestState.createdAt;
    var time = [requestState.execution, requestState.latency].join('|') + 'ms';
    console.log('api.Client', 'req#' + requestState.id, time, '<-', requestState.method, url.replace(this.apiRoot, ''), t.status, t.statusText, t);
    var res = t.responseJSON || {};

    // 結果を評価
    var isSuccess = t.status >= 200 && t.status < 300;
    if (isSuccess) {
      // 成功コールバック
      if (p.onSuccess) {
        p.onSuccess(t, res);
      }
    }
    var isFailure = !isSuccess;
    if (isFailure) {
      // 失敗コールバック
      if (p.onFailure) {
        p.onFailure(t, res);
      }
    }

    // 最後に完了時の処理を
    if (p.onComplete) {
      p.onComplete(t, res);
    }
    this.onCompleteRequest(t, res);
    Chinachu.emit(document, 'chinachu:api:client:request:complete', requestState);
  }.bind(this)
});

			return this;
		}
	});

	var ui = chinachu.ui = {};

	ui.ContentLoading = Chinachu.createClass({
		initialize: function (opt) {
			if (!opt) { opt = {}; }

			this.progress   = 0;
			this.target     = document.body;
			this.onComplete = opt.onComplete || function _empty() {};

			this.create();

			return this;
		},
		create: function _draw() {
			this.entity = {
				container: ChinachuDOM.create('div', {
  className: 'content-loading'
}),
				frame    : ChinachuDOM.create('div'),
				bar      : ChinachuDOM.create('div')
			};

			this.entity.container.insert(this.entity.frame);
			this.entity.frame.insert(this.entity.bar);

			this.redraw();

			return this;
		},
		update: function _update(num) {
			if (num >= 100) {
				setTimeout(this.onComplete, 0);

				num = 100;
			}

			this.progress = num;

			this.redraw();

			return this;
		},
		redraw: function _redraw() {
			this.entity.bar.setStyle({width: this.progress.toString(10) + '%'});

			return this;
		},
		render: function _render(target) {
			ChinachuDOM.get(target.entity || target || this.target).insert({top: this.entity.container});

			return this;
		},
		remove: function _remove() {
			this.entity.bar.remove();
			this.entity.frame.remove();
			this.entity.container.remove();

			this.entity.bar       = null;
			this.entity.frame     = null;
			this.entity.container = null;

			delete this.entity;
			delete this.target;
			delete this.progress;

			return true;
		}
	});

	ui.DynamicTime = Chinachu.createClass(ChinachuUI.ElementView, {

		init: function (opt) {

			this.tagName = opt.tagName || 'span';

			this.time  = opt.time;
			this.timer = 0;
			this.type  = opt.type || 'delta';

			return this;
		},

		create: function () {

			var wait = 1;

			if (this.entity) {
				if (ChinachuUI.Element.exists(this.entity) === false) {
					this.remove();
					return;
				}
			} else {
				this.entity = ChinachuDOM.create(this.tagName, this.attr);
			}

			if (this.id !== null) { this.entity.id = this.id; }

			if (this.style !== null) { this.entity.setStyle(this.style); }

			this.entity.className = 'dynamic-time';

			if (this.className !== null) { this.entity.addClassName(this.className); }

			this.entity.update(chinachu.dateToString(new Date(this.time), this.type));

			var delta = ((new Date().getTime() - this.time) / 1000);

			if (delta < 0) { delta -= delta * 2; }

			if (delta < 9600) { wait = 60 * 60; }
			if (delta < 4800) { wait = 60 * 30; }
			if (delta < 2400) { wait = 60 * 10; }
			if (delta < 1200) {
				wait = 60 * 5;
				this.entity.addClassName('soon');
			}
			if (delta < 360) { wait = 60; }
			if (delta < 120) {
				wait = 30;
				this.entity.addClassName('now');
			}
			if (delta < 60) { wait = 10; }
			if (delta < 30) { wait = 5; }
			if (delta < 10) { wait = 1; }

			this.timer = setTimeout(this.create.bind(this), wait * 1000);

			return this;
		},

		remove: function () {

			clearTimeout(this.timer);

			try {
				this.entity.remove();
				this.entity.fire('chinachu:remove');
			} catch (e) {
				//console.debug(e);
			}

			return this;
		}
	});

	ui.ExecuteScheduler = Chinachu.createClass({
		initialize: function () {
			this.create();

			return this;
		},
		create: function () {
			this.modal = new ChinachuUI.Modal({
				title: 'スケジューラーの実行',
				text : '全てのルールと手動予約から競合を検出してスケジューリングを行います',
				buttons: [
					{
						label   : '実行',
						color   : '@orange',
						onSelect: function (e, modal) {
							this.button.disable();

							var dummy = Chinachu.request('./api/scheduler.json', {
  method: 'put',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function (response) {
    var json = response.responseJSON;
    var conflictMsg = '';
    var title = '成功';
    if (Array.isArray(json.conflicts) && json.conflicts.length > 0) {
      conflictMsg = '。競合が' + json.conflicts.length + '件ありました';
      title = '競合検出';
    }
    new ChinachuUI.Modal({
      title: title,
      text: 'スケジューラーを実行しました' + conflictMsg
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: 'スケジューラーが失敗しました (' + t.status + ')'
    }).show();
  }
});
						}
					},
					{
						label   : '中止',
						onSelect: function (e, modal) {
							modal.close();
						}
					}
				]
			});

			this.modal.show();

			return this;
		}
	});

	ui.Reserve = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
			} else {
				var buttons = [];

				buttons.push({
					label   : '予約',
					color   : '@red',
					onSelect: function (e, modal) {
						e.targetButton.disable();

						var dummy = Chinachu.request('./api/program/' + this.program.id + '.json', {
  method: 'put',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: '予約しました。'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: '予約に失敗しました (' + t.status + ')'
    }).show();
  }
});
					}.bind(this)
				});

				if (false && this.program.channel.type === 'GR') {
					buttons.push({
						label   : '予約 (ワンセグ)',
						color   : '@red',
						onSelect: function (e, modal) {
							e.targetButton.disable();

							var dummy = Chinachu.request('./api/program/' + this.program.id + '.json', {
  method: 'put',
  parameters: {
    mode: '1seg'
  },
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: '予約しました。'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: '予約に失敗しました (' + t.status + ')'
    }).show();
  }
});
						}.bind(this)
					});
				}

				buttons.push({
					label   : 'キャンセル',
					onSelect: function (e, modal) {
						modal.close();
					}
				});

				var bitrate = 0;
				if (this.program.channel.type === "GR") {
					bitrate = 16.851;
				} else if (this.program.channel.type === "SKY") {
					bitrate = 8;
				} else {
					bitrate = 24;
				}
				var size = Math.round(this.program.seconds * bitrate / 8);

				this.modal = new ChinachuUI.Modal({
					title   : '手動予約',
					subtitle: this.program.title + ' #' + this.program.id,
					text    : '予約しますか？ (目安容量: ' + size + ' MB)',
					buttons : buttons
				});
			}

			this.modal.show();

			return this;
		}
	});

	ui.Unreserve = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
			} else {
				this.modal = new ChinachuUI.Modal({
					title   : '手動予約の取消',
					subtitle: this.program.title + ' #' + this.program.id,
					text    : '予約を取り消しますか？',
					buttons: [
						{
							label   : '予約取消',
							color   : '@red',
							onSelect: function (e, modal) {
								e.targetButton.disable();

								var dummy = Chinachu.request('./api/reserves/' + this.program.id + '.json', {
  method: 'delete',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: '予約を取り消しました。'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: '予約の取消に失敗しました (' + t.status + ')'
    }).show();
  }
});
							}.bind(this)
						},
						{
							label   : 'キャンセル',
							onSelect: function (e, modal) {
								modal.close();
							}
						}
					]
				});
			}

			this.modal.show();

			return this;
		}
	});

	ui.Skip = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
				this.modal.show();
			} else {
				Chinachu.request('./api/reserves/' + this.program.id + '/skip.json', {
  method: 'put',
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: 'スキップに失敗しました (' + t.status + ')'
    }).show();
  }
});
			}

			return this;
		}
	});

	ui.Unskip = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
			} else {
				this.modal = new ChinachuUI.Modal({
					title   : 'スキップの取消',
					subtitle: this.program.title + ' #' + this.program.id,
					text    : 'スキップを取り消しますか？',
					buttons: [
						{
							label   : 'スキップの取消',
							color   : '@red',
							onSelect: function (e, modal) {
								e.targetButton.disable();

								var dummy = Chinachu.request('./api/reserves/' + this.program.id + '/unskip.json', {
  method: 'put',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: 'スキップを取り消しました。'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: 'スキップの取消に失敗しました (' + t.status + ')'
    }).show();
  }
});
							}.bind(this)
						},
						{
							label   : 'キャンセル',
							onSelect: function (e, modal) {
								modal.close();
							}
						}
					]
				});
			}

			this.modal.show();

			return this;
		}
	});

	ui.StopRecord = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
			} else {
				this.modal = new ChinachuUI.Modal({
					title   : '録画中止',
					subtitle: this.program.title + ' #' + this.program.id,
					text    : '本当によろしいですか？',
					buttons: [
						{
							label   : '録画中止',
							color   : '@red',
							onSelect: function (e, modal) {
								e.targetButton.disable();

								var dummy = Chinachu.request('./api/recording/' + this.program.id + '.json', {
  method: 'delete',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: '録画を中止しました'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: '録画中止に失敗しました (' + t.status + ')'
    }).show();
  }
});
							}.bind(this)
						},
						{
							label   : 'キャンセル',
							onSelect: function (e, modal) {
								modal.close();
							}
						}
					]
				});
			}

			this.modal.show();

			return this;
		}
	});

	ui.RemoveRecordedProgram = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) {
				this.modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '番組が見つかりませんでした'
				});
			} else {
				this.modal = new ChinachuUI.Modal({
					title   : '録画履歴とファイルの削除',
					subtitle: this.program.title + ' #' + this.program.id,
					text    : '録画履歴とファイルを削除しますか？この操作は元に戻せません。',

					buttons: [
						{
							label  : '削除',
							color  : '@red',
							onSelect: function (e, modal) {
								e.targetButton.disable();

								Chinachu.request('./api/recorded/' + this.program.id + '.json', {
  method: 'delete',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: '削除に成功しました'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: '削除に失敗しました (' + t.status + ')'
    }).show();
  }
});
							}.bind(this)
						},
						{
							label  : 'キャンセル',
							onSelect: function (e, modal) {
								modal.close();
							}
						}
					]
				});
			}

			this.modal.show();

			return this;
		}
	});

	ui.DownloadRecordedFile = Chinachu.createClass({
		initialize: function _init(id) {
			window.open('./api/recorded/' + id + '/file.m2ts');
			return this;
		}
	});

	ui.RemoveRecordedFile = Chinachu.createClass({
		initialize: function _init(id) {
			return new ui.RemoveRecordedProgram(id);
		}
	});

	ui.Cleanup = Chinachu.createClass({
		initialize: function _init() {
			this.create();

			return this;
		},
		create: function _create() {
			this.modal = new ChinachuUI.Modal({
				title: 'クリーンアップ',
				text : '全ての録画履歴の中から録画ファイルを見失った項目を削除します。',
				buttons: [
					{
						label  : 'クリーンアップ',
						color  : '@red',
						onSelect: function (e, modal) {
							e.targetButton.disable();

							var dummy = Chinachu.request('./api/recorded.json', {
  method: 'put',
  onComplete: function () {
    modal.close();
  },
  onSuccess: function () {
    new ChinachuUI.Modal({
      title: '成功',
      text: 'クリーンアップに成功しました'
    }).show();
  },
  onFailure: function (t) {
    new ChinachuUI.Modal({
      title: '失敗',
      text: 'クリーンアップに失敗しました (' + t.status + ')'
    }).show();
  }
});
						}.bind(this)
					},
					{
						label  : 'キャンセル',
						onSelect: function (e, modal) {
							modal.close();
						}
					}
				]
			});

			this.modal.show();

			return this;
		}
	});

	ui.Streamer = Chinachu.createClass({
		initialize: function _init(id) {

			window.location.hash = '!/program/watch/id=' + id + '/';

			return this;
		}
	});

	ui.EditRule = Chinachu.createClass({
		initialize: function _init(ruleNum, isExclusion) {
			this.num = ruleNum;
			this.isExclusion = !!isExclusion;

			this.create();

			return this;
		},
		create: function _create() {
			var isExclusion = this.isExclusion;
			var resource = isExclusion ? 'exclusion-rules' : 'rules';
			if (this.num === null) {
				var modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : 'ルールの指定が不正です。'
				}).show();
			} else {
				// フォームに表示させるルールを読み込む
				var num = this.num;
				// Reserve the editor before the request: repeated activation can
				// otherwise create identical dialogs before either is visible.
				var editors = ui.EditRule._activeEditors || (ui.EditRule._activeEditors = new Map());
				var key = resource + '/' + num;
				if (editors.has(key)) return this;
				var owner = {}, scope = Chinachu.scope;
				editors.set(key, owner);
				function releaseEditor() {
				    if (editors.get(key) === owner) editors.delete(key);
				    if (scope && scope._cleanups) {
				        var index = scope._cleanups.indexOf(releaseEditor);
				        if (index !== -1) scope._cleanups.splice(index, 1);
				    }
				}
				if (scope && scope._cleanups) scope._cleanups.push(releaseEditor);
				Chinachu.request('./api/' + resource + '/' + num + '.json', {
  method: 'get',
  onSuccess: function (t) {
    if (editors.get(key) !== owner) return;
    var rule = t.responseJSON;
    var form = ChinachuUI.createForm({
      fields: [{
        key: 'types',
        label: 'タイプ',
        input: {
          type: 'checkboxes',
          val: rule.types,
          items: ['GR', 'BS', 'CS', 'SKY']
        }
      }, {
        key: 'categories',
        label: 'ジャンル',
        input: {
          type: 'checkboxes',
          val: rule.categories,
          items: ['anime', 'information', 'news', 'sports', 'variety', 'documentary', 'drama', 'music', 'cinema', 'theater', 'hobby', 'welfare', 'etc']
        }
      }, {
        key: 'channels',
        label: '対象CH',
        input: {
          type: formInputTypeChannels,
          style: {
            width: '100%'
          },
          val: rule.channels
        }
      }, {
        key: 'ignore_channels',
        label: '無視CH',
        input: {
          type: formInputTypeChannels,
          emptyText: '除外なし',
          style: {
            width: '100%'
          },
          val: rule.ignore_channels
        }
      }, {
        key: 'reserve_flags',
        label: '対象フラグ',
        input: {
          type: 'checkboxes',
          val: rule.reserve_flags,
          items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
        }
      }, {
        key: 'ignore_flags',
        label: '無視フラグ',
        input: {
          type: 'checkboxes',
          val: rule.ignore_flags,
          items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
        }
      }, {
        key: 'start',
        point: '/hour/start',
        label: '何時から',
        input: {
          type: 'number',
          style: {
            width: '60px'
          },
          maxLength: 2,
          max: 24,
          min: 0,
          val: !!rule.hour ? rule.hour.start : 0
        }
      }, {
        key: 'end',
        point: '/hour/end',
        label: '何時まで',
        input: {
          type: 'number',
          style: {
            width: '60px'
          },
          maxLength: 2,
          max: 24,
          min: 0,
          val: !!rule.hour ? rule.hour.end : 24
        }
      }, {
        key: 'mini',
        point: '/duration/min',
        label: '最短長さ(秒)',
        input: {
          type: 'number',
          style: {
            width: '80px'
          },
          val: !!rule.duration ? rule.duration.min : void 0
        }
      }, {
        key: 'maxi',
        point: '/duration/max',
        label: '最長長さ(秒)',
        input: {
          type: 'number',
          style: {
            width: '80px'
          },
          val: !!rule.duration ? rule.duration.max : void 0
        }
      }, {
        key: 'reserve_fields_operator',
        label: 'タイトルと説明文の関係',
        input: {
          type: 'radios',
          val: rule.reserve_fields_operator || 'and',
          items: [{
            label: '両方に一致 (AND)',
            value: 'and'
          }, {
            label: 'どちらかに一致 (OR)',
            value: 'or'
          }]
        }
      }, {
        key: 'reserve_titles_operator',
        label: '対象タイトル内のキーワード',
        input: {
          type: 'radios',
          val: rule.reserve_titles_operator || 'or',
          items: [{
            label: 'すべてに一致 (AND)',
            value: 'and'
          }, {
            label: 'いずれかに一致 (OR)',
            value: 'or'
          }]
        }
      }, {
        key: 'reserve_descriptions_operator',
        label: '対象説明文内のキーワード',
        input: {
          type: 'radios',
          val: rule.reserve_descriptions_operator || 'or',
          items: [{
            label: 'すべてに一致 (AND)',
            value: 'and'
          }, {
            label: 'いずれかに一致 (OR)',
            value: 'or'
          }]
        }
      }, {
        key: 'reserve_titles',
        label: isExclusion ? '除外するタイトル' : '対象タイトル',
        input: {
          type: formInputTypeStrings,
          style: {
            width: '100%'
          },
          val: rule.reserve_titles
        }
      }, {
        key: 'ignore_titles',
        label: '無視タイトル',
        input: {
          type: formInputTypeStrings,
          style: {
            width: '100%'
          },
          val: rule.ignore_titles
        }
      }, {
        key: 'reserve_descriptions',
        label: isExclusion ? '除外する説明文' : '対象説明文',
        input: {
          type: formInputTypeStrings,
          style: {
            width: '100%'
          },
          val: rule.reserve_descriptions
        }
      }, {
        key: 'ignore_descriptions',
        label: '無視説明文',
        input: {
          type: formInputTypeStrings,
          style: {
            width: '100%'
          },
          val: rule.ignore_descriptions
        }
      }, {
        key: 'recorded_format',
        label: '録画ファイル名フォーマット',
        input: {
          type: 'text',
          style: {
            width: '100%'
          },
          val: rule.recorded_format
        }
      }, {
        key: 'isEnabled',
        label: 'ルールの状態',
        input: {
          type: 'checkbox',
          label: '有効にする',
          val: !rule.isDisabled
        }
      }].filter(function (field) {
        return !isExclusion || field.key !== 'recorded_format';
      })
    });
    function editState() { return JSON.stringify(form.getResult({ commit: false })); }
    var initialState = editState();
    var saving = false, discardConfirmed = false, closeConfirmation = null;
    var modal = new ChinachuUI.Modal({
      title: isExclusion ? '共通除外ルール編集' : 'ルール編集',
      subtitle: isExclusion ? '一致した自動予約をスキップします。手動予約は対象外です。保存後、スケジューラー実行時に反映します。' : '',
      element: form.element,
      closeOnClickOutside: true,
      onClose: releaseEditor,
      onBeforeClose: function () {
        if (saving) return false;
        if (discardConfirmed || editState() === initialState) return true;
        if (!closeConfirmation) {
          closeConfirmation = new ChinachuUI.Modal({
            title: '未保存の変更',
            text: '変更が保存されていません。変更を破棄して閉じますか？',
            buttons: [{
              label: '編集を続ける',
              onSelect: function (e, confirmation) { confirmation.close(); }
            }, {
              label: '破棄して閉じる', color: '@accent',
              onSelect: function (e, confirmation) {
                discardConfirmed = true;
                confirmation.close();
                modal.close();
              }
            }],
            onClose: function () { closeConfirmation = null; }
          }).show();
        }
        return false;
      },
      buttons: [{
        label: '変更',
        onSelect: function (e, modal) {
          if (saving) return;
          e.targetButton.disable();
          var query = form.getResult();
          var submittedState = JSON.stringify(query);
          saving = true;
          form.element.inert = true;
          if (isExclusion) {
            ['sid', 'category'].forEach(function (key) {
              if (typeof rule[key] !== 'undefined') {
                query[key] = rule[key];
              }
            });
          }
          if (!query.duration.min) {
            delete query.duration.min;
          }
          if (!query.duration.max) {
            delete query.duration.max;
          }
          if (!query.duration.min && !query.duration.max) {
            delete query.duration;
          }
          var i;
          for (i in query) {
            if (typeof query[i] === 'object' && query[i].length === 0) {
              delete query[i];
            }
          }
          console.log(query);
          var xhr = new XMLHttpRequest();
          function finishSave() {
            if (!saving) return;
            saving = false;
            form.element.inert = false;
            e.targetButton.enable();
            if (xhr.status === 200) {
              initialState = submittedState;
              modal.close();
              if (isExclusion) {
                Chinachu.emit(document, 'chinachu:exclusion-rules');
              }
              ChinachuUI.createModal({
                title: '成功',
                text: 'ルール変更に成功しました'
              }).show();
            } else {
              ChinachuUI.createModal({
                title: '失敗',
                text: 'ルール変更に失敗しました (' + xhr.status + ')。入力内容は保持されています。'
              }).show();
            }
          }
          ['load', 'error', 'abort', 'timeout'].forEach(function (event) { xhr.addEventListener(event, finishSave); });
          xhr.open('PUT', './api/' + resource + '/' + num + '.json');
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
          xhr.send(JSON.stringify(query));
        }
      }, {
        label: 'キャンセル',
        onSelect: function (e, modal) {
          modal.close();
        }
      }]
    }).show();
    function updateSaveButton() {
      var button = modal.buttons[0].button;
      if (editState() !== initialState) button.setAttribute('data-color', '@accent');
      else button.removeAttribute('data-color');
    }
    form.element.addEventListener('input', updateSaveButton);
    form.element.addEventListener('change', updateSaveButton);
    updateSaveButton();
  }.bind(this),
  onFailure: function (t) {
    releaseEditor();
    new ChinachuUI.Modal({
      title: '失敗',
      text: 'ルールを読み込めませんでした (' + t.status + ')'
    }).show();
  }
});
			}

			return this;
		}
	});

	ui.NewRule = Chinachu.createClass({
		initialize: function _init(isExclusion) {
			this.isExclusion = !!isExclusion;

			this.create();

			return this;
		},
		create: function _create() {
			var isExclusion = this.isExclusion;
			var resource = isExclusion ? 'exclusion-rules' : 'rules';
			if (false) { //のちにエラー処理を追加
				var modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '不正なアクセスです。'
				}).show();
			} else {
				var form = ChinachuUI.createForm({
					fields: [
						{
							key  : 'types',
							label: 'タイプ',
							input: {
								type : 'checkboxes',
								items: ['GR', 'BS', 'CS', 'SKY']
							}
						},
						{
							key  : 'categories',
							label: 'ジャンル',
							input: {
								type : 'checkboxes',
								items: [
									'anime', 'information', 'news', 'sports', 'variety', 'documentary',
									'drama', 'music', 'cinema', 'theater', 'hobby', 'welfare', 'etc'
								]
							}
						},
						{
							key  : 'channels',
							label: '対象CH',
							input: {
								type : formInputTypeChannels,
								style: { width: '100%' }
							}
						},
						{
							key  : 'ignore_channels',
							label: '無視CH',
							input: {
								type : formInputTypeChannels,
								emptyText: '除外なし',
								style: { width: '100%' }
							}
						},
						{
							key  : 'reserve_flags',
							label: '対象フラグ',
							input: {
								type : 'checkboxes',
								items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
							}
						},
						{
							key  : 'ignore_flags',
							label: '無視フラグ',
							input: {
								type : 'checkboxes',
								items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
							}
						},
						{
							key  : 'start',
							point: '/hour/start',
							label: '何時から',
							input: {
								type     : 'number',
								style    : { width: '60px' },
								maxLength: 2,
								max      : 24,
								min      : 0,
								val      : 0
							}
						},
						{
							key   : 'end',
							point : '/hour/end',
							label : '何時まで',
							input : {
								type     : 'number',
								style    : { width: '60px' },
								maxLength: 2,
								max      : 24,
								min      : 0,
								val      : 24
							}
						},
						{
							key  : 'mini',
							point: '/duration/min',
							label: '最短長さ(秒)',
							input: {
								type : 'number',
								style: { width: '80px' }
							}
						},
						{
							key   : 'maxi',
							point: '/duration/max',
							label : '最長長さ(秒)',
							input : {
								type : 'number',
								style: { width: '80px' }
							}
						},
						{
							key: 'reserve_fields_operator',
							label: 'タイトルと説明文の関係',
							input: {
								type: 'radios',
								val: 'and',
								items: [
									{ label: '両方に一致 (AND)', value: 'and' },
									{ label: 'どちらかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key: 'reserve_titles_operator',
							label: '対象タイトル内のキーワード',
							input: {
								type: 'radios',
								val: 'or',
								items: [
									{ label: 'すべてに一致 (AND)', value: 'and' },
									{ label: 'いずれかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key: 'reserve_descriptions_operator',
							label: '対象説明文内のキーワード',
							input: {
								type: 'radios',
								val: 'or',
								items: [
									{ label: 'すべてに一致 (AND)', value: 'and' },
									{ label: 'いずれかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key   : 'reserve_titles',
							label : isExclusion ? '除外するタイトル' : '対象タイトル',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key   : 'ignore_titles',
							label : '無視タイトル',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key   : 'reserve_descriptions',
							label : isExclusion ? '除外する説明文' : '対象説明文',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key   : 'ignore_descriptions',
							label : '無視説明文',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key	: 'recorded_format',
							label	: '録画ファイル名フォーマット',
							input	: {
								type	: 'text',
								style	: { width: '100%' },
							}
						},
						{
							key   : 'isEnabled',
							label : 'ルールの状態',
							input : {
								type : 'checkbox',
								label: '有効にする',
								val  : true
							}
						}
					].filter(function(field) { return !isExclusion || field.key !== 'recorded_format'; })
				});

				var modal = ChinachuUI.createModal({
					title: isExclusion ? '共通除外ルールの新規作成' : '新規作成',
					subtitle: isExclusion ? '一致した自動予約をスキップします。手動予約は対象外です。保存後、スケジューラー実行時に反映します。' : '',
					element: form.element,
					buttons: [
						{
							label  : '作成',
							color  : '@pink',
							onSelect: function(e, modal) {
								e.targetButton.disable();

								var query = form.getResult();

								if (!query.duration.min) {
									delete query.duration.min;
								}
								if (!query.duration.max) {
									delete query.duration.max;
								}
								if (!query.duration.min && !query.duration.max) {
									delete query.duration;
								}

								var i;
								for (i in query) {
									if (typeof query[i] === 'object' && query[i].length === 0) {
										delete query[i];
									}
								}

								console.log(query);

								var xhr = new XMLHttpRequest();

								xhr.addEventListener('load', function () {
									if (xhr.status === 201) {
										if (isExclusion) { Chinachu.emit(document, 'chinachu:exclusion-rules'); }
										ChinachuUI.createModal({
											title: '成功',
											text : 'ルール作成に成功しました',
										}).show();
									} else {
										ChinachuUI.createModal({
											title: '失敗',
											text : 'ルール作成に失敗しました (' + xhr.status + ')'
										}).show();
									}
									modal.close();
								});

								xhr.open('POST', './api/' + resource + '.json');
								xhr.setRequestHeader('Content-Type', 'application/json');
								xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
								xhr.send(JSON.stringify(query));
							}
						},
						{
							label  : 'キャンセル',
							onSelect: function(e, modal) {
								modal.close();
							}
						}
					]
				}).show();
			}

			return this;
		}
	});

	ui.CreateRuleByProgram = Chinachu.createClass({
		initialize: function _init(id) {
			this.program = util.getProgramById(id);

			this.create();

			return this;
		},
		create: function _create() {
			if (this.program === null) { //のちにエラー処理を追加
				var modal = new ChinachuUI.Modal({
					title: 'エラー',
					text : '不正なアクセスです。'
				}).show();
			} else {
				var program = this.program;

				var form = ChinachuUI.createForm({
					fields: [
						{
							key  : 'types',
							label: 'タイプ',
							input: {
								type : 'checkboxes',
								items: ['GR', 'BS', 'CS', 'SKY'],
								val  : [program.channel.type]
							}
						},
						{
							key  : 'categories',
							label: 'ジャンル',
							input: {
								type : 'checkboxes',
								items: [
									'anime', 'information', 'news', 'sports', 'variety', 'documentary',
									'drama', 'music', 'cinema', 'theater', 'hobby', 'welfare', 'etc'
								],
								val  : [program.category]
							}
						},
						{
							key  : 'channels',
							label: '対象CH',
							input: {
								type : formInputTypeChannels,
								style: { width: '100%' },
								val  : [program.channel.id]
							}
						},
						{
							key  : 'ignore_channels',
							label: '無視CH',
							input: {
								type : formInputTypeChannels,
								emptyText: '除外なし',
								style: { width: '100%' }
							}
						},
						{
							key  : 'reserve_flags',
							label: '対象フラグ',
							input: {
								type : 'checkboxes',
								items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
							}
						},
						{
							key  : 'ignore_flags',
							label: '無視フラグ',
							input: {
								type : 'checkboxes',
								items: ['新', '終', '再', '字', 'デ', '解', '無', '二', 'Ｓ']
							}
						},
						{
							key  : 'start',
							point: '/hour/start',
							label: '何時から',
							input: {
								type     : 'number',
								style    : { width: '60px' },
								maxLength: 2,
								max      : 24,
								min      : 0,
								val      : 0
							}
						},
						{
							key   : 'end',
							point : '/hour/end',
							label : '何時まで',
							input : {
								type     : 'number',
								style    : { width: '60px' },
								maxLength: 2,
								max      : 24,
								min      : 0,
								val      : 24
							}
						},
						{
							key  : 'mini',
							point: '/duration/min',
							label: '最短長さ(秒)',
							input: {
								type : 'number',
								style: { width: '80px' }
							}
						},
						{
							key   : 'maxi',
							point: '/duration/max',
							label : '最長長さ(秒)',
							input : {
								type : 'number',
								style: { width: '80px' }
							}
						},
						{
							key: 'reserve_fields_operator',
							label: 'タイトルと説明文の関係',
							input: {
								type: 'radios',
								val: 'and',
								items: [
									{ label: '両方に一致 (AND)', value: 'and' },
									{ label: 'どちらかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key: 'reserve_titles_operator',
							label: '対象タイトル内のキーワード',
							input: {
								type: 'radios',
								val: 'or',
								items: [
									{ label: 'すべてに一致 (AND)', value: 'and' },
									{ label: 'いずれかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key: 'reserve_descriptions_operator',
							label: '対象説明文内のキーワード',
							input: {
								type: 'radios',
								val: 'or',
								items: [
									{ label: 'すべてに一致 (AND)', value: 'and' },
									{ label: 'いずれかに一致 (OR)', value: 'or' }
								]
							}
						},
						{
							key   : 'reserve_titles',
							label : '対象タイトル',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' },
								val  : [this.program.title]
							}
						},
						{
							key   : 'ignore_titles',
							label : '無視タイトル',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key   : 'reserve_descriptions',
							label : '対象説明文',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key   : 'ignore_descriptions',
							label : '無視説明文',
							input : {
								type : formInputTypeStrings,
								style: { width: '100%' }
							}
						},
						{
							key	: 'recorded_format',
							label	: '録画ファイル名フォーマット',
							input	: {
								type	: 'text',
								style	: { width: '100%' },
							}
						},
						{
							key   : 'isEnabled',
							label : 'ルールの状態',
							input : {
								type : 'checkbox',
								label: '有効にする',
								val  : true
							}
						}
					]
				});

				var modal = ChinachuUI.createModal({
					title: '新規作成',
					element: form.element,
					buttons: [
						{
							label  : '作成',
							color  : '@pink',
							onSelect: function(e, modal) {
								e.targetButton.disable();

								var query = form.getResult();

								if (!query.duration.min) {
									delete query.duration.min;
								}
								if (!query.duration.max) {
									delete query.duration.max;
								}
								if (!query.duration.min && !query.duration.max) {
									delete query.duration;
								}

								var i;
								for (i in query) {
									if (typeof query[i] === 'object' && query[i].length === 0) {
										delete query[i];
									}
								}

								console.log(query);

								var xhr = new XMLHttpRequest();

								xhr.addEventListener('load', function () {
									if (xhr.status === 201) {
										ChinachuUI.createModal({
											title: '成功',
											text : 'ルール作成に成功しました',
										}).show();
									} else {
										ChinachuUI.createModal({
											title: '失敗',
											text : 'ルール作成に失敗しました (' + xhr.status + ')'
										}).show();
									}
									modal.close();
								});

								xhr.open('POST', './api/rules.json');
								xhr.setRequestHeader('Content-Type', 'application/json');
								xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
								xhr.send(JSON.stringify(query));
							}
						},
						{
							label  : 'キャンセル',
							onSelect: function(e, modal) {
								modal.close();
							}
						}
					]
				}).show();
			}

			return this;
		}
	});

	ui.copyStr = function (string) {

		var span = ChinachuUI.createElement("span")
			.insertText(string)
			.insertTo(document.body);

		var range = document.createRange();
		range.selectNode(span);

		var selection = window.getSelection()
		selection.removeAllRanges();
		selection.addRange(range);

		document.execCommand("copy");

		span.remove();
	};

})();
