(function() {
	'use strict';
	// CLI actions rewrite the reservation list. Serialize rapid clicks across pages.
	var queue = [], pending = Object.create(null), running = false;
	function changed() { document.fire('chinachu:reserves', global.chinachu.reserves); }
	function next() {
		if (running || !queue.length) return;
		var item = queue.shift();
		running = true;
		var result = { ok: false, status: 0 };
		new Ajax.Request('./api/reserves/' + encodeURIComponent(item.id) + '/' + (item.skip ? 'skip' : 'unskip') + '.json', {
			method: 'put', parameters: { start: item.start },
			onSuccess: function(response) {
				var updated = response.responseJSON && response.responseJSON.program;
				if (response.status !== 200 || !updated || updated.id !== item.id || updated.start !== item.start) {
					result = { ok: false, status: response.status, message: '最新の予約状態を確認できませんでした。一覧を再読み込みしてください。' };
					return;
				}
				if (updated) {
					global.chinachu.reserves = global.chinachu.reserves.map(function(program) {
						return program.id === updated.id && program.start === updated.start ? updated : program;
					});
				}
				result = { ok: true, program: updated };
			},
			onFailure: function(response) { result = { ok: false, status: response.status }; },
			onComplete: function() {
				delete pending[item.id];
				running = false;
				try {
					changed();
					item.callback(result);
				} finally { next(); }
			}
		});
	}
	function setSkip(program, skip, callback) {
		if (program.isManualReserved || pending[program.id]) return false;
		pending[program.id] = true;
		queue.push({ id: program.id, start: program.start, skip: skip, callback: callback });
		changed();
		next();
		return true;
	}
	window.ChinachuReservationActions = { setSkip: setSkip, isPending: function(id) { return !!pending[id]; } };
})();
