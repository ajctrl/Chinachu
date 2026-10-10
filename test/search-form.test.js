'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser(query, recorded, data = {}) {
	class Element {
		constructor(tag) {
			this.tagName = tag; this.children = []; this.handlers = {}; this.value = '';
			this.ownerDocument = document;
			this.classList = { add: name => { this.className = name; } };
		}
		set textContent(value) { this.text = value; this.children = []; }
		get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
		setAttribute(name, value) { this[name] = value; }
		replaceChildren() { this.children = []; this.text = ''; }
		dispatchEvent(event) { if (this.handlers[event.type]) this.handlers[event.type](event); }
		appendChild(child) {
			if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(el => el !== child);
			child.parentElement = this;
			this.children.push(child); return child;
		}
		insertBefore(child, before) {
			this.appendChild(child);
			this.children.pop();
			this.children.splice(this.children.indexOf(before), 0, child);
			return child;
		}
		querySelector(selector) { return descendants(this).slice(1).find(el => (el.className || '').split(' ').includes(selector.slice(1))); }
		matches() { return false; }
		addEventListener(name, handler) { this.handlers[name] = handler; }
		setCustomValidity(message) { this.validationMessage = message; }
		reportValidity() { return this.children.every(label => label.children.every(input => !input.validationMessage)); }
		focus() {}
	}
	const document = { createElement: tag => new Element(tag), defaultView: { Event: class { constructor(type) { this.type = type; } } } };
	let modal;
	const window = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} };
	const context = { window, document, global: { chinachu: data },
		ChinachuChannelSelector: require('../web/channel-selector'),
		Chinachu: { serializeQuery: object => new URLSearchParams(object).toString() },
		ChinachuUI: { Modal: function(options) {
			modal = this;
			Object.assign(this, options, { content: new Element('div'), show() { return this; }, close() { this.closed = true; options.onClose(); } });
		} }
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/search-form.js'), 'utf8'), context);
	const page = { self: { query }, drawMain() { this.redrawn = true; } };
	window.ChinachuSearchForm.show(page, { recorded });
	const form = modal.content.children[0];
	const inputs = Object.fromEntries(form.children.filter(el => el.tagName === 'label' || el.className === 'chinachu-search-field chinachu-search-category-field').map(label => [label.children[1].name, label.children[1]]));
	const channelSelector = descendants(form).find(el => el.className === 'channel-selector');
	return { window, modal, form, inputs, page, channelSelector };
}

function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

