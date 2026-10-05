/* Browser UI built from Web Awesome and standard DOM APIs. */
(function (global) {
    'use strict';

    var UI = global.ChinachuUI = global.ChinachuUI || {};
    var uid = 0;
    function node(value) { return value && (value.entity || value.element || value); }
    function decorate(element) { return global.ChinachuDOM.decorate(element); }
    function listen(target, type, callback) {
        if (global.Chinachu && global.Chinachu.on) global.Chinachu.on(target, type, callback);
        else target.addEventListener(type, callback);
    }
    function scopedCleanup(cleanup) {
        var scope = global.Chinachu && global.Chinachu.scope;
        var registered = false;
        return {
            register: function () {
                if (scope && scope._disposed) return false;
                if (scope && scope._cleanups && !registered) {
                    scope._cleanups.push(cleanup);
                    registered = true;
                }
                return true;
            },
            unregister: function () {
                if (!registered) return;
                var index = scope._cleanups.indexOf(cleanup);
                if (index !== -1) scope._cleanups.splice(index, 1);
                registered = false;
            }
        };
    }
    function element(tag, attributes) {
        var result = decorate(document.createElement(tag || 'div'));
        Object.keys(attributes || {}).forEach(function (key) {
            var value = attributes[key];
            if (value === null || value === undefined || value === false) return;
            if (key === 'className') key = 'class';
            if (key === 'style' && typeof value === 'object') Object.assign(result.style, value);
            else result.setAttribute(key, value === true ? '' : String(value));
        });
        return result;
    }
    function append(target, value) {
        if (value === null || value === undefined) return;
        if (node(value).nodeType) target.appendChild(node(value));
        else target.appendChild(document.createTextNode(String(value)));
    }
    function applyOptions(target, options) {
        if (options.id) target.id = options.id;
        if (options.className) target.classList.add.apply(target.classList, options.className.split(/\s+/).filter(Boolean));
        if (options.style) Object.assign(target.style, options.style);
        return target;
    }
    function enablement(target) {
        target.disable = function () { target.disabled = true; target.setAttribute('disabled', ''); return target; };
        target.enable = function () { target.disabled = false; target.removeAttribute('disabled'); return target; };
        target.isEnabled = function () { return !target.disabled; };
        target.isDisabled = function () { return !!target.disabled; };
        return target;
    }
    UI.Element = UI.createElement = element;
    UI.Element.exists = function (target) { return !!node(target) && node(target).isConnected; };
    UI.emptyFunction = function () {};

    function ElementView(options) { this.initialize(options); }
    ElementView.prototype.initialize = function (options) {
        options = options || {};
        this.options = options;
        this.tagName = options.tagName || 'div';
        this.id = options.id || null;
        this.className = options.className || null;
        this.style = options.style || null;
        this.attr = options.attr || null;
        this.onRendered = options.onRendered;
        this.init(options);
        this.create();
        return this;
    };
    ElementView.prototype.init = function () { return this; };
    ElementView.prototype.create = function () {
        this.entity = applyOptions(element(this.tagName, this.attr), this);
        return this;
    };
    ElementView.prototype.render = function (target) {
        var container = typeof target === 'string' ? document.getElementById(target) : node(target);
        (container || document.body).appendChild(this.entity);
        if (this.onRendered) this.onRendered();
        return this;
    };
    ElementView.prototype.insertTo = ElementView.prototype.render;
    ElementView.prototype.update = function (content) { this.entity.replaceChildren(); append(this.entity, content); return this; };
    ElementView.prototype.insert = function (content) { append(this.entity, content); return this; };
    ElementView.prototype.show = function () { this.entity.hidden = false; this.entity.style.display = ''; return this; };
    ElementView.prototype.hide = function () { this.entity.hidden = true; return this; };
    ElementView.prototype.remove = function () { this.entity.remove(); return this; };
    UI.ElementView = UI.Container = ElementView;
    UI.Body = function () { this.entity = decorate(document.body); };
    UI.Body.prototype = Object.create(ElementView.prototype);
    UI.Body.prototype.clear = function () { this.entity.replaceChildren(); return this; };

    // Small, app-owned outline icons. All geometry uses the same 24px grid.
    // Legacy asset names remain aliases so page actions keep their identity.
    var iconPaths = {
        home: '<path d="m3 10 9-7 9 7v10H3Z M9 20v-7h6v7"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
        search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
        rules: '<path d="M9 5h12M9 12h12M9 19h12m-18-14 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2"/>',
        bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
        record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
        tv: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 2 4 4 4-4"/>',
        settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--icon-surface, white)"/><circle cx="16" cy="12" r="2" fill="var(--icon-surface, white)"/><circle cx="10" cy="18" r="2" fill="var(--icon-surface, white)"/>',
        storage: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18m-4 3h1m-5 0h1"/>',
        monitor: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8m-4-4v4M5 10h3l2-4 4 8 2-4h3"/>',
        history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        play: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
        user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
        online: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
        offline: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        add: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
        warning: '<path d="m12 3 10 18H2Z M12 9v5m0 3v.1"/>',
        edit: '<path d="m4 16 12-12 4 4L8 20H4Z M13 7l4 4"/>',
        copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
        save: '<path d="M3 3h15l3 3v15H3Z M7 3v6h10V3M7 21v-8h10v8"/>',
        erase: '<path d="m3 14 11-11 7 7-11 11H7Z M8 9l7 7m-5 5h11"/>',
        left: '<path d="M20 12H4m7-7-7 7 7 7"/>',
        right: '<path d="M4 12h16m-7-7 7 7-7 7"/>',
        import: '<path d="M4 4h16v16H4M2 12h12m-4-4 4 4-4 4"/>'
    };
    var iconAliases = {
        'home-medium': 'home', 'calendar-medium': 'calendar', 'calendar-search-result': 'search',
        'magnifier-zoom': 'search', 'regular-expression': 'rules', bookmarks: 'bookmark',
        'control-record-small': 'record', 'television-medium': 'tv', 'controller-d-pad': 'settings',
        'wrench-screwdriver': 'settings', hdd: 'storage', 'system-monitor': 'monitor',
        'clock-history': 'history', film: 'play', 'film-youtube': 'play', 'information-italic': 'info',
        'user-medium-silhouette': 'user', status: 'online', 'status-offline': 'offline',
        'cross-script': 'close', cross: 'close', 'plus-circle': 'add', 'tick-circle': 'check',
        'exclamation-red': 'warning', hammer: 'edit', 'document-copy': 'copy', disk: 'save',
        eraser: 'erase', 'arrow-180-medium': 'left', 'arrow-000-medium': 'right', 'calendar-import': 'import'
    };
    UI.createIcon = function (source) {
        var name = String(source || '').split('/').pop().replace(/\.png$/, '');
        name = iconAliases[name] || name;
        var icon = element('span', { 'class': 'chinachu-icon', 'aria-hidden': 'true', 'data-icon': name });
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (iconPaths[name] || iconPaths.info) + '</svg>';
        return icon;
    };

    function button(options) {
        options = options || {};
        var result = enablement(applyOptions(element('wa-button', Object.assign({ size: 'small', type: 'button' }, options.attribute || options.attr)), options));
        result.classList.add('chinachu-button');
        if (options.color) result.setAttribute('data-color', options.color);
        result.setLabel = function (label) {
            result.replaceChildren();
            if (options.icon) {
                var icon = UI.createIcon(options.icon);
                icon.setAttribute('slot', 'start');
                icon.classList.add('chinachu-button-icon');
                result.appendChild(icon);
            }
            append(result, label == null ? '' : label);
            return result;
        };
        result.setIcon = function (icon) { options.icon = icon; return result.setLabel(result.textContent); };
        result.setLabelHTML = function (html) { result.innerHTML = html; return result; };
        result.setLabel(options.label || '');
        if (options.labelHTML) result.insertAdjacentHTML('beforeend', options.labelHTML);
        if (options.color === '@transparent') result.setAttribute('appearance', 'plain');
        else if (options.color) result.setAttribute('variant', /red|pink/.test(options.color) ? 'danger' : /orange/.test(options.color) ? 'warning' : 'brand');
        if (options.isDisabled || options.disabled) result.disable();
        result.select = function () { result.classList.add('selected'); result.setAttribute('aria-pressed', 'true'); return result; };
        result.unselect = function () { result.classList.remove('selected'); result.setAttribute('aria-pressed', 'false'); return result; };
        result.isSelected = function () { return result.classList.contains('selected'); };
        listen(result, 'click', function (event) {
            if (result.disabled) return;
            event.targetButton = result;
            if (options.onSelect) options.onSelect.call(result, event, result);
            else if (options.onClick) options.onClick.call(result, event, result);
        });
        return result;
    }
    UI.Button = UI.createButton = button;
    function ActionButton(options) { this.options = options || {}; this.entity = button(this.options); }
    ActionButton.prototype = Object.create(ElementView.prototype);
    ['enable', 'disable', 'setLabel', 'setIcon', 'select', 'unselect'].forEach(function (method) {
        ActionButton.prototype[method] = function () { this.entity[method].apply(this.entity, arguments); return this; };
    });
    ['isEnabled', 'isDisabled', 'isSelected'].forEach(function (method) {
        ActionButton.prototype[method] = function () { return this.entity[method](); };
    });
    UI.ActionButton = ActionButton;

    function collection(target) {
        var items = new Map();
        target.add = function (entry) {
            if (typeof entry === 'string') { target.appendChild(element('span', { 'class': 'chinachu-toolbar-separator', 'aria-hidden': 'true' })); return target; }
            var key = entry.key == null ? Symbol('toolbar-item') : entry.key;
            if (items.has(key)) target.removeItem(key);
            var value = entry.ui || entry.element;
            items.set(key, value);
            append(target, value);
            return target;
        };
        target.one = function (key) { return items.get(key) || null; };
        target.getElementByKey = function (key) { return node(items.get(key)); };
        target.removeItem = function (key) {
            var value = items.get(key);
            if (value) node(value).remove();
            items.delete(key);
            return target;
        };
        target.removeAll = function () { items.clear(); target.replaceChildren(); return target; };
        target.all = function () { return Array.from(items.values()); };
        return target;
    }
    UI.Toolbar = UI.createToolbar = function (options) {
        options = options || {};
        var result = collection(applyOptions(element('div', { 'class': 'chinachu-toolbar', role: 'toolbar' }), options));
        (options.items || []).forEach(result.add);
        return result;
    };
    function Navbar(options) {
        options = options || {};
        this.entity = UI.Toolbar(options);
    }
    Navbar.prototype = Object.create(ElementView.prototype);
    ['add', 'removeAll'].forEach(function (method) {
        Navbar.prototype[method] = function () { this.entity[method].apply(this.entity, arguments); return this; };
    });
    Navbar.prototype.remove = function (key) { if (arguments.length) this.entity.removeItem(key); else this.entity.remove(); return this; };
    Navbar.prototype.one = function (key) { return this.entity.one(key); };
    Navbar.prototype.all = function () { return this.entity.all(); };
    UI.Navbar = UI.Headbar = UI.Sidebar = Navbar;

    function Modal(options) {
        options = this.options = options || {};
        var self = this;
        this.entity = applyOptions(element('wa-dialog', { label: options.title || 'Chinachu', 'class': 'chinachu-dialog' }), options);
        this.content = element('div', { 'class': 'chinachu-dialog-content' });
        this.entity.appendChild(this.content);
        if (options.subtitle) append(this.content, element('p', { 'class': 'chinachu-dialog-subtitle' }).updateText(options.subtitle));
        if (options.text) append(this.content, element('p', { 'class': 'chinachu-dialog-text' }).updateText(options.text));
        if (options.html) this.content.insertAdjacentHTML('beforeend', options.html);
        append(this.content, options.content || options.element);
        this.footer = element('div', { slot: 'footer', 'class': 'chinachu-dialog-actions' });
        this.entity.appendChild(this.footer);
        this.setButtons(options.buttons || [{ label: '閉じる', onSelect: function () { self.close(); } }]);
        if (options.disableCloseButton) this.entity.classList.add('without-close-button');
        this.entity.addEventListener('wa-hide', function (event) {
            if (event.target !== self.entity) return;
            if (options.disableCloseByEsc && !self._closing) { event.preventDefault(); return; }
            self._finishClose();
        });
        this.entity.addEventListener('wa-after-hide', function (event) {
            if (event.target === self.entity && !self.entity.open) {
                self.entity.remove();
                self._cleanup.unregister();
                // A dialog opened before custom-element upgrade has no native
                // originalTrigger yet. Preserve its caller's focus as well.
                if (self._previousFocus && self._previousFocus.isConnected && !document.querySelector('wa-dialog[open]')) self._previousFocus.focus();
            }
        });
        // Light dismissal is opt-in in Web Awesome; destructive dialogs remain explicit.
        this._isOpen = false;
        this._cleanup = scopedCleanup(function () {
            self.close(); self.entity.remove(); self._cleanup.unregister();
        });
    }
    Modal.prototype.setButtons = function (buttons) {
        var self = this;
        this.footer.replaceChildren();
        this.buttons = buttons;
        buttons.forEach(function (specification) {
            var options = Object.assign({}, specification, { onSelect: function (event) {
                if (specification.onSelect) specification.onSelect.call(specification, event, self);
                else if (specification.onClick) specification.onClick.call(specification, event, self);
            } });
            specification.button = button(options);
            self.footer.appendChild(specification.button);
        });
        return this;
    };
    Modal.prototype.setTitle = function (title) { this.entity.label = title; this.entity.setAttribute('label', title); return this; };
    Modal.prototype.setContent = function (content) { this.content.replaceChildren(); append(this.content, content); return this; };
    Modal.prototype.open = Modal.prototype.show = function () {
        if (!this._cleanup.register()) return this;
        if (!this.entity.isConnected) document.body.appendChild(this.entity);
        this._previousFocus = document.activeElement;
        this._closing = false;
        this._isOpen = true;
        this.entity.open = true;
        if (this.options.onOpen) this.options.onOpen.call(this, this);
        return this;
    };
    Modal.prototype._finishClose = function () {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this.options.onClose) this.options.onClose.call(this, this);
    };
    Modal.prototype.close = function () {
        this._closing = true;
        this.entity.open = false;
        this._finishClose();
        // Closing before the first render never emits wa-after-hide. Release
        // unopened native dialogs immediately; visible dialogs finish animating.
        var dialog = this.entity.shadowRoot && this.entity.shadowRoot.querySelector('dialog');
        if (!this.entity.open && (!dialog || !dialog.open)) {
            this.entity.remove();
            this._cleanup.unregister();
        }
        return this;
    };
    UI.Modal = Modal;
    UI.createModal = function (options) { return new Modal(options); };

    UI.Alert = function (options) {
        options = options || {};
        this.entity = element('wa-callout', { variant: ({ red: 'danger', green: 'success', orange: 'warning' })[options.type] || 'neutral', 'class': 'chinachu-callout' });
        if (options.title) append(this.entity, element('strong').updateText(options.title));
        append(this.entity, element('div').updateText(options.body || options.text || ''));
        if (!options.disableClose) {
            var self = this;
            this.entity.appendChild(button({ label: '閉じる', onSelect: function () { self.remove(); } }));
        }
    };
    UI.Alert.prototype = Object.create(ElementView.prototype);
    UI.Notify = function (options) { this.options = options || {}; };
    UI.Notify.prototype.create = function (options) {
        options = Object.assign({}, this.options, options);
        var area = document.getElementById('chinachu-notifications');
        if (!area) {
            area = element('div', { id: 'chinachu-notifications', 'aria-live': 'polite', 'aria-atomic': 'false' });
            document.body.appendChild(area);
        }
        var notice = new UI.Alert({ title: options.title, body: options.message || options.text, type: options.type });
        notice.render(area);
        if (options.onClick) notice.entity.addEventListener('click', options.onClick);
        var timeout = options.timeout === undefined ? 5 : options.timeout;
        if (timeout > 0) setTimeout(function () { notice.remove(); }, timeout * 1000);
        return notice;
    };

    function ContextMenu(options) {
        this.options = options || {};
        this.target = node(this.options.target);
        this._scope = global.Chinachu && global.Chinachu.scope;
        var self = this;
        this._handler = function (event) { event.preventDefault(); self.open(event); };
        if (this.target) listen(this.target, 'contextmenu', this._handler);
    }
    ContextMenu.prototype.open = function (event) {
        if (this._scope && this._scope._disposed) return this;
        var self = this;
        if (UI.activeMenu && UI.activeMenu !== this) UI.activeMenu.close();
        this.close();
        UI.activeMenu = this;
        this._focus = document.activeElement;
        this.entity = element('div', { 'class': 'chinachu-context-menu', role: 'menu', tabindex: '-1' });
        this.entity.style.position = 'fixed';
        var entries = typeof this.options.items === 'function' ? this.options.items() : this.options.items || [];
        entries.forEach(function (item) {
            if (typeof item === 'string') { self.entity.appendChild(element('hr', { role: 'separator' })); return; }
            var choice = button(Object.assign({}, item, { onSelect: function (selectedEvent) {
                self.close();
                if (item.onSelect) item.onSelect.call(item, selectedEvent, self);
            } }));
            choice.setAttribute('role', 'menuitem');
            self.entity.appendChild(choice);
        });
        document.body.appendChild(this.entity);
        var rect = this.entity.getBoundingClientRect();
        var anchor = this.target && this.target.getBoundingClientRect();
        var x = event && event.clientX != null ? event.clientX : anchor ? anchor.left : 0;
        var y = event && event.clientY != null ? event.clientY : anchor ? anchor.bottom : 0;
        this.entity.style.left = Math.max(4, Math.min(x, innerWidth - rect.width - 4)) + 'px';
        this.entity.style.top = Math.max(4, Math.min(y, innerHeight - rect.height - 4)) + 'px';
        this._outside = function (e) { if (!e.composedPath().includes(self.entity)) self.close(); };
        this._keys = function (e) {
            if (e.key === 'Escape') { e.preventDefault(); self.close(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                var choices = Array.from(self.entity.querySelectorAll('wa-button:not([disabled])'));
                var current = choices.indexOf(document.activeElement);
                var offset = e.key === 'ArrowDown' ? 1 : -1;
                if (choices.length) choices[(current + offset + choices.length) % choices.length].focus();
            }
        };
        document.addEventListener('pointerdown', this._outside);
        document.addEventListener('keydown', this._keys);
        // Detached targets and their listeners can be collected after redraws.
        // Only an open menu has document listeners that need page cleanup.
        if (this._scope && this._scope._cleanups) {
            this._cleanup = function () { self.remove(); };
            this._scope._cleanups.push(this._cleanup);
        }
        var first = this.entity.querySelector('wa-button:not([disabled])');
        if (first) Promise.resolve(first.updateComplete).then(function () {
            if (UI.activeMenu === self && first.isConnected) first.focus();
        });
        return this;
    };
    ContextMenu.prototype.close = function () {
        if (this.entity) this.entity.remove();
        document.removeEventListener('pointerdown', this._outside);
        document.removeEventListener('keydown', this._keys);
        if (this._cleanup) {
            var index = this._scope._cleanups.indexOf(this._cleanup);
            if (index !== -1) this._scope._cleanups.splice(index, 1);
            this._cleanup = null;
        }
        if (UI.activeMenu === this) UI.activeMenu = null;
        if (this._focus && this._focus.isConnected) this._focus.focus();
        return this;
    };
    ContextMenu.prototype.remove = function () {
        this.close();
        if (this.target) {
            if (global.Chinachu && global.Chinachu.off) global.Chinachu.off(this.target, 'contextmenu', this._handler);
            else this.target.removeEventListener('contextmenu', this._handler);
        }
        return this;
    };
    UI.ContextMenu = ContextMenu;
    UI.createContextMenu = function (options) { return new ContextMenu(options); };

    function Popover(options) {
        this.options = options || {};
        this.entity = element('div', { 'class': 'chinachu-popover', popover: 'auto' });
        append(this.entity, this.options.element || this.options.content || this.options.text);
        var self = this;
        this._cleanup = scopedCleanup(function () { self.remove(); });
    }
    Popover.prototype.open = function (target) {
        if (!this._cleanup.register()) return this;
        var rect = node(target).getBoundingClientRect();
        if (!this.entity.isConnected) document.body.appendChild(this.entity);
        if (typeof this.entity.showPopover === 'function') this.entity.showPopover();
        else this.entity.hidden = false;
        var width = this.entity.offsetWidth, height = this.entity.offsetHeight;
        this.entity.style.left = Math.max(4, Math.min(rect.right + 6, innerWidth - width - 4)) + 'px';
        this.entity.style.top = Math.max(4, Math.min(rect.top, innerHeight - height - 4)) + 'px';
        return this;
    };
    Popover.prototype.close = function () { if (typeof this.entity.hidePopover === 'function') this.entity.hidePopover(); else this.entity.hidden = true; return this; };
    Popover.prototype.remove = function () { this.close(); this.entity.remove(); this._cleanup.unregister(); };
    UI.Popover = Popover;
    UI.createPopover = function (options) { return new Popover(options); };
    UI.Tooltip = function (options) { this.options = options || {}; };
    UI.Tooltip.prototype.render = function () {
        var target = node(this.options.target);
        if (target) {
            var content = element('span'); content.innerHTML = this.options.html || this.options.text || '';
            target.title = content.textContent;
        }
        return this;
    };

    UI.Checkbox = UI.createCheckbox = function (options) {
        options = options || {};
        var result = enablement(applyOptions(element('wa-checkbox', { size: 'small' }), options));
        result.textContent = options.label || '';
        result.checked = !!(options.isChecked || options.checked);
        result.check = function () { result.checked = true; return result; };
        result.uncheck = function () { result.checked = false; return result; };
        result.isChecked = function () { return !!result.checked; };
        listen(result, 'change', function (event) {
            event.targetCheckbox = result;
            if (options.onChange) options.onChange.call(result, event, result);
        });
        return result;
    };
    UI.Slider = UI.createSlider = function (options) {
        options = options || {};
        // setValue is a Web Awesome form lifecycle method. Keep Chinachu's
        // value/enablement API on a container so it cannot shadow that method.
        var result = applyOptions(element('div', { 'class': 'chinachu-slider' }), options);
        var control = element('wa-slider', { 'aria-label': options.label || (options.className === 'seek' ? '再生位置' : '音量') });
        result.appendChild(control);
        control.min = options.min || 0; control.max = options.max == null ? 100 : options.max;
        control.step = options.step || 1; control.value = options.value || 0;
        result.getValue = function () { return Number(control.value); };
        result.setValue = function (value) { control.value = Math.max(control.min, Math.min(control.max, Number(value))); return result; };
        result.enable = function () { control.disabled = false; control.removeAttribute('disabled'); return result; };
        result.disable = function () { control.disabled = true; control.setAttribute('disabled', ''); return result; };
        result.isEnabled = function () { return !control.disabled; };
        result.isDisabled = function () { return !!control.disabled; };
        control.addEventListener('change', function () { result.dispatchEvent(new CustomEvent('slide', { bubbles: true })); });
        return result;
    };
    UI.Progress = UI.createProgress = function (options) {
        options = options || {};
        var result = applyOptions(element('wa-progress-bar'), options);
        result.setValue = function (value) { result.value = options.max ? Number(value) / options.max * 100 : Number(value); return result; };
        result.getValue = function () { return result.value; };
        return result.setValue(options.value || 0);
    };
    UI.Tab = UI.createTab = function (options) {
        options = options || {};
        var result = applyOptions(element('wa-tab-group', { 'class': 'chinachu-tabs' }), options);
        var tabs = new Map();
        (options.tabs || []).forEach(function (tab, index) {
            var name = 'chinachu-tab-' + (++uid);
            tabs.set(name, tab);
            var label = element('wa-tab', { panel: name }); label.textContent = tab.label;
            var panel = element('wa-tab-panel', { name: name }); append(panel, tab.element || tab.content);
            if (index === 0) { label.active = true; panel.active = true; }
            result.append(label, panel);
        });
        listen(result, 'wa-tab-show', function (event) {
            var tab = event.detail && tabs.get(event.detail.name);
            if (tab && tab.onSelect) tab.onSelect();
        });
        return result;
    };

    UI.Tokenizer = UI.createTokenizer = function (options) {
        options = options || {};
        var result = element('div', { 'class': 'chinachu-tokenizer' });
        var tokens = element('div', { 'class': 'chinachu-token-list' });
        var input = element('wa-input', { size: 'small', placeholder: options.placeholder || '入力して Enter', 'aria-label': options.label || 'キーワード' });
        var values = [];
        result.append(tokens, input);
        function redraw() {
            tokens.replaceChildren();
            values.forEach(function (value, index) {
                var token = button({ label: value + ' ×', onSelect: function () { values.splice(index, 1); redraw(); result.dispatchEvent(new Event('change', { bubbles: true })); } });
                token.setAttribute('aria-label', value + ' を削除');
                if (input.disabled) token.disable();
                tokens.appendChild(token);
            });
        }
        function commit() {
            var value = String(input.value || '').trim();
            if (value && values.indexOf(value) === -1) values.push(value);
            input.value = ''; redraw();
        }
        input.addEventListener('keydown', function (event) { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); result.dispatchEvent(new Event('change', { bubbles: true })); } });
        input.addEventListener('blur', commit);
        result.getValues = function () { commit(); return values.slice(); };
        result.setValues = function (value) { values = Array.isArray(value) ? value.slice() : value ? [String(value)] : []; redraw(); return result; };
        result.enable = function () { input.disabled = false; redraw(); return result; };
        result.disable = function () { input.disabled = true; redraw(); return result; };
        return result.setValues(options.values || []);
    };

    function Form(options) {
        this.options = options || {};
        this.element = this.entity = element('form', { 'class': 'chinachu-form', novalidate: true });
        this.fields = [];
        this.element.addEventListener('submit', function (event) { event.preventDefault(); });
        var self = this;
        (this.options.fields || []).forEach(function (specification) { self._addField(specification); });
        this.element.addEventListener('change', function () { self._dependencies(); });
        this.element.addEventListener('input', function () { self._dependencies(); });
        this._dependencies();
    }
    Form.prototype._addField = function (specification) {
        var input = Object.assign({}, specification.input || {});
        var type = input.type || 'text';
        var wrapper = element('div', { 'class': 'chinachu-form-field' });
        var label = element('label', { 'class': 'chinachu-form-label' }); label.textContent = specification.label || '';
        var body = element('div', { 'class': 'chinachu-form-input' });
        var error = element('div', { 'class': 'chinachu-form-error', 'aria-live': 'polite' });
        var control, get, set, choices = [];
        var initial = input.val !== undefined ? input.val : input.value;
        var id = 'chinachu-field-' + (++uid);
        if (typeof type === 'object') {
            control = type.create.call(input);
            input.element = control;
            get = function () { return type.getVal.call(input); };
            set = function (value) { type.setVal.call(input, value); };
        } else if (type === 'checkboxes' || type === 'radios') {
            control = element('div', { 'class': 'chinachu-choice-group', role: type === 'radios' ? 'radiogroup' : 'group', 'aria-label': specification.label || '' });
            (input.items || []).forEach(function (item) {
                if (typeof item !== 'object') item = { label: String(item), value: item };
                var choice;
                if (type === 'checkboxes') choice = UI.Checkbox({ label: item.label });
                else {
                    // Native radios preserve keyboard navigation within a named group.
                    var choiceLabel = element('label', { 'class': 'chinachu-radio' });
                    choice = element('input', { type: 'radio', name: id });
                    choiceLabel.append(choice, document.createTextNode(item.label));
                    control.appendChild(choiceLabel);
                }
                if (type === 'checkboxes') control.appendChild(choice);
                choices.push({ control: choice, value: item.value });
            });
            get = function () {
                var selected = choices.filter(function (choice) { return choice.control.checked; }).map(function (choice) { return choice.value; });
                return type === 'radios' ? selected[0] : selected;
            };
            set = function (value) { choices.forEach(function (choice) { choice.control.checked = type === 'radios' ? choice.value === value : (value || []).indexOf(choice.value) !== -1; }); };
        } else if (type === 'checkbox') {
            control = UI.Checkbox({ label: input.label });
            get = function () { return !!control.checked; };
            set = function (value) { control.checked = !!value; };
        } else if (type === 'select' || type === 'pulldown') {
            control = element('wa-select', { size: 'small', 'with-clear': !input.isRequired });
            (input.items || []).forEach(function (item, index) {
                if (typeof item !== 'object') item = { label: String(item), value: item };
                var option = element('wa-option', { value: 'option-' + index }); option.textContent = item.label;
                control.appendChild(option); choices.push(item.value);
                if (initial === undefined && item.isSelected) initial = item.value;
            });
            get = function () { var index = Number(String(control.value || '').replace('option-', '')); return control.value ? choices[index] : undefined; };
            set = function (value) { var index = choices.indexOf(value); control.value = index >= 0 ? 'option-' + index : ''; };
        } else {
            control = element(type === 'textarea' ? 'wa-textarea' : 'wa-input', { size: 'small', type: type === 'number' ? 'number' : 'text' });
            ['min', 'max', 'step', 'maxLength', 'placeholder'].forEach(function (key) { if (input[key] != null) control[key === 'maxLength' ? 'maxlength' : key] = input[key]; });
            get = function () { var value = control.value == null ? '' : control.value; return type === 'number' ? value === '' ? undefined : Number(value) : value; };
            set = function (value) { control.value = value == null ? '' : String(value); };
        }
        control.id = id;
        label.htmlFor = id;
        control.setAttribute('aria-label', specification.label || input.label || '入力');
        if (input.style) Object.assign(control.style, input.style);
        set(initial);
        body.append(control, error);
        wrapper.append(label, body);
        this.element.appendChild(wrapper);
        this.fields.push({ specification: specification, input: input, type: type, element: wrapper, control: control, get: get, set: set, error: error, active: true });
    };
    Form.prototype._fieldValue = function (reference) {
        var field = this.fields.find(function (candidate) {
            var specification = candidate.specification;
            var path = specification.pointer || specification.point || (specification.key == null ? undefined : '/' + specification.key.replace(/~/g, '~0').replace(/\//g, '~1'));
            return reference.key !== undefined ? specification.key === reference.key : path === (reference.pointer || reference.point);
        });
        return field ? field.get() : undefined;
    };
    Form.prototype._dependencies = function () {
        var self = this;
        function match(dependency) {
            if (Array.isArray(dependency)) return dependency.some(match);
            var value = self._fieldValue(dependency);
            if (dependency.op === '!==' || dependency.op === '!=') return value !== dependency.val;
            if (dependency.op === '>') return value > dependency.val;
            if (dependency.op === '<') return value < dependency.val;
            return value === dependency.val;
        }
        this.fields.forEach(function (field) {
            field.active = (field.specification.depends || []).every(match);
            field.element.hidden = !field.active;
        });
    };
    Form.prototype.getResult = Form.prototype.result = function () {
        this._dependencies();
        var result = {};
        this.fields.forEach(function (field) {
            if (!field.active) return;
            var specification = field.specification;
            var path = specification.pointer || specification.point;
            var keys = path ? path.replace(/^\//, '').split('/').map(function (part) { return part.replace(/~1/g, '/').replace(/~0/g, '~'); }) : [specification.key];
            if (!keys[0] || keys.some(function (key) { return ['__proto__', 'constructor', 'prototype'].includes(key); })) return;
            var target = result;
            keys.slice(0, -1).forEach(function (key) { if (!target[key]) target[key] = {}; target = target[key]; });
            target[keys[keys.length - 1]] = field.get();
        });
        return result;
    };
    Form.prototype.validate = function (callback) {
        this._dependencies();
        var valid = true;
        this.fields.forEach(function (field) {
            field.error.textContent = '';
            if (!field.active) return;
            var value = field.get(), error = '';
            if (field.input.isRequired && (value === undefined || value === '' || value === false || Array.isArray(value) && !value.length)) error = '入力してください';
            if (field.type === 'number' && value !== undefined) {
                if (!Number.isFinite(value)) error = '数値を入力してください';
                else if (field.input.min != null && value < field.input.min) error = field.input.min + ' 以上で入力してください';
                else if (field.input.max != null && value > field.input.max) error = field.input.max + ' 以下で入力してください';
            }
            field.error.textContent = error;
            field.control.setAttribute('aria-invalid', error ? 'true' : 'false');
            if (error) valid = false;
        });
        if (callback) callback(valid);
        return valid;
    };
    Form.prototype.insertTo = Form.prototype.render = function (target) { node(target).appendChild(this.element); return this; };
    UI.Form = Form;
    UI.createForm = function (options) { return new Form(options); };
})(window);
