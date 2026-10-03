P = Class.create(P, {
	init: function() {
		this.closed = false;
		this.onNotify = this.refresh.bindAsEventListener(this);
		['chinachu:storage', 'chinachu:recorded', 'chinachu:recording'].forEach(function(event) {
			document.observe(event, this.onNotify);
		}, this);
		this.draw();
		this.refresh();
		this.timer.storage = setInterval(function() {
			if (!document.hidden) this.refresh();
		}.bind(this), 30000);
		return this;
	},
	deinit: function() {
		this.closed = true;
		clearInterval(this.timer.storage);
		['chinachu:storage', 'chinachu:recorded', 'chinachu:recording'].forEach(function(event) {
			document.stopObserving(event, this.onNotify);
		}, this);
		if (this.request) this.request.transport.abort();
		return this;
	},
	node: function(tag, parent, text, className) {
		var node = document.createElement(tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		if (parent) parent.appendChild(node);
		return node;
	},
	readableFilesize: function(size) {
		var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
		var index = 0;
		while (size >= 1024 && index < units.length - 1) {
			size /= 1024;
			index++;
		}
		return size.toFixed(index ? 1 : 0) + ' ' + units[index];
	},
	draw: function() {
		this.view.content.className = 'storage-page';
		this.view.content.update();
		this.card = this.node('section', this.view.content, undefined, 'storage-card');
		this.card.setAttribute('aria-label', 'STORAGE USAGE'.__());
		var header = this.node('div', this.card, undefined, 'storage-card-header');
		this.node('h2', header, 'RECORDING STORAGE'.__());
		this.refreshButton = this.node('button', header, 'REFRESH'.__(), 'storage-refresh');
		this.refreshButton.type = 'button';
		this.refreshButton.addEventListener('click', this.refresh.bind(this));
		var summary = this.node('div', this.card, undefined, 'storage-summary');
		var free = this.node('div', summary);
		this.node('div', free, 'AVAILABLE SPACE'.__(), 'storage-label');
		this.freeValue = this.node('strong', free, '—', 'storage-free-value');
		var total = this.node('div', summary, undefined, 'storage-total');
		this.node('div', total, 'TOTAL CAPACITY'.__(), 'storage-label');
		this.totalValue = this.node('strong', total, '—');
		this.bar = this.node('div', this.card, undefined, 'storage-bar');
		this.bar.hidden = true;
		// The numeric breakdown provides the accessible equivalent of the bar.
		this.bar.setAttribute('aria-hidden', 'true');
		this.breakdown = this.node('dl', this.card, undefined, 'storage-breakdown');
		this.warning = this.node('p', this.card, undefined, 'storage-warning');
		this.warning.setAttribute('role', 'status');
		this.warning.hidden = true;
		var footer = this.node('div', this.card, undefined, 'storage-card-footer');
		var link = this.node('a', footer, 'OPEN RECORDED PROGRAMS'.__(), 'storage-recorded-link');
		link.href = '#!/recorded/list/';
		this.status = this.node('p', footer, '', 'storage-status');
		this.status.setAttribute('role', 'status');
		return this;
	},
	refresh: function() {
		if (this.closed || this.loading) return this;
		this.loading = true;
		this.refreshButton.disabled = true;
		this.card.setAttribute('aria-busy', 'true');
		this.status.className = 'storage-status';
		this.status.textContent = 'LOADING STORAGE'.__();
		this.request = new Ajax.Request('./api/storage.json', {
			method: 'get',
			onSuccess: function(response) {
				var data;
				try { data = JSON.parse(response.responseText); }
				catch (error) { this.receiveUsage(true); return; }
				this.receiveUsage(false, data);
			}.bind(this),
			onFailure: function() { this.receiveUsage(true); }.bind(this)
		});
		return this;
	},
	receiveUsage: function(error, data) {
		if (this.closed) return;
		this.loading = false;
		this.request = null;
		this.refreshButton.disabled = false;
		this.card.setAttribute('aria-busy', 'false');
		var valid = data && ['size', 'used', 'avail', 'recorded'].every(function(key) {
			return typeof data[key] === 'number' && isFinite(data[key]) && data[key] >= 0;
		});
		if (error || !valid || data.size === 0) {
			this.status.className = 'storage-status storage-error';
			this.status.textContent = 'STORAGE LOAD FAILED'.__();
			if (this.hasData) this.status.textContent += ' ' + 'SHOWING PREVIOUS STORAGE'.__();
			return;
		}
		this.renderUsage(data);
		this.hasData = true;
		this.status.textContent = 'LAST UPDATED'.__() + ': ' + new Date().toLocaleTimeString();
	},
	renderUsage: function(data) {
		var used = Math.min(data.used, data.size);
		var recorded = Math.min(data.recorded, used);
		var available = Math.min(data.avail, data.size - used);
		var reserved = Math.max(0, data.size - used - available);
		var categories = [
			{ label: 'RECORDED'.__(), value: recorded, className: 'storage-recorded' },
			{ label: 'OTHER STORAGE USAGE'.__(), value: used - recorded, className: 'storage-other' },
			{ label: 'AVAILABLE SPACE'.__(), value: available, className: 'storage-available' }
		];
		if (reserved > 0) categories.push({ label: 'RESERVED SPACE'.__(), value: reserved, className: 'storage-reserved' });
		this.freeValue.textContent = this.readableFilesize(available);
		this.totalValue.textContent = this.readableFilesize(data.size);
		this.bar.textContent = '';
		this.bar.hidden = false;
		this.breakdown.textContent = '';
		categories.forEach(function(category) {
			var formatted = this.readableFilesize(category.value);
			var segment = this.node('span', this.bar, undefined, category.className);
			segment.style.width = (category.value / data.size * 100) + '%';
			segment.title = category.label + ': ' + formatted;
			var row = this.node('div', this.breakdown, undefined, 'storage-breakdown-row');
			var label = this.node('dt', row);
			var dot = this.node('span', label, undefined, 'storage-dot ' + category.className);
			dot.setAttribute('aria-hidden', 'true');
			this.node('span', label, category.label);
			this.node('dd', row, formatted);
		}, this);
		var threshold = data.lowSpaceThreshold;
		var lowSpace = available === 0 || (typeof threshold === 'number' && isFinite(threshold) && threshold > 0 && available < threshold);
		this.warning.hidden = !lowSpace;
		this.warning.textContent = available === 0 ? 'NO AVAILABLE SPACE'.__() : 'LOW AVAILABLE SPACE'.__();
		this.card.className = 'storage-card' + (lowSpace ? ' storage-low-space' : '');
		return this;
	}
});
