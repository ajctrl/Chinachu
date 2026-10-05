/* Shared native search fields; all values, including empty filters, are explicit. */
(function(root) {
	'use strict';
	function show(page, options) {
		var recorded = !!options.recorded;
		if (page.searchModal) page.searchModal.close();
		var form = document.createElement('form');
		form.className = 'chinachu-search-form';
		var inputs = {};
		var fields = [
			['cat', 'カテゴリー', ['anime', 'information', 'news', 'sports', 'variety', 'documentary', 'drama', 'music', 'cinema', 'theater', 'hobby', 'welfare', 'etc']],
			['title', 'タイトル'], ['desc', '説明'], ['type', 'タイプ', ['GR', 'BS', 'CS', 'SKY']],
			['start', '何時から'], ['end', '何時まで'], ['pgid', 'プログラムID'], ['chid', 'チャンネルID']
		];
		fields.forEach(function(field) {
			var label = document.createElement('label');
			label.className = 'chinachu-search-field';
			var caption = document.createElement('span');
			caption.textContent = field[1];
			label.appendChild(caption);
			var input = inputs[field[0]] = document.createElement(field[2] ? 'select' : 'input');
			input.name = field[0];
			if (field[2]) {
				[''].concat(field[2]).forEach(function(value) {
					var option = document.createElement('option');
					option.value = value;
					option.textContent = value || '指定なし';
					input.appendChild(option);
				});
			} else {
				input.type = field[0] === 'start' || field[0] === 'end' ? 'number' : 'text';
				if (input.type === 'number') { input.min = '0'; input.max = '24'; input.step = '1'; }
			}
			input.value = page.self.query[field[0]] || '';
			input.addEventListener('input', function() { input.setCustomValidity(''); });
			label.appendChild(input);
			form.appendChild(label);
		});
		function submit(event) {
			if (event) event.preventDefault();
			['title', 'desc'].forEach(function(key) {
				try { new RegExp(inputs[key].value); inputs[key].setCustomValidity(''); }
				catch (error) { inputs[key].setCustomValidity('検索条件の正規表現を確認してください。'); }
			});
			if (!form.reportValidity()) return;
			var query = Object.assign({}, page.self.query);
			Object.keys(inputs).forEach(function(key) { query[key] = inputs[key].value; });
			query.skip = 1;
			// Older schedule-search URLs encoded title and description twice.
			if (!recorded) query.searchVersion = 2;
			delete query.page;
			modal.close();
			var hash = '!/' + (recorded ? 'recorded/search' : 'search/top') + '/' + Chinachu.serializeQuery(query) + '/';
			if (window.location.hash.replace(/^#/, '') === hash) { page.self.query = query; page.drawMain(); }
			else window.location.hash = hash;
		}
		form.addEventListener('submit', submit);
		var submitButton = document.createElement('button');
		submitButton.type = 'submit';
		submitButton.hidden = true;
		form.appendChild(submitButton);
		var modal = page.searchModal = new ChinachuUI.Modal({
			title: recorded ? '録画番組検索' : '番組検索',
			buttons: [{ label: '検索', color: '@pink', onSelect: submit }, { label: 'キャンセル', onSelect: function() { modal.close(); } }]
		}).show();
		modal.content.appendChild(form);
		inputs.title.focus();
		return modal;
	}
	root.ChinachuSearchForm = { show: show };
}(window));
