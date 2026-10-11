# Chinachu

Chinachuは、Mirakurunと連携してテレビ番組を予約・録画するLinux向けの録画ソフトウェアです。
ブラウザーから番組表の閲覧、番組検索、手動・自動予約、録画番組の再生・管理ができます。

[元プロジェクト](https://github.com/Chinachu/Chinachu)の開発停止を受け、このフォークで保守・改修を続けています。

## このフォークでの主な変更点

| 項目 | 変更内容 |
| --- | --- |
| 実行環境 | Node.js 24、Mirakurun 4、Socket.IO 4に対応。Node.jsとFFmpegはシステムにインストールしたものを使用 |
| Web UI | UI部品と一覧表示を刷新。仮想スクロール、狭い画面への対応、番組説明の表示切り替え、チャンネルを指定した検索を追加 |
| 予約・除外ルール | タイトル・説明文のAND／OR条件と共通除外ルールを追加。予約の一致キーワード・除外理由を表示し、自動スキップの手動解除にも対応 |
| 設定 | 日本語の設定フォームとJSON編集に対応。保存時の検証、更新競合の検出、バックアップを追加 |
| 認証・接続 | Web認証のパスワードをハッシュ化。Web UIはループバックで待ち受け、LANからの利用はHTTPSリバースプロキシ経由に変更 |
| 通知 | Twitter通知をGotifyによる録画開始・終了通知に変更 |

変更内容の詳細は、[ドキュメント](#ドキュメント)を参照してください。
旧版から更新する場合は、[既存環境からの移行](#既存環境からの移行)も確認してください。

## 動作要件

- Linux（録画ファイルへのアクセスに `/proc/self/fd` を使用）
- Node.js 24.xと、同梱のnpm
- FFmpeg・ffprobe
- 設定済みのMirakurun 4.x
- Git・Bash
- ES modules、Custom Elements、CSS Gridに対応したブラウザー

Node.js、npm、FFmpeg、ffprobeはシステムにインストールし、Chinachuを実行するユーザーの `PATH` から利用できるようにしてください。
チューナーと放送受信の設定は、Mirakurun側で行います。
ChinachuからMirakurunへの接続は、HTTPとUnixソケットに対応しています。

## 導入方法

以下は新規環境の手順です。Chinachuを実行する一般ユーザーで作業してください。

### 1. リポジトリと依存ファイルを取得

```sh
git clone --recurse-submodules --branch upgrade/node24 https://github.com/ajctrl/Chinachu.git
cd Chinachu
npm ci
```

既に取得済みの場合は、リポジトリのディレクトリで `git submodule update --init web/lib/ace` と `npm ci` を実行します。
ブラウザー用のライブラリは同梱しており、通常の起動にビルドは不要です。

### 2. 設定ファイルを作成

```sh
cp config.sample.json config.json
printf '[]\n' > rules.json
cp excludes.sample.json excludes.json
mkdir -p data log recorded
```

`config.json` を編集し、次の項目を環境に合わせます。

| 設定 | 内容 |
| --- | --- |
| `mirakurunPath` | Mirakurunの接続先。初期値は `http+unix://%2Fvar%2Frun%2Fmirakurun.sock/`。HTTPの場合は `http://127.0.0.1:40772/` など |
| `recordedDir` | 録画ファイルの保存先。初期値は `./recorded/` |
| `excludeServices` | 利用しないサービスのID。サンプルの値を見直し、除外しない場合は `[]` に変更 |
| `serviceOrder` | サービスの表示順。サンプルの値を見直し、指定しない場合は `[]` に変更 |

実行ユーザーには、Mirakurunの接続先を利用する権限と、設定・データ・ログ・録画先への必要な読み書き権限を与えてください。

自動予約ルールは空の状態から作成します。[rules.sample.json](rules.sample.json)には条件の記述例があります。
共通除外ルールのサンプルはすべて無効なので、使いたいものをWeb UIから有効にしてください。

### 3. Web UIのパスワードを設定

```sh
npm run password -- chinachu
```

ユーザー名 `chinachu` のパスワードを対話入力します。12文字以上で設定してください。
サンプルはパスワード未設定のため、この操作が完了するまでWeb UIは起動しません。
ユーザーの追加・変更は[Web認証とパスワード設定](docs/authentication.md)を参照してください。

### 4. 起動して接続

リポジトリのディレクトリでWeb UIを起動します。

```sh
./chinachu service wui execute
```

別の端末から、同じディレクトリで録画・スケジューラーを管理するoperatorを起動します。

```sh
./chinachu service operator execute
```

同じホストのブラウザーから `http://127.0.0.1:20772/` に接続し、設定したユーザー名とパスワードでログインします。
operatorが番組情報の取得と予約計画を定期的に実行します。

上記は端末での動作確認用です。常用する場合は、両プロセスをサービスとして起動し、作業ディレクトリをリポジトリに設定してください。
既存のLSB init形式の起動スクリプトは `./chinachu service wui initscript` と `./chinachu service operator initscript` で生成できます。

LAN・インターネットから利用する場合は、[Web UIの公開方法](docs/reverse-proxy.md)に従って、
同じホストにHTTPSリバースプロキシを設定し、公開URLを `wuiAllowedOrigins` に登録します。

## 既存環境からの移行

更新前にWUIとoperatorを停止し、設定ファイル、`rules.json`、`excludes.json`（存在する場合）、`data/` をバックアップしてください。
録画ファイルと保存先は維持し、新規導入のサンプルコピーで既存設定を上書きしないでください。

コードの更新後は、Node.js 24.x・FFmpeg・ffprobeを用意し、サブモジュールと依存ファイルを更新します。

```sh
git submodule update --init web/lib/ace
npm ci
```

主な移行項目は次のとおりです。

| 項目 | 必要な対応 |
| --- | --- |
| 旧平文パスワード | `npm run password -- --migrate` でハッシュ形式に変換。パスワード自体は維持されるため、共通・サンプルのパスワードは変更 |
| Web UIへの接続 | LANアドレスや `0.0.0.0` での直接待受から、ループバック＋HTTPSリバースプロキシへ変更。公開URLを `wuiAllowedOrigins` に登録 |
| 旧Web公開設定 | `wuiOpenServer`、国別制限、mDNS公開を廃止。設定の整理は[Web UIの公開方法](docs/reverse-proxy.md#旧設定からの移行)を参照 |
| 共通除外ルール | 旧 `config.json` の `autoExclusionRules` は `excludes.json` がない場合に読み込み。GUIで保存すると別ファイルへ移行 |
| 独自APIクライアント | Socket.IO 4に対応し、更新系APIに `X-Requested-With: XMLHttpRequest` を付与。Socket.IO 2.xクライアントは非対応 |

移行後はWUIとoperatorを起動し、ブラウザーを再読み込みしてください。
認証・公開方法・共通除外の詳細は、それぞれのドキュメントを参照してください。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [設定画面と保存](docs/settings.md) | 設定フォーム、JSON編集、表示設定、保存と再起動 |
| [一致キーワードと共通除外](docs/auto-exclusion.md) | 予約条件、AND／OR、共通除外ルール、スキップと手動解除 |
| [Web認証とパスワード設定](docs/authentication.md) | 初回設定、ユーザー追加、パスワード変更、旧設定からの移行 |
| [Web UIの公開方法](docs/reverse-proxy.md) | HTTPSリバースプロキシ、Nginx設定例、旧公開設定とAPIの移行 |
| [ブラウザーUI](docs/browser-ui.md) | UIの構成、同梱ライブラリ、実ブラウザーでの検証 |
| [npm依存](docs/npm-dependencies.md) | 依存パッケージの更新、標準機能への置き換え、互換性の検証 |

## 開発・検証

構文チェックとユニットテストを実行します。HTTPSのテストにはOpenSSLが必要です。

```sh
npm test
```

リバースプロキシを含む統合テストは、Nginx・OpenSSL・FFmpeg・ffprobeを用意して実行します。

```sh
npm run test:proxy
```

追加の配信テストと実ブラウザーでの検証手順は、[Web UIの公開方法](docs/reverse-proxy.md#ローカル統合テスト)と
[ブラウザーUI](docs/browser-ui.md#検証)にまとめています。
