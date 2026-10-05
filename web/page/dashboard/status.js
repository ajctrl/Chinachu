Chinachu.definePage({

	init: function _initPage() {

		this.view.content.className = 'loading';

		this.onNotify = this.refresh.bind(this);
		Chinachu.on(document, 'chinachu:status', this.onNotify);

		this.draw();

		return this;
	}
	,
	refresh: function() {

		this.draw();

		return this;
	}
	,
	deinit: function _deinit() {

		Chinachu.off(document, 'chinachu:status', this.onNotify);

		return this;
	}
	,
	draw: function _draw() {

		this.view.content.className = '';
		this.view.content.update();

		if (!global.chinachu.status.operator) {
			new ChinachuUI.Alert({
				title       : 'ステータス',
				body        : '取得待ち...',
				disableClose: true
			}).render(this.view.content);

			return this;
		}

		if (global.chinachu.status.operator.alive === true) {
			new ChinachuUI.Alert({
				title       : 'Operator',
				type        : 'green',
				body        : '動作しています',
				disableClose: true
			}).render(this.view.content);
		} else {
			new ChinachuUI.Alert({
				title       : 'Operator',
				type        : 'red',
				body        : '停止しています',
				disableClose: true
			}).render(this.view.content);
		}

		return this;
	}
});