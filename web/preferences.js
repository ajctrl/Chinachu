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
	window.addEventListener('storage', function(event) { if (event.key === key || event.key === null) notify(); });
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
	window.ChinachuPreferences = { get: get, set: set, subscribe: subscribe, createSwitch: createSwitch };
})();
