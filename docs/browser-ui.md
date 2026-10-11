# ブラウザーUI

画面の構成は標準の CSS Grid / Flexbox、UI部品は Web Awesome、一覧表は
Tabulator を使用します。npm のサーバー依存とは別に、ブラウザー用の配布物を
`web/lib/` に固定して同梱しています。通常の起動時にビルドやCDNへの接続は不要です。

| 用途 | 同梱ライブラリ |
| --- | --- |
| ボタン、ダイアログ、フォーム、タブ、スライダー | Web Awesome 3.14.0 (MIT) |
| 一覧表の仮想スクロール、ソート、選択 | Tabulator 6.6.1 (MIT) |
| 設定のJSON編集 | Ace 1.44.0 (BSD-3-Clause)、固定したサブモジュール |
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
| Ace 1.1.2（2013年） | Ace 1.44.0 | 設定のJSON編集、構文チェック |

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
- `web/virtual-grid.js`, `web/virtual-grid.css`: Tabulatorと番組データを接続します。表示中の行だけを描画し、
  更新後もソートとスクロール位置を保ちます。
- `web/layout.css`: ナビゲーション、ヘッダー、サイドバー、画面の配置。
- `web/schedule.css`, `web/timeline.css`: 番組表の操作・表示と番組タイムライン。
- `web/search-form.js`, `web/search.css`: 検索条件の入力・検証と検索結果の配置。
- `web/responsive.js`: ヘッダー、検索、一覧、番組表で共用する画面幅の判定。

番組説明はテキストとして描画し、HTTP(S) URLだけをリンク化します。番組情報のHTMLを実行しません。
予約スキップのキューは画面を移動しても完了させ、処理中状態が残ることを防ぎます。

## レスポンシブ対応

通常表示と関連する `@media` は部品ごとのCSS内にまとめます。共通のボタン、
フォーム、選択肢行は `ui.css`、全体の配置は `layout.css` に置きます。
CSSの適用順は `index.html` に記載した順序を維持します。

JavaScriptで画面幅を判定する場合は、各画面で `matchMedia` を作らず
`ChinachuResponsive.media` の共有 `MediaQueryList` を使います。

| 判定 | 条件 | 用途 |
| --- | --- | --- |
| `compact` | 800px以下 | ヘッダー・サイドバー、検索ダイアログ、番組一覧の簡略表示 |
| `wide` | 801px以上 | 通常のヘッダーと番組表の余白 |
| `scheduleCompact` | 451px以下 | 番組表の日付タブを前日・日付選択・翌日の操作へ切替 |

これらの境界を変える場合は `responsive.js` と該当CSSの条件を合わせて変更し、
境界の前後を実ブラウザーで確認します。部品固有のCSSの切替幅は、その部品内で管理します。
ブラウザー起動時のビルドやCSS生成は必要ありません。

一覧の `compactWhenOverflow` と番組表の日付行は、画面幅に加えて実際の利用可能幅を測ります。
固定のブレークポイントだけに置き換えないでください。番組表の処理は
`measureDayControls`（計測）、`getDayControlsLayout`（表示状態の決定）、
`applyDayControlsLayout`（反映）に分けています。
一覧の幅変更では選択、ソート、表示中の行とスクロール位置を引き継ぎます。

番組表のポップオーバーは、タップ／クリックの完了後に開きます。
`pointerup` の中で開くと、同じ操作の `click` によってブラウザーが即座に閉じる場合があります。
開くタイマーはページに属する `timer` で管理し、画面を離れると解除します。

## 依存ファイルの再生成

各ディレクトリの `vendor.json` にバージョン、配布元、SHA-512 integrityを記録し、
ライセンスも同梱しています。Web Awesomeは使用中の部品、その依存モジュール、
日本語訳とテーマのみを保存します。アップデート時はメタデータを確認して変更し、次を実行します。

```sh
python3 scripts/vendor-browser-libraries.py
```

配布物の整合性を検証してから同梱ファイルを更新します。この操作にはネットワークが必要です。
`components.js` に部品を追加した場合も再実行してください。

Aceは公式の `ajaxorg/ace-builds` サブモジュールをタグ `v1.44.0`
（コミット `184177de1dcc5946b093edba0b0fe1c29c2a127a`）に固定しています。
本体、JSONモード、GitHubテーマ、JSON構文チェック用Workerはすべてローカルから読み込みます。
上記の配布物再生成スクリプトには含めません。取得・更新後の復元には次を実行します。

```sh
git submodule update --init web/lib/ace
```

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

Firefoxで画面・Aceの検証を行う場合は、PlaywrightのFirefoxと必要な共有ライブラリを用意して実行します。

```sh
/tmp/chinachu-browser-tools/node_modules/.bin/playwright install firefox
CHINACHU_BROWSER=firefox NODE_PATH=/tmp/chinachu-browser-tools/node_modules node scripts/check-browser-pages.cjs
```

画面検証は専用のHTTP/Socket.IOテストサーバーを使い、実際の録画環境には接続しません。
全16画面、狭い画面幅、説明文の安全な表示、ポインター操作、フォーム、ダイアログ、
1万件の一覧表示、ソート、選択、状態保持を確認します。
画面検証ではAceのJSON構文チェック、日本語入力、undo/redo、フォームとの相互反映、
模擬APIへの保存内容も確認します。実際の設定ファイルは変更しません。
