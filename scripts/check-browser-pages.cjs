/* Optional end-to-end browser check. Install Playwright and Chromium separately,
 * then run NODE_PATH=/path/to/node_modules node scripts/check-browser-pages.cjs.
 * All HTTP/Socket.IO data comes from a temporary loopback fixture server. API
 * writes are rejected except a browser-intercepted mock config save; no DVR
 * service, real configuration files or recording files are accessed.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const browserName = process.env.CHINACHU_BROWSER || 'chromium';
if (!['chromium', 'firefox'].includes(browserName)) throw new Error('CHINACHU_BROWSER must be chromium or firefox');
const browserType = require('playwright')[browserName];
const webRoot = path.resolve(__dirname, '../web');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const screenshotDir = process.env.CHINACHU_BROWSER_SCREENSHOTS;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');

function makeFixture() {
	const now = Date.now();
	const channel = { id: 'test-channel', name: 'テスト放送 <channel>', type: 'GR', channel: '27', sid: 1024, hasLogoData: false };
	function program(id, start, extra) {
		return Object.assign({ id, title: '番組 <title> ' + id, fullTitle: '番組 <title> ' + id, subTitle: '副題', detail: '説明 <img src=x onerror="window.fixtureXss=true"> https://example.test/" onclick="alert(1)\nｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｔｅｓｔ／？ａ＝１＆ｂ＝２', flags: ['新'], category: 'anime', episode: 1, start, end: start + 1800000, seconds: 1800, channel, tuner: { isScrambling: false } }, extra);
	}
	const programs = Array.from({ length: 48 }, (_, index) => program('future-' + index, now - 60000 + index * 1800000));
	const reserves = programs.slice(1, 10).map((entry, index) => Object.assign({}, entry, { isManualReserved: index === 0, isSkip: index === 1 }));
	const recording = [program('recording-1', now - 60000, { recorded: '/fixture/recording.m2ts', pid: 1234 })];
	const recorded = Array.from({ length: 15 }, (_, index) => program('recorded-' + index, now - (index + 2) * 3600000, { recorded: '/fixture/recorded-' + index + '.m2ts' }));
	Object.assign(recorded[1], { recorded: '/fixture/' + 'long-file-name-'.repeat(25) + '.m2ts', command: 'recording-command-'.repeat(40), fullTitle: 'FullTitle'.repeat(50) });
	return {
		status: { operator: { alive: true, pid: 1234 }, connectedCount: 1, feature: { filer: true, streamer: true } },
		schedule: [Object.assign({}, channel, { programs })], reserves, recording, recorded,
		rules: [{ reserve_titles: ['番組'], types: ['GR'], categories: ['anime'], isDisabled: false }, { reserve_titles: ['ニュース', '<特集>'], reserve_titles_operator: 'and', ignore_titles: ['再放送'], hour: { start: 18, end: 23 }, duration: { min: 900, max: 3600 }, isDisabled: true }],
		'exclusion-rules': [{ reserve_titles: ['再放送'], types: ['GR'], isDisabled: false }],
		config: { recordedDir: './recorded/', wuiPort: 10772, recordingPriority: 2 },
		storage: { size: 1024 ** 4, used: 512 * 1024 ** 3, avail: 500 * 1024 ** 3, recorded: 400 * 1024 ** 3, lowSpaceThreshold: 3 * 1024 ** 3 }
	};
}

async function run() {
	const fixture = makeFixture();
	const writes = [], requests = [];
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		requests.push(url.pathname);
		if (url.pathname.startsWith('/api/')) {
			if (!['GET', 'HEAD'].includes(request.method)) {
				writes.push(request.method + ' ' + url.pathname);
				response.writeHead(405); response.end('Fixture API is read only'); return;
			}
			const key = /^\/api\/([^/]+)\.json$/.exec(url.pathname)?.[1];
			if (key && Object.hasOwn(fixture, key)) {
				response.writeHead(200, { 'Content-Type': 'application/json', ETag: '"fixture-revision"' });
				response.end(JSON.stringify(fixture[key])); return;
			}
			if (/\/file\.json$/.test(url.pathname)) {
				response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"size":1073741824}'); return;
			}
			if (/\/preview\.jpg$|\/logo\.png$/.test(url.pathname)) {
				response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(pixel); return;
			}
			if (/\/api\/log\/[^/]+\/stream\.txt$/.test(url.pathname)) {
				response.writeHead(200, { 'Content-Type': 'text/plain' });
				response.write('fixture log\n<img src=x onerror="window.fixtureXss=true">\n');
				const timer = setTimeout(() => response.end('end\n'), 150);
				response.on('close', () => clearTimeout(timer)); return;
			}
			response.writeHead(404); response.end('Unknown fixture API: ' + url.pathname); return;
		}
		let filename;
		try { filename = path.resolve(webRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
		catch (_) { response.writeHead(400); response.end(); return; }
		if (!filename.startsWith(webRoot + path.sep)) { response.writeHead(403); response.end(); return; }
		fs.readFile(filename, (error, bytes) => {
			if (error) { response.writeHead(404); response.end(); return; }
			response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); response.end(bytes);
		});
	});
	const io = new Server(server, { serveClient: true });
	io.on('connection', socket => {
		socket.emit('status', fixture.status);
		for (const key of ['rules', 'reserves', 'recording', 'recorded', 'schedule']) socket.emit('notify-' + key);
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const origin = 'http://127.0.0.1:' + server.address().port;
	let browser;
	try {
		browser = await browserType.launch({ headless: true, args: browserName === 'chromium' ? ['--no-sandbox'] : [] });
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
		const errors = [], external = [];
		await context.route('**/*', route => {
			const url = new URL(route.request().url());
			if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
			external.push(url.href); return route.abort();
		});
		const page = await context.newPage();
		if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
		async function screenshot(name, target = page) {
			if (screenshotDir) await target.screenshot({ path: path.join(screenshotDir, name + '.png'), fullPage: true });
		}
		page.on('pageerror', error => errors.push(error.stack || error.message));
		page.on('console', message => {
			if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
		});
		await page.goto(origin + '/#!/dashboard/top/');
		await page.waitForFunction(() => window.app?.pm?.p && app.chinachu.schedule.length && app.chinachu.reserves.length && app.chinachu.recorded.length);
		const cleanupCounts = await page.evaluate(() => {
			localStorage.setItem('dashboard.showChannels', 'yes');
			app.pm.p.drawChannels();
			const before = app.pm.p._cleanups.length;
			for (let i = 0; i < 100; i++) {
				app.pm.p.drawChannels();
				app.pm.p.drawReserves();
				app.pm.p.drawRecording();
				app.pm.p.drawRecorded();
			}
			return { before, after: app.pm.p._cleanups.length };
		});
		assert.equal(cleanupCounts.after, cleanupCounts.before, 'dashboard redraws must not retain detached controls in page cleanup records');
		const modalCleanupCounts = await page.evaluate(async () => {
			const owner = app.pm.p, before = owner._cleanups.length;
			for (let i = 0; i < 30; i++) {
				Chinachu.withScope(owner, () => new ChinachuUI.Modal({ title: '初回描画前の終了' }).show().close());
			}
			if (owner._cleanups.length !== before) throw new Error('Early dialog close retained cleanup records');
			const modal = Chinachu.withScope(owner, () => new ChinachuUI.Modal({ title: '後片付けの検証', text: 'テスト' }));
			for (let i = 0; i < 3; i++) {
				// Initial connection with open=true shows the native dialog without
				// wa-after-show; wait for rendering rather than that optional event.
				modal.open(); await modal.entity.updateComplete;
				if (!modal.entity.shadowRoot.querySelector('dialog').open) throw new Error('Dialog did not open');
				const hidden = new Promise(resolve => modal.entity.addEventListener('wa-after-hide', resolve, { once: true }));
				modal.close(); await hidden;
			}
			return { before, after: owner._cleanups.length, connected: modal.entity.isConnected };
		});
		assert.equal(modalCleanupCounts.after, modalCleanupCounts.before, 'closed and reopened dialogs must release their page cleanup records');
		assert.equal(modalCleanupCounts.connected, false);
		const menuCleanupCounts = await page.evaluate(() => {
			const before = app.pm.p._cleanups.length;
			const card = document.querySelector('.program-list-item');
			function open() { card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })); }
			for (let i = 0; i < 100; i++) { open(); ChinachuUI.activeMenu.close(); }
			const afterClose = app.pm.p._cleanups.length;
			open();
			window.fixtureMenu = ChinachuUI.activeMenu;
			fixtureMenu.close();
			// Reopening outside the event callback must still use the owning page.
			fixtureMenu.open({ clientX: 100, clientY: 100 });
			return { before, afterClose, afterOpen: app.pm.p._cleanups.length };
		});
		assert.equal(menuCleanupCounts.afterClose, menuCleanupCounts.before, 'closed menus must release their page cleanup records');
		assert.equal(menuCleanupCounts.afterOpen, menuCleanupCounts.before + 1, 'an open menu must retain exactly one page cleanup record');
		await page.waitForFunction(() => fixtureMenu.entity.contains(document.activeElement));
		await page.evaluate(() => {
			window.fixtureNotice = app.notify.create({ text: '録画開始', timeout: 10 });
		});
		await page.waitForTimeout(100);
		assert.equal(await page.evaluate(() => fixtureNotice.entity.isConnected), true, 'ten-second notification must remain visible after 100 milliseconds');
		await page.evaluate(() => { fixtureNotice.remove(); delete window.fixtureNotice; });
		await page.evaluate(() => { location.hash = '!/missing/top/'; });
		await page.waitForFunction(() => !app.pm.p);
		assert.equal(await page.locator('.chinachu-context-menu').count(), 0, 'navigation must close the open menu');
		assert.equal(await page.evaluate(() => {
			fixtureMenu.open({ clientX: 100, clientY: 100 });
			const reopened = !!ChinachuUI.activeMenu;
			delete window.fixtureMenu;
			return reopened;
		}), false, 'a departed page must not reopen its menu');
		await page.goBack();
		await page.waitForFunction(() => app.pm.p?.self.category === 'dashboard' && app.pm.p.self.page === 'top');
		async function route(name, query = '') {
			const [category, view] = name.split('/');
			await page.evaluate(hash => { location.hash = hash; }, '!/' + name + '/' + query + (query ? '/' : ''));
			await page.waitForFunction(([category, view]) => window.app?.pm?.p?.self.category === category && app.pm.p.self.page === view, [category, view]);
			await page.waitForTimeout(120);
			assert.equal(await page.locator('.page-content.failure').count(), 0, name + ' failed to render');
			assert.equal(await page.evaluate(() => window.fixtureXss), undefined, name + ' executed fixture markup');
			assert.equal(errors.length, 0, name + ': ' + errors.join('\n'));
			console.log('PASS ' + name);
			await screenshot((page.viewportSize().width < 600 ? 'mobile-' : 'desktop-') + name.replace('/', '-'));
		}
		for (const name of ['dashboard/top', 'dashboard/status', 'dashboard/log', 'dashboard/storage', 'reserves/list', 'recording/list', 'recorded/list', 'rules/list', 'search/top', 'recorded/search']) {
			await route(name, name.includes('search') ? 'skip=1' : '');
		}
		await route('search/top', 'skip=1');
		await page.evaluate(() => {
			const channel = app.chinachu.schedule[0];
			channel.programs.push(Object.assign({}, channel.programs[0], { id: 'literal-percent', title: '%41', fullTitle: '%41', detail: '%2F' }));
			app.pm.p.viewSearchModal();
		});
		await page.locator('.chinachu-search-form input[name="title"]').fill('%41');
		await page.locator('.chinachu-search-form input[name="desc"]').fill('%2F');
		await page.evaluate(() => document.querySelector('.chinachu-search-form').requestSubmit());
		await page.waitForFunction(() => app.pm.p?.self.query.searchVersion === '2');
		assert.match(await page.locator('.chinachu-search-summary').innerText(), /タイトル：%41/);
		assert.match(await page.locator('.chinachu-search-summary').innerText(), /説明：%2F/);
		assert.deepEqual(await page.evaluate(() => ({ title: app.pm.p.self.query.title, desc: app.pm.p.self.query.desc, ids: app.pm.p.grid.rows.map(row => row.data.id) })),
			{ title: '%41', desc: '%2F', ids: ['literal-percent'] }, 'submission and page initialization must preserve literal percent escapes');
		await page.evaluate(() => {
			app.chinachu.schedule[0].programs = app.chinachu.schedule[0].programs.filter(program => program.id !== 'literal-percent');
		});
		await route('search/top', 'skip=1&title=%25E7%2595%25AA%25E7%25B5%2584');
		assert.equal(await page.evaluate(() => app.pm.p.self.query.title), '番組', 'legacy double-encoded bookmarks must still work');
		await route('program/view', 'id=recorded-0');
		assert.equal(await page.locator('.program-detail img').count(), 0);
		assert.equal(await page.locator('.program-detail a').count(), 2);
		assert.equal(await page.locator('.program-detail a').last().getAttribute('href'), 'https://example.test/?a=1&b=2');
		assert.match(await page.locator('.program-detail').innerText(), /<img src=x/);
		assert.ok(await page.locator('.main-head-toolbar wa-button').count() >= 3, 'program actions must not overwrite anonymous toolbar entries');
		for (const name of ['program/watch', 'channel/watch']) {
			await route(name, 'id=' + (name === 'program/watch' ? 'recorded-0' : 'test-channel'));
			assert.equal(await page.locator('wa-dialog[open]').count(), 1);
			assert.ok(await page.locator('wa-dialog .chinachu-form-field').count() >= 3);
		}
		await route('pref/config');
		await page.waitForFunction(() => app.pm.p.data.editor && app.pm.p.inputs);
		await page.getByText('JSON編集', { exact: true }).first().click();
		assert.equal(await page.evaluate(() => app.pm.p.activeTab), 'json');
		assert.equal(await page.evaluate(() => JSON.parse(app.pm.p.data.editor.getValue()).wuiPort), 10772);
		const aceVersion = JSON.parse(fs.readFileSync(path.join(webRoot, 'lib/ace/package.json'), 'utf8')).version;
		assert.equal(await page.evaluate(() => ace.version), aceVersion, 'the browser must load the pinned Ace version');
		await page.waitForFunction(() => app.pm.p.data.editor.session.getMode().$id === 'ace/mode/json' && app.pm.p.data.editor.session.$worker);
		assert.equal(await page.evaluate(() => app.pm.p.data.editor.getTheme()), 'ace/theme/github');
		const originalJson = await page.evaluate(() => app.pm.p.data.editor.getValue());
		async function editJson(text) {
			await page.evaluate(() => { app.pm.p.data.editor.focus(); app.pm.p.data.editor.selectAll(); });
			await page.keyboard.insertText(text);
			assert.equal(await page.evaluate(() => app.pm.p.data.editor.getValue()), text, 'Ace must preserve typed JSON and Japanese text');
		}
		const invalidJson = '{ "wuiPort": }';
		await editJson(invalidJson);
		await page.waitForFunction(() => app.pm.p.data.editor.session.getAnnotations().some(annotation => annotation.type === 'error'));
		await page.getByRole('button', { name: 'サーバー設定を保存', exact: true }).click();
		assert.match(await page.locator('.config-status').innerText(), /JSONを確認してください/);
		assert.equal(await page.locator('wa-dialog[open]').count(), 0, 'invalid JSON must not open the save confirmation');
		await page.evaluate(() => app.pm.p.data.editor.focus());
		await page.keyboard.press('Control+z');
		assert.equal(await page.evaluate(() => app.pm.p.data.editor.getValue()), originalJson);
		await page.keyboard.press('Control+Shift+z');
		assert.equal(await page.evaluate(() => app.pm.p.data.editor.getValue()), invalidJson);
		const editedConfig = { ...JSON.parse(originalJson), wuiPort: 10773, customSetting: { text: '日本語の設定 <img src=x onerror="window.fixtureXss=true">' } };
		await editJson(JSON.stringify(editedConfig, null, '  '));
		await page.waitForFunction(() => app.pm.p.data.editor.session.getAnnotations().length === 0);
		await page.getByRole('button', { name: '設定フォームに戻る', exact: true }).click();
		assert.equal(await page.locator('#setting-wuiPort').inputValue(), '10773');
		await page.locator('#setting-wuiPort').fill('10774');
		await page.getByRole('button', { name: 'JSON編集', exact: true }).click();
		editedConfig.wuiPort = 10774;
		assert.deepEqual(await page.evaluate(() => JSON.parse(app.pm.p.data.editor.getValue())), editedConfig, 'form edits must preserve settings outside the form');
		const savedConfig = [];
		const configUrl = origin + '/api/config.json';
		const mockConfigSave = async route => {
			if (route.request().method() !== 'PUT') return route.continue();
			savedConfig.push(new URLSearchParams(route.request().postData()));
			return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ETag: '"fixture-saved"' }, body: '{}' });
		};
		await page.route(configUrl, mockConfigSave);
		await page.getByRole('button', { name: 'サーバー設定を保存', exact: true }).click();
		assert.equal(await page.locator('wa-dialog[label="サーバー設定の保存"][open]').count(), 1, await page.locator('.config-status').innerText());
		// The footer is slotted light DOM outside the native dialog's subtree.
		await page.locator('wa-dialog[label="サーバー設定の保存"][open]').getByRole('button', { name: '保存', exact: true }).click();
		await page.waitForFunction(() => !app.pm.p.saving && app.pm.p.data.original?.wuiPort === 10774);
		assert.equal(savedConfig.length, 1);
		assert.deepEqual(JSON.parse(savedConfig[0].get('json')), editedConfig);
		assert.equal(savedConfig[0].get('revision'), 'fixture-revision');
		assert.equal(await page.evaluate(() => app.pm.p.data.revision), 'fixture-saved');
		assert.equal(await page.evaluate(() => app.pm.p.data.editor.getReadOnly()), false);
		assert.match(await page.locator('.config-status').innerText(), /設定を保存しました/);
		assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
		assert.ok(requests.includes('/lib/ace/src-min-noconflict/worker-json.js'), 'JSON validation must use the local Worker');
		await page.unroute(configUrl, mockConfigSave);
		await page.evaluate(() => { window.fixtureEditor = app.pm.p.data.editor; });
		console.log('PASS Ace ' + aceVersion + ': local JSON Worker/theme, Japanese editing, undo/redo, form synchronization and mock save');
		for (const name of ['schedule/table', 'schedule/timeline']) {
			await route(name);
			assert.equal(await page.evaluate(() => fixtureEditor.destroyed && !fixtureEditor.session.$worker), true, 'leaving settings must destroy the editor and its Worker');
			await page.waitForSelector('.rect[rel]');
			if (name === 'schedule/table') {
				const counts = await page.evaluate(async () => {
					const owner = app.pm.p, before = owner._cleanups.length;
					for (let i = 0; i < 10; i++) {
						owner.refresh(); await new Promise(resolve => setTimeout(resolve, 100));
					}
					return { before, after: owner._cleanups.length };
				});
				assert.equal(counts.after, counts.before, 'schedule refreshes must release removed popover cleanup records');
				assert.equal(await page.locator('.schedule-day-tabs wa-button:visible').count(), 7, 'desktop must show all seven dates');
				assert.equal(await page.locator('.schedule-day-navigation').isVisible(), false);
				for (const width of [390, 801, 1024, 1280, 1920, 800, 1280]) {
					await page.setViewportSize({ width, height: 900 });
					await page.waitForFunction(compact => document.querySelector('.schedule-day-tabs').hidden === compact && document.querySelector('.schedule-day-navigation').hidden === !compact, width === 390);
					assert.equal(await page.locator('.schedule-day-tabs').isVisible(), width !== 390);
					assert.equal(await page.locator('.schedule-day-navigation').isVisible(), width === 390);
					if (width !== 390) {
						const gap = await page.evaluate(() => {
							const selected = document.querySelector('.schedule-day-tabs .selected');
							return document.querySelector('.main-head').getBoundingClientRect().bottom - selected.getBoundingClientRect().bottom - parseFloat(getComputedStyle(selected, '::after').height);
						});
						assert.ok(Math.abs(gap) <= 1, 'selected date must meet schedule even when settings wraps at ' + width);
					}
				}

				const labels = await page.locator('.schedule-day-tabs wa-button').allTextContents();
				const expectedLabels = await page.evaluate(() => {
					const today = new Date(app.pm.p.time);
					return Array.from({ length: 7 }, (_, day) => {
						const date = new Date(app.pm.p.time + day * 86400000);
						const month = day === 0 || date.getMonth() !== today.getMonth() || date.getFullYear() !== today.getFullYear();
						return (month ? (date.getMonth() + 1) + '/' : '') + date.getDate() + '(' + '日月火水木金土'[date.getDay()] + ')' + (day === 0 ? ' ' + date.getHours() + '時〜' : '');
					});
				});
				assert.deepEqual(labels, expectedLabels);
				assert.deepEqual(await page.locator('.schedule-day-navigation option').allTextContents(), expectedLabels);
				await page.locator('.schedule-day-tabs wa-button').nth(2).click();
				await page.waitForFunction(() => app.pm.p?.self.query.day === '2' && app.pm.p.view.daySelect.value === '2');
				assert.equal(await page.locator('.schedule-day-tabs wa-button.selected').count(), 1);
				assert.equal(await page.locator('.schedule-day-navigation select').inputValue(), '2');
				await route('schedule/table', 'day=7');
				assert.equal(await page.locator('.schedule-day-navigation select').inputValue(), '0', 'invalid URL day must fall back to today');
				await route('schedule/table');
				await page.waitForSelector('.rect[rel]');
			}
			const rect = page.locator('.rect[rel]').first();
			await rect.click();
			assert.ok(await page.evaluate(() => app.pm.p.data.target), name + ' should select tapped program');
			const box = await rect.boundingBox();
			if (box) {
				await page.mouse.move(box.x + 5, box.y + 5);
				await page.mouse.down();
				await page.mouse.move(0, 0, { steps: 3 });
				await page.mouse.up();
			}
			assert.equal(errors.length, 0, errors.join('\n'));
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await route('dashboard/top');
		assert.equal(await page.locator('.app-sidebar-toggle').innerText(), 'トップ ▾');
		assert.equal(await page.locator('.app-mobile-title .app-sidebar-toggle').count(), 1);
		for (const width of [320, 390, 800]) {
			await page.setViewportSize({ width, height: 844 });
			assert.equal(await page.locator('.side').isVisible(), false, 'sidebar starts closed at ' + width);
			await page.locator('.app-sidebar-toggle').click();
			assert.equal(await page.locator('.side').isVisible(), true);
			assert.equal(await page.locator('.side-body wa-button:visible').count(), 4);
			assert.equal(await page.locator('.app-sidebar-toggle').getAttribute('aria-expanded'), 'true');
			assert.equal(await page.evaluate(() => app.view.main.entity.inert), true);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
			await page.locator('.app-sidebar-toggle').click();
			assert.equal(await page.locator('.side').isVisible(), false);
			assert.equal(await page.evaluate(() => app.view.main.entity.inert), false);
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator('.app-sidebar-toggle').click();
		await screenshot('mobile-sidebar-open');
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('.side').isVisible(), false);
		await page.locator('.app-sidebar-toggle').click();
		await page.locator('.sidebar-backdrop').click({ position: { x: 380, y: 20 } });
		assert.equal(await page.locator('.side').isVisible(), false);
		await page.locator('.app-sidebar-toggle').click();
		await page.locator('.side-body wa-button').first().click();
		assert.equal(await page.locator('.side').isVisible(), false, 'selecting current page closes sidebar');
		await page.locator('.app-sidebar-toggle').click();
		await page.locator('.side-body wa-button').nth(3).click();
		await page.waitForFunction(() => app.pm.p?.self.page === 'storage');
		assert.equal(await page.locator('.side').isVisible(), false, 'navigation closes sidebar');
		assert.equal(await page.locator('.app-sidebar-toggle').getAttribute('aria-expanded'), 'false');
		await page.locator('.app-sidebar-toggle').click();
		await page.setViewportSize({ width: 801, height: 844 });
		await page.waitForFunction(() => !app.view.main.entity.inert);
		assert.equal(await page.locator('.side').isVisible(), true, 'desktop retains sidebar');
		assert.equal(await page.locator('.app-sidebar-toggle').isVisible(), false);
		assert.equal(await page.evaluate(() => app.view.main.entity.inert), false);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator('.side').waitFor({ state: 'hidden' });
		assert.equal(await page.locator('.side').isVisible(), false);
		await route('recording/list');
		assert.equal(await page.locator('.app-sidebar-toggle').isVisible(), false, 'hide toggle for categories without sidebar');
		assert.equal(await page.locator('.app-mobile-title').innerText(), '録画中');
		assert.equal(await page.locator('.main-head').isVisible(), false);
		assert.equal(await page.locator('#app-menu-settings .description-switch').count(), 1);
		assert.equal(await page.locator('#app-menu-settings').isVisible(), false);
		await page.locator('.app-menu-toggle').click();
		await page.locator('#app-menu-settings input').check();
		await page.locator('.reserve-description').first().waitFor();
		await page.locator('.app-menu-toggle').click();
		await screenshot('mobile-compact-header');
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.locator('.main-head-toolbar .description-switch').waitFor();
		assert.equal(await page.locator('.main-head-toolbar .description-switch input').isChecked(), true);
		assert.equal(await page.locator('#app-menu-settings .description-switch').count(), 0);
		await page.setViewportSize({ width: 390, height: 844 });
		await route('rules/list');
		assert.equal(await page.locator('#app-menu-settings .description-switch').count(), 0);
		assert.equal(await page.locator('.rule-kind-tabs').isVisible(), true);
		assert.equal(await page.locator('.scheduler-label-short').isVisible(), true);
		for (const [width, height] of [[320, 568], [568, 320], [375, 667], [667, 375]]) {
			await page.setViewportSize({ width, height });
			const bounds = await page.locator('.main-head-toolbar .chinachu-button').evaluateAll(buttons => buttons.map(button => {
				const rect = button.getBoundingClientRect();
				return { top: rect.top, left: rect.left, right: rect.right };
			}));
			assert.ok(bounds.every(rect => Math.abs(rect.top - bounds[0].top) <= 1 && rect.left >= 0 && rect.right <= width), 'rule actions fit one row at ' + width);
			if (width > height) {
				const tabsTop = await page.locator('.rule-kind-tabs').evaluate(element => element.getBoundingClientRect().top);
				assert.ok(Math.abs(tabsTop - bounds[0].top) <= 1, 'rule tabs and actions share one row in landscape');
			}
			await screenshot('rules-se-' + width, page);
		}

		await route('reserves/list');
		for (const name of ['reserves/list', 'recording/list', 'recorded/list', 'search/top', 'recorded/search']) {
			await route(name, name.includes('search') ? 'skip=1' : '');
			await page.evaluate(() => app.pm.p.grid.sort('channel', false));
			for (const width of [800, 320, 390, 801]) {
				await page.setViewportSize({ width, height: 844 });
				await page.waitForFunction(compact => app.pm.p?.grid?._ready && app.pm.p.grid._compact === compact, width <= 800);
				await page.waitForTimeout(150);
				assert.equal(await page.evaluate(() => app.pm.p.grid.table.getSorters()[0]?.field), 'channel');
				const summary = page.locator('.chinachu-program-metadata').first();
				if (width <= 800) {
					assert.equal(await page.locator('.chinachu-virtual-grid .tabulator-header').isVisible(), false);
					assert.match(await summary.innerText(), /テスト放送 <channel>.*GR/s);
					assert.match(await summary.innerText(), /anime/);
					assert.match(await summary.innerText(), /\d{2}:\d{2}–(?:\d+\/\d+\([日月火水木金土]\) )?\d{2}:\d{2} · 30分/);
					assert.equal(await summary.locator('img, channel').count(), 0);
					assert.deepEqual(await page.evaluate(() => app.pm.p.grid.table.getColumns().filter(c => c.isVisible()).map(c => c.getField())), ['title', '_menu']);
					assert.equal(await page.locator('.tabulator-tableholder').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, name + ' overflow at ' + width);
					if (width === 390 && name === 'reserves/list') {
						await page.locator('.app-menu-toggle').click();
						await page.locator('#app-menu-settings .description-switch input').check();
						await page.locator('.app-menu-toggle').click();
						await page.locator('.chinachu-program-summary .reserve-description').first().waitFor();
						const firstTitle = page.locator('.chinachu-program-summary .reserve-title').first();
						assert.ok(await firstTitle.locator(':scope > .flag').count(), 'title flags must keep their original styling');
						assert.ok(await firstTitle.locator(':scope > .subtitle').count(), 'subtitle must keep its original styling');
						assert.equal(await firstTitle.locator(':scope > a > .flag, :scope > a > .subtitle').count(), 0);
						assert.notEqual(await firstTitle.locator(':scope > .flag').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
						assert.equal(await page.locator('.tabulator-responsive-collapse-toggle').count(), 0);
						const title = page.locator('.chinachu-program-title-link').first();
						assert.match(await title.getAttribute('href'), /#!\/program\/view\/id=/);
						assert.equal(await page.locator('.chinachu-program-keywords').count(), 0);
						await page.evaluate(() => {
							const row = app.pm.p.grid.rows[1];
							row.cell.matchedKeywords.text = '<該当>'; row.cell.excludedKeywords.text = '<除外>';
							app.pm.p.grid.table.getRow(row._key).reformat();
						});
						assert.equal(await page.locator('.chinachu-program-keywords').count(), 2);
						assert.match(await page.locator('.chinachu-program-keywords').first().innerText(), /該当キーワード：<該当>/);
						assert.match(await page.locator('.chinachu-program-keywords').last().innerText(), /除外キーワード：<除外>/);
						assert.equal(await page.locator('.chinachu-program-keywords *').count(), 0);
					}
					if (width === 390) await screenshot('mobile-metadata-' + name.replace('/', '-'));
				} else {
					assert.equal(await page.locator('.chinachu-virtual-grid .tabulator-header').isVisible(), true);
					assert.equal(await page.locator('.chinachu-program-metadata').count(), 0);
				}
			}
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await route('reserves/list');
		await page.evaluate(() => {
			window.originalClickAction = ChinachuPreferences.getClickAction;
			ChinachuPreferences.getClickAction = () => 'skip';
			window.skipCalls = [];
			app.pm.p.setProgramSkip = (program, skip) => window.skipCalls.push({ id: program.id, skip });
		});
		await page.locator('.chinachu-program-metadata').nth(1).click();
		assert.equal(await page.evaluate(() => window.skipCalls.length), 1);
		await page.evaluate(() => { ChinachuPreferences.getClickAction = () => 'detail'; });
		await page.locator('.chinachu-program-metadata').nth(1).click();
		assert.equal(await page.evaluate(() => window.skipCalls.length), 1);
		assert.equal(await page.evaluate(() => app.pm.p.self.category), 'reserves');
		await page.evaluate(() => { ChinachuPreferences.getClickAction = () => 'skip'; });
		await page.locator('.chinachu-program-title-link').nth(1).click();
		await page.waitForFunction(() => app.pm.p.self.category === 'program');
		assert.equal(await page.evaluate(() => window.skipCalls.length), 1);
		await page.evaluate(() => { ChinachuPreferences.getClickAction = window.originalClickAction; });
		await route('program/view', 'id=recorded-1');
		await page.locator('.program-thumbnail').first().waitFor({ state: 'attached' });
		for (const width of [800, 390, 320]) {
			await page.setViewportSize({ width, height: 844 });
			await page.waitForTimeout(150);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'recorded details must fit at ' + width);
			assert.equal(await page.locator('.program-page').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'recorded details must not scroll sideways at ' + width);
			assert.equal(await page.locator('.main-head-toolbar wa-button, .program-page .chinachu-callout, .program-thumbnail').evaluateAll(nodes => nodes.some(el => el.getBoundingClientRect().right > innerWidth + 1)), false, 'program controls and notifications must fit at ' + width);
			assert.ok(await page.locator('.program-page').innerText().then(text => text.includes('long-file-name-'.repeat(25))), 'long file path must remain readable');
			if (width === 390) await screenshot('mobile-recorded-program-details');
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await route('program/view', 'id=future-1');
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile page must not overflow the viewport');
		for (const exclusion of [false, true]) {
			await route('rules/list', exclusion ? 'kind=exclusion' : '');
			await page.waitForFunction(exclusion => app.pm.p.isExclusion === exclusion, exclusion);
			for (const width of [800, 390, 320]) {
				await page.setViewportSize({ width, height: 844 });
				await page.waitForFunction(() => app.pm.p.grid._ready && app.pm.p.grid._compact);
				await page.waitForFunction(() => {
					const holder = document.querySelector('.tabulator-tableholder');
					return holder && holder.scrollWidth <= holder.clientWidth + 1;
				});
				const card = page.locator('.chinachu-rule-summary').first();
				await card.waitFor();
				assert.match(await card.innerText(), exclusion ? /除外タイトル：.*再放送/ : /タイトル：.*番組/);
				assert.doesNotMatch(await card.innerText(), /CH指定なし|除外なし|時間帯：all/);
				assert.deepEqual(await page.evaluate(() => app.pm.p.grid.table.getColumns().filter(c => c.isVisible()).map(c => c.getField())), ['_selection', 'reserve_titles', '_menu']);
				assert.equal(await page.locator('.tabulator-tableholder').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
				if (!exclusion) {
					assert.match(await page.locator('.chinachu-rule-summary').nth(1).innerText(), /\[AND\] ニュース, <特集>/);
					assert.match(await page.locator('.chinachu-rule-summary').nth(1).innerText(), /無視タイトル：再放送/);
				}
				if (width === 390) await screenshot(exclusion ? 'mobile-exclusion-rules' : 'mobile-rule-cards');
			}
			await page.locator('.tabulator-cell[tabulator-field="_selection"] input').first().check();
			assert.equal(await page.evaluate(() => app.pm.p.grid.getSelectedRows().length), 1);
			await page.evaluate(() => { window.savedEditRule = chinachu.ui.EditRule; chinachu.ui.EditRule = function(index, exclusion) { window.editedRule = { index, exclusion }; }; });
			await page.locator('.chinachu-grid-menu').first().click();
			await page.locator('.chinachu-context-menu').getByText('編集', { exact: true }).click();
			assert.deepEqual(await page.evaluate(() => window.editedRule), { index: 0, exclusion });
			assert.equal(await page.evaluate(() => app.pm.p.grid.getSelectedRows().length), 1);
			await page.evaluate(() => { chinachu.ui.EditRule = window.savedEditRule; });
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.waitForFunction(() => app.pm.p.grid._ready && !app.pm.p.grid._compact);
			assert.equal(await page.locator('.chinachu-rule-summary').count(), 0);
			assert.equal(await page.evaluate(() => app.pm.p.grid.getSelectedRows().length), 1);
		}
		for (const name of ['search/top', 'recorded/search']) {
			const term = '長い検索条件'.repeat(12) + '<img>';
			await route(name, 'skip=1&searchVersion=2&title=' + encodeURIComponent(term) + '&desc=' + encodeURIComponent('経済') + '&channels=test-channel&cat=anime&type=GR&start=0&end=24');
			for (const width of [1280, 390, 320]) {
				await page.setViewportSize({ width, height: 844 });
				const summary = page.locator('.chinachu-search-summary');
				await summary.waitFor();
				assert.equal(await page.locator('.main-head .chinachu-search-summary').count(), 0);
				assert.equal(await summary.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
				assert.equal(await page.locator('.search-results-page').evaluate(el => {
					const summary = el.querySelector('.chinachu-search-summary').getBoundingClientRect();
					const grid = el.querySelector('.chinachu-virtual-grid').getBoundingClientRect();
					return grid.top >= summary.bottom - 1 && grid.bottom <= el.getBoundingClientRect().bottom + 1 && grid.height > 0;
				}), true, 'summary must sit above a usable results grid');
				const text = await summary.innerText();
				for (const expected of ['タイトル：' + term, '説明：経済', 'チャンネル：テスト放送 <channel>', 'ジャンル：anime', '放送種別：GR', '開始時刻：0時', '終了時刻：24時']) assert.ok(text.includes(expected), expected);
				assert.equal(await summary.locator('img').count(), 0);
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
				assert.equal(await summary.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
				if (width === 390) await screenshot('mobile-search-summary-' + name.replace('/', '-'));
			}
			await route(name, 'skip=1');
			assert.equal(await page.locator('.chinachu-search-summary').isVisible(), false);
		}
		const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: browserName === 'chromium', hasTouch: true, locale: 'ja-JP' });
		await touchContext.route('**/*', route => {
			if (new URL(route.request().url()).origin === origin) return route.continue();
			external.push(route.request().url()); return route.abort();
		});
		const touchPage = await touchContext.newPage();
		touchPage.on('pageerror', error => errors.push(error.stack || error.message));
		await touchPage.goto(origin + '/#!/dashboard/top/');
		await touchPage.waitForFunction(() => window.app?.pm?.p && app.chinachu.schedule.length);
		for (const name of ['table', 'timeline']) {
			await touchPage.evaluate(name => { location.hash = '!/schedule/' + name + '/'; }, name);
			await touchPage.waitForFunction(name => app.pm.p?.self.page === name && app.pm.p?.data.pieces?.length, name);
			if (name === 'table') {
				const navigation = touchPage.locator('.schedule-day-navigation');
				await touchPage.setViewportSize({ width: 800, height: 844 });
				await touchPage.locator('.schedule-day-tabs').waitFor({ state: 'visible' });
				const requiredWidth = await touchPage.locator('.schedule-day-tabs').evaluate(element =>
					Array.from(element.children).reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + parseFloat(getComputedStyle(element).gap) * 6);
				const rowMargin = await touchPage.locator('.schedule-day-controls').evaluate(element => {
					const toolbar = element.parentElement;
					const siblings = Array.from(toolbar.children).filter(item => item !== element && item.getBoundingClientRect().width > 0);
					const header = toolbar.closest('.main-head');
					const style = getComputedStyle(header);
					return innerWidth - header.clientWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + siblings.reduce((total, item) => total + item.getBoundingClientRect().width, 0) + parseFloat(getComputedStyle(toolbar).columnGap) * siblings.length + 16;
				});
				const minimumWidth = Math.ceil(requiredWidth + rowMargin);
				const shortRequiredWidth = await touchPage.evaluate(() => {
					const button = app.pm.p.view.dayButtons[0];
					const full = app.pm.p.view.daySelect.options[0].textContent;
					button.setLabel(full.replace(/^\d+\//, '').replace(/ .*/, ''));
					const tabs = document.querySelector('.schedule-day-tabs');
					const width = Array.from(tabs.children).reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) + parseFloat(getComputedStyle(tabs).gap) * 6;
					button.setLabel(full);
					return width;
				});
				const shortMinimumWidth = Math.ceil(shortRequiredWidth + rowMargin - 18);
				console.log('Date tabs with short today label minimum viewport width:', shortMinimumWidth);
				console.log('Date tabs minimum viewport width:', minimumWidth);
				for (const width of [800, 750, 700, minimumWidth, minimumWidth - 1, shortMinimumWidth, shortMinimumWidth - 1, 600, 500, 452, 451, 450, 390, 320]) {
					await touchPage.setViewportSize({ width, height: 844 });
					const compact = width <= 451;
					await touchPage.waitForFunction(compact => document.querySelector('.schedule-day-controls').classList.contains('is-compact') === compact, compact);
					assert.equal(await navigation.isVisible(), compact);
					if (!compact) await touchPage.waitForFunction(split => document.querySelector('.schedule-day-controls').parentElement.classList.contains('schedule-toolbar-split') === split, width < shortMinimumWidth);
					if (compact && (width === 390 || width === 320)) await touchPage.waitForFunction(split => document.querySelector('.schedule-day-controls').parentElement.classList.contains('schedule-toolbar-split') === split, false);
					const split = await touchPage.locator('.schedule-day-controls').evaluate(element => element.parentElement.classList.contains('schedule-toolbar-split'));
					if (!compact) assert.equal(split, width < shortMinimumWidth, 'wrap date tabs only when needed at ' + width);
					if (!compact) {
						const fullLabel = await navigation.locator('option').first().innerText();
						const expectedLabel = width < minimumWidth ? fullLabel.replace(/^\d+\//, '').replace(/ .*/, '') : fullLabel;
						await touchPage.waitForFunction(label => document.querySelector('.schedule-day-tabs wa-button').textContent === label, expectedLabel);
						assert.equal(await touchPage.locator('.schedule-day-tabs wa-button').first().getAttribute('aria-label'), fullLabel);
					}
					if (width === 390) assert.equal(split, false, 'keep short date navigation on one row at 390px');
					if (width === 320) assert.equal(split, false, 'group broadcast filters to keep one row at 320px');
					if (compact) {
						const full = await touchPage.locator('.schedule-day-tabs wa-button').first().getAttribute('title');
						assert.equal(await navigation.locator('option').first().innerText(), full.replace(/^\d+\//, '').replace(/ .*/, ''));
					}
					if (!compact && !split) {
						const difference = await touchPage.evaluate(() => document.querySelector('.schedule-day-tabs .selected').getBoundingClientRect().top - document.querySelector('.schedule-type-filter').getBoundingClientRect().top);
						assert.ok(Math.abs(difference) <= 1, 'inline dates and filters must stay aligned at ' + width);
						const outerGapDifference = await touchPage.evaluate(() => {
							const buttons = Array.from(document.querySelectorAll('.schedule-type-filter'));
							const first = document.createRange(), last = document.createRange();
							first.selectNodeContents(buttons[0]); last.selectNodeContents(buttons.at(-1));
							const left = first.getBoundingClientRect().left - document.querySelector('.main-head').getBoundingClientRect().left;
							const right = document.querySelector('.schedule-day-controls').getBoundingClientRect().left - last.getBoundingClientRect().right;
							return left - right;
						});
						assert.ok(Math.abs(outerGapDifference) <= 1, 'equal space before GR and after SKY at ' + width);
						const gap = await touchPage.evaluate(() => document.querySelector('.schedule-settings-button').getBoundingClientRect().left - document.querySelector('.schedule-day-controls').getBoundingClientRect().right);
						assert.ok(Math.abs(gap - 4) <= 1, 'keep settings with the date and filter group at ' + width);
					}
					await screenshot('schedule-one-row-' + width, touchPage);
					assert.equal(await touchPage.locator('.schedule-day-tabs').isVisible(), !compact);
					assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
				}

				for (const width of [320, 390]) {
					await touchPage.setViewportSize({ width, height: 844 });
					await navigation.waitFor({ state: 'visible' });
					assert.equal(await navigation.isVisible(), true);
					assert.equal(await touchPage.locator('.schedule-day-tabs').isVisible(), false);
					const fits = await navigation.evaluate(element => {
						const bounds = element.getBoundingClientRect();
						return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth;
					});
					assert.equal(fits, true, 'compact date navigation must fit width ' + width);
				}
				await touchPage.setViewportSize({ width: 320, height: 844 });
				const broadcastToggle = touchPage.getByRole('button', { name: '放送切替⌄' });
				await broadcastToggle.click();
				const broadcastPanel = touchPage.getByRole('group', { name: '表示する放送' });
				await broadcastPanel.getByRole('checkbox', { name: 'BS', exact: true }).uncheck();
				await touchPage.waitForFunction(() => !JSON.parse(localStorage.getItem('schedule.visible.types')).includes('BS'));
				await broadcastPanel.getByRole('checkbox', { name: 'BS', exact: true }).check();
				await touchPage.keyboard.press('Escape');
				await broadcastPanel.waitFor({ state: 'hidden' });
				await touchPage.setViewportSize({ width: 390, height: 844 });
				assert.equal(await navigation.getByRole('button', { name: '前日の番組表' }).isDisabled(), true);
				await navigation.locator('select').selectOption('6');
				await touchPage.waitForFunction(() => app.pm.p?.self.query.day === '6' && app.pm.p.view.daySelect.value === '6');
				assert.equal(await navigation.getByRole('button', { name: '翌日の番組表' }).isDisabled(), true);
				await navigation.getByRole('button', { name: '前日の番組表' }).click();
				await touchPage.waitForFunction(() => app.pm.p?.self.query.day === '5' && app.pm.p.view.daySelect.value === '5');
				assert.equal(await navigation.locator('select').inputValue(), '5');
				await navigation.getByRole('button', { name: '翌日の番組表' }).click();
				await touchPage.waitForFunction(() => app.pm.p?.self.query.day === '6' && app.pm.p.view.daySelect.value === '6');
				await navigation.locator('select').selectOption('0');
				await touchPage.waitForFunction(() => app.pm.p?.self.query.day === '0' && app.pm.p.view.daySelect.value === '0' && app.pm.p?.data.pieces?.length);
				await touchPage.setViewportSize({ width: 801, height: 844 });
				await touchPage.locator('.schedule-day-tabs').waitFor({ state: 'visible' });
				assert.equal(await touchPage.locator('.schedule-day-tabs').isVisible(), true);
				assert.equal(await navigation.isVisible(), false);
				await touchPage.setViewportSize({ width: 390, height: 844 });
			}
			const card = touchPage.locator('.rect[rel]').first();
			await card.scrollIntoViewIfNeeded();
			await touchPage.waitForTimeout(150);
			await screenshot('mobile-schedule-' + name, touchPage);
			const box = await card.boundingBox();
			await touchPage.touchscreen.tap(box.x + Math.min(10, box.width / 2), box.y + Math.min(10, box.height / 2));
			if (name === 'table') await touchPage.waitForFunction(() => app.pm.p?.self.category === 'program');
			else await touchPage.waitForFunction(() => app.pm.p?.data.target && !app.pm.p.view.drawer.entity.classList.contains('hide'));
			assert.equal(errors.length, 0, 'touch ' + name + ': ' + errors.join('\n'));
			console.log('PASS native touch schedule/' + name);
		}
		await touchContext.close();
		assert.equal(external.length, 0, 'unexpected external requests: ' + external.join(', '));
		assert.equal(requests.some(url => /\/lib\/(?:prototype|pep\.|date\.format|hyperform|bootstrap|flagrate|sakurapanel)/i.test(url)), false, 'removed libraries requested');
		assert.equal(writes.length, 0, 'unexpected API writes: ' + writes.join(', '));
		assert.equal(errors.length, 0, errors.join('\n'));
		console.log('Browser checks passed (' + browserName + '): 16 routes, desktop/narrow viewport, safe description links, mouse/touch pointer controls, local assets, Ace JSON editing/mock save, no server API writes.');
	} finally {
		if (browser) await browser.close();
		await new Promise(resolve => io.close(resolve));
		if (server.listening) await new Promise(resolve => server.close(resolve));
	}
}
run().catch(error => { console.error(error); process.exitCode = 1; });
