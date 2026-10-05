# npm依存

実行環境はNode.js 24.xです。ルートの `package.json` と `package-lock.json` を使い、
`npm ci` でサーバー・CLI・テストの依存を取得します。ブラウザーに同梱するライブラリは
[ブラウザーUI](browser-ui.md)で別に管理しています。

## 更新した依存

| パッケージ | 更新前 | 更新後 | 使用箇所 |
| --- | --- | --- | --- |
| socket.io / socket.io-client | 4.8.3 | 4.8.4 | 更新通知、認証、ブラウザー・接続テスト |
| mirakurun | 4.1.3 | 4.1.5 | 番組情報・録画ストリームのクライアント |
| nodemailer | 9.0.5 | 10.0.15 | 空き容量不足時のsendmail通知 |
| mocha | 11.8.0 | 12.0.3 | テスト実行 |
| http-auth | 2.4.11 | 4.2.1 | WebのBasic認証 |
| easy-table | 0.2.0 | 1.2.0 | CLIの番組・ルール一覧 |
| opts | 1.2.7 | 2.0.2 | CLIとスケジューラーの引数 |

間接依存もロックファイルで修正版に更新しています。Socket.IOのEngine.IOは6.6.11です。
`http-auth`の旧版によるHTTPモジュールの変更に依存せず、HTTP/HTTPSサーバーへ
`basic.check(httpServer)`を明示的に渡します。Socket.IOの認証は既存の専用ミドルウェアを使います。
`easy-table`で廃止された列幅指定は専用の表示関数へ置き換えています。複数ルールの一覧では
長い配列値を20文字に省略し、単独ルールの縦表示では従来どおり全文を表示します。

## 標準機能への置き換え

- `mkdirp`を削除し、録画先の作成を `fs.mkdirSync(path, { recursive: true })` に変更しました。
- `diskusage`を削除し、容量取得を `fs.statfs()` に変更しました。一般ユーザーが利用できる
  空き容量は `bavail * bsize` で求め、取得失敗時には容量不足の動作を実行しません。
- `@chezearth/string`を削除し、録画ファイル名の話数ゼロ埋めを `String.prototype.padStart()` に変更しました。

`chinachu-common`は外部配布物ではなく `file:common` を参照します。
`common/package.json`には実際に使用する `dateformat` を宣言し、単独で依存を取得する場合も対応します。

未使用の開発用依存 `sinon` を削除しました。本体と専用の間接依存を合わせて6個の
インストール分が減り、Mochaでも使用する `diff` は残しています。

## uuidの限定的な指定

Mirakurun 4.1.5の `jsonrpc2-ws` が古いuuidを要求するため、ルートの `overrides` で
この依存経路だけをuuid 11.1.1に固定しています。その他の依存経路への一律指定は行いません。

uuid 11.1.1は[出力バッファの境界検査に関する脆弱性の修正版](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)です。
`jsonrpc2-ws`で使用する `v4()` の互換性は、実際にJSON-RPC接続を作成し、接続IDを応答するテストで確認します。
上流の依存指定が修正版へ更新されたら、この `overrides` の削除を検討します。

## 検証

```sh
npm ci
npm test
npm audit
npm audit --omit=dev
```

互換性テストはHTTP/HTTPS認証の成功・失敗、CLIの従来の引数と日本語一覧、
予約・ルールのシミュレーション、容量取得の失敗と通知、sendmailへの引き渡し、
MirakurunのTCP/Unixソケット・ストリーム中断、JSON-RPC接続を確認します。
HTTPSテスト用の一時証明書の生成には、`openssl` コマンドを使用します。
テストには仮のデータとローカルサーバーを使い、実際の録画・設定変更・メール配送は行いません。

画面の回帰検証には `scripts/check-browser-pages.cjs` を使用します。
実ブラウザーの準備と実行方法は[ブラウザーUI](browser-ui.md#検証)を参照してください。
