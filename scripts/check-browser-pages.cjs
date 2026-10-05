/* Optional end-to-end browser check. Install Playwright and Chromium separately,
 * then run NODE_PATH=/path/to/node_modules node scripts/check-browser-pages.cjs.
 * All HTTP/Socket.IO data comes from a temporary loopback fixture server. API
 * writes are rejected; no DVR service or recording files are accessed.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { chromium } = require('playwright');
const webRoot = path.resolve(__dirname, '../web');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const screenshotDir = process.env.CHINACHU_BROWSER_SCREENSHOTS;
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

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
	return {
		status: { operator: { alive: true, pid: 1234 }, connectedCount: 1, feature: { filer: true, streamer: true } },
		schedule: [Object.assign({}, channel, { programs })], reserves, recording, recorded,
		rules: [{ reserve_titles: ['番組'], types: ['GR'], categories: ['anime'], isDisabled: false }],
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
		browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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
		for (const name of ['schedule/table', 'schedule/timeline']) {
			await route(name);
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
		await route('reserves/list');
		await route('program/view', 'id=future-1');
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'mobile page must not overflow the viewport');
		const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
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
		console.log('Browser checks passed: 16 routes, desktop/mobile, safe description links, mouse/touch pointer controls, local assets, no API writes.');
	} finally {
		if (browser) await browser.close();
		await new Promise(resolve => io.close(resolve));
		if (server.listening) await new Promise(resolve => server.close(resolve));
	}
}
run().catch(error => { console.error(error); process.exitCode = 1; });