describe('native search forms', function() {
	function genreCheckboxes(ui) {
		const list = descendants(ui.form).find(el => el.className === 'chinachu-search-choices');
		return Object.fromEntries(list.children.map(row => [row.children[1].value, row.children[1]]));
	}
	function toggleGenre(ui, value, checked) {
		const checkbox = genreCheckboxes(ui)[value];
		checkbox.checked = checked;
		checkbox.handlers.change();
	}
	it('closes an open mobile dropdown on Escape while retaining the search modal and restoring focus', function() {
		for (const recorded of [false, true]) {
			const ui = browser({}, recorded);
			const trigger = descendants(ui.form).find(el => el.type === 'button' && el['aria-label'] === 'ジャンル');
			const panel = trigger.popoverTargetElement;
			let open = true, focused = false, prevented = false, stopped = false;
			panel.matches = () => open;
			panel.hidePopover = () => { open = false; };
			trigger.focus = () => { focused = true; };
			ui.form.handlers.keydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
			assert.equal(open, false);
			assert.equal(focused, true);
			assert.equal(prevented, true);
			assert.equal(stopped, true);
			assert.equal(ui.modal.closed, undefined);
			prevented = stopped = false;
			ui.form.handlers.keydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
			assert.equal(prevented, false, 'Escape can dismiss the modal once the dropdown is closed');
			assert.equal(stopped, false);
			open = true;
			ui.modal.close();
			assert.equal(open, false, 'closing the modal also closes its dropdown');
		}
	});
	it('matches any selected genre and preserves single-genre bookmarks', function() {
		const matcher = browser({}, false).window.ChinachuSearchForm.categoryMatcher;
		for (const cat of [undefined, '', ',,']) {
			assert.equal(matcher({ cat })('anime'), true);
			assert.equal(matcher({ cat })(undefined), true);
		}
		for (const cat of ['anime,news', 'anime,news,anime', ',anime,,news,']) {
			assert.equal(matcher({ cat })('anime'), true);
			assert.equal(matcher({ cat })('news'), true);
			assert.equal(matcher({ cat })('drama'), false);
			assert.equal(matcher({ cat })(undefined), false);
		}
		assert.equal(matcher({ cat: 'anime' })('anime'), true);
		assert.equal(matcher({ cat: 'anime' })('news'), false);
	});
	for (const recorded of [false, true]) {
		it('submits, restores and clears multiple genre checkboxes for ' + (recorded ? 'recorded' : 'schedule'), function() {
			const ui = browser({ cat: 'anime' }, recorded);
			assert.equal(genreCheckboxes(ui).anime.checked, true);
			assert.equal(genreCheckboxes(ui)[''].checked, false);
			toggleGenre(ui, 'news', true);
			assert.equal(genreCheckboxes(ui).anime.checked, true);
			assert.equal(genreCheckboxes(ui).news.checked, true);
			ui.modal.buttons[0].onSelect();
			const submitted = Object.fromEntries(new URLSearchParams(ui.window.location.hash.split('/')[3]));
			assert.equal(submitted.cat, 'anime,news');
			const reopened = browser(submitted, recorded);
			assert.equal(genreCheckboxes(reopened).anime.checked, true);
			assert.equal(genreCheckboxes(reopened).news.checked, true);
			toggleGenre(reopened, 'anime', false);
			assert.equal(reopened.inputs.cat.value, 'news');
			toggleGenre(reopened, 'news', false);
			assert.equal(reopened.inputs.cat.value, '');
			assert.equal(genreCheckboxes(reopened)[''].checked, true);
			toggleGenre(reopened, 'drama', true);
			toggleGenre(reopened, '', true);
			assert.equal(reopened.inputs.cat.value, '');
			assert.equal(genreCheckboxes(reopened).drama.checked, false);
			reopened.modal.buttons[0].onSelect();
			assert.equal(new URLSearchParams(reopened.window.location.hash.split('/')[3]).get('cat'), '');
		});
		it('removes one genre chip while retaining other genres and filters for ' + recorded, function() {
			const { window, page } = browser({ cat: 'anime,news,anime', channels: 'gr1', keyword: '旅' }, recorded);
			page.view = { content: { appendChild() {} } };
			window.ChinachuSearchForm.updateSummary(page, recorded);
			assert.equal(page.searchSummary.children.filter(el => el.textContent === 'アニメ').length, 1);
			page.searchSummary.children.find(el => el.textContent === 'アニメ').handlers.click();
			const query = Object.fromEntries(new URLSearchParams(window.location.hash.split('/')[3]));
			assert.equal(query.cat, 'news');
			assert.equal(query.channels, 'gr1');
			assert.equal(query.keyword, '旅');
			page.self.query = query;
			window.ChinachuSearchForm.updateSummary(page, recorded);
			page.searchSummary.children.find(el => el.textContent === 'すべて解除').handlers.click();
			assert.equal(new URLSearchParams(window.location.hash.split('/')[3]).get('cat'), '');
		});
	}
	it('matches every keyword literally across the selected fields, including full-width whitespace', function() {
		const { window } = browser({}, false);
		const matcher = window.ChinachuSearchForm.textMatcher;
		const program = { title: '京都の旅', fullTitle: '京都の旅 [再] C++', detail: '温泉とおいしい料理' };
		for (const keyword of ['京都 温泉', ' 温泉\t京都　料理 ', '[再] C++', 'c++ 温泉']) {
			assert.equal(matcher({ keyword })(program), true, keyword);
		}
		for (const keyword of ['京都 雪', '.*', '^京都', '++温泉']) assert.equal(matcher({ keyword })(program), false, keyword);
		assert.equal(matcher({ keyword: '京都 温泉', searchTarget: 'title' })(program), false);
		assert.equal(matcher({ keyword: '京都 温泉', searchTarget: 'desc' })(program), false);
		assert.equal(matcher({ keyword: '京都 旅', searchTarget: 'title' })(program), true);
		assert.equal(matcher({ keyword: '温泉 料理', searchTarget: 'desc' })(program), true);
		assert.equal(matcher({ keyword: '京都 温泉', searchTarget: 'invalid' })(program), true);
		assert.equal(matcher({ keyword: '京都' })({ title: '京都' }), true);
		assert.equal(matcher({ keyword: '京都', searchTarget: 'title' })({ title: '京都', fullTitle: '別の正式名称' }), true);
		assert.equal(matcher({ keyword: '京都', searchTarget: 'desc' })({ title: '京都' }), false);
		assert.equal(matcher({ keyword: ' 　' })({}), true);
		assert.equal(matcher({ keyword: '京 都' })({ title: '京都' }), true);
		assert.equal(matcher({ keyword: '京都' })({ title: '京', detail: '都' }), false, 'a term must not straddle field boundaries');
		assert.equal(matcher({ keyword: 'ＡＢＣ ｶﾀｶﾅ' }, 'NFKC')({ title: 'abc', detail: 'カタカナ' }), true);
	});
	it('retains legacy regex conditions alongside keywords and handles malformed bookmarks safely', function() {
		const { window } = browser({}, false);
		const matcher = window.ChinachuSearchForm.textMatcher;
		const program = { title: '京都', fullTitle: '京都 温泉', detail: '自然の旅館' };
		assert.equal(matcher({ title: '^京都', desc: '温泉|旅館', keyword: '自然' })(program), true);
		assert.equal(matcher({ title: '^東京', keyword: '自然' })(program), false);
		assert.equal(matcher({ title: '[' })(program), false);
		assert.equal(matcher({ desc: '^$' })({ title: '京都' }), false);
		assert.equal(matcher({ title: '温泉' }, undefined, true)(program), false, 'legacy recorded title scope is preserved');
		assert.equal(matcher({ keyword: '温泉', searchTarget: 'title' }, undefined, true)(program), true);
	});
	it('submits and restores one keyword field and its scope without introducing legacy conditions', function() {
		for (const recorded of [false, true]) {
			for (const term of ['京都　温泉', '%41 %2F', '[再] C++', '100% & /']) {
				const ui = browser({}, recorded);
				assert.equal(ui.inputs.title, undefined);
				assert.equal(ui.inputs.desc, undefined);
				assert.equal(ui.inputs.searchTarget.value, 'all');
				ui.inputs.keyword.value = term;
				ui.inputs.searchTarget.value = 'desc';
				ui.form.handlers.submit({ preventDefault() {} });
				const query = Object.fromEntries(new URLSearchParams(ui.window.location.hash.split('/')[3]));
				assert.equal(query.keyword, term);
				assert.equal(query.searchTarget, 'desc');
				assert.equal(query.title, undefined);
				assert.equal(query.desc, undefined);
				const reopened = browser(query, recorded);
				assert.equal(reopened.inputs.keyword.value, term);
				assert.equal(reopened.inputs.searchTarget.value, 'desc');
			}
		}
	});
	it('clears the keyword and scope separately and resets both on clear-all', function() {
		const { window, page } = browser({ keyword: '京都 温泉', searchTarget: 'title', cat: 'documentary' }, false);
		page.view = { content: { appendChild() {} } };
		const helper = window.ChinachuSearchForm;
		assert.equal(helper.hasSearch({ searchTarget: 'title' }), false);
		helper.updateSummary(page, false, 3);
		const submitted = () => Object.fromEntries(new URLSearchParams(window.location.hash.split('/')[3]));
		page.searchSummary.children.find(el => el.textContent === '検索対象：タイトルのみ').handlers.click();
		assert.equal(submitted().searchTarget, 'all');
		assert.equal(submitted().keyword, '京都 温泉');
		page.searchSummary.children.find(el => el.textContent === 'キーワード：京都 温泉').handlers.click();
		assert.equal(submitted().keyword, '');
		page.searchSummary.children.find(el => el.textContent === 'すべて解除').handlers.click();
		assert.equal(submitted().keyword, '');
		assert.equal(submitted().searchTarget, 'all');
		assert.equal(submitted().cat, '');
	});
	function initializeScheduleQuery(query) {
		let definition;
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/search/top.js'), 'utf8'), {
			Chinachu: { definePage(page) { definition = page; }, on() {} }, document: {}
		});
		definition.init.call({ self: { query }, view: { content: {} }, initToolbar() {}, draw() {}, refresh() {} });
		return query;
	}

	it('shows literal search terms, resolves channel aliases and clears removed conditions', function() {
		const { window, page } = browser({ title: '<img>%41', start: '0', channels: 'GR_101,unknown' }, false, { schedule: [{ id: 'gr1', type: 'GR', sid: 101, name: '総合' }] });
		let additions = 0;
		page.view = { content: { appendChild() { additions++; } } };
		window.ChinachuSearchForm.updateSummary(page, false);
		assert.equal(page.searchSummary.hidden, false);
		assert.match(page.searchSummary.textContent, /タイトル：<img>%41/);
		assert.equal(page.searchSummary.children[1].textContent, '総合');
		assert.equal(page.searchSummary.children[2].textContent, 'unknown');
		assert.match(page.searchSummary.textContent, /開始時刻：0時/);
		assert.equal(page.searchSummary.children[0].innerHTML, undefined);
		page.self.query = { skip: 1 };
		window.ChinachuSearchForm.updateSummary(page, false);
		assert.equal(page.searchSummary.hidden, true);
		assert.equal(page.searchSummary.textContent, '');
		assert.equal(additions, 1);
	});

	it('preserves percent escapes through form submission and schedule page initialization', function() {
		for (const term of ['%41', '%20', '%2F', '%E7%95%AA', '%', '日本語 & 100% / (字幕)']) {
			const { inputs, modal, window } = browser({ title: '以前', desc: '以前' }, false);
			inputs.title.value = inputs.desc.value = term;
			modal.buttons[0].onSelect({ preventDefault() {} });
			const query = initializeScheduleQuery(Object.fromEntries(new URLSearchParams(window.location.hash.slice('!/search/top/'.length, -1))));
			assert.equal(query.title, term);
			assert.equal(query.desc, term);
		}
	});

	it('still decodes titles and descriptions in legacy double-encoded schedule bookmarks', function() {
		const query = initializeScheduleQuery(Object.fromEntries(new URLSearchParams('skip=1&title=%25E7%2595%25AA%25E7%25B5%2584&desc=%252F')));
		assert.equal(query.title, '番組');
		assert.equal(query.desc, '/');
	});

	for (const recorded of [false, true]) {
		it('removes individual chips and clears every filter while preserving unrelated query state for ' + recorded, function() {
			const query = { title: '旅', cat: 'documentary', desc: '海', type: 'GR', start: '0', end: '24', pgid: 'p1', chid: 'legacy', channels: 'gr1,gr2', page: '5', custom: 'keep' };
			const { window, page } = browser(query, recorded);
			page.view = { content: { appendChild() {} } };
			const update = () => window.ChinachuSearchForm.updateSummary(page, recorded, 24);
			const submitted = () => Object.fromEntries(new URLSearchParams(window.location.hash.split('/')[3]));
			update();
			assert.equal(page.searchSummary.children.find(el => el.className === 'chinachu-search-count').textContent, '24件');
			page.searchSummary.children.find(el => el.textContent === 'gr1').handlers.click();
			assert.equal(submitted().channels, 'gr2');
			assert.equal(submitted().chid, undefined);
			assert.equal(submitted().title, '旅');
			page.searchSummary.children.find(el => el.textContent === 'ドキュメンタリー').handlers.click();
			assert.equal(submitted().cat, '');
			assert.equal(submitted().channels, 'gr1,gr2');
			page.searchSummary.children.find(el => el.textContent === 'すべて解除').handlers.click();
			const cleared = submitted();
			for (const key of ['title', 'desc', 'cat', 'type', 'start', 'end', 'pgid', 'channels']) assert.equal(cleared[key], '');
			assert.equal(cleared.page, undefined);
			assert.equal(cleared.chid, undefined);
			assert.equal(cleared.custom, 'keep');
			page.self.query = cleared;
			window.ChinachuSearchForm.updateSummary(page, recorded, 0);
			assert.equal(page.searchSummary.textContent, '0件');
			assert.equal(page.searchSummary.hidden, false);
		});
		it('removes a legacy single channel without reviving its alias for ' + recorded, function() {
			const { window, page } = browser({ chid: 'gr1', title: '旅' }, recorded);
			page.view = { content: { appendChild() {} } };
			window.ChinachuSearchForm.updateSummary(page, recorded);
			page.searchSummary.children.find(el => el.textContent === 'gr1').handlers.click();
			const query = Object.fromEntries(new URLSearchParams(window.location.hash.split('/')[3]));
			assert.equal(query.channels, '');
			assert.equal(query.chid, undefined);
			assert.equal(query.title, '旅');
		});

		it('filters rendered results by the selected channels for ' + (recorded ? 'recorded' : 'schedule'), function() {
			const { window } = browser({}, recorded);
			const programs = ['gr1', 'gr2', 'bs1'].map((id, index) => ({
				id, channel: { id, name: id, type: id.startsWith('gr') ? 'GR' : 'BS' },
				title: '番組', fullTitle: '番組', category: 'news',
				start: Date.now() + index * 60000, end: Date.now() + 3600000, seconds: 3600
			}));
			let definition, rows;
			vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/page/' + (recorded ? 'recorded/search' : 'search/top') + '.js'), 'utf8'), {
				Chinachu: { definePage(value) { definition = value; }, escapeHTML: String },
				ChinachuSearchForm: window.ChinachuSearchForm,
				ChinachuPreferences: { get: () => false, getDescriptionFontSize: () => '12px' },
				chinachu: { dateToString: String },
				global: { chinachu: { status: {}, recorded: programs, schedule: [{ programs }] } }
			});
			const page = { view: { content: { appendChild() {} } }, self: { query: { channels: 'gr1,bs1' } }, grid: { splice(start, count, result) { rows = result; } } };
			page.self.query = {};
			definition.drawMain.call(page);
			assert.equal(rows, undefined, 'initial page does not search before submission');
			assert.equal(page.searchSummary, undefined, 'initial page does not display a result count');
			page.self.query = { channels: 'gr1,bs1' };
			definition.drawMain.call(page);
			assert.deepEqual(Array.from(rows, row => row.data.id), ['gr1', 'bs1']);
			page.self.query.channels = '';
			page.self.query.skip = 1;
			definition.drawMain.call(page);
			assert.equal(rows.length, 3);
			programs[0].category = 'anime';
			programs[2].category = 'drama';
			page.self.query.cat = 'anime,news';
			definition.drawMain.call(page);
			assert.deepEqual(Array.from(rows, row => row.data.id), ['gr1', 'gr2'], 'multiple genres match with OR');
			page.self.query.channels = 'gr2,bs1';
			definition.drawMain.call(page);
			assert.deepEqual(Array.from(rows, row => row.data.id), ['gr2'], 'genre and channel conditions combine with AND');
			page.self.query.cat = 'drama';
			definition.drawMain.call(page);
			assert.deepEqual(Array.from(rows, row => row.data.id), ['bs1'], 'single genre bookmarks retain their behavior');
		});

		it('selects multiple stations, restores legacy IDs and clears channel filters for ' + (recorded ? 'recorded' : 'schedule'), function() {
			const stations = [
				{ id: 'gr1', name: '総合', type: 'GR', channel: '27', sid: 101 },
				{ id: 'bs1', name: 'BS局', type: 'BS', channel: 'BS09_0', sid: 211 }
			];
			const ui = browser({ chid: 'gr1' }, recorded, {
				schedule: recorded ? [] : stations,
				recorded: stations.map(channel => ({ channel }))
			});
			assert.deepEqual(Array.from(ui.channelSelector.getValues()), ['gr1']);
			assert.match(ui.channelSelector.textContent, /総合/);
			const picker = ui.channelSelector.children.find(el => el.className === 'channel-selector-picker');
			picker.open = true;
			picker.handlers.toggle();
			function all(node) { return [node, ...node.children.flatMap(all)]; }
			const checkbox = all(picker).filter(el => el.type === 'checkbox')[1];
			checkbox.checked = true;
			checkbox.handlers.change({ stopPropagation() {} });
			ui.modal.buttons[0].onSelect();
			const query = Object.fromEntries(new URLSearchParams(ui.window.location.hash.split('/')[3]));
			assert.equal(query.channels, 'gr1,bs1');
			assert.equal(query.chid, undefined);
			const reopened = browser(query, recorded);
			assert.deepEqual(Array.from(reopened.channelSelector.getValues()), ['gr1', 'bs1']);
			reopened.channelSelector.setValues([]);
			reopened.modal.buttons[0].onSelect();
			assert.match(reopened.window.location.hash, /channels=&/);
		});
		it('preserves blank filters, literal query characters and resets old pages for ' + (recorded ? 'recorded' : 'schedule') + ' searches', function() {
			const { inputs, modal, window } = browser({ cat: 'anime', type: 'BS', title: '以前', desc: '以前', page: '9' }, recorded);
			assert.equal(inputs.cat.value, 'anime');
			assert.equal(inputs.type.children[0].value, '');
			inputs.cat.value = inputs.type.value = '';
			inputs.title.value = '日本語 & 100% / (字幕)';
			inputs.desc.value = '番組 + 説明';
			modal.buttons[0].onSelect({ preventDefault() {} });
			const route = recorded ? '!/recorded/search/' : '!/search/top/';
			assert.ok(window.location.hash.startsWith(route));
			const query = new URLSearchParams(window.location.hash.slice(route.length, -1));
			assert.equal(query.get('title'), inputs.title.value);
			assert.equal(query.get('desc'), inputs.desc.value);
			assert.equal(query.get('cat'), '');
			assert.equal(query.get('type'), '');
			assert.equal(query.get('skip'), '1');
			assert.equal(query.has('page'), false);
			assert.equal(modal.closed, true);
		});
	}

	it('shows each station once in recorded search alias labels despite repeated recordings', function() {
		const main = { id: 'gr1', name: '総合', type: 'GR', channel: '27', sid: 101 };
		const sub = { id: 'gr2', name: '総合サブ', type: 'GR', channel: '27', sid: 102 };
		const ui = browser({}, true, {
			schedule: [main],
			recorded: [main, main, main, sub, sub].map(channel => ({ channel: { ...channel } }))
		});
		for (const [value, label] of [
			['GR_101', 'GR_101（[GR] 総合）'],
			['27', '27（[GR] 総合 / [GR] 総合サブ）'],
			['GR_102', 'GR_102（[GR] 総合サブ）']
		]) {
			ui.channelSelector.setValues([value]);
			const selected = ui.channelSelector.children[0];
			assert.equal(selected.children[0].children[0].textContent, label);
			assert.deepEqual(Array.from(ui.channelSelector.getValues()), [value]);
		}
	});

	it('matches selected IDs, physical channels and service aliases while preserving old exact-ID URLs', function() {
		const { window } = browser({}, false);
		const matches = window.ChinachuSearchForm.matchesChannel;
		const channel = { id: 'gr1', type: 'GR', channel: '27', sid: 101 };
		for (const channels of ['', 'gr1,bs1', '27', 'GR_101']) assert.equal(matches({ channels }, channel), true);
		for (const channels of ['bs1,gr2', '28', 'GR_102']) assert.equal(matches({ channels }, channel), false);
		assert.equal(matches({ chid: 'gr1' }, channel), true);
		assert.equal(matches({ chid: '27' }, channel), false);
		assert.equal(matches({ channels: '', chid: 'old' }, channel), true);
	});

	it('validates expressions before navigation and submits through the native form', function() {
		const { inputs, form, modal, window } = browser({ title: '以前' }, false);
		inputs.title.value = '[';
		form.handlers.submit({ preventDefault() {} });
		assert.equal(window.location.hash, '');
		assert.ok(inputs.title.validationMessage);
		assert.equal(modal.closed, undefined);
		inputs.title.value = '正しい条件';
		form.handlers.submit({ preventDefault() {} });
		assert.equal(inputs.title.validationMessage, '');
		assert.ok(window.location.hash.includes('skip=1'));
		assert.ok(form.children.some(element => element.type === 'submit'));
	});
});
