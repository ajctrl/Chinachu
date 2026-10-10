/* Shared native search fields; all values, including empty filters, are explicit. */
(function(root) {
	'use strict';
	var categories = { anime: 'アニメ', information: '情報・ワイドショー', news: 'ニュース・報道', sports: 'スポーツ', variety: 'バラエティ', documentary: 'ドキュメンタリー', drama: 'ドラマ', music: '音楽', cinema: '映画', theater: '劇場・公演', hobby: '趣味・教育', welfare: '福祉', etc: 'その他' };
	var searchTargets = { all: 'タイトル＋説明', title: 'タイトルのみ', desc: '説明のみ' };
	var filterKeys = ['keyword', 'title', 'desc', 'cat', 'type', 'start', 'end', 'pgid', 'channels'];
	function isMobile() { return window.matchMedia('(max-width: 800px)').matches; }
	function hasSearch(query) {
		return !!query.skip || filterKeys.concat('chid').some(function(key) {
			return query[key] !== undefined && query[key] !== null && query[key] !== '';
		});
	}
	function textMatcher(query, normalizationForm, recorded) {
		function normalize(value) {
			var text = String(value == null ? '' : value);
			return normalizationForm ? text.normalize(normalizationForm) : text;
		}
		var words = normalize(query.keyword).toLowerCase().split(/\s+/).filter(Boolean);
		var target = query.searchTarget === 'title' || query.searchTarget === 'desc' ? query.searchTarget : 'all';
		// Bookmarked title/description conditions retain their original regex semantics.
		var titleExpression, descriptionExpression;
		try {
			if (query.title) titleExpression = new RegExp(normalize(query.title));
			if (query.desc) descriptionExpression = new RegExp(normalize(query.desc));
		} catch (error) { return function() { return false; }; }
		return function(program) {
			var title = normalize(program.fullTitle || program.title);
			var description = normalize(program.detail);
			if (titleExpression && !titleExpression.test(recorded ? normalize(program.title) : title)) return false;
			if (descriptionExpression && (!program.detail || !descriptionExpression.test(description))) return false;
			var titles = [normalize(program.title), title];
			var fields = target === 'title' ? titles : target === 'desc' ? [description] : titles.concat(description);
			fields = fields.map(function(text) { return text.toLowerCase(); });
			return words.every(function(word) {
				return fields.some(function(text) { return text.indexOf(word) !== -1; });
			});
		};
	}
	function categoryValues(value) {
		return Array.from(new Set(typeof value === 'string' ? value.split(',').filter(Boolean) : []));
	}
	function categoryMatcher(query) {
		var selected = categoryValues(query.cat);
		return function(category) { return !selected.length || selected.indexOf(category) !== -1; };
	}
	function choiceList(panel, input) {
		// The same checkbox group is used in desktop popovers and mobile forms.
		var list = document.createElement('div');
		list.className = 'chinachu-search-choices';
		list.setAttribute('role', 'group');
		list.setAttribute('aria-label', 'ジャンル（複数選択可）');
		var values = [''].concat(Object.keys(categories));
		categoryValues(input.value).forEach(function(value) { if (values.indexOf(value) === -1) values.push(value); });
		var checkboxes = [];
		function sync() {
			var selected = categoryValues(input.value);
			checkboxes.forEach(function(checkbox) {
				checkbox.checked = checkbox.value ? selected.indexOf(checkbox.value) !== -1 : !selected.length;
			});
		}
		values.forEach(function(value) {
			var row = document.createElement('label');
			var text = document.createElement('span');
			text.textContent = categories[value] || value || '指定なし';
			var checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.value = value;
			checkbox.addEventListener('change', function() {
				var selected = categoryValues(input.value).filter(function(item) { return item !== value; });
				if (value && checkbox.checked) selected.push(value);
				input.value = value ? selected.join(',') : '';
				sync();
			});
			checkboxes.push(checkbox);
			row.appendChild(text);
			row.appendChild(checkbox);
			list.appendChild(row);
		});
		sync();
		panel.appendChild(list);
		return list;
	}
	function popup(container, label, className) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'chinachu-search-filter';
		button.textContent = label;
		button.setAttribute('aria-label', label);
		button.setAttribute('aria-expanded', 'false');
		var panel = document.createElement('div');
		panel.className = 'chinachu-search-popover ' + className;
		panel.popover = 'auto';
		panel.setAttribute('aria-label', label);
		var heading = document.createElement('strong');
		heading.textContent = label;
		panel.appendChild(heading);
		button.popoverTargetElement = panel;
		panel.addEventListener('beforetoggle', function(event) {
			var open = event.newState === 'open';
			button.setAttribute('aria-expanded', String(open));
			if (!open) return;
			var rect = button.getBoundingClientRect();
			var viewport = window.visualViewport;
			var left = viewport ? viewport.offsetLeft : 0;
			var top = viewport ? viewport.offsetTop : 0;
			var width = viewport ? viewport.width : window.innerWidth;
			var bottom = top + (viewport ? viewport.height : window.innerHeight);
			var panelWidth = parseFloat(window.getComputedStyle(panel).width);
			panel.style.left = Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12)) + 'px';
			var below = bottom - rect.bottom - 24;
			var above = rect.top - top - 24;
			var upward = below < 160 && above > below;
			panel.style.top = upward ? 'auto' : (rect.bottom + 8) + 'px';
			panel.style.bottom = upward ? (window.innerHeight - rect.top + 8) + 'px' : 'auto';
			panel.style.maxHeight = Math.max(0, upward ? above : below) + 'px';
		});
		container.appendChild(button);
		container.appendChild(panel);
		return { button: button, panel: panel };
	}
	function navigate(page, recorded, query) {
		query.skip = 1;
		if (!recorded) query.searchVersion = 2;
		delete query.page;
		var hash = '!/' + (recorded ? 'recorded/search' : 'search/top') + '/' + Chinachu.serializeQuery(query) + '/';
		if (window.location.hash.replace(/^#/, '') === hash) { page.self.query = query; page.drawMain(); }
		else window.location.hash = hash;
	}
	function createForm(page, recorded, onSubmit) {
		var form = document.createElement('form');
		form.className = 'chinachu-search-form';
		var inputs = {};
		var categoryChoices;
		var fields = [
			['keyword', 'キーワード'], ['searchTarget', '検索対象', ['all', 'title', 'desc']],
			['cat', 'ジャンル'],
			['type', 'タイプ', ['GR', 'BS', 'CS', 'SKY']],
			['start', '何時から'], ['end', '何時まで'], ['pgid', 'プログラムID']
		];
		[['title', 'タイトルの条件'], ['desc', '説明の条件']].forEach(function(field) {
			if (page.self.query[field[0]]) fields.push(field);
		});
		fields.forEach(function(field) {
			var label = document.createElement(field[0] === 'cat' ? 'div' : 'label');
			label.className = 'chinachu-search-field' + (field[0] === 'cat' ? ' chinachu-search-category-field' : '');
			var caption = document.createElement('span');
			caption.textContent = field[1];
			label.appendChild(caption);
			var input = inputs[field[0]] = document.createElement(field[2] ? 'select' : 'input');
			input.name = field[0];
			if (field[2]) {
				(field[0] === 'searchTarget' ? field[2] : [''].concat(field[2])).forEach(function(value) {
					var option = document.createElement('option');
					option.value = value;
					option.textContent = (field[0] === 'searchTarget' ? searchTargets[value] : value) || '指定なし';
					input.appendChild(option);
				});
			} else {
				input.type = field[0] === 'cat' ? 'hidden' : field[0] === 'start' || field[0] === 'end' ? 'number' : 'text';
				if (input.type === 'number') { input.min = '0'; input.max = '24'; input.step = '1'; }
			}
			input.value = page.self.query[field[0]] == null ? '' : page.self.query[field[0]];
			if (field[0] === 'searchTarget' && input.value !== 'title' && input.value !== 'desc') input.value = 'all';
			input.addEventListener('input', function() { input.setCustomValidity(''); });
			label.appendChild(input);
			if (field[0] === 'cat') categoryChoices = choiceList(label, input);
			form.appendChild(label);
		});
		inputs.keyword.placeholder = 'キーワードを入力（スペース区切りで絞り込み）';
		inputs.keyword.title = 'スペースで区切ったすべての語を含む番組を検索します';
		var channelField = document.createElement('div');
		channelField.className = 'chinachu-search-field chinachu-search-channel-field';
		var channelCaption = document.createElement('span');
		channelCaption.textContent = 'チャンネル';
		channelField.appendChild(channelCaption);
		var channelSelector = ChinachuChannelSelector.create({
			element: document.createElement('div'),
			getChannels: function() {
				var data = global.chinachu;
				var seen = new Set();
				return (data.schedule || []).concat(recorded ? (data.recorded || []).map(function(program) { return program.channel; }) : []).filter(function(channel) {
					if (seen.has(channel.id)) return false;
					seen.add(channel.id);
					return true;
				});
			}
		});
		channelSelector.setValues(typeof page.self.query.channels === 'string' ? page.self.query.channels.split(',').filter(Boolean) : (page.self.query.chid ? [page.self.query.chid] : []));
		channelField.appendChild(channelSelector);
		form.appendChild(channelField);
		function submit(event) {
			if (event) event.preventDefault();
			['title', 'desc'].forEach(function(key) {
				if (!inputs[key]) return;
				try { new RegExp(inputs[key].value); inputs[key].setCustomValidity(''); }
				catch (error) { inputs[key].setCustomValidity('検索条件の正規表現を確認してください。'); }
			});
			if (!form.reportValidity()) return;
			var query = Object.assign({}, page.self.query);
			Object.keys(inputs).forEach(function(key) { query[key] = inputs[key].value; });
			query.channels = channelSelector.getValues().join(',');
			delete query.chid;
			onSubmit(query);
		}
		form.addEventListener('submit', submit);
		var submitButton = document.createElement('button');
		submitButton.type = 'submit';
		submitButton.hidden = true;
		form.appendChild(submitButton);
		return { form: form, inputs: inputs, categoryChoices: categoryChoices, channelSelector: channelSelector, channelField: channelField, submit: submit, submitButton: submitButton };
	}
	function show(page, options) {
		var recorded = !!options.recorded;
		if (page.searchModal) page.searchModal.close();
		var fields = createForm(page, recorded, function(query) { closePopovers(); modal.close(); navigate(page, recorded, query); });
		fields.form.className += ' chinachu-search-modal';
		var categoryField = fields.inputs.cat.parentElement;
		var genres = popup(categoryField, 'ジャンル', 'chinachu-search-genres');
		genres.panel.appendChild(fields.categoryChoices);
		var channels = popup(fields.channelField, 'チャンネル', 'chinachu-search-channels');
		channels.panel.appendChild(fields.channelSelector);
		channels.panel.addEventListener('beforetoggle', function(event) {
			fields.channelSelector.querySelector('.channel-selector-picker').open = event.newState === 'open';
		});
		fields.form.insertBefore(fields.channelField, categoryField);
		function valueLabel(button, values) {
			var text = document.createElement('span');
			text.textContent = values.join('、') || '指定なし';
			button.replaceChildren(text);
			button.title = text.textContent;
		}
		function updateGenres() {
			valueLabel(genres.button, categoryValues(fields.inputs.cat.value).map(function(value) { return categories[value] || value; }));
		}
		function updateChannels() {
			valueLabel(channels.button, fields.channelSelector.getValues().map(function(value) {
				var data = global.chinachu;
				var source = (data.schedule || []).concat(recorded ? (data.recorded || []).map(function(program) { return program.channel; }) : []);
				var channel = source.find(function(channel) { return channel.id === value; });
				return channel ? channel.name : value;
			}));
		}
		fields.categoryChoices.addEventListener('change', updateGenres);
		fields.channelSelector.addEventListener('change', updateChannels);
		updateGenres();
		updateChannels();
		var panels = [genres.panel, channels.panel];
		fields.form.addEventListener('keydown', function(event) {
			if (event.key !== 'Escape') return;
			var active = [genres, channels].find(function(controls) { return controls.panel.matches(':popover-open'); });
			if (!active) return;
			event.preventDefault();
			event.stopPropagation();
			closePopovers();
			active.button.focus();
		});
		function closePopovers() {
			panels.forEach(function(panel) { if (panel.matches(':popover-open')) panel.hidePopover(); });
		}
		function onScroll(event) {
			if (!panels.some(function(panel) { return panel.contains(event.target); })) closePopovers();
		}
		window.addEventListener('resize', closePopovers);
		window.addEventListener('scroll', onScroll, true);
		if (window.visualViewport) window.visualViewport.addEventListener('resize', closePopovers);
		var modal = page.searchModal = new ChinachuUI.Modal({
			title: recorded ? '録画番組検索' : '番組検索',
			buttons: [{ label: '検索', color: '@pink', onSelect: fields.submit }, { label: 'キャンセル', onSelect: function() { modal.close(); } }],
			onClose: function() {
				closePopovers();
				window.removeEventListener('resize', closePopovers);
				window.removeEventListener('scroll', onScroll, true);
				if (window.visualViewport) window.visualViewport.removeEventListener('resize', closePopovers);
			}
		}).show();
		modal.content.appendChild(fields.form);
		fields.inputs.keyword.focus();
		return modal;
	}
	function mount(page, recorded) {
		var header = page.searchHeader = document.createElement('div');
		header.className = 'chinachu-search-header';
		page.view.content.appendChild(header);
		var fields = createForm(page, recorded, function(query) { closePopovers(); navigate(page, recorded, query); });
		var form = fields.form;
		form.className += ' chinachu-search-inline';
		form.setAttribute('aria-label', recorded ? '録画番組検索' : '番組検索');
		header.appendChild(form);
		var popovers = [];
		function addPopup(label, className) {
			var controls = popup(form, label, className);
			popovers.push(controls.panel);
			return controls.panel;
		}
		var titleLabel = fields.inputs.keyword.parentElement;
		titleLabel.className = 'chinachu-search-title';
		fields.inputs.keyword.setAttribute('aria-label', 'キーワード');
		form.appendChild(titleLabel);
		var channelPanel = addPopup('チャンネル', 'chinachu-search-channels');
		channelPanel.appendChild(fields.channelField);
		channelPanel.addEventListener('beforetoggle', function(event) {
			fields.channelSelector.querySelector('.channel-selector-picker').open = event.newState === 'open';
		});
		var categoryPanel = addPopup('ジャンル', 'chinachu-search-genres');
		categoryPanel.appendChild(fields.inputs.cat.parentElement);
		var advancedPanel = addPopup('詳細条件', 'chinachu-search-advanced');
		['searchTarget', 'title', 'desc', 'type', 'start', 'end', 'pgid'].forEach(function(key) {
			if (fields.inputs[key]) advancedPanel.appendChild(fields.inputs[key].parentElement);
		});
		// Open the containing popover before the browser focuses an invalid field.
		Object.keys(fields.inputs).forEach(function(key) {
			fields.inputs[key].addEventListener('invalid', function() {
				var panel = fields.inputs[key].closest('[popover]');
				if (panel && !panel.matches(':popover-open')) panel.showPopover();
			});
		});
		fields.submitButton.hidden = false;
		fields.submitButton.className = 'chinachu-search-submit';
		fields.submitButton.textContent = '検索';
		form.appendChild(fields.submitButton);
		function closePopovers() {
			popovers.forEach(function(panel) { if (panel.matches(':popover-open')) panel.hidePopover(); });
		}
		window.addEventListener('resize', closePopovers);
		page.searchControls = { destroy: function() { closePopovers(); window.removeEventListener('resize', closePopovers); } };
		page.searchSummary = null;
		updateSummary(page, recorded);
		if (!hasSearch(page.self.query)) {
			page.view.content.classList.add('search-awaiting-input');
			var hint = document.createElement('p');
			hint.className = 'chinachu-search-hint';
			hint.textContent = '検索条件を入力して「検索」を押してください。';
			page.view.content.appendChild(hint);
		}
	}
	function updateSummary(page, recorded, count) {
		if (!page.searchSummary) {
			page.searchSummary = document.createElement('div');
			page.searchSummary.className = 'chinachu-search-summary';
			page.searchSummary.setAttribute('aria-label', '検索条件');
			(page.searchHeader || page.view.content).appendChild(page.searchSummary);
		}
		var summary = page.searchSummary, query = page.self.query;
		summary.replaceChildren();
		function clear(key, value) {
			var next = Object.assign({}, query);
			if (key === 'channels') {
				next.channels = ids.filter(function(id) { return id !== value; }).join(',');
				delete next.chid;
			} else if (key === 'cat') {
				next.cat = categoryValues(query.cat).filter(function(category) { return category !== value; }).join(',');
			} else next[key] = key === 'searchTarget' ? 'all' : '';
			navigate(page, recorded, next);
		}
		function add(key, label, value, raw) {
			if (value === undefined || value === null || value === '') return;
			var item = document.createElement('button');
			item.type = 'button';
			item.className = 'chinachu-search-chip';
			var text = (label ? label + '：' : '') + value;
			item.textContent = text;
			item.setAttribute('aria-label', text + 'を解除');
			item.addEventListener('click', function() { clear(key, raw); });
			summary.appendChild(item);
		}
		add('keyword', 'キーワード', query.keyword);
		if (query.keyword && (query.searchTarget === 'title' || query.searchTarget === 'desc')) add('searchTarget', '検索対象', searchTargets[query.searchTarget]);
		add('title', 'タイトル', query.title);
		var data = global.chinachu;
		var channels = (data.schedule || []).concat(recorded ? (data.recorded || []).map(function(program) { return program.channel; }) : []);
		var ids = typeof query.channels === 'string' ? query.channels.split(',').filter(Boolean) : (query.chid ? [query.chid] : []);
		ids.forEach(function(id) {
			var channel = channels.find(function(channel) {
				return matchesChannel(typeof query.channels === 'string' ? { channels: id } : { chid: id }, channel);
			});
			add('channels', '', channel && channel.name || id, id);
		});
		categoryValues(query.cat).forEach(function(category) { add('cat', '', categories[category] || category, category); });
		add('desc', '説明', query.desc);
		add('type', '放送種別', query.type);
		if (query.start !== undefined && query.start !== '') add('start', '開始時刻', query.start + '時');
		if (query.end !== undefined && query.end !== '') add('end', '終了時刻', query.end + '時');
		add('pgid', 'プログラムID', query.pgid);
		var hasFilters = !!summary.children.length;
		if (hasFilters) {
			var reset = document.createElement('button');
			reset.type = 'button';
			reset.className = 'chinachu-search-clear';
			reset.textContent = 'すべて解除';
			reset.addEventListener('click', function() {
				var next = Object.assign({}, query);
				filterKeys.forEach(function(key) { next[key] = ''; });
				next.searchTarget = 'all';
				delete next.chid;
				navigate(page, recorded, next);
			});
			summary.appendChild(reset);
		}
		if (typeof count === 'number') page.searchResultCount = count;
		if (typeof page.searchResultCount === 'number') {
			var counter = document.createElement('span');
			counter.className = 'chinachu-search-count';
			counter.setAttribute('role', 'status');
			counter.textContent = page.searchResultCount + '件';
			summary.appendChild(counter);
		}
		summary.hidden = !summary.children.length;
	}
	function matchesChannel(query, channel) {
		if (typeof query.channels === 'string') {
			var values = query.channels.split(',').filter(Boolean);
			return !values.length || values.some(function(value) {
				return value === channel.id || value === channel.channel || value === channel.type + '_' + channel.sid;
			});
		}
		return !query.chid || query.chid === channel.id;
	}
	root.ChinachuSearchForm = { show: show, mount: mount, isMobile: isMobile, hasSearch: hasSearch, textMatcher: textMatcher, categoryMatcher: categoryMatcher, matchesChannel: matchesChannel, updateSummary: updateSummary };
}(window));
