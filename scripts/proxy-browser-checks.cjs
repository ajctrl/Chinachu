'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// Optional real-browser checks; keep Playwright out of the production install.
module.exports = async function browserChecks({ origin, password, ca, check, root }) {
	const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
	const spki = new crypto.X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' });
	const pin = crypto.createHash('sha256').update(spki).digest('base64');
	const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}),
		args: ['--no-sandbox', '--ignore-certificate-errors-spki-list=' + pin, '--autoplay-policy=no-user-gesture-required'] });
	const context = await browser.newContext({ httpCredentials: { username: 'proxy-test', password }, viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	const errors = [], failed = [], mutations = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
	page.on('response', response => { if (response.status() >= 400) failed.push(response.status() + ' ' + new URL(response.url()).pathname); });
	page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method()) && request.url().includes('/api/')) mutations.push(request); });
	async function route(hash) {
		await page.evaluate(hash => { location.hash = hash; }, hash);
		const [category, name] = hash.split('/').slice(1, 3);
		await page.waitForFunction(({ category, name }) => window.app?.pm?.p?.self.category === category && app.pm.p.self.page === name &&
			!app.pm.content.classList.contains('loading'), { category, name });
		assert.ok(!await page.locator('.page-content.failure').count(), 'Page failed to load: ' + hash);
	}
	async function closeDialogs() {
		await page.locator('wa-dialog[label="成功"][open] [slot="footer"]').getByRole('button', { name: '閉じる', exact: true }).click();
		await page.waitForFunction(() => !document.querySelector('wa-dialog[open]'));
	}
	try {
		await check('Chromium rejects unauthenticated HTTPS access and loads the authenticated dashboard', async () => {
			const anonymous = await browser.newContext();
			try {
				const denied = await anonymous.request.get(origin, { ignoreHTTPSErrors: true });
				assert.equal(denied.status(), 401);
			} finally { await anonymous.close(); }
			await page.goto(origin);
			await page.waitForFunction(() => window.app?.socket?.connected && app.chinachu.recorded.length === 1 && app.pm.p);
			assert.equal(await page.evaluate(() => isSecureContext), true);
			assert.equal(await page.evaluate(() => app.socket.io.engine.transport.name), 'websocket');
		});
		await check('Chromium creates, edits and deletes a rule using the actual dialogs', async () => {
			await route('!/rules/list/');
			await page.getByRole('button', { name: '追加', exact: true }).click();
			const title = page.locator('.chinachu-form-field').filter({ has: page.locator('.chinachu-form-label', { hasText: /^対象タイトル$/ }) }).locator('wa-input input');
			await title.fill('browser-proxy-test'); await title.press('Enter');
			const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/rules.json');
			await page.getByRole('button', { name: '作成', exact: true }).click();
			assert.equal((await created).status(), 201);
			await closeDialogs();
			await page.waitForFunction(() => app.chinachu.rules.some(rule => rule.reserve_titles?.includes('browser-proxy-test')));
			await page.locator('.tabulator-row').filter({ hasText: 'browser-proxy-test' }).click();
			await page.getByRole('button', { name: '編集', exact: true }).click();
			await title.fill('browser-proxy-updated'); await title.press('Enter');
			const updated = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/rules/0.json');
			await page.getByRole('button', { name: '変更', exact: true }).click();
			assert.equal((await updated).status(), 200);
			await closeDialogs();
			await page.waitForFunction(() => app.chinachu.rules.some(rule => rule.reserve_titles?.includes('browser-proxy-updated')));
			await page.locator('.tabulator-row').filter({ hasText: 'browser-proxy-updated' }).click();
			await page.getByRole('button', { name: '削除', exact: true }).click();
			const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/rules/0.json');
			await page.locator('wa-dialog[open]').getByRole('button', { name: '削除', exact: true }).click();
			assert.equal((await deleted).status(), 200);
			await page.waitForFunction(() => app.chinachu.rules.length === 0);
			for (const request of mutations) {
				const headers = await request.allHeaders();
				assert.equal(headers['x-requested-with'], 'XMLHttpRequest');
				assert.equal(headers.origin, origin);
				assert.equal(headers['sec-fetch-site'], 'same-origin');
			}
			assert.equal(mutations.length, 3);
		});
		await check('Chromium navigates all main views without JavaScript errors', async () => {
			for (const hash of ['!/schedule/table/', '!/schedule/timeline/', '!/reserves/list/', '!/recording/list/',
				'!/recorded/list/', '!/recorded/search/', '!/rules/list/kind=exclusion/', '!/search/top/', '!/pref/config/', '!/dashboard/status/']) await route(hash);
			assert.deepEqual(errors, []); assert.deepEqual(failed, []);
		});
		await check('Chromium plays recorded MP4, seeks, and releases playback after navigating away', async () => {
			await page.evaluate(() => localStorage.setItem('program.watch.settings', JSON.stringify({ ext: 'mp4', s: '1024x576', 'b:v': '256k', 'b:a': '64k' })));
			await route('!/program/watch/id=proxy-recorded/');
			await page.getByRole('button', { name: '再生', exact: true }).click();
			await page.waitForFunction(() => window.video?.readyState >= 2 && video.currentTime > 0);
			await page.evaluate(() => { video.pause(); });
			const seeked = page.waitForResponse(response => response.url().includes('/api/recorded/proxy-recorded/watch.mp4') && response.url().includes('ss=3'));
			await page.locator('.seek wa-slider').evaluate(slider => { slider.value = 3; slider.dispatchEvent(new Event('change', { bubbles: true })); });
			assert.equal((await seeked).status(), 200);
			await page.waitForFunction(() => video.readyState >= 2 && video.currentTime > 0);
			await page.screenshot({ path: process.env.PROXY_BROWSER_SCREENSHOT || path.join(root, 'browser-playback.png') });
			await route('!/recorded/list/');
			assert.equal(await page.locator('.video-container video').count(), 0);
			assert.deepEqual(errors, []); assert.deepEqual(failed, []);
		});
		await check('Chromium reconnects Socket.IO after an interrupted network connection', async () => {
			await context.setOffline(true);
			// Chromium's offline emulation leaves existing WebSockets open.
			// Close the active transport as well so Socket.IO must reconnect.
			await page.evaluate(() => app.socket.io.engine.close());
			await page.waitForFunction(() => !app.socket.connected);
			await context.setOffline(false);
			await page.waitForFunction(() => app.socket.connected);
			await page.reload();
			await page.waitForFunction(() => window.app?.socket?.connected && app.pm.p);
			assert.deepEqual(errors, []);
		});
	} catch (error) {
		console.error('Browser errors:', errors, '\nFailed HTTP requests:', failed);
		console.error((await page.locator('body').innerText()).slice(-2500));
		await page.screenshot({ path: process.env.PROXY_BROWSER_SCREENSHOT || path.join(root, 'browser-failure.png') }).catch(() => {});
		throw error;
	} finally { await context.close(); await browser.close(); }
};
