# Web UIの公開方法

ChinachuのWebサーバーは `127.0.0.1` または `::1` だけで待ち受けます。
LAN・インターネットから利用するときは、同じホストのリバースプロキシでHTTPSと認証を適用してください。
別ホスト・別ネットワーク名前空間のプロキシは、そのままではループバックへ接続できません。

## Chinachuの設定

既存の `config.json` に次の値を設定します。以下は関連部分だけの例です。
公開するホスト名・ポートに合わせて `wuiAllowedOrigins` を変更し、認証情報は自分専用の値にしてください。

```json
{
  "wuiPort": 20772,
  "wuiHost": "127.0.0.1",
  "wuiAllowedOrigins": ["https://chinachu.example.com"],
  "wuiUsers": ["your-user:replace-with-a-long-unique-password"],
  "wuiXFF": true,
  "wuiTlsKeyPath": null,
  "wuiTlsCertPath": null
}
```

TLSはプロキシで終端し、ChinachuのBasic認証を通す構成です。既存のサンプルパスワードは変更してください。
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
`wuiXFF` が有効でも、Chinachuはループバック接続の場合だけこの値をログに採用します。

WebSocketの転送は[Nginxの公式手順](https://nginx.org/en/docs/http/websocket.html)に従っています。
配信データを逐次返すため、[応答バッファリング](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)を無効にしています。
本文の制限は[Nginxのclient_max_body_size](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)も使います。
この例の構文確認・証明書の準備・Nginxへの適用は、それぞれの実環境で行ってください。

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
