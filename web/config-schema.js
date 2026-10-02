/* Shared by the settings form and the server. Unknown config keys are preserved. */
(function(root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.ChinachuConfig = factory();
})(typeof window === 'undefined' ? this : window, function() {
	'use strict';
	var fields = [];
	function field(group, key, label, type, description, options) {
		fields.push(Object.assign({ group: group, key: key, label: label, type: type, description: description, restart: true }, options || {}));
	}
	var recording = '録画・保存', notification = '通知', connection = '接続・詳細設定';
	field(recording, 'recordedDir', '録画の保存先', 'string', '録画ファイルの保存先。末尾に / を付けてください。', { nonempty: true, directory: true });
	field(recording, 'recordedFormat', '録画ファイル名', 'string', '<title> や <date:yymmdd-HHMM> などを使えます。', { nonempty: true });
	field(recording, 'storageLowSpaceThresholdMB', '空き容量の下限（MB）', 'number', 'この容量を下回ると、下の動作を実行します。省略時は 3000 MB。', { min: 1 });
	field(recording, 'storageLowSpaceAction', '空き容量不足時の動作', 'select', '「古い録画を削除」は録画済みファイルを削除します。省略時も削除です。', { choices: [['none', '何もしない'], ['stop', '録画を停止'], ['remove', '古い録画を削除']] });
	field(recording, 'storageLowSpaceCommand', '空き容量不足時のコマンド', 'string', '必要な場合のみ実行するコマンドを指定します。');
	field(recording, 'vaapiEnabled', 'VA-APIを使用', 'boolean', '配信時のハードウェアエンコードを有効にします。');
	field(recording, 'vaapiDevice', 'VA-APIデバイス', 'string', '例: /dev/dri/renderD128');
	field(notification, 'storageLowSpaceNotifyTo', '空き容量不足の通知先', 'string', '通知先メールアドレス。空欄なら通知しません。', { nullable: true });
	field(notification, 'operGotify', 'Gotify通知', 'boolean', '録画開始・終了の通知をGotifyへ送ります。');
	field(notification, 'operGotifyUrl', 'Gotify URL', 'string', 'Gotifyサーバーの http:// または https:// URL。', { url: true });
	field(notification, 'operGotifyToken', 'Gotifyアプリトークン', 'string', 'Gotifyのアプリケーショントークン。', { nullable: true, secret: true });
	field(notification, 'operGotifyTitle', '通知タイトル', 'string', '省略時は Chinachu。');
	field(notification, 'operGotifyPriority', '通知の優先度', 'number', 'Gotifyに渡す整数の優先度。省略時は 5。');
	field(notification, 'operGotifyTimeout', '通知タイムアウト（ミリ秒）', 'number', '通知の待ち時間。省略時は 10000 ミリ秒。', { min: 1 });
	field(notification, 'operGotifyFormat.start', '録画開始メッセージ', 'string', '<title>、<channelname>、<starttime>、<endtime> を使えます。空欄なら開始通知なし。');
	field(notification, 'operGotifyFormat.end', '録画終了メッセージ', 'string', '録画終了時の文面。空欄なら終了通知なし。');
	field(connection, 'mirakurunPath', 'Mirakurun接続先', 'string', 'http:// または http+unix:// で指定します。旧形式 http://unix:ソケットパス: にも対応します。', { mirakurun: true });
	field(connection, 'uid', '実行ユーザー', 'identity', 'ユーザー名または数値ID。空欄は null。', { nullable: true });
	field(connection, 'gid', '実行グループ', 'identity', 'グループ名または数値ID。空欄は null。', { nullable: true });
	field(connection, 'excludeServices', '除外するサービスID', 'numbers', 'カンマまたは改行で区切ったサービスID。');
	field(connection, 'serviceOrder', 'サービスの表示順', 'numbers', '優先して表示する順にサービスIDを指定します。');
	field(connection, 'wuiUsers', 'Web認証ユーザー', 'strings', '1行に ユーザー名:パスワード を入力。空欄は認証なし。', { credentials: true });
	field(connection, 'wuiAllowCountries', 'アクセスを許可する国', 'strings', 'JP などの2文字の国コードを1行ずつ指定。空欄は国による制限なし。', { countries: true });
	field(connection, 'wuiPort', 'Web待受ポート', 'number', '1〜65535。空欄なら通常のWeb待受を無効にします。', { nullable: true, min: 1, max: 65535 });
	field(connection, 'wuiHost', 'Web待受アドレス', 'string', '例: 0.0.0.0、127.0.0.1');
	field(connection, 'wuiOpenServer', '認証なしサーバー', 'boolean', '認証なしのWeb待受を有効にします。');
	field(connection, 'wuiOpenPort', '認証なしサーバーのポート', 'number', '1〜65535。省略時は 20772。', { min: 1, max: 65535 });
	field(connection, 'wuiOpenHost', '認証なしサーバーのアドレス', 'string', '省略時はサーバーのネットワークアドレスを自動選択します。');
	field(connection, 'wuiXFF', '転送元IPヘッダーを使用', 'boolean', '信頼できるリバースプロキシ経由の場合に使用します。');
	field(connection, 'wuiMdnsAdvertisement', 'mDNSで公開', 'boolean', 'ネットワーク内へWebサービスを通知します。');
	['Key', 'Cert', 'Ca'].forEach(function(name) {
		field(connection, 'wuiTls' + name + 'Path', { Key: 'TLS秘密鍵', Cert: 'TLS証明書', Ca: 'TLS CA証明書' }[name], 'string', '証明書ファイルのパス。空欄は null。', { nullable: true });
	});
	field(connection, 'wuiTlsRequestCert', 'クライアント証明書を要求', 'boolean', 'TLS接続時にクライアント証明書を要求します。');
	field(connection, 'wuiTlsRejectUnauthorized', '未認証のTLS接続を拒否', 'boolean', '信頼できないクライアント証明書の接続を拒否します。');

	function get(config, key) {
		return key.split('.').reduce(function(value, part) { return value && typeof value === 'object' ? value[part] : undefined; }, config);
	}
	function set(config, key, value) {
		var parts = key.split('.'), target = config;
		parts.slice(0, -1).forEach(function(part) {
			if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
			target = target[part];
		});
		if (typeof value === 'undefined') delete target[parts[parts.length - 1]];
		else target[parts[parts.length - 1]] = value;
	}
	function parse(field, value) {
		if (field.type === 'boolean') return value;
		if (value === '' && field.nullable) return null;
		if (value === '' && (field.type === 'number' || field.type === 'select' || field.mirakurun)) return undefined;
		if (field.type === 'number') return value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
		if (field.type === 'identity') return /^\d+$/.test(value) ? Number(value) : value;
		if (field.type === 'numbers') return value.trim() ? value.trim().split(/[\s,]+/).map(Number) : [];
		if (field.type === 'strings') return value.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
		return value;
	}
	function validMirakurunEndpoint(value) {
		// Match the Unix socket forms handled by configureMirakurunClient.
		var socket = value.match(/^http\+unix:\/\/([^/]+)(\/?.*)$/i) || value.match(/^http:\/\/unix:([^:]+):?(.*)$/i);
		if (socket) {
			decodeURIComponent(socket[1]);
			return true;
		}
		var url = new URL(value);
		return !!url.hostname && url.protocol === 'http:';
	}
	function validate(config) {
		var errors = [];
		function error(key, message) { errors.push({ key: key, message: message }); }
		if (!config || typeof config !== 'object' || Array.isArray(config)) return [{ key: '', message: '設定全体はJSONオブジェクトにしてください。' }];
		fields.forEach(function(f) {
			var value = get(config, f.key), valid = true;
			if (typeof value === 'undefined' || (value === null && f.nullable)) return;
			if (f.type === 'boolean') valid = typeof value === 'boolean';
			if (f.type === 'number') valid = Number.isSafeInteger(value) && (f.min === undefined || value >= f.min) && (f.max === undefined || value <= f.max);
			if (f.type === 'string') valid = typeof value === 'string' && (!f.nonempty || value.trim().length > 0);
			if (f.type === 'identity') valid = (typeof value === 'string' && value.trim().length > 0) || (Number.isSafeInteger(value) && value >= 0);
			if (f.type === 'select') valid = f.choices.some(function(choice) { return choice[0] === value; });
			if (f.type === 'numbers') valid = Array.isArray(value) && value.every(function(n) { return Number.isSafeInteger(n) && n >= 0; });
			if (f.type === 'strings') valid = Array.isArray(value) && value.every(function(s) { return typeof s === 'string' && (!f.credentials || /^[^:]+:.+$/.test(s)) && (!f.countries || /^[A-Z]{2}$/.test(s)); });
			if (valid && f.directory) valid = /\/$/.test(value);
			if (valid && (f.url || f.mirakurun)) {
				try {
					if (f.mirakurun) valid = validMirakurunEndpoint(value);
					else { var url = new URL(value); valid = !!url.hostname && ['http:', 'https:'].indexOf(url.protocol) !== -1; }
				} catch (e) { valid = false; }
			}
			if (!valid) error(f.key, f.label + 'の値を確認してください。' + f.description);
		});
		if (config.operGotifyFormat !== undefined && (!config.operGotifyFormat || typeof config.operGotifyFormat !== 'object' || Array.isArray(config.operGotifyFormat))) error('operGotifyFormat', '通知メッセージはJSONオブジェクトにしてください。');
		if (config.operGotify) {
			['operGotifyUrl', 'operGotifyToken', 'operGotifyFormat'].forEach(function(key) { if (!config[key]) error(key, 'Gotify通知を有効にするには ' + key + ' が必要です。'); });
		}
		if (!!config.wuiTlsKeyPath !== !!config.wuiTlsCertPath) error('wuiTlsKeyPath', 'TLS秘密鍵とTLS証明書は両方指定してください。');
		return errors;
	}
	function changes(before, after) {
		return Object.keys(Object.assign({}, before, after)).filter(function(key) { return JSON.stringify(before[key]) !== JSON.stringify(after[key]); });
	}
	return { fields: fields, get: get, set: set, parse: parse, validate: validate, changes: changes };
});
