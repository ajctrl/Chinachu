Chinachu.definePage({
	
	init: function _initPage() {
		this.view.content.className = 'loading';
		
		this.draw();
		
		return this;
	},
	
	deinit: function _deinit() {
		
		if (this.data.operatorLogRequest) this.data.operatorLogRequest.transport.abort();
		if (this.data.schedulerLogRequest) this.data.schedulerLogRequest.transport.abort();
		if (this.data.wuiLogRequest) this.data.wuiLogRequest.transport.abort();
		
		return this;
	},
	
	draw: function _draw() {
		this.view.content.className = '';
		this.view.content.update();
		
		this.view.operatorLog  = ChinachuUI.createElement().addClassName('console');
		this.view.schedulerLog = ChinachuUI.createElement().addClassName('console');
		this.view.wuiLog       = ChinachuUI.createElement().addClassName('console');
		
		ChinachuUI.createTab({
			fill: true,
			tabs: [
				{
					label   : 'Operator',
					element : this.view.operatorLog,
					onSelect: function() {
						this.view.operatorLog.scrollTop = this.view.operatorLog.scrollHeight;
					}.bind(this)
				},
				{
					label   : 'Scheduler',
					element : this.view.schedulerLog,
					onSelect: function() {
						this.view.schedulerLog.scrollTop = this.view.schedulerLog.scrollHeight;
					}.bind(this)
				},
				{
					label   : 'WUI',
					element : this.view.wuiLog,
					onSelect: function() {
						this.view.wuiLog.scrollTop = this.view.wuiLog.scrollHeight;
					}.bind(this)
				}
			]
		}).insertTo(this.view.content);
		
		this.data.operatorLogRequest = Chinachu.request('./api/log/operator/stream.txt', {
			method: 'get',
			onInteractive: function(t) {
				var text = t.responseText;
				
				this.view.operatorLog.updateText(text);
				this.view.operatorLog.scrollTop = this.view.operatorLog.scrollHeight;
			}.bind(this)
		});
		
		this.data.schedulerLogRequest = Chinachu.request('./api/log/scheduler/stream.txt', {
			method: 'get',
			onInteractive: function(t) {
				var text = t.responseText;
				
				this.view.schedulerLog.updateText(text);
				this.view.schedulerLog.scrollTop = this.view.schedulerLog.scrollHeight;
			}.bind(this)
		});
		
		this.data.wuiLogRequest = Chinachu.request('./api/log/wui/stream.txt', {
			method: 'get',
			onInteractive: function(t) {
				var text = t.responseText;
				
				this.view.wuiLog.updateText(text);
				this.view.wuiLog.scrollTop = this.view.wuiLog.scrollHeight;
			}.bind(this)
		});
		
		return this;
	}
});