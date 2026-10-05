(function (root) {
	'use strict';
	const C = root.Chinachu;
	const definitions = new Map();
	const scripts = new Map();
	C.definePage = function (definition) {
		const key = document.currentScript && document.currentScript.dataset.pageKey;
		if (!key) throw new Error('Page registration requires a route');
		definitions.set(key, definition);
	};
	C.loadScript = function (url, key) {
		if (scripts.has(url)) return scripts.get(url);
		const promise = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = url; script.async = true;
			if (key) script.dataset.pageKey = key;
			script.onload = resolve;
			script.onerror = () => { scripts.delete(url); script.remove(); reject(new Error('読み込みに失敗しました: ' + url)); };
			document.head.append(script);
		});
		scripts.set(url, promise); return promise;
	};
	C.PageManager = class PageManager {
		constructor(app, index) {
			this.app = app; this.index = index; this.indexPath = './page/';
			this.title = ChinachuDOM.create('h1');
			this.toolbar = new ChinachuUI.Navbar();
			this.content = ChinachuDOM.create('div', { class: 'page-content' });
			this._generation = 0;
			this._onHash = () => this.realizeHash();
			root.addEventListener('hashchange', this._onHash);
		}
		enableHashControl(initial) { if (initial) this.realizeHash(true); return this; }
		disableHashControl() { return this; }
		realizeHash(force) {
			const hash = root.location.hash.replace(/^#/, '');
			if (!force && hash === this.url) return;
			const parts = hash.split('/');
			const category = parts[1] || this.index.defaultCategory;
			const group = this.index.category[category];
			const page = parts[2] || (group && group.defaultPage);
			if (!group || !group.page[page]) {
				this.url = hash;
				this._generation++; this.unload(); this.content.updateText('ページが見つかりません。'); return;
			}
			if (!parts[1] || !parts[2]) { root.location.replace('#!/' + category + '/' + page + '/'); return; }
			this.url = hash;
			this.load(category, page, C.query(parts.slice(3).join('/').replace(/\/$/, '')));
		}
		async load(category, page, query = {}) {
			const generation = ++this._generation;
			C.emit(document, 'chinachu:page:reload'); this.unload();
			this.category = category; this.page = page; this.query = query;
			this.pageData = this.index.category[category].page[page];
			this.content.className = 'page-content loading';
			const key = category + '/' + page;
			try {
				await C.loadScript(this.indexPath + key + '.js', key);
				if (generation !== this._generation) return;
				const definition = definitions.get(key);
				if (!definition) throw new Error('ページを初期化できません: ' + key);
				this.content.className = 'page-content'; this.title.updateText(C.t(this.pageData.title));
				const instance = {
					app: this.app, view: { title: this.title, toolbar: this.toolbar, content: this.content },
					self: { category, page, pageData: this.pageData, url: this.url, query },
					data: {}, timer: {}, id: Date.now(), _requests: new Set(), _cleanups: [], _disposed: false
				};
				Object.entries(definition).forEach(([name, value]) => {
					instance[name] = typeof value === 'function' ? function (...args) {
						if (instance._disposed && name !== 'deinit') return;
						return C.withScope(instance, () => value.apply(instance, args));
					} : value;
				});
				this.p = instance; instance.init();
				C.emit(document, 'chinachu:page:load'); C.emit(document, 'chinachu:page:complete');
			} catch (error) {
				if (generation !== this._generation) return;
				this.unload(); this.title.updateText('読み込みエラー'); this.content.className = 'page-content failure';
				this.content.updateText(error.message); console.error(error); C.emit(document, 'chinachu:page:failure', error);
			}
		}
		unload() {
			if (this.p) {
				const page = this.p; this.p = null;
				try { if (page.deinit) page.deinit(); } catch (error) { console.error(error); }
				page._disposed = true; page.closed = true;
				page._requests.forEach(controller => controller.abort());
				page._cleanups.splice(0).forEach(cleanup => {
					try { cleanup(); } catch (error) { console.error(error); }
				});
				Object.values(page.timer).forEach(timer => { clearTimeout(timer); clearInterval(timer); });
			}
			this.title.updateText(''); this.toolbar.removeAll(); this.content.replaceChildren();
			C.emit(document, 'chinachu:page:unload');
		}
		destroy() { this._generation++; this.unload(); root.removeEventListener('hashchange', this._onHash); }
	};
}(window));
