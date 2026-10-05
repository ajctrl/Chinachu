'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function environment(fetch) {
    class Node extends EventTarget {
        constructor(tag) {
            super(); this.nodeType = 1; this.tagName = tag.toUpperCase();
            this.localName = tag; this.dataset = {}; this.children = []; this.style = {};
        }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this[name] = value; }
        remove() {}
    }
    const document = new EventTarget();
    document.createElement = tag => new Node(tag);
    document.head = new Node('head');
    document.body = new Node('body');
    const window = new EventTarget();
    const errors = [], cleared = [];
    Object.assign(window, {
        window, document, fetch, Headers, URLSearchParams, AbortController, TextDecoder,
        CustomEvent, URL, setTimeout, clearTimeout: value => { cleared.push(value); clearTimeout(value); },
        clearInterval: value => { cleared.push(value); clearInterval(value); },
        console: { error: error => errors.push(error), log() {} },
        location: { hash: '#!/test/first/', replace(value) { this.hash = value; } },
        ChinachuUI: { Navbar: class { removeAll() { return this; } } }
    });
    vm.createContext(window);
    vm.runInContext(fs.readFileSync(require.resolve('../web/runtime.js'), 'utf8'), window);
    vm.runInContext(fs.readFileSync(require.resolve('../web/page-manager.js'), 'utf8'), window);
    function resolvePage(key, definition) {
        const script = document.head.children.find(item => item.dataset.pageKey === key);
        assert.ok(script, 'Page script requested: ' + key);
        document.currentScript = script;
        window.Chinachu.definePage(definition);
        document.currentScript = null;
        script.onload();
    }
    return { C: window.Chinachu, window: vm.runInContext('window', window), context: window, document, errors, cleared, resolvePage };
}
function scope() { return { _requests: new Set(), _cleanups: [], _disposed: false }; }
const result = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ETag: 'revision' } });

