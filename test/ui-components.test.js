'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Only DOM primitives are stubbed: tests exercise the application form model,
// callback contracts, and lifecycle hooks independently of Web Awesome internals.
function loadUI(timers = {}, chinachu) {
    class Node {
        constructor(tagName) {
            this.tagName = tagName;
            this.nodeType = 1;
            this.children = [];
            this.attributes = {};
            this.events = {};
            this.style = {};
            this.value = '';
            const classes = new Set();
            this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: name => classes.delete(name), contains: name => classes.has(name) };
        }
        appendChild(child) { this.children.push(child); child.parent = this; return child; }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        replaceChildren(...children) { this.children = []; this.append(...children); }
        setAttribute(key, value) { this.attributes[key] = value; }
        removeAttribute(key) { delete this.attributes[key]; }
        addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
        dispatchEvent(event) { event.target ||= this; (this.events[event.type] || []).forEach(fn => fn(event)); }
        set textContent(value) { this.text = String(value); this.children = []; }
        get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    }
    const document = { createElement: tag => new Node(tag), createTextNode: value => Object.assign(new Node('#text'), { textContent: value }), body: new Node('body'), activeElement: null };
    document.getElementById = id => {
        function find(node) {
            if (node.attributes.id === id) return node;
            for (const child of node.children) {
                const found = find(child);
                if (found) return found;
            }
            return null;
        }
        return find(document.body);
    };
    const window = { ChinachuDOM: { decorate: node => { node.updateText = value => { node.textContent = value; return node; }; return node; } } };
    window.Chinachu = chinachu;
    document.querySelector = () => null;
    vm.runInNewContext(fs.readFileSync(require.resolve('../web/ui.js'), 'utf8'), { window, document, innerWidth: 1280, innerHeight: 900, CustomEvent: class { constructor(type) { this.type = type; } }, Event: class { constructor(type) { this.type = type; } }, setTimeout: timers.setTimeout || setTimeout });
    return { UI: window.ChinachuUI, document };
}
const plain = value => JSON.parse(JSON.stringify(value));

