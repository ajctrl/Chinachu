P = Class.create(P, {
	init: function() {
		this.activeTab = 'form';
		this.closed = false;
		this.view.toolbar.add({ key: 'save', ui: new sakura.ui.Button({
			label: 'サーバー設定を保存', icon: './icons/disk.png', onClick: this.save.bind(this)
		}).disable() });
		var editorToggle = new sakura.ui.Button({
			label: 'JSON編集',
			attr: { role: 'button', tabindex: '0', 'aria-controls': 'config-panel-form config-panel-json' },
			onClick: function() { this.selectTab(this.activeTab === 'form' ? 'json' : 'form'); }.bind(this)
		}).disable();
		editorToggle.entity.addEventListener('keydown', function(event) {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				if (editorToggle.isEnabled()) editorToggle.onClick();
			}
		});
		this.view.toolbar.add({ key: 'editor-toggle', ui: editorToggle });
		this.draw();
		this.load();
		return this;
	},
	deinit: function() {
		this.closed = true;
		if (this.descriptionSwitch) this.descriptionSwitch.destroy();
		if (this.data.editor) this.data.editor.destroy();
		return this;
	},
	node: function(tag, parent, text, className) {
		var node = document.createElement(tag);
		if (text !== undefined) node.textContent = text;
		if (className) node.className = className;
		if (parent) parent.appendChild(node);
		return node;
	},
	draw: function() {
		this.view.content.className = 'config-settings';
		this.view.content.update();
		this.status = this.node('div', this.view.content, '設定を読み込んでいます…', 'config-status');
		this.status.setAttribute('role', 'status');
		this.formPanel = this.node('div', this.view.content, undefined, 'config-form');
		this.jsonPanel = this.node('div', this.view.content, undefined, 'config-json');
		[this.formPanel, this.jsonPanel].forEach(function(panel, index) {
			panel.id = 'config-panel-' + (index ? 'json' : 'form');
			panel.setAttribute('role', 'region');
			panel.setAttribute('aria-label', index ? 'JSON編集' : '設定フォーム');
		});
		this.jsonPanel.hidden = true;
		this.node('p', this.jsonPanel, 'フォーム対象外の設定も編集できます。サーバー設定は保存後にサービスの再起動が必要です（共通除外ルールは次回の予約計画から反映）。');
		this.editorElement = this.node('div', this.jsonPanel, undefined, 'config-json-editor');
		this.node('p', this.formPanel, '表示設定はこのブラウザに即時保存します。');
		this.addDisplaySettings(this.formPanel);
	},
	addDisplaySettings: function(parent) {
		if (this.descriptionSwitch) this.descriptionSwitch.destroy();
		var group = this.node('section', parent, undefined, 'config-group');
		this.node('h2', group, '表示');
		this.descriptionSwitch = ChinachuPreferences.createSwitch();
		group.appendChild(this.descriptionSwitch.element);
		this.node('p', group, '予約済みのタイトルの下に番組説明を最大3行表示します。全文は行をクリックして確認できます。このブラウザにのみ適用・再起動不要。', 'config-help');
	},
	load: function() {
		new Ajax.Request('./api/config.json', {
			method: 'get',
			onSuccess: function(t) {
				if (this.closed) return;
				try {
					this.data.original = null;
					this.data.revision = (t.getHeader('ETag') || '').replace(/"/g, '');
					this.data.editor = ace.edit(this.editorElement);
					this.data.editor.setTheme('ace/theme/github');
					this.data.editor.setShowPrintMargin(false);
					this.data.editor.getSession().setMode('ace/mode/json');
					this.data.editor.getSession().setTabSize(2);
					this.data.editor.setValue(t.responseText, -1);
					this.view.toolbar.one('save').enable();
					this.view.toolbar.one('editor-toggle').enable();
					if (!this.readJson()) {
						this.selectTab('json');
						return;
					}
					this.data.original = JSON.parse(t.responseText);
					this.renderForm();
					this.message('サーバー設定は config.json に保存します。「再起動が必要」の項目は保存だけでは反映されません。');
				} catch (error) { this.message('設定を読み込めませんでした。' + error.message, true); }
			}.bind(this),
			onFailure: function(t) { if (!this.closed) this.message('設定を読み込めませんでした（HTTP ' + t.status + '）。', true); }.bind(this)
		});
	},
	message: function(text, error) {
		this.status.textContent = text;
		this.status.className = 'config-status' + (error ? ' config-error' : '');
	},
	renderForm: function() {
		this.formPanel.textContent = '';
		this.addDisplaySettings(this.formPanel);
		this.node('p', this.formPanel, '以下はサーバーの設定です。未設定の項目は、操作しない限り追加しません。その他の項目はJSON編集で変更できます。');
		this.inputs = {};
		var groups = {};
		ChinachuConfig.fields.forEach(function(field) {
			if (!groups[field.group]) {
				groups[field.group] = this.node('section', this.formPanel, undefined, 'config-group');
				this.node('h2', groups[field.group], field.group);
			}
			var row = this.node('div', groups[field.group], undefined, 'config-field');
			var id = 'setting-' + field.key.replace(/\./g, '-');
			var label = this.node('label', row, field.label);
			label.htmlFor = id;
			this.node('span', label, '再起動が必要', 'config-restart');
			var value = ChinachuConfig.get(this.data.config, field.key);
			var input = this.node(field.type === 'select' ? 'select' : /^(strings|numbers)$/.test(field.type) ? 'textarea' : 'input', row);
			input.id = id;
			input.setAttribute('aria-describedby', id + '-help ' + id + '-error');
			if (field.type === 'boolean') {
				input.type = 'checkbox';
				input.setAttribute('role', 'switch');
				input.checked = value === true;
			} else if (field.type === 'select') {
				this.node('option', input, '未設定（標準動作）').value = '';
				field.choices.forEach(function(choice) { this.node('option', input, choice[1]).value = choice[0]; }, this);
				if (value !== undefined && !field.choices.some(function(choice) { return choice[0] === value; })) this.node('option', input, '入力値を確認: ' + value).value = String(value);
				input.value = value === undefined ? '' : String(value);
			} else {
				// Text input keeps malformed numbers visible so validation never silently clears them.
				if (input.tagName === 'INPUT') input.type = field.secret ? 'password' : 'text';
				if (field.secret) input.autocomplete = 'new-password';
				if (field.type === 'number') input.inputMode = 'numeric';
				input.value = value === undefined || value === null ? '' : Array.isArray(value) ? value.join('\n') : String(value);
			}
			var help = this.node('p', row, field.description + (value === undefined ? '（現在は未設定）' : ''), 'config-help');
			help.id = id + '-help';
			var error = this.node('p', row, '', 'config-field-error');
			error.id = id + '-error';
			this.inputs[field.key] = { input: input, error: error };
			input.addEventListener(field.type === 'boolean' || field.type === 'select' ? 'change' : 'input', function() {
				ChinachuConfig.set(this.data.config, field.key, ChinachuConfig.parse(field, field.type === 'boolean' ? input.checked : input.value));
				this.formEdited = true;
				error.textContent = '';
				input.removeAttribute('aria-invalid');
				this.message('サーバー設定に未保存の変更があります。');
			}.bind(this));
		}, this);
	},
	readJson: function() {
		try {
			var config = JSON.parse(this.data.editor.getValue());
			if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('設定全体はJSONオブジェクトにしてください。');
			this.data.config = config;
			return true;
		} catch (error) {
			this.message('JSONを確認してください。' + error.message, true);
			return false;
		}
	},
	selectTab: function(tab) {
		if (!this.data.editor || this.saving || tab === this.activeTab) return;
		if (tab === 'form') {
			if (!this.readJson()) return;
			this.renderForm();
		} else if (this.formEdited) {
			this.data.editor.setValue(JSON.stringify(this.data.config, null, '  '), -1);
			this.formEdited = false;
		}
		this.activeTab = tab;
		this.formPanel.hidden = tab !== 'form';
		this.jsonPanel.hidden = tab !== 'json';
		var toggle = this.view.toolbar.one('editor-toggle');
		toggle.label = tab === 'json' ? '設定フォームに戻る' : 'JSON編集';
		toggle.entity.textContent = toggle.label;
		if (tab === 'json') this.data.editor.resize();
	},
	showErrors: function(errors) {
		var inputs = this.inputs || {};
		Object.keys(inputs).forEach(function(key) {
			inputs[key].error.textContent = '';
			inputs[key].input.removeAttribute('aria-invalid');
		}, this);
		errors.forEach(function(error) {
			if (inputs[error.key]) {
				inputs[error.key].error.textContent = error.message;
				inputs[error.key].input.setAttribute('aria-invalid', 'true');
			}
		}, this);
		if (errors.length) {
			this.message(errors.map(function(error) { return error.message; }).join('\n'), true);
			if (this.activeTab === 'form' && inputs[errors[0].key]) inputs[errors[0].key].input.focus();
		}
	},
	save: function() {
		if (!this.data.editor || this.saving) return;
		if (this.activeTab === 'json' && !this.readJson()) return;
		var errors = ChinachuConfig.validate(this.data.config);
		this.showErrors(errors);
		if (errors.length) return;
		var changed = this.data.original === null ? ['設定ファイルの修復'] : ChinachuConfig.changes(this.data.original, this.data.config);
		if (!changed.length) { this.message('サーバー設定に変更はありません。' + (this.restartPending ? '保存済みの変更を反映するにはサービスの再起動が必要です。' : '')); return; }
		var restart = changed.filter(function(key) { return key !== 'autoExclusionRules'; });
		var labels = changed.map(function(key) {
			var field = ChinachuConfig.fields.filter(function(f) { return f.key === key; })[0];
			return field ? field.label : key === 'operGotifyFormat' ? '通知メッセージ' : key;
		});
		var text = this.activeTab === 'json' ? this.data.editor.getValue() : JSON.stringify(this.data.config, null, '  ');
		var page = this;
		flagrate.createModal({
			title: 'サーバー設定の保存',
			text: '変更項目: ' + labels.join('、') + '\n' + (restart.length ? '保存後、変更を反映するにはサービスの再起動が必要です。' : '共通除外ルールは次回の予約計画から反映されます。') + '\n直前の設定を config.json.bak にバックアップします。',
			buttons: [
				{ label: '保存', color: '@orange', onSelect: function(e, modal) {
					modal.close();
					page.persist(text, restart.length > 0);
				} },
				{ label: 'キャンセル', onSelect: function(e, modal) { modal.close(); } }
			]
		}).open();
	},
	persist: function(text, restart) {
		if (this.saving || this.closed) return;
		this.saving = true;
		this.formPanel.inert = true;
		this.data.editor.setReadOnly(true);
		this.view.toolbar.one('save').disable();
		this.view.toolbar.one('editor-toggle').disable();
		this.message('設定を保存しています…');
		new Ajax.Request('./api/config.json', {
			method: 'put', parameters: { json: text, revision: this.data.revision },
			onSuccess: function(t) {
				if (this.closed) return;
				this.data.original = JSON.parse(text);
				this.data.config = JSON.parse(text);
				this.data.revision = (t.getHeader('ETag') || '').replace(/"/g, '');
				this.data.editor.setValue(text, -1);
				this.formEdited = false;
				this.restartPending = this.restartPending || restart;
				this.renderForm();
				this.message('設定を保存しました。直前の設定: config.json.bak。' + (this.restartPending ? '変更はまだ反映されていません。サービスを再起動してください。' : '共通除外ルールは次回の予約計画から反映されます。'));
			}.bind(this),
			onFailure: function(t) {
				if (this.closed) return;
				var result = t.responseJSON || {};
				this.showErrors(result.errors || []);
				this.message((result.message || '保存に失敗しました（HTTP ' + t.status + '）。') + (result.errors && result.errors.length ? '\n' + result.errors.map(function(error) { return error.message; }).join('\n') : '') + '\n編集中の内容はこの画面に残しています。', true);
			}.bind(this),
			onComplete: function() {
				if (this.closed) return;
				this.saving = false;
				this.formPanel.inert = false;
				this.data.editor.setReadOnly(false);
				this.view.toolbar.one('save').enable();
				this.view.toolbar.one('editor-toggle').enable();
			}.bind(this)
		});
	}
});