describe('browser request runtime', function () {
    it('substitutes scalar and array translation values without dropping zero', function () {
        const { C } = environment(async () => result({}));
        assert.equal(C.t('TO {0}', 'YESTERDAY'), 'TO YESTERDAY');
        assert.equal(C.t('{0}件', 0), '0件');
        assert.equal(C.t('{0} / {1}', ['A', 'B']), 'A / B');
    });
    it('encodes repeated GET parameters and keeps headers/JSON/status available to callers', async function () {
        let requested;
        const { C } = environment(async (url, options) => { requested = { url, options }; return result({ ok: true }); });
        const calls = [];
        const request = C.request('./api/search.json?skip=1', {
            method: 'get', parameters: { title: '日本語 & +', type: ['GR', 'BS'], ignored: undefined },
            requestHeaders: ['X-Test', 'yes'], onSuccess: response => calls.push(['success', response.responseJSON.ok]),
            onComplete: response => calls.push(['complete', response.status, response.getHeader('ETag')])
        });
        await request.promise;
        const query = new URL(requested.url, 'http://localhost').searchParams;
        assert.equal(query.get('title'), '日本語 & +');
        assert.deepEqual(query.getAll('type'), ['GR', 'BS']);
        assert.equal(query.has('ignored'), false);
        assert.equal(requested.options.body, undefined);
        assert.equal(requested.options.credentials, 'same-origin');
        assert.equal(requested.options.headers.get('X-Test'), 'yes');
        assert.deepEqual(calls, [['success', true], ['complete', 200, 'revision']]);
    });

    it('sends update parameters as form data and reports HTTP/network failures once', async function () {
        let requested;
        const { C } = environment(async (url, options) => { requested = options; return new Response('denied', { status: 403 }); });
        const calls = [];
        await C.request('./api/config.json', {
            method: 'put', parameters: { json: '{"percent":"50%"}', revision: 'a&b' },
            onSuccess: () => calls.push('success'), onFailure: response => calls.push(response.status), onComplete: () => calls.push('complete')
        }).promise;
        assert.equal(new URLSearchParams(requested.body).get('json'), '{"percent":"50%"}');
        assert.equal(new URLSearchParams(requested.body).get('revision'), 'a&b');
        assert.match(requested.headers.get('Content-Type'), /application\/x-www-form-urlencoded/);
        assert.deepEqual(calls, [403, 'complete']);
        const network = environment(async () => { throw new Error('offline'); }).C;
        const failures = [];
        await network.request('/test', { onFailure: response => failures.push(response.error.message), onComplete: () => failures.push('complete') }).promise;
        assert.deepEqual(failures, ['offline', 'complete']);
    });

    it('reports callback exceptions without treating a successful HTTP request as a failure', async function () {
        const env = environment(async () => result({ ok: true }));
        const calls = [];
        await env.C.request('/ok', {
            onSuccess() { throw new Error('UI callback failed'); },
            onFailure() { calls.push('failure'); }, onComplete() { calls.push('complete'); }
        }).promise;
        assert.deepEqual(calls, ['complete']);
        assert.equal(env.errors[0].message, 'UI callback failed');
    });

    it('cancels scoped requests and suppresses callbacks after leaving the page', async function () {
        let signal;
        const { C } = environment((url, options) => new Promise((resolve, reject) => {
            signal = options.signal;
            signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
        }));
        const owner = scope(), calls = [];
        const request = C.withScope(owner, () => C.request('/slow', {
            onSuccess: () => calls.push('success'), onFailure: () => calls.push('failure'), onComplete: () => calls.push('complete')
        }));
        assert.equal(owner._requests.size, 1);
        owner._disposed = true;
        owner._requests.forEach(controller => controller.abort());
        await request.promise;
        assert.equal(signal.aborted, true);
        assert.equal(owner._requests.size, 0);
        assert.deepEqual(calls, []);
    });

    it('keeps callback scope when a response starts another request', async function () {
        const { C } = environment(async () => result({ ok: true }));
        const owner = scope();
        let nested, nestedScope;
        await C.withScope(owner, () => C.request('/first', { onSuccess() {
            nestedScope = C.scope;
            nested = C.request('/second');
            assert.equal(owner._requests.size, 2);
        } })).promise;
        await nested.promise;
        assert.equal(nestedScope, owner);
        assert.equal(owner._requests.size, 0);
    });

    it('decodes multibyte text across stream chunks and completes after the final chunk', async function () {
        const bytes = new TextEncoder().encode('番組\nログ');
        const stream = new ReadableStream({ start(controller) {
            controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2, 7)); controller.enqueue(bytes.slice(7)); controller.close();
        } });
        const { C } = environment(async () => new Response(stream));
        const progress = [], complete = [];
        await C.request('/log', { method: 'get', onInteractive: response => progress.push(response.responseText), onComplete: response => complete.push(response.responseText) }).promise;
        assert.equal(progress.at(-1), '番組\nログ');
        assert.ok(progress.every(text => !text.includes('�')));
        assert.deepEqual(complete, ['番組\nログ']);
    });

    it('preserves the API client JSON payload, response body, and callback order', async function () {
        let requested;
        const env = environment(async (url, options) => { requested = { url, options }; return result({ ok: true }); });
        const source = fs.readFileSync(require.resolve('../web/class.js'), 'utf8');
        env.window.chinachu = {};
        vm.runInContext(source.slice(source.indexOf('var api = chinachu.api = {};'), source.indexOf('var ui = chinachu.ui = {};')), env.context);
        const client = new env.window.chinachu.api.Client({ apiRoot: './api/' });
        const callbacks = [];
        await new Promise(resolve => {
            client.request('example.json', {
                method: 'put', param: { label: '50% 日本語' },
                onCreate: response => callbacks.push(['create', typeof response.transport.abort]),
                onSuccess: (response, body) => callbacks.push(['success', response.status, body.ok]),
                onComplete: () => { callbacks.push(['complete']); resolve(); }
            });
        });
        assert.equal(requested.url, './api/example.json');
        assert.deepEqual(JSON.parse(requested.options.body), { label: '50% 日本語', Count: 0 });
        assert.equal(requested.options.headers.get('X-Chinachu-Client-Version'), '3');
        assert.deepEqual(callbacks, [['create', 'function'], ['success', 200, true], ['complete']]);
        assert.equal(client.requestTable[1].status, 'complete');
    });
});

