(function() {
	'use strict';
	// Preserve the existing reservation preference; other lists default to hidden.
	function descriptionKey(scope) { return 'chinachu.' + (scope || 'reserves') + '.showDescription'; }
	var listeners = [];
	function get(scope) {
		try { return window.localStorage.getItem(descriptionKey(scope)) === 'true'; } catch (error) { return false; }
	}
	function notify(key) {
		listeners.slice().forEach(function(entry) {
			if (key === null || descriptionKey(entry.scope) === key) entry.listener(get(entry.scope));
		});
	}
	function set(value, scope) {
		var key = descriptionKey(scope);
		window.localStorage.setItem(key, value ? 'true' : 'false');
		notify(key);
	}
	function subscribe(listener, scope) {
		var entry = { listener: listener, scope: scope };
		listeners.push(entry);
		return function() { listeners = listeners.filter(function(item) { return item !== entry; }); };
	}
	window.addEventListener('storage', function(event) {
		notify(event.key);
		if (event.key === clickKey || event.key === null) notifyClickAction();
		if (event.key === descriptionFontSizeKey || event.key === null) notifyDescriptionFontSize();
	});
	function createSwitch(onChange, scope, labelText) {
		var label = document.createElement('label');
		label.className = 'description-switch';
		var input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('role', 'switch');
		input.checked = get(scope);
		label.appendChild(input);
		label.appendChild(document.createTextNode(' ' + (labelText || '番組説明を表示')));
		label.title = 'このブラウザにのみ適用・即時保存';
		var error = document.createElement('span');
		error.className = 'preference-error';
		error.setAttribute('role', 'alert');
		label.appendChild(error);
		input.addEventListener('change', function() {
			try { set(input.checked, scope); error.textContent = ''; }
			catch (e) { input.checked = get(scope); error.textContent = ' ブラウザに保存できませんでした。保存の許可設定を確認してください。'; }
		});
		var unsubscribe = subscribe(function(value) { input.checked = value; if (onChange) onChange(value); }, scope);
		return { element: label, destroy: unsubscribe };
	}
	var clickKey = 'chinachu.reserves.clickAction';
	var clickListeners = [];
	function getClickAction() {
		try { return window.localStorage.getItem(clickKey) === 'skip' ? 'skip' : 'details'; } catch (error) { return 'details'; }
	}
	function notifyClickAction() { clickListeners.slice().forEach(function(listener) { listener(getClickAction()); }); }
	function setClickAction(value) {
		window.localStorage.setItem(clickKey, value === 'skip' ? 'skip' : 'details');
		notifyClickAction();
	}
	function createClickActionSelect() {
		var label = document.createElement('label');
		label.className = 'reservation-click-setting';
		label.appendChild(document.createTextNode('予約一覧のクリック動作 '));
		var select = document.createElement('select');
		[['details', '詳細を開く（初期値）'], ['skip', 'スキップを切り替える（手動予約はスキップ時のみダブルクリック）']].forEach(function(choice) {
			var option = document.createElement('option');
			option.value = choice[0];
			option.textContent = choice[1];
			select.appendChild(option);
		});
		select.value = getClickAction();
		label.appendChild(select);
		var error = document.createElement('span');
		error.className = 'preference-error';
		error.setAttribute('role', 'alert');
		label.appendChild(error);
		select.addEventListener('change', function() {
			try { setClickAction(select.value); error.textContent = ''; }
			catch (e) { select.value = getClickAction(); error.textContent = ' ブラウザに保存できませんでした。保存の許可設定を確認してください。'; }
		});
		var listener = function(value) { select.value = value; };
		clickListeners.push(listener);
		return { element: label, destroy: function() { clickListeners = clickListeners.filter(function(item) { return item !== listener; }); } };
	}
	var descriptionFontSizeKey = 'chinachu.reserves.descriptionFontSize';
	var descriptionFontSizeChoices = [['10px', '10px'], ['11px', '11px'], ['12px', '標準（12px）'], ['13px', '13px'], ['14px', '14px'], ['16px', '16px']];
	// Approximate previous rem choices using a 16px root font size.
	var legacyDescriptionFontSizes = { '0.7rem': '11px', '0.8rem': '13px', '0.9rem': '14px', '1rem': '16px' };
	var descriptionFontSizeListeners = [];
	function normalizeDescriptionFontSize(value) {
		value = legacyDescriptionFontSizes[value] || value;
		return descriptionFontSizeChoices.some(function(choice) { return choice[0] === value; }) ? value : '12px';
	}
	function getDescriptionFontSize() {
		try { return normalizeDescriptionFontSize(window.localStorage.getItem(descriptionFontSizeKey)); } catch (error) { return '12px'; }
	}
	function notifyDescriptionFontSize() { descriptionFontSizeListeners.slice().forEach(function(listener) { listener(getDescriptionFontSize()); }); }
	function setDescriptionFontSize(value) {
		window.localStorage.setItem(descriptionFontSizeKey, normalizeDescriptionFontSize(value));
		notifyDescriptionFontSize();
	}
	function subscribeDescriptionFontSize(listener) {
		descriptionFontSizeListeners.push(listener);
		return function() { descriptionFontSizeListeners = descriptionFontSizeListeners.filter(function(item) { return item !== listener; }); };
	}
	function createDescriptionFontSizeSelect() {
		var label = document.createElement('label');
		label.className = 'reservation-description-font-setting';
		label.appendChild(document.createTextNode('番組一覧の番組説明の文字サイズ '));
		var select = document.createElement('select');
		descriptionFontSizeChoices.forEach(function(choice) {
			var option = document.createElement('option');
			option.value = choice[0];
			option.textContent = choice[1];
			select.appendChild(option);
		});
		select.value = getDescriptionFontSize();
		label.appendChild(select);
		var error = document.createElement('span');
		error.className = 'preference-error';
		error.setAttribute('role', 'alert');
		label.appendChild(error);
		select.addEventListener('change', function() {
			try { setDescriptionFontSize(select.value); error.textContent = ''; }
			catch (e) { select.value = getDescriptionFontSize(); error.textContent = ' ブラウザに保存できませんでした。保存の許可設定を確認してください。'; }
		});
		return { element: label, destroy: subscribeDescriptionFontSize(function(value) { select.value = value; }) };
	}
	window.ChinachuPreferences = { get: get, set: set, subscribe: subscribe, createSwitch: createSwitch, getClickAction: getClickAction, setClickAction: setClickAction, createClickActionSelect: createClickActionSelect, getDescriptionFontSize: getDescriptionFontSize, setDescriptionFontSize: setDescriptionFontSize, subscribeDescriptionFontSize: subscribeDescriptionFontSize, createDescriptionFontSizeSelect: createDescriptionFontSizeSelect };
})();
