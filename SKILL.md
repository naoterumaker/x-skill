---
name: x-research
description: >
  X/Twitter research agent with Agent Team architecture. Use when: (1) user says
  "x research", "search x for", "search twitter for", "what are people saying about",
  "what's twitter saying", "check x for", "x search", "/x-research",
  (2) user wants real-time X discourse on any topic (product launches, API changes,
  industry trends, cultural events), (3) user wants a buzz analysis report (MD + xlsx).
  NOT for: posting tweets, account management, or archive searches beyond 7 days.
---

# X Research

X/Twitter リサーチ & バズ分析。テーマを受け取り、並列検索 → ノイズ除去 → 構造化レポート（MD + xlsx）を出力する。

- X API 詳細: `references/x-api.md`
- CLI 全コマンド: `references/cli-reference.md`
- レポート生成の詳細: `references/report-guide.md`
- Agent Team ワークフロー詳細: `references/workflow.md`

## 環境セットアップ

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ~/.claude/skills/x-research
source ~/.config/env/global.env
```

Subagent 環境では `bun` にパスが通らないことがある。**全コマンドの先頭に `export PATH="$HOME/.bun/bin:$PATH"` を必ず付ける。**

## Agent Team Research（メインワークフロー）

リサーチは Coordinator（Opus）+ Subagent（Sonnet）のチーム方式で実行する。

**Phase 1 — クエリ分解（Coordinator）**
テーマを 4〜6 クエリに分解。切り口: Core / ツール / 課題 / 成果 / エキスパート / 関連領域。各クエリにラベルを付ける。

**Phase 2 — 並列検索（Subagents）**
全クエリを **1つのメッセージで同時に** Task(Bash, model:sonnet) として発行。

```
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"クエリ"' --sort likes --limit 15 --json > /tmp/{slug}-{label}.json
```

**Phase 3 — マージ & ノイズ除去（Coordinator）**
Top 10 を確認。`generate_summary_md.py` が重複除去・自動ノイズ除去（韓国語/ポルトガル語/スペイン語/アラビア語）を実行。

**Phase 4 — X記事タイトル取得（必要時のみ）**
テキストが t.co リンクのみの場合、Chrome MCP でタイトル取得 → `--titles` で渡す。

**Phase 5 — レポート生成（Coordinator）**

```bash
python3 ~/.claude/skills/x-research/generate_summary_md.py \
  --name "テーマ名 バズ分析" \
  --files /tmp/{slug}-core.json /tmp/{slug}-tools.json ... \
  --labels "ラベルA" "ラベルB" ... \
  --queries "クエリA" "クエリB" ...
```

出力: `reports/YYYY-MM-DD/テーマ名/テーマ名.md` + `.xlsx`（7シート）

**Phase 5.5 — 戦略分析の追記（Coordinator）**
生成 MD を読み、先頭に `## 戦略サマリー` を挿入:
- 戦略的インサイト（3〜5項目: 流れ、空きポジション、ビジネス示唆）
- バズパターン分析（TOP10の共通型、保存率の高い/低い投稿の特徴）
- 具体的アクションプラン（テーマ × ユーザー文脈に合わせた提案）

**Phase 6 — レビュー（Review Agent / Sonnet）**
`pr-review-toolkit:code-reviewer`（model:sonnet）で MD 品質チェック: トピック重複、改行崩れ、ノイズ混入、数値整合性。

詳細な手順・実例・モデル使い分け表: **`references/workflow.md`**

## Quick Research（単発検索）

深掘り不要な場合は Agent Team を使わず直接実行:

```bash
export PATH="$HOME/.bun/bin:$PATH" && \
cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
bun run x-search.ts search "クエリ" --quick
```

## Refinement Heuristics

- **ノイズが多い** → `-is:reply` 追加、`--sort likes`、キーワード絞り込み
- **結果が少ない** → `OR` で拡張、制約オペレータ除去
- **仮想通貨スパム** → `-$ -airdrop -giveaway -whitelist`
- **専門家のみ** → `from:` または `--min-likes 50`
- **中身のある投稿のみ** → `has:links`

## Key Rules

- Coordinator = **Opus**（クエリ設計・分析・レポート）、Subagent = **Sonnet**（検索・レビュー）
- 並列 Task は**必ず1メッセージで全発行**
- `--sort likes` + `--limit 15` が標準
- JSON 出力先は `/tmp/{slug}-{label}.json`
- X API コスト: $0.005/post read。Quick ~$0.50、Standard ~$1.50-2.00、Deep ~$3.00-5.00
