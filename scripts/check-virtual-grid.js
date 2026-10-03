/* Optional browser regression check:
 * Install Playwright + Chromium separately, then run with NODE_PATH pointing to
 * that installation's node_modules: node scripts/check-virtual-grid.js
 * Pass screen names (e.g. search recorded.search) to check only those screens.
 * Uses synthetic data and intercepted URLs; no DVR server or recordings touched.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function run() {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		const errors = [];
		page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
		await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><body><div id="content" style="position:relative;width:1200px;height:700px"></div></body></html>' }));
		await page.goto('http://chinachu.test/');
		for (const file of ['web/lib/flagrate/flagrate.min.css', 'web/chinachu.css']) await page.addStyleTag({ content: read(file) });
		for (const file of ['web/lib/flagrate/flagrate.min.js', 'web/lib/prototype.js', 'web/lib/sakurapanel/sakurapanel.js', 'web/virtual-grid.js', 'web/preferences.js']) await page.addScriptTag({ content: read(file) });
		await page.evaluate(() => {
			window.liveTimes = 0;
			window.global = { chinachu: {} };
			window.chinachu = { ui: {}, dateToString: date => date.toISOString() };
			window.ChinachuReservationActions = { isPending: () => false };
			window.makePrograms = count => new Array(count).fill(null).map((_, i) => ({
				id: 'program-' + i, title: '番組 ' + i, fullTitle: '番組 ' + i,
				detail: i % 4 ? '説明文です。'.repeat(i % 20 + 1) : '',
				flags: [], category: 'anime', channel: { id: 'ch', name: 'チャンネル', type: 'GR' },
				start: Date.now() + i * 60000, end: Date.now() + (i + 30) * 60000, seconds: 1800
			}));
		});
		// Exercise the real timer lifecycle, without loading unrelated application UI.
		const classes = read('web/class.js');
		await page.addScriptTag({ content: classes.slice(classes.indexOf('ui.DynamicTime ='), classes.indexOf('ui.ExecuteScheduler =')).replace('ui.DynamicTime =', 'chinachu.ui.DynamicTime =') });
		await page.evaluate(() => {
			const Time = chinachu.ui.DynamicTime;
			chinachu.ui.DynamicTime = function(options) {
				const time = new Time(options);
				liveTimes++;
				const remove = time.remove;
				time.remove = function() {
					if (!this.testRemoved) { liveTimes--; this.testRemoved = true; }
					return remove.call(this);
				};
				return time;
			};
		});
		const settle = () => page.waitForTimeout(150);
		const snapshot = () => page.evaluate(() => {
			const grid = listPage.grid;
			const body = grid._body.getBoundingClientRect();
			const rows = [...grid._mounted].map(row => ({ id: row.data.id, rect: row._tr.getBoundingClientRect() })).sort((a, b) => a.rect.top - b.rect.top);
			return {
				count: grid._mounted.size, cached: grid._rows.filter(row => row._tr).length,
				liveTimes, top: grid._body.scrollTop, height: grid._body.scrollHeight,
				viewport: grid._body.clientHeight, anchor: grid._anchor(),
				coversViewport: !rows.length || (rows[0].rect.top <= body.top + 1 && rows[rows.length - 1].rect.bottom >= Math.min(body.bottom, body.top + grid._body.scrollHeight) - 1),
				pager: !!grid.element.querySelector('.flagrate-grid-pager')
			};
		});

		for (const name of ['rules', 'reserves', 'recording', 'recorded', 'search', 'recorded.search']) {
			if (process.argv.length > 2 && !process.argv.slice(2).includes(name)) continue;
			const isSearch = name === 'search' || name === 'recorded.search';
			const source = name === 'search' ? 'search/top' : name === 'recorded.search' ? 'recorded/search' : name + '/list';
			const dataKey = isSearch ? 'recorded' : name;
			await page.evaluate(name => {
				window.P = Class.create({});
				global.chinachu[name] = name === 'rules' ? new Array(10000).fill(null).map((_, i) => ({ reserve_titles: ['ルール ' + i] })) : makePrograms(10000);
				global.chinachu.schedule = [{ programs: global.chinachu[name] }];
				global.chinachu.status = {};
			}, dataKey);
			await page.addScriptTag({ content: read('web/page/' + source + '.js') });
			await page.evaluate(({ name, isSearch }) => {
				window.listPage = new P();
				// The old Firefox render callback encoded the query in place, so
				// switching descriptions searched for percent escapes and lost rows.
				Prototype.Browser.Gecko = name === 'search';
				listPage.self = { query: isSearch ? { skip: 1, title: '番組', page: '2' } : {} };
				listPage.view = { content: flagrate.createElement('div').setStyle({ position: 'relative', height: '100%' }).insertTo(document.getElementById('content')) };
				listPage.updateToolbar = function() {};
				if (isSearch) {
					ChinachuPreferences.set(false, name);
					window.searchToolbar = flagrate.createElement('div', { id: 'search-test-toolbar' }).insertTo(document.body);
					listPage.view.toolbar = { add: option => searchToolbar.appendChild(option.ui.entity) };
					listPage.init();
				} else listPage.draw();
			}, { name, isSearch });
			await settle();
			let state = await snapshot();
			assert.ok(!state.pager, name + ': pager removed');
			assert.ok(state.count > 0 && state.count < 100, name + ': bounded initial rows');
			assert.equal(state.cached, state.count);
			if (name === 'reserves' || name === 'recording') assert.equal(state.liveTimes, state.count);
			if (isSearch) assert.ok(state.anchor.index >= 40, name + ': old page links become a scroll position');
			if (name !== 'rules') {
				const id = await page.evaluate(() => {
					const row = listPage.grid._rows[listPage.grid._anchor().index];
					row._tr.click();
					row._last.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 150 }));
					return row.data.id;
				});
				assert.equal(await page.evaluate(() => location.hash), '#!/program/view/id=' + id + '/');
				assert.ok(await page.evaluate(() => !!document.querySelector('.flagrate-context-menu')));
			}

			// Stay inside a row: fractional browser heights can round a boundary
			// scroll position into the preceding row after descriptions are shown.
			await page.evaluate(() => listPage.grid._body.scrollTop = 150010);
			await settle();
			state = await snapshot();
			assert.ok(state.coversViewport, name + ': middle viewport covered');
			assert.ok(state.count < 100 && state.anchor.index > 1000);
			assert.equal(state.cached, state.count, name + ': offscreen DOM released');
			if (name !== 'rules') {
				await page.waitForTimeout(300);
				assert.equal(await page.evaluate(() => !!document.querySelector('.flagrate-context-menu')), false, 'offscreen menu released');
			}

			if (name === 'rules') {
				// Exercise native input activation: grid.select() alone cannot expose
				// the checked-state rollback caused by a cancelled click event.
				await page.evaluate(() => listPage.grid._rows[5000]._checkbox._input.focus());
				for (const selected of [true, false]) {
					await page.keyboard.press('Space');
					await settle();
					assert.deepEqual(await page.evaluate(() => ({
						checked: listPage.grid._rows[5000]._checkbox.isChecked(),
						selected: !!listPage.grid._rows[5000].isSelected,
						count: listPage.grid.getSelectedRows().length
					})), { checked: selected, selected, count: selected ? 1 : 0 });
				}
				await page.evaluate(() => { listPage.grid.select(5000); listPage.grid.select(5000); listPage.grid._body.scrollTop = 0; });
				await settle();
				assert.equal(await page.evaluate(() => listPage.grid.getSelectedRows().length), 1);
				await page.evaluate(() => listPage.grid._body.scrollTop = 150000);
				await settle();
				assert.equal(await page.evaluate(() => listPage.grid._rows[5000]._checkbox.isChecked()), true);
				await page.evaluate(() => listPage.grid.selectAll());
				assert.equal(await page.evaluate(() => listPage.grid.getSelectedRows().length), 10000);
				await page.evaluate(() => listPage.grid.deselectAll());
				assert.equal(await page.evaluate(() => listPage.grid.getSelectedRows().length), 0);
			}

			if (name === 'reserves') {
				const anchor = state.anchor.key;
				await page.evaluate(() => { ChinachuPreferences.set(true); listPage.drawMain(); });
				await settle();
				state = await snapshot();
				assert.equal(state.anchor.key, anchor, 'description switch preserves the visible program');
				assert.ok(state.coversViewport, 'variable-height viewport covered');
				assert.equal(state.liveTimes, state.count);
				await page.evaluate(() => document.getElementById('content').style.width = '850px');
				await settle();
				assert.equal((await snapshot()).anchor.key, anchor, 'resize preserves anchor');
				await page.evaluate(() => { global.chinachu.reserves.unshift(Object.assign({}, global.chinachu.reserves[0], { id: 'inserted', start: 0 })); listPage.drawMain(); });
				await settle();
				assert.equal((await snapshot()).anchor.key, anchor, 'insertion preserves anchor');
				await page.evaluate(() => { document.getElementById('content').style.width = '1200px'; });
				await settle();
			}

			if (isSearch) {
				const anchor = state.anchor.key;
				const hash = await page.evaluate(() => location.hash);
				for (const checked of [true, false, true]) {
					await page.locator('#search-test-toolbar input[role="switch"]').setChecked(checked);
					await settle();
					state = await snapshot();
					assert.ok(state.count > 0 && state.count < 100 && state.coversViewport, name + ': descriptions keep results visible');
					assert.equal(state.anchor.key, anchor, name + ': description switch preserves the visible program');
					assert.equal(await page.evaluate(() => location.hash), hash, name + ': rendering does not rewrite the URL');
					assert.equal(await page.evaluate(() => listPage.self.query.title), '番組', name + ': rendering does not encode the search term');
					assert.equal(await page.evaluate(() => listPage.grid._rows.length), 10000);
					assert.equal(await page.evaluate(() => !!listPage.grid.element.querySelector('.reserve-description')), checked);
				}
				await page.evaluate(() => { ChinachuPreferences.setDescriptionFontSize('16px'); document.fire('chinachu:schedule'); document.fire('chinachu:recorded'); });
				await settle();
				assert.equal((await snapshot()).anchor.key, anchor, name + ': font and data changes preserve the visible program');
				assert.equal(await page.evaluate(() => listPage.grid.element.querySelector('.reserve-description').style.fontSize), '16px');
			}

			// Return from details recreates a page and restores the anchor and sort order.
			await page.evaluate(name => listPage.grid.sort(name === 'rules' ? 'n' : 'datetime', false), name);
			await settle();
			await page.evaluate(() => listPage.grid._body.scrollTop = 90000);
			await settle();
			const before = (await snapshot()).anchor;
			await page.evaluate(() => { listPage.grid.destroy(); listPage.draw(); });
			await settle();
			state = await snapshot();
			assert.equal(state.anchor.key, before.key, name + ': restore row');
			assert.ok(Math.abs(state.anchor.offset - before.offset) <= 1, name + ': restore offset');
			assert.equal(state.anchor.sort, before.sort);
			assert.equal(state.anchor.ascending, false);

			await page.evaluate(() => listPage.grid._body.scrollTop = listPage.grid._body.scrollHeight);
			await settle();
			state = await snapshot();
			assert.ok(state.count < 100 && state.coversViewport, name + ': end viewport');
			assert.ok(Math.abs(state.height - state.viewport - state.top) < 2, name + ': reaches the last row');
			if (isSearch) {
				await page.evaluate(() => { listPage.grid.destroy(); listPage.self.query.title = '^番組 1$'; listPage.draw(); });
				await settle();
				assert.equal(await page.evaluate(() => listPage.grid._rows.length), 1, name + ': new conditions filter results');
				assert.equal((await snapshot()).anchor.index, 0, name + ': new conditions have an independent position');
			}
			await page.evaluate(name => { global.chinachu[name] = []; global.chinachu.schedule = []; listPage.drawMain(); }, dataKey);
			await settle();
			assert.equal((await snapshot()).count, 0);
			assert.equal((await snapshot()).liveTimes, 0);
			await page.evaluate(isSearch => {
				if (isSearch) { listPage.deinit(); searchToolbar.remove(); }
				else listPage.grid.destroy();
				listPage.view.content.remove();
			}, isSearch);
			console.log(name + ': 10,000 rows, scrolling, sorting, restoration and cleanup passed');
		}
		assert.deepEqual(errors, [], 'no browser errors');
	} finally {
		await browser.close();
	}
}

run().catch(error => { console.error(error); process.exitCode = 1; });
