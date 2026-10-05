/* Browser services owned by Chinachu. No native prototypes are modified. */
(function (root) {
	'use strict';
	const C = root.Chinachu = {};
	const listeners = new WeakMap();
	C.noop = function () {};
	C.pad = (value, length = 2) => String(value).padStart(length, '0');
	C.clone = value => JSON.parse(JSON.stringify(value));
	C.escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
	C.query = function (value) {
		const result = Object.create(null);
		new URLSearchParams(String(value || '').replace(/^\?/, '')).forEach((value, key) => {
			if (Object.hasOwn(result, key)) result[key] = [].concat(result[key], value);
			else result[key] = value;
		});
		return result;
	};
	C.serializeQuery = function (value) {
		const params = new URLSearchParams();
		Object.entries(value || {}).forEach(([key, item]) => {
			if (item === undefined) return;
			(Array.isArray(item) ? item : [item]).forEach(v => params.append(key, v == null ? '' : String(v)));
		});
		return params.toString();
	};
	C.translations = {};
	C.t = function (text, values) {
		text = String(text == null ? '' : text);
		const substitutions = Array.isArray(values) ? values : values === undefined ? [] : [values];
		return String(C.translations[text.toUpperCase()] || text).replace(/\{(\d+)\}/g, (all, i) => substitutions[i] !== undefined ? String(substitutions[i]) : all);
	};
	C.formatDate = function (value, mask) {
		const date = value instanceof Date ? value : new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		const time = C.pad(date.getHours()) + ':' + C.pad(date.getMinutes());
		return mask === 'HH:MM' ? time : C.pad(date.getMonth() + 1) + '/' + C.pad(date.getDate()) + ' ' + time;
	};
	C.stopEvent = event => { event.preventDefault(); event.stopPropagation(); };
	C.withScope = function (scope, fn) {
		const previous = C.scope;
		C.scope = scope;
		try { return fn(); } finally { C.scope = previous; }
	};
	C.on = function (target, type, handler, options) {
		target = typeof target === 'string' ? document.getElementById(target) : target;
		if (!target) return target;
		const scope = C.scope;
		const wrapped = scope ? function (event) { if (!scope._disposed) return C.withScope(scope, () => handler.call(this, event)); } : handler;
		const entries = listeners.get(target) || [];
		const entry = { type, handler, wrapped, options };
		entries.push(entry); listeners.set(target, entries);
		target.addEventListener(type, wrapped, options);
		// Page elements are collected with their listeners when removed. Only
		// persistent event targets need a cleanup owned by the page itself.
		if (scope && scope._cleanups && (target === document || target === root)) {
			entry.scope = scope;
			entry.cleanup = () => C.off(target, type, handler);
			scope._cleanups.push(entry.cleanup);
		}
		return target;
	};
	C.off = function (target, type, handler) {
		if (!target) return target;
		const entries = listeners.get(target) || [];
		listeners.set(target, entries.filter(entry => {
			if ((!type || entry.type === type) && (!handler || entry.handler === handler)) {
				target.removeEventListener(entry.type, entry.wrapped, entry.options);
				if (entry.cleanup) {
					const index = entry.scope._cleanups.indexOf(entry.cleanup);
					if (index !== -1) entry.scope._cleanups.splice(index, 1);
				}
				return false;
			}
			return true;
		}));
		return target;
	};
	C.emit = function (target, type, detail) {
		const event = new CustomEvent(type, { detail, bubbles: true, cancelable: true });
		event.memo = detail;
		target.dispatchEvent(event);
		return target;
	};
	C.request = function (url, options = {}) {
		const controller = new AbortController();
		const scope = C.scope;
		if (scope && scope._requests) scope._requests.add(controller);
		let aborted = false;
		const response = { status: 0, statusText: '', responseText: '', responseJSON: null, getHeader: () => null };
		const request = { transport: { abort() { aborted = true; controller.abort(); } }, response };
		response.transport = request.transport;
		const call = (name, ...args) => {
			if (aborted || (scope && scope._disposed) || !options[name]) return;
			try { return C.withScope(scope, () => options[name](...args)); }
			catch (error) { console.error(error); }
		};
		let method = String(options.method || 'post').toUpperCase();
		const headers = new Headers();
		if (Array.isArray(options.requestHeaders)) {
			for (let i = 0; i < options.requestHeaders.length; i += 2) headers.set(options.requestHeaders[i], options.requestHeaders[i + 1]);
		} else Object.entries(options.requestHeaders || {}).forEach(([name, value]) => headers.set(name, value));
		headers.set('X-Requested-With', 'XMLHttpRequest');
		let body = options.postBody;
		const parameters = typeof options.parameters === 'string' ? options.parameters : C.serializeQuery(options.parameters);
		if (method === 'GET' || method === 'HEAD') {
			if (parameters) url += (url.includes('?') ? '&' : '?') + parameters;
		} else if (body === undefined) {
			body = parameters;
			headers.set('Content-Type', options.contentType || 'application/x-www-form-urlencoded; charset=UTF-8');
		}
		request.promise = (async function () {
			try {
				call('onCreate', response);
				const result = await fetch(url, { method, headers, body, credentials: 'same-origin', signal: controller.signal });
				response.status = result.status; response.statusText = result.statusText;
				response.getHeader = name => result.headers.get(name);
				if (options.onInteractive && result.body) {
					const reader = result.body.getReader(); const decoder = new TextDecoder();
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) break;
						response.responseText += decoder.decode(chunk.value, { stream: true });
						call('onInteractive', response);
					}
					response.responseText += decoder.decode();
				} else response.responseText = await result.text();
				try { response.responseJSON = JSON.parse(response.responseText); } catch (_) { /* text response */ }
				call(result.ok ? 'onSuccess' : 'onFailure', response);
			} catch (error) {
				if (error.name !== 'AbortError') {
					response.error = error;
					call('onFailure', response);
				}
			} finally {
				if (scope && scope._requests) scope._requests.delete(controller);
				call('onComplete', response);
			}
			return response;
		}());
		return request;
	};
	// Constructor composition for Chinachu's action objects; no Object/String patches.
	C.createClass = function (parent, methods) {
		if (!methods) { methods = parent; parent = null; }
		function Action(...args) { if (this.initialize) this.initialize(...args); }
		if (parent) Action.prototype = Object.create(parent.prototype);
		Object.assign(Action.prototype, methods, { constructor: Action });
		return Action;
	};
	const shortcuts = new Map();
	function shortcutKey(key) {
		const aliases = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', ' ': 'space', spacebar: 'space', esc: 'escape', return: 'enter', control: 'ctrl', command: 'meta', cmd: 'meta', option: 'alt' };
		const parts = String(key).toLowerCase().split('+').map(part => aliases[part] || part);
		const modifiers = ['ctrl', 'alt', 'shift', 'meta'];
		return modifiers.filter(part => parts.includes(part)).concat(parts.filter(part => !modifiers.includes(part))).join('+');
	}
	C.shortcuts = {
		add(key, fn, options = {}) {
			key = shortcutKey(key);
			const scope = C.scope, shortcut = { fn, options, scope };
			shortcuts.set(key, shortcut);
			if (scope && scope._cleanups) scope._cleanups.push(() => { if (shortcuts.get(key) === shortcut) shortcuts.delete(key); });
		},
		remove(key) { shortcuts.delete(shortcutKey(key)); }
	};
	if (root.document) document.addEventListener('keydown', event => {
		const path = event.composedPath();
		const editing = path.some(el => el.tagName && (/^(INPUT|TEXTAREA|SELECT|WA-INPUT|WA-TEXTAREA|WA-SELECT|WA-SLIDER|WA-CHECKBOX|WA-RADIO|WA-RADIO-GROUP)$/.test(el.tagName) || el.isContentEditable));
		const key = shortcutKey([event.ctrlKey ? 'ctrl' : '', event.altKey ? 'alt' : '', event.shiftKey ? 'shift' : '', event.metaKey ? 'meta' : '', event.key].filter(Boolean).join('+'));
		const shortcut = shortcuts.get(key);
		if (shortcut && !(shortcut.scope && shortcut.scope._disposed) && !(editing && shortcut.options.protectInput !== false)) {
			event.preventDefault(); C.withScope(shortcut.scope, () => shortcut.fn(event));
		}
	});
	const D = root.ChinachuDOM = {};
	D.get = value => D.decorate(typeof value === 'string' ? document.getElementById(value) : value && (value.entity || value));
	D.all = (...selectors) => Array.from(document.querySelectorAll(selectors.join(',')), D.decorate);
	D.create = function (tag, attributes) {
		const element = document.createElement(tag);
		Object.entries(attributes || {}).forEach(([key, value]) => { if (value != null) element.setAttribute(key === 'className' ? 'class' : key, value); });
		return D.decorate(element);
	};
	function insert(element, value, position = 'beforeend') {
		if (value == null) return;
		if (value.entity) value = value.entity;
		if (value.nodeType) {
			if (position === 'afterbegin') element.prepend(value);
			else if (position === 'beforebegin') element.before(value);
			else if (position === 'afterend') element.after(value);
			else element.append(value);
		} else if (typeof value === 'object') {
			Object.entries(value).forEach(([key, child]) => insert(element, child, { top: 'afterbegin', bottom: 'beforeend', before: 'beforebegin', after: 'afterend' }[key] || position));
		} else element.insertAdjacentHTML(position, String(value));
	}
	const methods = {
		update(value) { this.replaceChildren(); insert(this, value); return this; },
		updateText(value) { this.textContent = value == null ? '' : String(value); return this; },
		insert(value) { insert(this, value); return this; },
		insertText(value) { this.append(document.createTextNode(String(value))); return this; },
		insertTo(target) { D.get(target).append(this); return this; },
		setStyle(styles) { Object.entries(styles || {}).forEach(([key, value]) => { if (key.includes('-')) this.style.setProperty(key, value); else this.style[key] = value; }); return this; },
		getStyle(key) { return getComputedStyle(this).getPropertyValue(key) || this.style[key]; },
		addClassName(name) { String(name || '').split(/\s+/).filter(Boolean).forEach(s => this.classList.add(s)); return this; },
		removeClassName(name) { String(name || '').split(/\s+/).filter(Boolean).forEach(s => this.classList.remove(s)); return this; },
		hasClassName(name) { return this.classList.contains(name); },
		toggleClassName(name) { this.classList.toggle(name); return this; },
		show() { this.hidden = false; this.style.display = ''; return this; },
		hide() { this.hidden = true; this.style.display = 'none'; return this; },
		visible() { return !this.hidden && this.style.display !== 'none'; },
		observe(type, fn, options) { C.on(this, type, fn, options); return this; },
		stopObserving(type, fn) { C.off(this, type, fn); return this; },
		on(type, fn, options) { return this.observe(type, fn, options); },
		off(type, fn) { return this.stopObserving(type, fn); },
		fire(type, detail) { C.emit(this, type, detail); return this; },
		writeAttribute(name, value) { if (typeof name === 'object') Object.entries(name).forEach(([key, v]) => this.writeAttribute(key, v)); else if (value === false || value == null) this.removeAttribute(name); else this.setAttribute(name, value === true ? name : value); return this; },
		readAttribute(name) { return this.getAttribute(name); },
		getWidth() { return this.getBoundingClientRect().width; },
		getHeight() { return this.getBoundingClientRect().height; },
		getDimensions() { const r = this.getBoundingClientRect(); return { width: r.width, height: r.height }; },
		cumulativeOffset() { const r = this.getBoundingClientRect(); return { left: r.left + root.scrollX, top: r.top + root.scrollY }; },
		up(selector) { return D.decorate(selector ? this.parentElement?.closest(selector) : this.parentElement); },
		down(selector) { return D.decorate(this.querySelector(selector || '*')); },
		selectAll(selector) { return Array.from(this.querySelectorAll(selector), D.decorate); },
		setOpacity(value) { this.style.opacity = value; return this; }
	};
	D.decorate = function (element) {
		if (!element || !element.nodeType) return element;
		Object.entries(methods).forEach(([name, fn]) => { if (!(name in element) && !(element.localName?.startsWith('wa-') && ['update', 'show', 'hide'].includes(name))) Object.defineProperty(element, name, { value: fn, configurable: true }); });
		return element;
	};
}(window));
