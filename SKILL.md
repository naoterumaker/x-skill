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

**Phase 0 — ヒアリング（Coordinator）**
検索開始前に **必ず** ユーザーに以下を確認する（AskUserQuestion を使用）:
1. **方向性** — 何を知りたいか（バズ分析? 競合調査? 世論? トレンド?）
2. **期間・取得量・品質** — 期間（24h/7d）、1クエリ件数（デフォルト100）、最低いいね数（デフォルト100。絶対に10以下にしない）
3. **参考情報** — 参考アカウントや参考ポストがあるか
4. **言語** — 日本語メイン? 英語メイン? 両方?

**Phase 1 — クエリ分解（Coordinator）**
テーマを 4〜6 クエリに分解。

**⚠ クエリ設計の鉄則:**
- **初手は狙いを絞って投げる**。感想語・文脈語を入れてピンポイントに狙うのはOK
- **取れなかった時の広げ方に芸を出す**。段階的に広げる（下記参照）
- **品質は `--sort likes` + `--min-likes` に任せる**
- **min-likes は絶対に下げない**。量が足りなければ広げ方で対応する

**広げ方の段階（Phase 2.5 リトライ順序）:**
1. 感想語・補足語を外す（`"Claude Code" 便利` → `"Claude Code"`）
2. 固有名詞の組み合わせを変える（`"Claude Code" MCP` → `"Claude Code" plugin`）
3. `lang:` を外す / `-is:reply` を外す
4. `--pages` を増やす（2→3→5）
5. `--since` を広げる（7d→14d）
⛔ min-likes を下げるのは禁止（ゴミが入る）

**Phase 2 — 並列検索（Subagents）**
全クエリを **1つのメッセージで同時に** Task(Bash, model:sonnet) として発行。

```
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/0_AI/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"クエリ"' \
    --sort likes --limit 100 --min-likes 100 --pages 2 \
    --json > /tmp/{slug}-{label}.json
```

**Phase 2.5 — リトライ（Coordinator）**
各クエリの取得件数を確認。目標の50%未満のクエリは再検索する。

**リトライで変えていいもの:**
- `--pages` を増やす（2→3→5）
- OR で類義語・関連語を追加
- `-is:reply` を外す
- `--since` を広げる（7d→14d）

**リトライで絶対に変えないもの:**
- `--min-likes` は絶対に下げない（ゴミが入る）
- 感想語・形容詞を追加しない（ヒット率が下がる）

件数が少ないのはテーマがニッチという事実。品質を落として量を増やすのは本末転倒。

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

**Phase 7 — 総括（Coordinator）**
レポート完成後、ユーザーに **口頭で総括を提示** する（MDには書かない）:
- このリサーチで分かったこと（3行以内）
- 最も重要な発見・意外だったこと
- ユーザーが次にやるべき具体的アクション1つ
- レポートファイルのパス（MD + xlsx）

詳細な手順・実例・モデル使い分け表: **`references/workflow.md`**

## Quick Research（単発検索）

深掘り不要な場合は Agent Team を使わず直接実行:

```bash
export PATH="$HOME/.bun/bin:$PATH" && \
cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
bun run x-search.ts search "クエリ" --quick
```

## Refinement Heuristics

- **ノイズが多い** → `-is:reply` 追加、`lang:ja`/`lang:en` で言語絞り
- **結果が少ない** → `--pages` を増やす（min-likes は下げない）
- **仮想通貨スパム** → `-$ -airdrop -giveaway -whitelist`
- **専門家のみ** → `from:username`
- **同名の別物が混じる** → 最小限の文脈語を1つだけ追加（例: `Cursor AI`）

## Key Rules

- Coordinator = **Opus**（クエリ設計・分析・レポート）、Subagent = **Sonnet**（検索・レビュー）
- 並列 Task は**必ず1メッセージで全発行**
- `--sort likes --min-likes 100 --limit 100 --pages 2` が標準
- **クエリはシンプルに**（固有名詞のみ、感想語禁止）。品質は `--min-likes` に任せる
- **min-likes は絶対に下げない**。量が欲しいなら `--pages` を増やす
- JSON 出力先は `/tmp/{slug}-{label}.json`
- X API コスト: $0.005/post read。Quick ~$0.50、Standard ~$2.00-3.00、Deep ~$5.00-6.00
