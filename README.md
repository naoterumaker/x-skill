# x-skill — X/Twitter リサーチ & バズ分析ツールキット

Claude Code のスキルとして動作する、X/Twitter のリアルタイムリサーチ & バズ分析ツールキット。
Agent Team アーキテクチャにより、複数クエリの並列検索 → 自動ノイズ除去 → Markdown + xlsx レポート生成までを一気通貫で実行する。

## 必要なもの

| 項目 | 説明 |
|------|------|
| **X API Bearer Token** | [X Developer Portal](https://developer.x.com) で取得。pay-per-use（従量課金）方式 |
| **Bun** | TypeScript ランタイム。[bun.sh](https://bun.sh) からインストール |
| **Python 3.9+** | レポート生成スクリプト用。openpyxl は自動インストールされる |
| **Claude Code** | [claude.ai/claude-code](https://claude.ai/claude-code) — スキルとして利用 |

> **API キーについて:** このリポジトリに API キーは含まれていません。
> Bearer Token は環境変数 `X_BEARER_TOKEN` で設定してください（後述）。
> `.env` ファイルや認証情報を **絶対にコミットしないでください**。

## セットアップ

### 1. リポジトリのクローン

```bash
# Claude Code のスキルディレクトリに配置
mkdir -p ~/.claude/skills
cd ~/.claude/skills
git clone https://github.com/naoterumaker/x-skill.git x-research
```

### 2. Bun のインストール

```bash
curl -fsSL https://bun.sh/install | bash
```

### 3. X API Bearer Token の設定

[X Developer Portal](https://developer.x.com) で Bearer Token を取得し、環境変数に設定:

```bash
# 方法A: ~/.config/env/global.env に保存（推奨）
mkdir -p ~/.config/env
echo 'X_BEARER_TOKEN=ここにトークンを貼る' >> ~/.config/env/global.env
```

```bash
# 方法B: シェルの環境変数に直接設定
export X_BEARER_TOKEN="ここにトークンを貼る"
```

## 使い方

### 基本: CLI で直接検索

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ~/.claude/skills/x-research
source ~/.config/env/global.env

# キーワード検索（いいね順）
bun run x-search.ts search "AI マーケティング" --sort likes --limit 15

# クイック検索（1ページ、ノイズフィルタ付き）
bun run x-search.ts search "Claude Code" --quick

# 特定ユーザーの投稿
bun run x-search.ts profile username

# スレッド全文取得
bun run x-search.ts thread TWEET_ID

# JSON出力（レポート生成用）
bun run x-search.ts search "query" --sort likes --limit 15 --json > /tmp/result.json
```

### 検索オプション

```
--sort likes|impressions|retweets|recent   ソート順（デフォルト: likes）
--since 1h|3h|12h|1d|7d                    期間フィルタ（デフォルト: 7日）
--min-likes N                              最低いいね数フィルタ
--pages N                                  取得ページ数 1-5（100件/ページ）
--limit N                                  表示件数（デフォルト: 15）
--quick                                    クイックモード
--from <username>                          from:username のショートハンド
--quality                                  低エンゲージメント除去（いいね≥10）
--no-replies                               リプライ除外
--json                                     JSON出力
--save                                     ファイル保存
--markdown                                 Markdown形式で保存
```

### Agent Team リサーチ（メインワークフロー）

Claude Code 上で自然言語で依頼すると、Agent Team が自動で動く:

```
User: "AIとマーケの掛け算でXリサーチして"
```

**処理フロー:**

1. **Phase 1** — Coordinator（Opus）がテーマを 4〜6 クエリに分解
2. **Phase 2** — Subagent（Sonnet）が全クエリを並列検索 → JSON保存
3. **Phase 3** — マージ & 自動ノイズ除去（韓国語/ポルトガル語/スペイン語/アラビア語を検出）
4. **Phase 4** — X記事タイトル取得（必要時のみ、Chrome MCP経由）
5. **Phase 5** — `generate_summary_md.py` で Markdown + xlsx レポート生成
6. **Phase 6** — Review Agent（Sonnet）が MD の品質チェック

### レポート生成スクリプト（generate_summary_md.py）

検索結果の JSON から、バズ分析レポートを自動生成:

```bash
python3 generate_summary_md.py \
  --name "AI×マーケティング バズ分析" \
  --files /tmp/ai-mkt-core.json /tmp/ai-mkt-tools.json /tmp/ai-mkt-sns.json \
  --labels "AIマーケ基本" "AI×ツール" "AI×SNS" \
  --queries '"AIマーケ" OR "AI マーケティング"' '"ChatGPT マーケ"' '"AI SNS"'
```

**オプション:**

| オプション | 説明 |
|-----------|------|
| `--name` | レポートタイトル（必須） |
| `--files` | JSON ファイルパス（複数可、必須） |
| `--labels` | 各ファイルのラベル名 |
| `--queries` | 検索クエリ文字列（レポートに表示） |
| `--exclude` | 除外するツイート ID（手動ノイズ除去） |
| `--titles` | X記事タイトルの JSON マッピング |
| `--topics` | カスタム TOPIC_RULES の JSON ファイル |
| `--no-noise-filter` | 自動ノイズ除去を無効化 |
| `--out-dir` | 出力先ディレクトリ |
| `--no-xlsx` | xlsx 出力をスキップ |

**レポート出力内容:**

1. **何が語られているか** — トピック別いいね合計 + 代表ツイート例
2. **キーパーソン** — アカウント別プロファイル（話題・投稿タイプ・サンプル）
3. **次にやるべきこと** — 5 項目のアクションプラン
4. **バズ TOP10** — 全文・タグ・バズ効率・ポスト URL
5. **数値サマリー** — クエリ一覧 + 全体指標テーブル
6. **保存されるコンテンツ** — 保存率 TOP5（実用系）
7. **外部リンク** — 共有された URL 集

### 話題検出のカスタマイズ

デフォルトの TOPIC_RULES（マーケ向け）:

```
LP/Web制作, SEO/検索流入, AI活用/テック, コンテンツ制作,
AI副業/収益化, ビジネス/起業, 𝕏攻略/SNS, 広告/集客, 速報/ニュース
```

テーマに応じてカスタムルールを JSON で渡せる:

```bash
# topics.json
[
  {"name": "LP/Web制作", "keywords": ["lp", "ランディング", "figma", "html"]},
  {"name": "SEO", "keywords": ["seo", "検索", "google", "organic"]},
  {"name": "AI活用", "keywords": ["claude", "chatgpt", "ai", "プロンプト"]}
]

python3 generate_summary_md.py --topics topics.json --name "..." --files ...
```

## API コスト

X API は従量課金（2026年2月時点）:

| リソース | コスト |
|---------|-------|
| Post read | $0.005 |
| User lookup | $0.010 |

| 操作 | 推定コスト |
|------|-----------|
| Quick 検索（1ページ） | ~$0.50 |
| 標準リサーチ（3-4クエリ） | ~$1.50-2.00 |
| Deep dive（5-6クエリ） | ~$3.00-5.00 |
| キャッシュ済みの再検索 | 無料 |

キャッシュ（15分 TTL、Quick モードは 1時間）により重複リクエストを回避。

## ファイル構成

```
x-skill/
├── SKILL.md                    # スキル定義（Claude が読む）
├── x-search.ts                 # CLI エントリポイント（Bun で実行）
├── lib/
│   ├── api.ts                  # X API ラッパー
│   ├── cache.ts                # ファイルキャッシュ（15分 TTL）
│   ├── format.ts               # Markdown フォーマッタ
│   ├── cost.ts                 # API コスト追跡
│   ├── analyze.ts              # エンゲージメント分析
│   └── xlsx.ts                 # xlsx エクスポート
├── generate_summary_md.py      # MD + xlsx バズ分析（メイン）
├── generate_full_report.py     # 総合分析 xlsx（8シート）
├── generate_genz_report.py     # Z世代トレンド xlsx
├── xlsx_export.py              # xlsx 生成ユーティリティ
├── data/
│   ├── watchlist.example.json  # ウォッチリスト例
│   └── cache/                  # 検索キャッシュ（自動管理）
├── references/
│   └── x-api.md                # X API リファレンス
└── reports/                    # レポート出力先（git 管理外）
    └── YYYY-MM-DD/
```

## 原作と魔改造の差分

本リポジトリは [rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill) を**魔改造**したものです。

**原作（rohunvora/x-research-skill）:**
- X API v2 の検索・プロフィール・スレッド取得 CLI
- キャッシュ、コスト表示、ウォッチリスト機能

**本リポジトリで追加・改造した部分:**

| 追加機能 | 内容 |
|---------|------|
| **Agent Team アーキテクチャ** | Coordinator（Opus）+ Subagent（Sonnet）による並列検索ワークフロー |
| **generate_summary_md.py** | JSON → Markdown + xlsx バズ分析レポート生成（トピック分類・キーパーソン・アクションプラン・バズTOP10） |
| **自動ノイズ検出** | 韓国語/ポルトガル語/スペイン語/アラビア語を自動検出＆除外（日本語は保護） |
| **TOPIC_RULES** | キーワードベースの話題自動分類（短い英単語はワードバウンダリ対応） |
| **トピック例の重複排除** | 同じツイートが複数トピックの例に使われない仕組み |
| **SKILL.md 全面書き換え** | 6フェーズの Agent Team ワークフロー、モデル使い分け表、実行例 |
| **generate_full_report.py** | 総合分析 xlsx（8シート構成） |
| **generate_genz_report.py** | Z世代トレンド分析 xlsx |

原作のライセンス（MIT）に基づき公開しています。原作者に感謝。

## ライセンス

MIT — Original work by [rohunvora](https://github.com/rohunvora/x-research-skill)
