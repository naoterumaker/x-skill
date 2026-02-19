# x-research — X/Twitter リサーチ & バズ分析

テーマを投げると、並列検索 → ノイズ除去 → 構造化レポート（MD + xlsx）を自動生成する Claude Code スキル。

## 何ができるか

- テーマに対するX上の **世論・バズ・トレンド** を網羅的に収集・分析
- **全体概要**（X上で今何が起きているか）を自然な文章で記述
- **戦略サマリー**（インサイト・バズパターン・アクションプラン）を自動生成
- バズTOP10・キーパーソン・保存率分析を含む **MD + xlsx** レポート出力

## 出力例

```
reports/2026-02-20/manus-世論調査/
├── manus-世論調査.md      ← 全体概要・戦略サマリー・バズTOP10・キーパーソン
└── manus-世論調査.xlsx    ← 全ツイート一覧・アカウント別・投稿タイプ別
```

## アーキテクチャ

Coordinator（Opus）+ Subagent（Sonnet）の Agent Team 方式。**Opus は本当に必要な3箇所のみ。**

```
Phase 1  ヒアリング（方向性・期間・言語）
Phase 2  クエリ分解 ⚡Opus（1〜3クエリ、表記ゆれOR網羅）
Phase 3  並列検索（Sonnet × N 同時実行）
Phase 4  フォールバック判断 ⚡Opus（結果ベースで0〜2クエリ追加）
Phase 5  X記事タイトル取得（必要時のみ、Chrome MCP経由）
Phase 6  レポート生成(Sonnet) ‖ 全体概要・戦略サマリー執筆 ⚡Opus ← 並列
Phase 7  MD統合 & 口頭総括
Phase 8  レビュー（Deep diveのみ）
```

## セットアップ

```bash
# Claude Code のスキルディレクトリに配置
mkdir -p ~/.claude/skills
cd ~/.claude/skills
git clone https://github.com/naoterumaker/x-skill.git x-research

# Bun（未インストールなら）
curl -fsSL https://bun.sh/install | bash

# X API Bearer Token
mkdir -p ~/.config/env
echo 'X_BEARER_TOKEN=ここにトークン' >> ~/.config/env/global.env
```

Bearer Token は [X Developer Portal](https://developer.x.com) で取得。従量課金（$0.005/post read）。

## CLI

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ~/.claude/skills/x-research && source ~/.config/env/global.env

# 検索（いいね順）
bun run x-search.ts search "AI マーケティング" --sort likes --since 7d

# クイック検索
bun run x-search.ts search "Claude Code" --quick

# JSON出力（レポート生成用）
bun run x-search.ts search "query" --json > /tmp/result.json

# プロフィール・スレッド・単体ツイート
bun run x-search.ts profile username
bun run x-search.ts thread TWEET_ID
bun run x-search.ts tweet TWEET_ID

# API使用量
bun run x-search.ts usage
```

### 主要オプション

| オプション | 説明 |
|-----------|------|
| `--sort likes\|impressions\|retweets\|recent` | ソート順（デフォルト: likes） |
| `--since 1h\|3h\|12h\|1d\|7d` | 期間（デフォルト: 7d） |
| `--quick` | 1ページ・10件・ノイズフィルタ・1hキャッシュ |
| `--json` | JSON出力 |
| `--analyze --xlsx` | 分析付きxlsx出力 |
| `--min-likes N` | 最低いいね数フィルタ |
| `--pages N` | 取得ページ数 1-5（100件/ページ） |

## レポート生成

```bash
python3 generate_summary_md.py \
  --name "テーマ名 バズ分析" \
  --files /tmp/a.json /tmp/b.json \
  --labels "ラベルA" "ラベルB" \
  --queries "クエリA" "クエリB"
```

**MD出力セクション:** 全体概要 → 戦略サマリー → 何が語られているか → キーパーソン → アクションプラン → バズTOP10 → 数値サマリー → 保存率TOP5 → 外部リンク

## X API の現実

- `min_faves` / `min_likes` は API v2 で **使えない**
- `sort_order=relevancy` はいいね順 **ではない**
- `max_results=100` 未満でバズが **全滅** する
- relevancy は **ページネーション不可**（1クエリ最大100件）
- 表記ゆれで結果が **130倍** 変わる

対策: `max_results=100` 固定、表記ゆれ OR 網羅、7d → 3d フォールバック。詳細は `references/x-api.md`。

## コスト

| スコープ | クエリ数 | 推定コスト |
|---------|---------|-----------|
| Quick scan | 1 | ~$0.50 |
| Standard | 1-3 | ~$0.50-1.50 |
| + フォールバック | +1-2 | ~$1.00-2.50 |

## 構成

```
├── SKILL.md                  ← Claude Code スキル定義
├── x-search.ts               ← CLI
├── generate_summary_md.py    ← MD + xlsx レポート生成
├── lib/
│   ├── api.ts                ← X API v2 wrapper
│   ├── analyze.ts            ← エンゲージメント分析
│   ├── cache.ts              ← 15分TTLキャッシュ
│   ├── cost.ts               ← コスト追跡
│   ├── format.ts             ← フォーマッタ
│   └── xlsx.ts               ← xlsx export
├── references/
│   ├── x-api.md              ← API リファレンス + 実測制約
│   ├── workflow.md           ← Agent Team ワークフロー詳細
│   ├── cli-reference.md      ← CLI 全コマンド
│   └── report-guide.md       ← レポート生成ガイド
└── data/
    ├── watchlist.json         ← 監視アカウント
    └── cache/                 ← 自動管理
```

## クレジット

[rohunvora/x-research-skill](https://github.com/rohunvora/x-research-skill) をベースに構築。原作の MIT ライセンスに基づく。
