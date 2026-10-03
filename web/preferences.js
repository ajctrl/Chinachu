(function() {
	'use strict';
	var key = 'chinachu.reserves.showDescription';
	var listeners = [];
	function get() {
		try { return window.localStorage.getItem(key) === 'true'; } catch (error) { return false; }
	}
	function notify() { listeners.slice().forEach(function(listener) { listener(get()); }); }
	function set(value) {
		window.localStorage.setItem(key, value ? 'true' : 'false');
		notify();
	}
	function subscribe(listener) {
		listeners.push(listener);
		return function() { listeners = listeners.filter(function(item) { return item !== listener; }); };
	}
	window.addEventListener('storage', function(event) {
		if (event.key === key || event.key === null) notify();
		if (event.key === clickKey || event.key === null) notifyClickAction();
	});
	function createSwitch(onChange) {
		var label = document.createElement('label');
		label.className = 'description-switch';
		var input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('role', 'switch');
		input.checked = get();
		label.appendChild(input);
		label.appendChild(document.createTextNode(' 番組説明を表示'));
		label.title = 'このブラウザにのみ適用・即時保存';
		var error = document.createElement('span');
		error.className = 'preference-error';
		error.setAttribute('role', 'alert');
		label.appendChild(error);
		input.addEventListener('change', function() {
			try { set(input.checked); error.textContent = ''; }
			catch (e) { input.checked = get(); error.textContent = ' ブラウザに保存できませんでした。保存の許可設定を確認してください。'; }
		});
		var unsubscribe = subscribe(function(value) { input.checked = value; if (onChange) onChange(value); });
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
	window.ChinachuPreferences = { get: get, set: set, subscribe: subscribe, createSwitch: createSwitch, getClickAction: getClickAction, setClickAction: setClickAction, createClickActionSelect: createClickActionSelect };
})();
