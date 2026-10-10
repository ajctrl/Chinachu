# Web UIの公開方法

ChinachuのWebサーバーは `127.0.0.1` または `::1` だけで待ち受けます。
LAN・インターネットから利用するときは、同じホストのリバースプロキシでHTTPSと認証を適用してください。
別ホスト・別ネットワーク名前空間のプロキシは、そのままではループバックへ接続できません。

## Chinachuの設定

既存の `config.json` に次の値を設定します。以下は関連部分だけの例です。
公開するホスト名・ポートに合わせて `wuiAllowedOrigins` を変更してください。
`wuiUsers` はパスワード設定コマンドが生成した値を維持します。

```json
{
  "wuiPort": 20772,
  "wuiHost": "127.0.0.1",
  "wuiAllowedOrigins": ["https://chinachu.example.com"],
  "wuiXFF": true,
  "wuiTlsKeyPath": null,
  "wuiTlsCertPath": null
}
```

TLSはプロキシで終端し、ChinachuのBasic認証を通す構成です。
初回は `npm run password -- chinachu` で固有のパスワードを設定します。
旧平文設定は `npm run password -- --migrate` で移行できます。保存後はWUIを再起動してください。
詳しい設定・移行方法は [Web認証の説明](authentication.md) を参照してください。
プロキシ側の認証だけを使う場合は `wuiUsers` を空にできますが、UI・API・Socket.IOの全経路を
プロキシの認証対象にする必要があります。ローカルの他のプロセスからはバックエンドへ直接接続できます。

`wuiAllowedOrigins` はURLのスキーム・ホスト・ポートを登録します。パス、ワイルドカード、
資格情報は使用できません。例えば443以外なら `https://chinachu.example.com:8443` とします。
ブラウザーからのHostと、存在する場合のOriginを検証するため、公開URLの登録がないと403になります。
ローカルの `http://127.0.0.1:20772` と `http://localhost:20772` は利用できます。

## Nginxの例

証明書を用意した既存のNginxの `http` 内に配置する例です。
ドメイン、証明書パス、待受ポートは環境に合わせて変更してください。

```nginx
map $http_upgrade $chinachu_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name chinachu.example.com;

    ssl_certificate     /etc/letsencrypt/live/chinachu.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chinachu.example.com/privkey.pem;

    client_max_body_size 1m;
    client_body_timeout 15s;
    client_header_timeout 10s;

    location / {
        proxy_pass http://127.0.0.1:20772;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $chinachu_connection_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Authorization、Origin、`X-Requested-With`、`Sec-Fetch-*` をそのまま転送します。
プロキシ側で `X-Requested-With` やOriginを付け足すとCSRF検証を損なうため、付け足さないでください。
CORSを追加して任意の外部サイトへAPIを開放することも避けてください。
`X-Forwarded-For` は受信値を連結せず、クライアントの接続元で上書きします。
`wuiXFF` が有効でも、Chinachuはループバック接続の場合だけこの値を採用します。
認証の試行制限では単一の有効なIPだけを使います。`wuiXFF` が無効だと、プロキシ経由の接続はプロキシのIPとして同じ制限を共有します。

WebSocketの転送は[Nginxの公式手順](https://nginx.org/en/docs/http/websocket.html)に従っています。
配信データを逐次返すため、[応答バッファリング](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)を無効にしています。
本文の制限は[Nginxのclient_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)も使います。
この例は後述のローカル統合テストで構文と転送動作を確認しています。
実環境の証明書の準備・構文確認・Nginxへの適用は、それぞれの実環境で行ってください。

## ローカル統合テスト

LinuxでNginx、OpenSSL、FFmpeg、ffprobeをPATHに用意し、npm依存をインストールした状態で実行します。

```sh
npm run test:proxy
```

NginxがPATHにない場合は `NGINX_BIN=/path/to/nginx npm run test:proxy` とします。
ローカルのTCP待受と子プロセスの起動を許可した環境が必要です。
テストは一時ディレクトリに設定・認証情報・動画・証明書を生成し、実際の `app-wui.js` と
このページのNginx設定例をループバックの一時ポートで起動します。
実設定・録画データには触れず、終了時にテスト用サーバーと一時データを片付けます。
約20秒で完了し、通常の `npm test` とは別に実行します。

2026-10-09にNode.js 24.21.0、Nginx 1.24.0、FFmpeg 6.1.1で19項目が成功しました。
証明書の検証を有効にしたHTTPS通信、Basic認証、Host・Origin・CSRF検証、ルールの
POST・PUT・DELETE、本文の1MiB制限・15秒タイムアウト、静的RangeとHEAD、
経路逸脱の拒否、Socket.IOのpolling・WebSocket・upgrade、録画ダウンロード・PNGプレビュー・
MP4/TS配信、録画中TSとログの逐次転送、切断後の子プロセス終了、転送元IPの上書きを確認します。
Nginxの本文タイムアウトではクライアント接続が終了し、アクセスログに408が記録されることも確認しました。
追加の配信・接続テストは次のコマンドで実行します。60秒の接続維持を含むため、約2分かかります。

```sh
npm run test:proxy -- --extended
```

録画中PNG・MP4のシーク・時間指定・途中切断、Mirakurun互換のHTTP上流を使ったチャンネル配信と
上流障害、8本の同時MP4配信、80回のWebSocket接続・切断、8本のWebSocketと4本の配信の
60秒維持を確認します。接続数、WUIのファイル記述子数、子プロセスが切断後に戻ることも検証します。
チャンネル配信は実Mirakurunクライアントを使いますが、チューナーとMirakurunサーバーは模擬です。

PlaywrightとChromiumを別途用意すると、実ブラウザーで認証・ルール操作・主要画面・録画再生と
シーク・Socket.IO再接続を確認できます。Playwrightはアプリの依存には追加していません。

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
CHROMIUM_BIN=/path/to/chromium \
npm run test:proxy -- --extended --browser
```

