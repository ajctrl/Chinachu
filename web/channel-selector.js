/* Channel names are presentation only; rule values retain their original meaning. */
(function(root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.ChinachuChannelSelector = factory();
})(typeof window === 'undefined' ? this : window, function() {
	'use strict';
	var types = { GR: '地デジ', BS: 'BS', CS: 'CS', SKY: 'SKY' };
	function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase(); }
	function channelLabel(channel, channels) {
		var label = '[' + channel.type + '] ' + channel.name;
		if (channels.some(function(other) {
			return other.id !== channel.id && other.type === channel.type && other.name === channel.name;
		})) label += ' (SID ' + channel.sid + ' / ' + channel.id + ')';
		return label;
	}
	function format(value, channels) {
		channels = channels || [];
		var exact = channels.find(function(channel) { return channel.id === value; });
		if (exact) return channelLabel(exact, channels);
		var matches = channels.filter(function(channel) {
			return channel.channel === value || channel.type + '_' + channel.sid === value;
		});
		return matches.length ? value + '（' + matches.map(function(channel) {
			return channelLabel(channel, channels);
		}).join(' / ') + '）' : value;
	}
	function create(options) {
		var element = options.element;
		var doc = element.ownerDocument;
		var values = [], disabled = false, checks = [];
		var emptyText = options.emptyText || 'CH指定なし';
		element.classList.add('channel-selector');
		element.setAttribute('role', 'group');
		element.setAttribute('aria-label', options.label || 'チャンネル');
		function node(tag, className, text, parent) {
			var child = doc.createElement(tag);
			if (className) child.className = className;
			if (typeof text !== 'undefined') child.textContent = text;
			(parent || element).appendChild(child);
			return child;
		}
		function channels() { return options.getChannels() || []; }
		var selected = node('div', 'channel-selector-selected');
		var picker = node('details', 'channel-selector-picker');
		var summary = node('summary', '', 'チャンネルを選択', picker);
		var filters = node('div', 'channel-selector-filters', undefined, picker);
		var wave = node('select', '', undefined, filters);
		wave.setAttribute('aria-label', '放送波で絞り込み');
		node('option', '', 'すべての放送波', wave).value = '';
		Object.keys(types).forEach(function(type) { node('option', '', types[type], wave).value = type; });
		var search = node('input', '', undefined, filters);
		search.type = 'search';
		search.placeholder = '局名・IDで検索';
		search.setAttribute('aria-label', '局名・IDで検索');
		var list = node('div', 'channel-selector-list', undefined, picker);
		var manual = node('details', 'channel-selector-manual');
		node('summary', '', 'ID・物理CHを手入力', manual);
		var manualRow = node('div', 'channel-selector-filters', undefined, manual);
		var raw = node('input', '', undefined, manualRow);
		raw.type = 'text';
		raw.placeholder = '例: BS_101';
		raw.setAttribute('aria-label', 'ID・物理CH');
		var add = node('button', '', '追加', manualRow);
		add.type = 'button';
		var error = node('p', 'channel-selector-error', '', manual);
		error.setAttribute('role', 'alert');
		function changed() {
			renderSelected();
			checks.forEach(function(item) { item.input.checked = values.indexOf(item.value) !== -1; });
			element.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
		}
		function renderSelected() {
			selected.textContent = '';
			if (!values.length) node('span', 'channel-selector-empty', emptyText, selected);
			values.forEach(function(value) {
				var token = node('span', 'channel-selector-token', undefined, selected);
				var label = format(value, channels());
				token.title = value;
				node('span', '', label, token);
				var remove = node('button', '', '×', token);
				remove.type = 'button';
				remove.disabled = disabled;
				remove.setAttribute('aria-label', label + 'を解除');
				remove.addEventListener('click', function() {
					if (disabled) return;
					values = values.filter(function(item) { return item !== value; });
					changed();
					summary.focus();
				});
			});
		}
		function renderList() {
			list.textContent = '';
			checks = [];
			var all = channels(), seen = new Set();
			var query = normalize(search.value).trim();
			var visible = all.filter(function(channel) {
				if (seen.has(channel.id)) return false;
				seen.add(channel.id);
				return (!wave.value || channel.type === wave.value) && normalize([
					channel.name, channel.id, channel.channel, channel.type + '_' + channel.sid
				].join(' ')).indexOf(query) !== -1;
			});
			var groups = Object.keys(types);
			visible.forEach(function(channel) { if (groups.indexOf(channel.type) === -1) groups.push(channel.type); });
			groups.forEach(function(type) {
				var groupChannels = visible.filter(function(channel) { return channel.type === type; });
				if (!groupChannels.length) return;
				var group = node('fieldset', '', undefined, list);
				node('legend', '', types[type] || type, group);
				groupChannels.forEach(function(channel) {
					var label = node('label', 'channel-selector-option', undefined, group);
					label.title = channel.id;
					var input = node('input', '', undefined, label);
					input.type = 'checkbox';
					input.checked = values.indexOf(channel.id) !== -1;
					input.disabled = disabled;
					node('span', '', channelLabel(channel, all), label);
					checks.push({ input: input, value: channel.id });
					input.addEventListener('change', function(event) {
						event.stopPropagation();
						if (disabled) return;
						if (input.checked && values.indexOf(channel.id) === -1) values.push(channel.id);
						else if (!input.checked) values = values.filter(function(value) { return value !== channel.id; });
						changed();
					});
				});
			});
			if (!visible.length) node('p', 'channel-selector-empty', all.length ? '該当するチャンネルはありません' : 'チャンネル一覧がありません。番組表を取得すると選択できます。', list);
		}
		function addRaw() {
			if (disabled) return;
			var value = raw.value.trim();
			if (!/^[a-z0-9_]+$/i.test(value)) {
				error.textContent = 'ID・物理CHを半角英数字とアンダースコアで入力してください';
				return;
			}
			error.textContent = '';
			if (values.indexOf(value) === -1) values.push(value);
			raw.value = '';
			changed();
			raw.focus();
		}
		search.addEventListener('input', renderList);
		wave.addEventListener('change', function(event) { event.stopPropagation(); renderList(); });
		picker.addEventListener('toggle', function() {
			if (picker.open) { renderList(); renderSelected(); }
		});
		add.addEventListener('click', addRaw);
		// Enter in either text field must not submit the surrounding rule form.
		[raw, search].forEach(function(input) {
			input.addEventListener('keydown', function(event) {
				if (event.key !== 'Enter' || event.isComposing) return;
				event.preventDefault();
				event.stopPropagation();
				if (input === raw) addRaw();
			});
		});
		element.getValues = function() { return values.slice(); };
		element.setValues = function(next) {
			values = (next || []).filter(function(value, index, array) { return array.indexOf(value) === index; });
			renderSelected();
			checks.forEach(function(item) { item.input.checked = values.indexOf(item.value) !== -1; });
			return element;
		};
		function setDisabled(value) {
			disabled = value;
			element.setAttribute('aria-disabled', String(value));
			[wave, search, raw, add].forEach(function(input) { input.disabled = value; });
			checks.forEach(function(item) { item.input.disabled = value; });
			renderSelected();
			return element;
		}
		element.enable = function() { return setDisabled(false); };
		element.disable = function() { return setDisabled(true); };
		renderSelected();
		return element;
	}
	return { create: create, format: format };
});
