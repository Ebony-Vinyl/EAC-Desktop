<div align="center">

<h1><img src="docs/assets/eac-readme-hero.svg" alt="EAC-Desktop" width="808" /></h1>

**_EAC = Embracing All Creation（揽尽万象）_**

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

[![Stars](https://img.shields.io/github/stars/DSH-EAC/EAC-Desktop?style=for-the-badge&label=Star&color=4b6fff)](https://github.com/DSH-EAC/EAC-Desktop)
[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f?style=for-the-badge)](LICENSE)

[![QQ](https://img.shields.io/badge/QQ-1083832019-blue?logo=qq)](https://qm.qq.com/q/vqXxQQ3rmo)
[![Discord](https://img.shields.io/badge/Discord-DSH--EAC-5865f2?logo=discord)](https://discord.com/invite/kY48Ah8h)

[![Trendshift daily](https://trendshift.io/api/badge/trendshift/repositories/158075/daily?language=JavaScript)](https://trendshift.io/repositories/158075)
[![Trendshift weekly](https://trendshift.io/api/badge/trendshift/repositories/158075/weekly?language=JavaScript)](https://trendshift.io/repositories/158075)

[ダウンロード](https://github.com/DSH-EAC/EAC-Desktop/releases) · [クイックスタート](#クイックスタート) · [アーキテクチャ](#アーキテクチャ) · [コミュニティ](#コミュニティとサポート)

</div>

**エージェントの能力を、実際の仕事のためのデスクトップに。**

Deepseek Harness EAC は、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) をベースにしたオープンソースのデスクトップワークスペースです。会話、プロジェクトのファイル、ツールの実行、拡張機能を 1 つにまとめ、ネイティブのウィンドウ、分離された実行環境、同梱の依存関係によって、インストールしたらすぐに仕事を始められます。

**EAC · Embracing All Creation。** 能力は開かれ、境界は明確に：シェルがデスクトップの体験を、サービス層がオーケストレーションを、Harness がエージェントを担い、拡張パッケージが新しい可能性を開きます。

<p align="center"><img src="docs/screenshot-preview.jpg" alt="EAC デスクトップのスキンのプレビュー" width="960" /><br /><sub>スキンの紹介 · 見た目はインストールしたスキンによって変わります。</sub></p>

## 目次

| はじめに | アーキテクチャと拡張機能 | 開発とコミュニティ |
| :--- | :--- | :--- |
| [機能](#機能)<br />[クイックスタート](#クイックスタート)<br />[ダウンロードと起動](#ダウンロードと起動)<br />[データと環境](#データと環境) | [アーキテクチャ](#アーキテクチャ)<br />[起動から実行まで](#起動から実行まで)<br />[複雑さを明確な境界の中に収める](#複雑さを明確な境界の中に収める)<br />[プラグインと外観](#プラグインと外観)<br />[デスクトップのコンパニオン機能](#デスクトップのコンパニオン機能)<br />[拡張機能の配布](#拡張機能の配布)<br />[スキンの契約](#スキンの契約) | [開発](#開発)<br />[リポジトリの構成](#リポジトリの構成)<br />[ドキュメントとコミュニティ](#ドキュメントとコミュニティ)<br />[コミュニティとサポート](#コミュニティとサポート)<br />[コントリビューターと謝辞](#コントリビューターと謝辞)<br />[ライセンスと謝辞](#ライセンスと謝辞)<br />[Star の推移](#star-の推移) |

## 機能

| 意図から行動へ | EAC が提供するもの |
| --- | --- |
| 作業を始める | 同梱の Node.js、npm、dsh のリソースで、Node を別途インストールせずにローカルの Web UI を起動します |
| プロジェクトを中心に協働する | ワークスペースでタスクを実行し、セッションのファイルの変更を確認し、ファイル表示で編集をレビューしたり元に戻したりします |
| 長い会話を管理する | リクエスト経路でのコンテキストの圧縮と、上限付きのオーバーフローからの回復で、コンテキストの容量を管理します |
| ワークフローを形作る | 画像対応モデルやペルソナ関連の設定のための、クイックセットアップの操作 |
| 拡張機能を管理しやすく保つ | 集約されたカタログ、インストールと有効化の操作、そして保護センターのスナップショット、ヘルスチェック、ロールバック |
| 環境を分ける | DPX が、リリースのチャンネルごとに、環境の識別、デフォルトのデータパス、実行時の変数を管理します |
| デスクトップアプリとして動く | Tauri のネイティブのウィンドウ、トレイ、単一インスタンスの動作、終了のポリシーと、管理されたサービスのライフサイクル |
| 外観をカスタマイズする | ユーザーのスキンはマーケットのパッケージとして届き、明示的なホストの契約を通して組み込まれます |

モデルへのリクエストは、あなたが設定したプロバイダーを使います。有効化、互換性、追加の依存関係は、配布パッケージと拡張機能の設定によって異なります。

## クイックスタート

### ダウンロードと起動

EAC Launcher（デスクトップアプリと並べてインストールする、スタンドアロンのマルチインスタンス／マルチカーネルのマネージャー）：
[EAC-Launcher v0.1.0 for Windows x64](https://github.com/Ebony-Vinyl/EAC-Desktop/releases/tag/launcher-v0.1.0)
は独自の Node 24.22.1 のランタイムを同梱しているので、Node を別途インストールする必要はありません。使い方は
[`launcher/README.md`](launcher/README.md) を参照してください。

Windows の最新の安定版リリース：**v6.0.0**。その他のプラットフォームは、一覧の各形式で最後に公開されたパッケージにリンクしています。

| プラットフォーム | バージョン | ダウンロード | 更新日時（UTC+8） |
| --- | --- | --- | --- |
| Windows x64 | v6.0.0 | [Full Setup](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v6.0.0/Deepseek-Harness-EAC-full-v6.0.0-Setup-x64.exe) | 2026-10-05 02:23 |
| Windows x64 | v6.0.0 | [Full Portable](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v6.0.0/Deepseek-Harness-EAC-full-v6.0.0-x64-portable.zip) | 2026-10-05 02:23 |
| Windows x64 | v6.0.0 | [Lite Setup](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v6.0.0/Deepseek-Harness-EAC-lite-v6.0.0-Setup-x64.exe) | 2026-10-05 00:49 |
| Windows x64 | v6.0.0 | [Lite Portable](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v6.0.0/Deepseek-Harness-EAC-lite-v6.0.0-x64-portable.zip) | 2026-10-05 00:49 |
| Linux x64 | v5.3.6 | [AppImage](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v5.3.6/Deepseek.Harness.EAC_5.3.6_amd64.AppImage) | 2026-09-03 19:30 |
| Linux x64 | v5.3.6 | [deb](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v5.3.6/Deepseek.Harness.EAC_5.3.6_amd64.deb) | 2026-09-03 19:30 |
| Linux x64 | v4.4.0-linux | [rpm](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v4.4.0-linux/Deepseek-Harness-EAC-4.4.0.x86_64.rpm) | 2026-08-19 19:13 |
| macOS arm64 | v5.1.0 | [dmg](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v5.1.0/Deepseek.Harness.EAC_5.1.0_macos-arm64.dmg) | 2026-08-27 15:12 |
| macOS arm64 | v5.1.0 | [app.zip](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v5.1.0/Deepseek.Harness.EAC_5.1.0_macos-arm64.app.zip) | 2026-08-27 15:12 |

[リリースノート](https://github.com/DSH-EAC/EAC-Desktop/releases/tag/v6.0.0) · [SHA256SUMS.txt](https://github.com/DSH-EAC/EAC-Desktop/releases/download/v6.0.0/SHA256SUMS.txt)

更新日時は GitHub のアセットの更新のタイムスタンプです。プラットフォームごとのパッケージは異なるリリースの世代に属していることがあるので、インストールする前にそれぞれのリリースノートを確認してください。Windows では WebView2 を使います。クラウドのモデルにはネットワークへのアクセスとプロバイダーの認証情報が必要です。

1. **アプリケーションを起動し**、ローカルの dsh サービスと Web UI の準備ができるのを待ちます。
2. **モデルを設定します**。プロバイダーと API キーも含みます。
3. **ワークスペースを選び**、タスクを説明して、エージェントにプロジェクトの文脈の中で作業させます。
4. **結果をレビューします**。会話の出力とファイルの変更の表示で確認します。
5. **必要に応じて拡張します**。ワークフローに合ったプラグインを使います。

<details>
<summary>ダウンロードを検証する</summary>

PowerShell でファイルのハッシュを計算し、同じリリースのチェックサムのマニフェストと比べます：

```powershell
Get-FileHash -LiteralPath '<downloaded-file-path>' -Algorithm SHA256
```

</details>

## アーキテクチャ

**デスクトップの入口は 1 つ。責任ははっきり 3 つに分かれています。** EAC は、オペレーティングシステムとの統合、実行時のオーケストレーション、エージェントのカーネルを分けることで、デスクトップの体験と拡張機能が独立して進化できるようにしています。

![EAC のアーキテクチャ：Tauri が RPC で Node のサイドカーを動かし、DPX がサービスと公式の dsh カーネルのための実行環境を準備します](docs/assets/eac-runtime-flow-en.svg)

| 層 | 責任 | 入口 |
| --- | --- | --- |
| **L1 · ネイティブのデスクトップ** | ウィンドウ、トレイ、単一インスタンス、終了のポリシー、ネイティブとの統合 | [Rust のシェル](tauri-shell/src/main.rs) |
| **L2 · オーケストレーション** | 環境の初期化、プロファイル、プロセスの起動、デスクトップの RPC、プラグインの同期と管理 | [Node のサイドカー](tauri-shell/sidecar/server.ts)、[デスクトップのサービス](dsh-desktop/lib/desktop) |
| **L3 · Harness のカーネル** | エージェントの実行、会話、ツール、Cordis のプラグインツリー、Web UI | [カーネルの依存関係](dsh-desktop/package.json) |
| **DPX · 環境の基盤** | 登録、ディレクトリの構成、デフォルトのパス、実行時の変数 | [環境のアダプター](dsh-desktop/lib/desktop/environment.ts)、[dsh-dpx](third_party/dsh-dpx) |

### 起動から実行まで

1. **シェルがリソースを見つけてサイドカーを起動し**、製品のデータのルートとチャンネルを渡します。
2. **DPX が環境を作成するか再利用し**、ユーザーの設定とプラグインのモジュールが読み込まれる前に、実行時の変数を適用します。
3. **サービス層がプロファイルとコンパニオンのプラグインを準備し**、dsh を起動して、準備ができるのを待ちます。
4. **メインウィンドウが Web UI を開きます**。Harness が会話とツールの実行を担い、デスクトップの操作はブリッジを通してホストに届きます。

Rust と Node は **stdio の JSON-RPC** で通信し、プロトコルの出力と診断情報を分けています。環境の初期化に失敗すると、間違ったデータのルートのまま続けるのではなく、起動を止めてエラーを報告します。

### 複雑さを明確な境界の中に収める

- **ネイティブとの統合を業務のサービスから分ける。** ネイティブの機能は L1 に、オーケストレーションは L2 に置き、拡張機能はプラグインの契約を通してつながります。
- **確立された環境の管理を再利用する。** DPX がレジストリの状態、識別、デフォルトのパスを担い、EAC は 2 つ目のルールを持つ代わりに、アダプターを通して DPX を呼び出します。
- **配布を明示的にする。** プラグインのディレクトリ、同期のマニフェスト、依存関係の成果物がパッケージを定義するので、足りないリソースはステージングの段階で見つかります。
- **インターフェースのリソースを固定する。** UI のスキンマネージャーとデフォルトのシェルの成果物はロックされ、組み立ての際に SHA-256 で確認されます。

[層の分け方](docs/adr/0002-shell-boundary-and-layering.md)、[環境の分離](docs/adr/0004-eac-install-environment-isolation.md)、[コアの範囲](docs/adr/0006-minimal-core-scope.md)についての決定を読んでください。

## プラグインと外観

### デスクトップのコンパニオン機能

コンパニオンのプラグインは、Harness のホスト／クライアントの契約を使います。[ステージングのスクリプト](tauri-shell/stage-resources.mjs)が次のモジュールを組み立てます：

| 分野 | プラグイン | 用途 |
| --- | --- | --- |
| ファイルでの協働 | `dsh-file-changes`、`dsh-client-file-changes` | セッションの変更の投影、ファイルの変更の表示、元に戻す操作 |
| コンテキストの管理 | `dsh-compact` | リクエスト経路での圧縮と、上限付きのオーバーフローからの回復 |
| クイックセットアップ | `dsh-easy-setup` | 画像対応モデル、ペルソナ、関連する設定 |
| 発見 | `dsh-unified-market` | 集約されたカタログとインストールの管理 |
| 保護 | `dsh-plugin-shield` | スナップショット、ヘルスチェック、ロールバックの操作 |
| ローカライズ | `dsh-eac-locale-compat` | コンパニオンとコミュニティのプラグインの英語 UI の互換性 |
| UI の安定性 | `dsh-viewport-lock` | ビューポートの制約と設定パネルのレイアウト修正 |
| 起動アニメーション | `dsh-boot-animation` | 起動時やピン留めしたセッションに入るときの、全画面のイントロアニメーション（クリップを埋め込み） |
| WeChat チャンネル | `dsh-wechat-plugin` | WeChat からローカルのセッションを操作します。OpenClaw やグローバル IP は不要です |
| リモートアクセス | `ds-harness-remote` | PC / Android / Web からの、エンドツーエンドで暗号化された、P2P を優先するリモートアクセス |

### 拡張機能の配布

プラグインは **builtin / recommended / external** に分類されます。組み立てのマニフェストが同梱する機能を定義し、パッケージのメタデータが推奨のコレクションと外部の拡張機能を定義します。拡張機能はその機能で選び、入手元、バージョンの制約、ライセンスで管理してください。

[配布の仕様](docs/adr/0008-plugin-distribution-boundary.md)、[プラグインの台帳](.sync/plugin-distribution.json)、[入手元の記録](dsh-desktop/assets/SOURCES.json)を見てください。

### スキンの契約

ユーザーの Web UI のスキンはマーケットのパッケージを通してインストールされ、有効にしたスキンがなければ、ホストはネイティブの外観を使います。シェルの UI のスキンマネージャーと `system.default` のリソースは、[成果物のロック](tauri-shell/skin-manager-artifact.lock.json)で固定されています。領域、スロット、公開される機能は、[ホストのプロファイル](tauri-shell/host-profile.json)で定義されています。

**スキンは見た目を、ホストは機能とウィンドウの境界を担います。** 明示的な契約によって、見た目のカスタマイズと業務のロジックの結び付きを減らしています。

## データと環境

EAC は、デスクトップのデータを **DPX の分離された環境** に整理し、`web-desktop` のプロファイルを使います。環境の名前は `eac-<channel>` です：同じチャンネルは同じ環境を再利用し、異なるチャンネルは別々のストレージを持ちます。

```text
<product-data-root>/
└── dpx/dsh-environments/eac-<channel>/
    ├── .dpx-environment.json      # environment identity
    ├── dsh-home/                 # profiles, sessions, skills and configuration
    ├── home/                     # environment user directory
    ├── appdata/                  # application data
    ├── localappdata/             # local application data
    ├── tmp/                      # temporary files
    └── workspace/                # environment workspace
```

Windows のデフォルトは `%LOCALAPPDATA%\Deepseek Harness EAC` で、その他のプラットフォームはシステムのデータのディレクトリから導きます。ホストの `~/.dsh` は検出して報告しますが、自動で移行、削除、上書きはしません。

実際の製品のデータのルートと、別々のプロジェクトのディレクトリをバックアップする前に、アプリケーションを終了してください。Portable はアプリケーションの配布形式を表すもので、データがどこに置かれるかは環境の設定で決まります。

DPX はデフォルトのパスと環境変数を振り向けますが、**ファイルシステムのサンドボックスは提供しません**。明示的な絶対パスへのアクセスは、引き続きオペレーティングシステムの権限に従います。[environment.ts](dsh-desktop/lib/desktop/environment.ts) を参照してください。

## 開発

### リポジトリの構成

```text
tauri-shell/       Rust shell, sidecar, bridge, resource staging and packaging
dsh-desktop/       TypeScript services, companion plugins, build scripts and tests
third_party/       External dependencies pinned to commits
.sync/             Plugin source, distribution and synchronization ledgers
docs/adr/          Architecture decisions and module boundaries
```

パッケージングのマトリクスは Windows/Linux の x64 と arm64 をカバーし、リポジトリには macOS のプラットフォームの設定も含まれています。バイナリは Releases から入手し、ソースからのビルドについては[インストーラーのワークフロー](.github/workflows/staged-runtime-artifact.yml)を参照してください。

<details>
<summary>ソースとツールチェーンを準備する</summary>

Git、Node.js 24、pnpm 11.7.0、Rust stable を使います。Windows では Rust のターゲットのための C++ のビルドツールが、Linux では Tauri/WebKitGTK の依存関係が必要です。

```sh
git clone --recurse-submodules https://github.com/says693/Deepseek-Harness-EAC.git
cd Deepseek-Harness-EAC
git submodule update --init --recursive
node tauri-shell/check-dpx-pin.mjs
npm install --global pnpm@11.7.0

cd dsh-desktop
node scripts/fetch-kernel.js
npm run ci:install
npm run typecheck
npm run build
npm run fetch-runtime
npm test
cd ..
```

カーネルの依存関係はローカルの `vendor/kernel` の成果物を使います。依存関係をインストールする前に、固定されたカーネルを取得してください。ビルドではネットワークから依存関係をダウンロードします。

</details>

<details>
<summary>ステージングとパッケージング</summary>

Windows では、リポジトリのルートで次を実行します：

```sh
node tauri-shell/stage-resources.mjs --target=win32 --skip-npm
node dsh-desktop/scripts/verify-staged-runtime.mjs
cd tauri-shell
cargo fetch --locked
npx -y @tauri-apps/cli@2 build --verbose
```

Linux では `--target=linux` を使い、ビルド中は `APPIMAGE_EXTRACT_AND_RUN=1` を設定します。Ubuntu のビルドの依存関係：

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libfuse2 rpm
```

ポータブル版のアーカイブについては [make-portable.mjs](tauri-shell/make-portable.mjs) を参照してください。

</details>

<details>
<summary>検証とコントリビューション</summary>

`dsh-desktop` で、型チェック、テスト、台帳のチェックを実行します：

```sh
npm run typecheck
npm test
node scripts/plugin-ledger.mjs
node scripts/plugin-sync.mjs validate
```

起動、ブリッジ、環境、パッケージングの変更には、関連する実行時の検証も必要です。[開発ガイド](.agents/skills/deepseek-harness-eac-dev/SKILL.md)を使ってチェックを選び、[CONTRIBUTING.md](CONTRIBUTING.md) に従ってください。

</details>

## ドキュメントとコミュニティ

- [アーキテクチャの決定](docs/adr)：層の分け方、分離、スキン、プラグインの配布。
- [Issues](https://github.com/DSH-EAC/EAC-Desktop/issues)：再現できるバグ、機能の提案、フィードバック。
- [コントリビュート](https://github.com/DSH-EAC/EAC-Desktop/pulls)：コード、拡張機能の互換性、プラットフォームの対応、ドキュメント。
- [コントリビューター](https://github.com/DSH-EAC/EAC-Desktop/graphs/contributors)：EAC を作っている人たち。
- [エコシステムのクレジット](docs/ECOSYSTEM-CREDITS.md)：プラグインの作者、スキンの入手元、ライセンスの記録。

環境と実行時の挙動を追跡できるよう、バグ報告には、アプリケーションのバージョン、オペレーティングシステム、パッケージの形式、再現の手順、機密を伏せたログを含めてください。

## コミュニティとサポート

ワークフロー、プラグイン、トラブルシューティングについて、コミュニティで話し合いましょう。

| QQ | Discord | Issue トラッカー |
| :---: | :---: | :---: |
| [1083832019](https://qm.qq.com/q/vqXxQQ3rmo) | [DSH-EAC](https://discord.com/invite/kY48Ah8h) | [GitHub Issues](https://github.com/DSH-EAC/EAC-Desktop/issues) |

<table><tr><td align="center"><img src="docs/qq-group-qrcode.jpg" alt="QQ グループの QR コード" width="260" /></td><td align="center"><img src="docs/wechat-group-qrcode.jpg" alt="WeChat グループの QR コード" width="260" /></td></tr><tr><td align="center">QQ · 1083832019</td><td align="center">WeChat グループ</td></tr></table>

## コントリビューターと謝辞

EAC にコード、プラットフォームの対応、プラグイン、ドキュメントを提供してくださっている開発者の皆さんに感謝します。

<div align="center">

<p>
<a href="https://github.com/Ebony-Vinyl" title="Ebony-Vinyl"><img src="https://avatars.githubusercontent.com/u/245557608?v=4&amp;s=128" width="64" height="64" alt="Ebony-Vinyl" /></a>
<a href="https://github.com/metaone01" title="metaone01"><img src="https://avatars.githubusercontent.com/u/99704629?v=4&amp;s=128" width="64" height="64" alt="metaone01" /></a>
<a href="https://github.com/jing-hy" title="jing-hy"><img src="https://avatars.githubusercontent.com/u/281396152?v=4&amp;s=128" width="64" height="64" alt="jing-hy" /></a>
<a href="https://github.com/zixin947" title="zixin947"><img src="https://avatars.githubusercontent.com/u/318131693?v=4&amp;s=128" width="64" height="64" alt="zixin947" /></a>
<a href="https://github.com/says693" title="says693"><img src="https://avatars.githubusercontent.com/u/317628891?v=4&amp;s=128" width="64" height="64" alt="says693" /></a>
<a href="https://github.com/dtyg123" title="dtyg123"><img src="https://avatars.githubusercontent.com/u/171705219?v=4&amp;s=128" width="64" height="64" alt="dtyg123" /></a>
<a href="https://github.com/lanyun077" title="lanyun077"><img src="https://avatars.githubusercontent.com/u/186024291?v=4&amp;s=128" width="64" height="64" alt="lanyun077" /></a>
<a href="https://github.com/BAIKAI23333" title="BAIKAI23333"><img src="https://avatars.githubusercontent.com/u/196413461?v=4&amp;s=128" width="64" height="64" alt="BAIKAI23333" /></a>
</p>
<p>
<a href="https://github.com/nishantpurohit04" title="nishantpurohit04"><img src="https://avatars.githubusercontent.com/u/116972523?v=4&amp;s=128" width="64" height="64" alt="nishantpurohit04" /></a>
<a href="https://github.com/ViscaOwO" title="ViscaOwO"><img src="https://avatars.githubusercontent.com/u/221565198?v=4&amp;s=128" width="64" height="64" alt="ViscaOwO" /></a>
<a href="https://github.com/jiang8297" title="jiang8297"><img src="https://avatars.githubusercontent.com/u/242639667?v=4&amp;s=128" width="64" height="64" alt="jiang8297" /></a>
<a href="https://github.com/Luoye-hb" title="Luoye-hb"><img src="https://avatars.githubusercontent.com/u/238787898?v=4&amp;s=128" width="64" height="64" alt="Luoye-hb" /></a>
<a href="https://github.com/look-back-lysj" title="look-back-lysj"><img src="https://avatars.githubusercontent.com/u/318155171?v=4&amp;s=128" width="64" height="64" alt="look-back-lysj" /></a>
<a href="https://github.com/T-Auto" title="T-Auto"><img src="https://avatars.githubusercontent.com/u/183904010?v=4&amp;s=128" width="64" height="64" alt="T-Auto" /></a>
<a href="https://github.com/maliang233" title="maliang233"><img src="https://avatars.githubusercontent.com/u/78346713?v=4&amp;s=128" width="64" height="64" alt="maliang233" /></a>
<a href="https://github.com/lbn2011" title="lbn2011"><img src="https://avatars.githubusercontent.com/u/89037561?v=4&amp;s=128" width="64" height="64" alt="lbn2011" /></a>
</p>

[Ebony-Vinyl](https://github.com/Ebony-Vinyl) · [metaone01](https://github.com/metaone01) · [jing-hy](https://github.com/jing-hy) · [zixin947](https://github.com/zixin947) · [says693](https://github.com/says693) · [dtyg123](https://github.com/dtyg123) · [lanyun077](https://github.com/lanyun077) · [BAIKAI23333](https://github.com/BAIKAI23333) · [nishantpurohit04](https://github.com/nishantpurohit04) · [ViscaOwO](https://github.com/ViscaOwO) · [jiang8297](https://github.com/jiang8297) · [Luoye-hb](https://github.com/Luoye-hb) · [look-back-lysj](https://github.com/look-back-lysj) · [T-Auto](https://github.com/T-Auto) · [maliang233](https://github.com/maliang233) · [lbn2011](https://github.com/lbn2011)

</div>

macOS への移植をしてくださった [@Nuomi9](https://github.com/Nuomi9) に特に感謝します（[PR #234](https://github.com/DSH-EAC/EAC-Desktop/pull/234)）。プラグインとスキンの作者は[エコシステムのクレジット](docs/ECOSYSTEM-CREDITS.md)に記録しています。

## ライセンスと謝辞

EAC は [MIT License](LICENSE) を使っています。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[dsh-dpx](https://github.com/T-Auto/dsh-dpx)、Tauri、そしてプラグイン、スキン、プラットフォーム、ドキュメントのすべてのコントリビューターに感謝します。

サードパーティのコンポーネントは、それぞれの著作権とライセンスを保持しています。スキンの入手元には CC BY-NC-SA 4.0 の素材が含まれており、利用と再配布は該当するコンポーネントの条件に従う必要があります。

---

<div align="center"><sub>Embracing All Creation · コアは絞り込み、広がりの余地を。</sub></div>

## Star の推移

<a href="https://www.star-history.com/#DSH-EAC/EAC-Desktop&amp;Date">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=DSH-EAC/EAC-Desktop&amp;type=Date&amp;theme=dark" />
<source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=DSH-EAC/EAC-Desktop&amp;type=Date" />
<img alt="Star History" src="https://api.star-history.com/svg?repos=DSH-EAC/EAC-Desktop&amp;type=Date" width="960" />
</picture>
</a>