Playwrightが通常のモジュール探索先にあり、そのChromiumを使う場合は、両環境変数を省略できます。
`PROXY_BROWSER_SCREENSHOT=/path/to/playback.png` を指定すると再生画面の画像を保存します。
ブラウザーはテスト用証明書の公開鍵だけを許可してHTTPSへ接続します。
2026-10-09に拡張テスト28項目、基本テストとChromium 153.0.0.0のブラウザーテスト計24項目が成功しました。
実チューナー・実Mirakurunサーバー、VAAPI、外部からの到達性、実環境の証明書、
数時間以上の連続運転は対象外です。

## 旧設定からの移行

- `wuiHost: "0.0.0.0"` やLANアドレスは、起動時に `127.0.0.1` として扱います。設定値も変更してください。
- `wuiOpenServer` による独立した認証なし待受を廃止しました。旧設定で通常ポートがない場合は、
  `wuiOpenPort`（省略時20772）を通常の認証付きサーバーのポートとして利用します。
  `wuiPort` を明示した後は `wuiOpenServer`、`wuiOpenHost`、`wuiOpenPort` を削除してください。
- `wuiAllowCountries` と `wuiMdnsAdvertisement` は廃止され、値が残っていても動作しません。
  国・地域ごとの制限が必要ならプロキシ側で適用します。
- Web待受を無効にするには `wuiPort` を `null` にし、旧 `wuiOpenServer` も削除または `false` にします。
- 設定を反映するにはWUIを再起動します。この修正で実設定の変更や稼働サービスの再起動は行っていません。

## APIクライアントの変更

POST・PUT・DELETEには `X-Requested-With: XMLHttpRequest` が必須です。
同梱UIは既にこのヘッダーを付けています。独自クライアントも付けてください。
Originを送る場合は公開URLと一致させ、`method` / `_method` の指定を廃止して実際のHTTPメソッドを使います。
本文は1MiBまで、受信期限は15秒です。上限超過は413、期限超過は408で終了します。
視聴APIの映像サイズ `s` は、正の整数による `幅x高さ`（例: `1920x1080`）を指定します。
各辺8192以下、総画素数35,389,440以下に限定し、空文字・複数指定・式・範囲外の値は400で拒否します。
サイズ指定が不要なら `s` 自体を省略します。この検証はVAAPIの有効・無効によらず適用します。
録画フォーマットは保存先内の相対パスに限定し、`..`、絶対パス、制御文字、長すぎる拡張子を拒否します。
下位ディレクトリやファイルがシンボリックリンクの録画先も使用できません。

CSRF対策はカスタムヘッダーとOrigin・Fetch Metadataの検証を組み合わせています。
このAPI向けの方式は[OWASPのCSRF対策](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)を参照しています。