describe('browser page event ownership', function () {
    it('does not retain redrawn page elements and preserves callback scope', function () {
        const { C, document } = environment(async () => result({}));
        const owner = scope();
        let calls = 0;
        for (let i = 0; i < 100; i++) {
            const button = document.createElement('button');
            C.withScope(owner, () => C.on(button, 'click', function () {
                assert.equal(C.scope, owner);
                assert.equal(this, button);
                calls++;
            }));
            button.dispatchEvent(new Event('click'));
            if (i === 99) {
                owner._disposed = true;
                button.dispatchEvent(new Event('click'));
            }
        }
        assert.equal(calls, 100);
        assert.equal(owner._cleanups.length, 0);
    });

    it('releases cleanup records when persistent listeners are explicitly removed', function () {
        const { C, document, window } = environment(async () => result({}));
        const owner = scope();
        let calls = 0;
        const handler = () => { calls++; };
        for (let i = 0; i < 100; i++) {
            C.withScope(owner, () => C.on(document, 'refresh', handler));
            C.off(document, 'refresh', handler);
        }
        assert.equal(owner._cleanups.length, 0);
        C.withScope(owner, () => {
            C.on(document, 'refresh', handler);
            C.on(window, 'keydown', handler);
        });
        document.dispatchEvent(new Event('refresh'));
        window.dispatchEvent(new Event('keydown'));
        owner._cleanups.splice(0).forEach(cleanup => cleanup());
        document.dispatchEvent(new Event('refresh'));
        window.dispatchEvent(new Event('keydown'));
        assert.equal(calls, 2);
    });
});

describe('browser keyboard shortcuts', function () {
    function key(document, value, options = {}) {
        const event = new Event('keydown', { cancelable: true });
        Object.assign(event, { key: value }, options);
        document.dispatchEvent(event);
        return event;
    }

    it('normalizes legacy arrow and space labels and removes them with either spelling', function () {
        const { C, document } = environment(async () => result({}));
        const pressed = [];
        C.shortcuts.add('Left', () => pressed.push('left'));
        C.shortcuts.add('Right', () => pressed.push('right'));
        C.shortcuts.add('Space', () => pressed.push('space'));
        key(document, 'ArrowLeft'); key(document, 'ArrowRight'); key(document, ' ');
        C.shortcuts.remove('ArrowLeft'); key(document, 'ArrowLeft');
        assert.deepEqual(pressed, ['left', 'right', 'space']);
    });

    it('preserves page scope and removes page shortcuts on cleanup without removing later replacements', function () {
        const { C, document } = environment(async () => result({}));
        const owner = scope(); let callbackScope, count = 0;
        C.withScope(owner, () => C.shortcuts.add('Right', () => { callbackScope = C.scope; }));
        key(document, 'ArrowRight');
        assert.equal(callbackScope, owner);
        owner._disposed = true;
        owner._cleanups.forEach(cleanup => cleanup());
        assert.equal(key(document, 'ArrowRight').defaultPrevented, false);
        const second = scope();
        C.withScope(second, () => C.shortcuts.add('Left', () => {}));
        C.shortcuts.add('ArrowLeft', () => { count++; });
        second._cleanups.forEach(cleanup => cleanup());
        key(document, 'ArrowLeft');
        assert.equal(count, 1);
    });

    it('leaves keyboard editing to native and Web Awesome form controls', function () {
        const { C, document } = environment(async () => result({}));
        let count = 0;
        C.shortcuts.add('Right', () => { count++; });
        for (const tagName of ['INPUT', 'WA-INPUT', 'WA-SLIDER', 'WA-SELECT']) {
            key(document, 'ArrowRight', { composedPath: () => [{ tagName }, document] });
        }
        assert.equal(count, 0);
        C.shortcuts.add('Shift+Ctrl+Left', () => { count++; });
        key(document, 'ArrowLeft', { shiftKey: true, ctrlKey: true });
        assert.equal(count, 1);
    });
});

