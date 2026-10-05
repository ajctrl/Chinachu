# ブラウザーUI

画面の構成は標準の CSS Grid / Flexbox、UI部品は Web Awesome、一覧表は
Tabulator を使用します。npm のサーバー依存とは別に、ブラウザー用の配布物を
`web/lib/` に固定して同梱しています。通常の起動時にビルドやCDNへの接続は不要です。

| 用途 | 同梱ライブラリ |
| --- | --- |
| ボタン、ダイアログ、フォーム、タブ、スライダー | Web Awesome 3.14.0 (MIT) |
| 一覧表の仮想スクロール、ソート、選択 | Tabulator 6.6.1 (MIT) |
| 設定のJSON編集 | 既存のAceサブモジュール |
| サーバーからの更新通知 | サーバーが配信するSocket.IOクライアント |
| 日本語フォント | Noto Sans JP variable WOFF2 (SIL OFL 1.1) |

## ライブラリの変更

| 変更前 | 変更後 | 用途 |
| --- | --- | --- |
| Bootstrap、Flagrate、Sakurapanel | Web Awesome 3.14.0 とアプリ独自のCSS/JavaScript | ボタン、ダイアログ、フォーム、タブなどのUI部品 |
| - | Tabulator 6.6.1 | 一覧の仮想スクロール、ソート、選択 |
| Prototype | Chinachuのランタイム関数と標準DOM API | DOM操作、文字列・日付処理 |
| PEP | Pointer Events | ポインター入力 |
| Hyperform | HTML標準のフォーム検証 | 入力値の検証 |
| date.format.js | Chinachuの `formatDate` 関数 | 日付の表示 |

Noto Sans JPは `web/lib/notosansjp/` に同梱しています。表示端末のインストール済みフォントに依存せず、通常起動時のCDN接続なしで表示できます。

共通除外ルールの一覧は、保存先の変更をSocket.IOで通知して自動更新します。別タブでの編集と再接続にも対応し、手動の更新ボタンは不要です。

Prototype、Sakurapanel、Flagrate、Bootstrap、Hyperform、PEP、date.format.js は
削除済みです。通信には `fetch`、ポインター操作には Pointer Events、ページの切り替えには
`hashchange` を使用します。既存の `#!/program/view/id=.../` などのURLを維持します。
現行のChrome/Edge、Firefox、Safariなど、ES modules、Custom Elements、Shadow DOM、
CSS Gridを備えたブラウザーを対象とします。

## アプリケーション側の実装

- `web/runtime.js`: 通信、ページに属するイベントの解除、翻訳、DOM操作。
  読み込み中のページを離れると、そのページのリクエストを中断します。
- `web/page-manager.js`: ページの読み込みと破棄。古い画面の非同期処理やタイマーを片付けます。
- `web/components.js`, `web/ui.js`, `web/ui.css`: Web Awesomeを読み込み、アプリ内で共通する操作を提供します。
- `web/virtual-grid.js`: Tabulatorと番組データを接続します。表示中の行だけを描画し、
  更新後もソートとスクロール位置を保ちます。
- `web/layout.css`, `web/timeline.css`: ナビゲーション、画面の配置、番組タイムライン。
- `web/search-form.js`: 検索条件の入力と検証。

番組説明はテキストとして描画し、HTTP(S) URLだけをリンク化します。番組情報のHTMLを実行しません。
予約スキップのキューは画面を移動しても完了させ、処理中状態が残ることを防ぎます。

## 依存ファイルの再生成

各ディレクトリの `vendor.json` にバージョン、配布元、SHA-512 integrityを記録し、
ライセンスも同梱しています。Web Awesomeは使用中の部品、その依存モジュール、
日本語訳とテーマのみを保存します。アップデート時はメタデータを確認して変更し、次を実行します。

```sh
python3 scripts/vendor-browser-libraries.py
```

配布物の整合性を検証してから同梱ファイルを更新します。この操作にはネットワークが必要です。
`components.js` に部品を追加した場合も再実行してください。

Noto Sans JPは、Gitで管理する固定のCSSと、`vendor.json` に記録した各WOFF2・ライセンスの配布URLおよびSHA-512を使って再生成します。
Google FontsのCSS APIを起動時や再生成時に呼び出さないため、配布バージョンやURLが自動で変わることはありません。
フォントのみを再生成する場合は `python3 scripts/vendor-browser-libraries.py notosansjp`、
通信なしでCSSと全フォント・ライセンスの整合性を確認する場合は次を実行します。

```sh
python3 scripts/vendor-browser-libraries.py --verify-fonts
```

## 検証

```sh
npm test
```

実ブラウザーでの回帰検証には、別途PlaywrightとChromiumを用意します。
通常のアプリ依存には含めません。例えば一時ディレクトリを使う場合:

```sh
npm install --prefix /tmp/chinachu-browser-tools --no-package-lock playwright
/tmp/chinachu-browser-tools/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/chinachu-browser-tools/node_modules node scripts/check-browser-pages.cjs
NODE_PATH=/tmp/chinachu-browser-tools/node_modules node scripts/check-browser-ui.cjs
NODE_PATH=/tmp/chinachu-browser-tools/node_modules node scripts/check-virtual-grid.js
```

画面検証は専用のHTTP/Socket.IOテストサーバーを使い、実際の録画環境には接続しません。
全16画面、狭い画面幅、説明文の安全な表示、ポインター操作、フォーム、ダイアログ、
1万件の一覧表示、ソート、選択、状態保持を確認します。