describe('Web Awesome application UI', function () {
    it('waits for an outside click before checking unsaved changes, including click-only touch simulation', function () {
        const { UI } = loadUI();
        let checks = 0, stopped = 0;
        const modal = new UI.Modal({ closeOnClickOutside: true,
            onBeforeClose() { checks++; return false; }
        }).open();
        const dialog = { open: true, getBoundingClientRect: () => ({ left: 20, right: 340, top: 72, bottom: 648 }) };
        modal.entity.shadowRoot = { querySelector: () => dialog };
        const outside = { clientX: 4, clientY: 360, composedPath: () => [dialog, modal.entity], stopPropagation() { stopped++; } };
        modal.entity.dispatchEvent({ ...outside, type: 'pointerdown' });
        assert.equal(checks, 0, 'do not change dialogs during a pointer gesture');
        assert.equal(stopped, 1, 'suppress the component pulse and pointerdown dismissal');
        modal.entity.dispatchEvent({ ...outside, type: 'click' });
        assert.equal(checks, 1);
        assert.equal(modal.entity.open, true);
        modal.entity.dispatchEvent({ ...outside, type: 'click' });
        assert.equal(checks, 2, 'a click without pointerdown also checks unsaved changes');
        modal.entity.dispatchEvent({ ...outside, type: 'click', clientX: 180 });
        modal.entity.dispatchEvent({ ...outside, type: 'click', composedPath: () => [{}, dialog, modal.entity] });
        assert.equal(checks, 2, 'dialog contents do not trigger outside dismissal');
    });

    it('guards explicit and native dialog dismissal without closing or notifying twice', function () {
        const { UI } = loadUI();
        let allow = false, checks = 0, closed = 0;
        const modal = new UI.Modal({ closeOnClickOutside: true,
            onBeforeClose() { checks++; return allow; }, onClose() { closed++; }
        }).open();
        assert.equal(Object.hasOwn(modal.entity.attributes, 'light-dismiss'), false, 'outside clicks use the guarded application close path');
        modal.close();
        assert.equal(modal.entity.open, true);
        assert.equal(closed, 0);
        let prevented = false;
        modal.entity.dispatchEvent({ type: 'wa-hide', preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
        assert.equal(modal._isOpen, true);
        allow = true;
        modal.close();
        modal.entity.dispatchEvent({ type: 'wa-hide' });
        assert.equal(checks, 3);
        assert.equal(closed, 1);
        assert.equal(modal.entity.open, false);
    });

    it('releases closed dialogs and registers reopened dialogs with their original page', function () {
        const scope = { _cleanups: [] };
        const chinachu = { scope };
        const { UI, document } = loadUI({}, chinachu);
        const modal = new UI.Modal({ title: '確認' });
        modal.entity.shadowRoot = { querySelector: () => ({ open: true }) };
        chinachu.scope = null;
        assert.equal(scope._cleanups.length, 0, 'unopened dialogs need no cleanup');
        for (let i = 0; i < 30; i++) {
            modal.open();
            modal.open();
            assert.equal(scope._cleanups.length, 1);
            modal.close();
            assert.equal(scope._cleanups.length, 1, 'retain cleanup until the closing animation finishes');
            modal.entity.dispatchEvent({ type: 'wa-after-hide' });
            assert.equal(scope._cleanups.length, 0);
            assert.ok(!document.body.children.includes(modal.entity));
        }
        modal.open();
        scope._disposed = true;
        scope._cleanups.splice(0).forEach(cleanup => cleanup());
        assert.ok(!document.body.children.includes(modal.entity));
        modal.open();
        assert.equal(scope._cleanups.length, 0);
        assert.ok(!document.body.children.includes(modal.entity));
    });

    it('releases dialogs closed before the custom element renders', function () {
        const scope = { _cleanups: [] };
        const { UI, document } = loadUI({}, { scope });
        for (let i = 0; i < 30; i++) {
            const modal = new UI.Modal({ title: '確認' }).open();
            modal.close();
            assert.equal(scope._cleanups.length, 0);
            assert.ok(!document.body.children.includes(modal.entity));
        }
    });

    it('releases removed popovers and cleans up reopened popovers on navigation', function () {
        const scope = { _cleanups: [] };
        const chinachu = { scope };
        const { UI, document } = loadUI({}, chinachu);
        const popover = new UI.Popover({ text: '番組' });
        const target = { getBoundingClientRect: () => ({ right: 10, top: 10 }) };
        chinachu.scope = null;
        assert.equal(scope._cleanups.length, 0);
        for (let i = 0; i < 30; i++) {
            popover.open(target);
            assert.equal(scope._cleanups.length, 1);
            popover.remove();
            popover.remove();
            assert.equal(scope._cleanups.length, 0);
        }
        popover.open(target);
        scope._disposed = true;
        scope._cleanups.splice(0).forEach(cleanup => cleanup());
        assert.ok(!document.body.children.includes(popover.entity));
        popover.open(target);
        assert.ok(!document.body.children.includes(popover.entity));
    });

    it('keeps notification timeouts in seconds and leaves timeout zero visible', function () {
        const scheduled = [];
        const { UI, document } = loadUI({ setTimeout: (callback, delay) => scheduled.push({ callback, delay }) });
        const notify = new UI.Notify();
        const notice = notify.create({ message: '録画開始', timeout: 10 });
        const area = document.getElementById('chinachu-notifications');
        assert.equal(scheduled[0].delay, 10000);
        assert.ok(area.children.includes(notice.entity));
        scheduled[0].callback();
        assert.equal(area.children.includes(notice.entity), false);
        const persistent = notify.create({ message: '継続表示', timeout: 0 });
        assert.equal(scheduled.length, 1);
        assert.ok(area.children.includes(persistent.entity));
        notify.create({ message: '標準表示' });
        assert.equal(scheduled[1].delay, 5000);
        new UI.Notify({ timeout: 8 }).create({ message: '設定済み' });
        assert.equal(scheduled[2].delay, 8000);
    });

    it('preserves numeric nested rule fields and selected category values', function () {
        const { UI } = loadUI();
        const form = UI.createForm({ fields: [
            { key: 'start', point: '/hour/start', input: { type: 'number', val: 0, min: 0, max: 24 } },
            { key: 'end', point: '/hour/end', input: { type: 'number', val: 24, min: 0, max: 24 } },
            { key: 'categories', input: { type: 'checkboxes', val: ['anime'], items: ['anime', 'news'] } },
            { key: 'isEnabled', input: { type: 'checkbox', val: true } }
        ] });
        assert.deepEqual(plain(form.getResult()), { hour: { start: 0, end: 24 }, categories: ['anime'], isEnabled: true });
        form.fields[1].set(25);
        assert.equal(form.validate(), false);
        assert.match(form.fields[1].error.textContent, /24/);
        form.fields[1].set(23);
        assert.equal(form.validate(), true);
    });

    it('updates codec-dependent fields and excludes their stale values from the request', function () {
        const { UI } = loadUI();
        const form = UI.createForm({ fields: [
            { key: 'c:v', input: { type: 'radios', val: 'copy', isRequired: true, items: ['copy', 'h264'] } },
            { key: 's', input: { type: 'select', val: '1024x576', items: ['1024x576', '1280x720'] }, depends: [{ pointer: '/c:v', val: 'copy', op: '!==' }] }
        ] });
        assert.deepEqual(plain(form.getResult()), { 'c:v': 'copy' });
        assert.equal(form.fields[1].element.hidden, true);
        form.fields[0].set('h264');
        form.element.dispatchEvent({ type: 'change' });
        assert.equal(form.fields[1].element.hidden, false);
        assert.deepEqual(plain(form.getResult()), { 'c:v': 'h264', s: '1024x576' });
        form.fields[0].set('copy');
        assert.deepEqual(plain(form.getResult()), { 'c:v': 'copy' });
    });

    it('uses custom channel and tokenizer input adapters without changing their values', function () {
        const { UI, document } = loadUI();
        const inputType = {
            create() { const node = document.createElement('div'); node.values = []; return node; },
            setVal(value) { this.element.values = (value || []).slice(); },
            getVal() { return this.element.values.slice(); }
        };
        const form = UI.createForm({ fields: [{ key: 'channels', input: { type: inputType, val: ['27', 'BS_211', 'unavailable'] } }] });
        assert.deepEqual(plain(form.getResult()), { channels: ['27', 'BS_211', 'unavailable'] });
    });

    it('checks draft keywords without committing or clearing the text being typed', function () {
        const { UI } = loadUI();
        const form = UI.createForm({ fields: [{ key: 'keywords', input: { val: ['元の語'], type: {
            create() { return UI.createTokenizer(); },
            getVal(options) { return this.element.getValues(options); },
            setVal(value) { this.element.setValues(value); }
        } } }] });
        const input = form.fields[0].control.children[1];
        input.value = '新しい語';
        assert.deepEqual(plain(form.getResult({ commit: false })), { keywords: ['元の語', '新しい語'] });
        assert.equal(input.value, '新しい語');
        input.value = '';
        assert.deepEqual(plain(form.getResult({ commit: false })), { keywords: ['元の語'] });
        input.value = '新しい語';
        assert.deepEqual(plain(form.getResult()), { keywords: ['元の語', '新しい語'] });
        assert.equal(input.value, '');
    });

    it('validates only active required controls', function () {
        const { UI } = loadUI();
        const form = UI.createForm({ fields: [
            { key: 'enabled', input: { type: 'checkbox', val: false } },
            { key: 'name', input: { type: 'text', isRequired: true }, depends: [{ key: 'enabled', val: true }] }
        ] });
        assert.equal(form.validate(), true);
        form.fields[0].set(true);
        let valid;
        form.validate(result => { valid = result; });
        assert.equal(valid, false);
        form.fields[1].set('番組名');
        assert.equal(form.validate(), true);
    });

    it('preserves modal callback button identity and renders labels as text', function () {
        const { UI } = loadUI();
        let called = false;
        const modal = new UI.Modal({ buttons: [{ label: '<img onerror=alert(1)>', onSelect(event, owner) {
            called = true;
            assert.equal(owner, modal);
            assert.equal(event.targetButton, this.button);
            this.button.disable();
        } }] });
        const button = modal.buttons[0].button;
        assert.equal(button.children[0].tagName, '#text');
        button.dispatchEvent({ type: 'click' });
        assert.equal(called, true);
        assert.equal(button.disabled, true);
    });

    it('calls subclass init/create hooks during ElementView initialization', function () {
        const { UI } = loadUI();
        function DynamicTime(options) { this.initialize(options); }
        DynamicTime.prototype = Object.create(UI.ElementView.prototype);
        DynamicTime.prototype.init = function (options) { this.time = options.time; this.tagName = 'time'; };
        DynamicTime.prototype.create = function () { UI.ElementView.prototype.create.call(this); this.entity.textContent = this.time; };
        const view = new DynamicTime({ time: 42 });
        assert.equal(view.entity.tagName, 'time');
        assert.equal(view.entity.textContent, '42');
    });

    it('retains every anonymous toolbar action while replacing named actions', function () {
        const { UI } = loadUI();
        const toolbar = new UI.Navbar();
        toolbar.add({ key: null, ui: UI.Button({ label: '予約' }) });
        toolbar.add({ key: null, ui: UI.Button({ label: 'ルール' }) });
        toolbar.add({ key: 'save', ui: UI.Button({ label: '保存' }) });
        toolbar.add({ key: 'save', ui: UI.Button({ label: '変更を保存' }) });
        assert.equal(toolbar.all().length, 3);
        assert.equal(toolbar.one('save').textContent, '変更を保存');
    });

    it('clears the initial body message before rendering the application', function () {
        const { UI, document } = loadUI();
        document.body.appendChild(document.createTextNode('JavaScript execution required.'));
        const body = new UI.Body().clear();
        assert.equal(body.entity, document.body);
        assert.equal(document.body.children.length, 0);
    });

    it('keeps the slider application API separate from the component form lifecycle', function () {
        const { UI } = loadUI();
        const slider = new UI.Slider({ min: 0, max: 10, value: 4 });
        assert.equal(slider.children[0].tagName, 'wa-slider');
        assert.equal(Object.hasOwn(slider.children[0], 'setValue'), false);
        slider.setValue(50);
        assert.equal(slider.getValue(), 10);
        slider.disable();
        assert.equal(slider.children[0].disabled, true);
        slider.enable();
        assert.equal(slider.isEnabled(), true);
    });
});