describe('hash page manager', function () {
    const index = { defaultCategory: 'test', category: { test: { defaultPage: 'first', page: { first: { title: 'First' }, second: { title: 'Second' } } } } };

    it('ignores a slow earlier page load after a later navigation has completed', async function () {
        const env = environment(async () => result({}));
        const manager = new env.C.PageManager({}, index), initialized = [];
        const first = manager.load('test', 'first');
        const second = manager.load('test', 'second', { title: '番組' });
        env.resolvePage('test/second', { init() { initialized.push('second'); } });
        await second;
        env.resolvePage('test/first', { init() { initialized.push('first'); } });
        await first;
        assert.deepEqual(initialized, ['second']);
        assert.equal(manager.p.self.page, 'second');
        assert.equal(manager.p.self.query.title, '番組');
        manager.destroy();
    });

    it('removes document listeners, aborts requests, and cancels timers when unloading', async function () {
        let signal;
        const env = environment((url, options) => new Promise((resolve, reject) => {
            signal = options.signal; signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
        }));
        const manager = new env.C.PageManager({}, index);
        let clicks = 0, cleaned = 0, request;
        const loading = manager.load('test', 'first');
        env.resolvePage('test/first', { init() {
            env.C.on(env.document, 'test-click', () => { clicks++; });
            env.C.on(env.window, 'test-click', () => { clicks++; });
            this.timer.poll = 1234;
            request = env.C.request('/slow');
        }, deinit() { cleaned++; } });
        await loading;
        env.C.emit(env.document, 'test-click');
        env.C.emit(env.window, 'test-click');
        manager.unload();
        env.C.emit(env.document, 'test-click');
        env.C.emit(env.window, 'test-click');
        await request.promise;
        assert.equal(clicks, 2);
        assert.equal(cleaned, 1);
        assert.equal(signal.aborted, true);
        assert.ok(env.cleared.includes(1234));
        assert.equal(manager.p, null);
        manager.destroy();
    });

    it('resolves legacy hash queries with repeated values and encoded slashes', function () {
        const env = environment(async () => result({}));
        const manager = new env.C.PageManager({}, index);
        let loaded;
        manager.load = (category, page, query) => { loaded = { category, page, query }; };
        env.window.location.hash = '#!/test/second/title=A%2FB&type=GR&type=BS/';
        manager.realizeHash();
        assert.equal(loaded.category, 'test');
        assert.equal(loaded.page, 'second');
        assert.equal(loaded.query.title, 'A/B');
        assert.deepEqual(Array.from(loaded.query.type), ['GR', 'BS']);
        manager.destroy();
    });

    it('reloads the original page after visiting an invalid route and going back', async function () {
        const env = environment(async () => result({}));
        const manager = new env.C.PageManager({}, index);
        let initialized = 0;
        manager.realizeHash();
        env.resolvePage('test/first', { init() { initialized++; } });
        await new Promise(setImmediate);
        const original = manager.p;
        assert.equal(initialized, 1);
        for (const hash of ['#!/missing/first/', '#!/test/missing/']) {
            env.window.location.hash = hash;
            manager.realizeHash();
            assert.equal(manager.p, null);
            assert.equal(manager.content.textContent, 'ページが見つかりません。');
            env.window.location.hash = '#!/test/first/';
            manager.realizeHash();
            await new Promise(setImmediate);
            assert.equal(manager.p.self.page, 'first');
            assert.notEqual(manager.p, original);
        }
        assert.equal(initialized, 3);
        manager.destroy();
    });

    it('continues unloading listeners and timers when one component cleanup fails', async function () {
        const env = environment(async () => result({}));
        const manager = new env.C.PageManager({}, index);
        let remaining = false;
        const loading = manager.load('test', 'first');
        env.resolvePage('test/first', { init() {
            this._cleanups.push(() => { throw new Error('component cleanup failed'); });
            this._cleanups.push(() => { remaining = true; });
            this.timer.poll = 5678;
        } });
        await loading;
        manager.unload();
        assert.equal(remaining, true);
        assert.ok(env.cleared.includes(5678));
        assert.equal(env.errors[0].message, 'component cleanup failed');
        assert.equal(manager.p, null);
        manager.destroy();
    });
});
