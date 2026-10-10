Chinachu.definePage({
	init: function() {
		this.activeTab = 'form';
		this.closed = false;
		this.pendingPasswords = Object.create(null);
		this.view.toolbar.add({ key: 'save', ui: new ChinachuUI.ActionButton({
			label: 'サーバー設定を保存', icon: './icons/disk.png', onClick: this.save.bind(this)
		}).disable() });
		var editorToggle = new ChinachuUI.ActionButton({
			label: 'JSON編集',
			attr: { 'aria-controls': 'config-panel-form config-panel-json' },
			onClick: function() { this.selectTab(this.activeTab === 'form' ? 'json' : 'form'); }.bind(this)
		}).disable();

		this.view.toolbar.add({ key: 'editor-toggle', ui: editorToggle });
		this.draw();
		this.load();
		return this;
	},
	deinit: function() {
		this.closed = true;
		if (this.descriptionSwitches) this.descriptionSwitches.forEach(function(control) { control.destroy(); });
		if (this.descriptionFontSizeSelect) this.descriptionFontSizeSelect.destroy();
		if (this.clickActionSelect) this.clickActionSelect.destroy();
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
		this.node('p', this.jsonPanel, 'フォーム対象外の設定も編集できます。サーバー設定は保存後にサービスの再起動が必要です。共通除外ルールは「ルール」画面から編集できます。');
		this.editorElement = this.node('div', this.jsonPanel, undefined, 'config-json-editor');
		this.node('p', this.formPanel, '表示設定はこのブラウザに即時保存します。');
		this.addDisplaySettings(this.formPanel);
	},
	addDisplaySettings: function(parent) {
		if (this.descriptionSwitches) this.descriptionSwitches.forEach(function(control) { control.destroy(); });
		if (this.descriptionFontSizeSelect) this.descriptionFontSizeSelect.destroy();
		if (this.clickActionSelect) this.clickActionSelect.destroy();
		var group = this.node('section', parent, undefined, 'config-group');
		this.node('h2', group, '表示');
		this.descriptionSwitches = [
			['reserves', '予約済み'], ['recording', '録画中'], ['recorded', '録画済み'],
			['search', '番組検索'], ['recorded.search', '録画番組検索']
		].map(function(choice) {
			var control = ChinachuPreferences.createSwitch(null, choice[0], choice[1] + 'の番組説明を表示');
			group.appendChild(control.element);
			return control;
		});
		this.node('p', group, '番組説明の表示はタブごとに設定できます。タイトルの下に最大2行表示します。全文は番組詳細で確認できます。このブラウザにのみ適用・再起動不要。', 'config-help');
		this.descriptionFontSizeSelect = ChinachuPreferences.createDescriptionFontSizeSelect();
		group.appendChild(this.descriptionFontSizeSelect.element);
		this.node('p', group, '番組説明の文字サイズは各タブ共通です。標準は12pxです。このブラウザにのみ適用・即時保存・再起動不要。', 'config-help');
		this.clickActionSelect = ChinachuPreferences.createClickActionSelect();
		group.appendChild(this.clickActionSelect.element);
		this.node('p', group, 'スキップ優先時は行を左クリックすると確認なしでスキップ／解除します。「詳細」ボタンから番組詳細を開けます。手動予約の行は詳細を開きます。このブラウザにのみ適用・即時保存。', 'config-help');
	},
	load: function() {
		Chinachu.request('./api/config.json', {
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
			if (field.type === 'users') {
				this.renderUsers(row, field, id, value || []);
				return;
			}
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
	renderUsers: function(row, field, id, users) {
		if (!this.pendingPasswords) this.pendingPasswords = Object.create(null);
		var group = this.node('div', row);
		group.id = id;
		group.tabIndex = -1;
		group.setAttribute('role', 'group');
		group.setAttribute('aria-label', field.label);
		group.setAttribute('aria-describedby', id + '-help ' + id + '-error');
		var help = this.node('p', row, field.description + ' ユーザーの追加・初回設定はサーバー上のパスワード設定コマンドで行います。', 'config-help');
		help.id = id + '-help';
		var error = this.node('p', row, '', 'config-field-error');
		error.id = id + '-error';
		this.inputs[field.key] = { input: group, error: error };
		var errors = ChinachuConfig.validate({ wuiUsers: users });
		if (errors.length) { error.textContent = errors[0].message; return; }
		if (!users.length) this.node('p', group, 'Web認証は無効です。');
		users.forEach(function(user, index) {
			var label = this.node('label', group, user.username + (user.passwordSet ? '（設定済み）' : '（未設定）'));
			var input = this.node('input', group);
			input.id = id + '-password-' + index;
			label.htmlFor = input.id;
			input.type = 'password';
			input.autocomplete = 'new-password';
			input.placeholder = '変更する場合だけ入力（12文字以上）';
			input.setAttribute('aria-describedby', help.id + ' ' + error.id);
			input.value = this.pendingPasswords[user.username] || '';
			input.addEventListener('input', function() {
				if (input.value) this.pendingPasswords[user.username] = input.value;
				else delete this.pendingPasswords[user.username];
				error.textContent = '';
				this.message('サーバー設定に未保存の変更があります。');
			}.bind(this));
		}, this);
	},
	readJson: function(clearPasswords) {
		try {
			var config = JSON.parse(this.data.editor.getValue());
			if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('設定全体はJSONオブジェクトにしてください。');
			var pending = Object.create(null), consumed = false;
			if (Array.isArray(config.wuiUsers)) config.wuiUsers.forEach(function(user) {
				if (!user || typeof user.username !== 'string') return;
				if (Object.prototype.hasOwnProperty.call(user, 'password')) {
					// Explicit JSON input wins, including an empty string cancelling a form edit.
					if (typeof user.password !== 'string') return;
					if (user.password) pending[user.username] = user.password;
					delete user.password;
					consumed = true;
				} else if (this.pendingPasswords && this.pendingPasswords[user.username]) {
					pending[user.username] = this.pendingPasswords[user.username];
				}
			}, this);
			this.pendingPasswords = pending;
			this.data.config = config;
			// Do not restore an old JSON password after the user edits or clears it in the form.
			if (clearPasswords && consumed) this.data.editor.setValue(JSON.stringify(config, null, '  '), -1);
			return true;
		} catch (error) {
			this.message('JSONを確認してください。' + error.message, true);
			return false;
		}
	},
	selectTab: function(tab) {
		if (!this.data.editor || this.saving || tab === this.activeTab) return;
		if (tab === 'form') {
			if (!this.readJson(true)) return;
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
		var passwordChanged = (this.data.config.wuiUsers || []).some(function(user) { return !!(this.pendingPasswords && this.pendingPasswords[user.username]); }, this);
		if (passwordChanged && changed.indexOf('wuiUsers') === -1) changed.push('wuiUsers');
		if (!changed.length) { this.message('サーバー設定に変更はありません。' + (this.restartPending ? '保存済みの変更を反映するにはサービスの再起動が必要です。' : '')); return; }
		var labels = changed.map(function(key) {
			var field = ChinachuConfig.fields.filter(function(f) { return f.key === key; })[0];
			return field ? field.label : key === 'operGotifyFormat' ? '通知メッセージ' : key;
		});
		var text = this.activeTab === 'json' ? this.data.editor.getValue() : JSON.stringify(this.data.config, null, '  ');
		if (passwordChanged) {
			var outgoing = JSON.parse(text);
			outgoing.wuiUsers.forEach(function(user) {
				if (this.pendingPasswords[user.username]) user.password = this.pendingPasswords[user.username];
			}, this);
			text = JSON.stringify(outgoing, null, '  ');
		}
		var page = this;
		var disablesAuth = this.data.original && this.data.original.wuiUsers && this.data.original.wuiUsers.length &&
			Array.isArray(this.data.config.wuiUsers) && !this.data.config.wuiUsers.length;
		ChinachuUI.createModal({
			title: 'サーバー設定の保存',
			text: '変更項目: ' + labels.join('、') + (disablesAuth ? '\nWeb認証を無効にします。公開する場合はプロキシ側の認証が必要です。' : '') + '\n保存後、変更を反映するにはサービスの再起動が必要です。\n直前の設定を config.json.bak にバックアップします。',
			buttons: [
				{ label: '保存', color: '@orange', onSelect: function(e, modal) {
					modal.close();
					page.persist(text, true);
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
		Chinachu.request('./api/config.json', {
			method: 'put', parameters: { json: text, revision: this.data.revision },
			onSuccess: function(t) {
				if (this.closed) return;
				this.data.original = JSON.parse(t.responseText);
				this.data.config = JSON.parse(t.responseText);
				this.pendingPasswords = Object.create(null);
				this.data.revision = (t.getHeader('ETag') || '').replace(/"/g, '');
				this.data.editor.setValue(t.responseText, -1);
				this.formEdited = false;
				this.restartPending = this.restartPending || restart;
				this.renderForm();
				this.message('設定を保存しました。直前の設定: config.json.bak。' + (this.restartPending ? '変更はまだ反映されていません。サービスを再起動してください。' : ''));
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
