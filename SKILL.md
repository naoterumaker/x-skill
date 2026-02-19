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

## X API の制約（重要）

**知っておくべき事実:**
- `min_faves` / `min_likes` オペレータは **API v2 では使えない**（Web検索では動く）
- `sort_order=relevancy` は **いいね順ではない**（X独自のアルゴリズム）
- relevancy は **`max_results=100` 必須**。50以下だとバズ投稿が完全に漏れる
- relevancy は **ページネーション不可**（`next_token` が返らない）
- **1クエリで取れるのは最大100件**。品質はクエリの質で決まる
- **表記ゆれが致命的**。`"Claude Code"` と `ClaudeCode` で結果が全く違う
- 期間は **3d が最もバランスが良い**（7d だと中間層が漏れやすい）

## Agent Team Research（メインワークフロー）

リサーチは Coordinator（Opus）+ Subagent（Sonnet）のチーム方式で実行する。
**Opus はクエリ設計・フォールバック判断・分析執筆のみ。それ以外は全て Sonnet or 直接実行。**

### Phase 1 — ヒアリング

検索開始前に **必ず** ユーザーに以下を確認する（AskUserQuestion を使用）:
1. **方向性** — 何を知りたいか（バズ分析? 競合調査? 世論? トレンド?）
2. **期間** — 24h / 7d（デフォルト。取れなければ 3d にフォールバック）
3. **参考情報** — 参考アカウントや参考ポストがあるか
4. **言語** — 日本語メイン? 英語メイン? 両方?

### Phase 2 — クエリ分解 ⚡Opus

テーマを **1〜3 クエリ** に分解。少数精鋭で狙い撃ち。

**⚠ クエリ設計の鉄則:**
- **表記ゆれを必ず OR で網羅する**（最重要）
  - `("Claude Code" OR ClaudeCode)` — スペースあり/なし
  - `(Antigravity OR "anti gravity")` — 綴りの揺れ
- **1クエリ = relevancy 100件固定**。これがAPIの限界
- **品質はクエリの質で決まる**。post-hoc フィルタは補助
- **初手は狙いを絞って投げる**。取れなかったら広げる
- **期間は `--since 7d` でまず投げる**。バズが取れなければ `--since 3d` にフォールバック

### Phase 3 — 並列検索（Sonnet）

全クエリを **1つのメッセージで同時に** Task(Bash, model:sonnet) として発行。

```
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/0_AI/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '("Claude Code" OR ClaudeCode) lang:ja' \
    --sort likes --since 7d \
    --json > /tmp/{slug}-{label}.json
```

### Phase 4 — フォールバック ⚡Opus

各クエリの結果を確認。**良い結果から次のクエリを類推する。**
十分な結果が取れていれば **スキップして Phase 5 へ直行**。

**フォールバック戦略（結果ベース、1〜2 クエリ追加）:**
1. **TOP投稿の著者を深掘り** — `from:username` で追加検索
2. **TOP投稿のキーワードで横展開** — バズキーワードで追加クエリ
3. **関連テーマに展開** — 結果内の言及から横展開
4. **表記ゆれの追加** — 結果に別表記が見つかったら反映

**フォールバックは最大 1〜2 クエリ。** 必要なものだけ追加、雑に増やさない。

### Phase 5 — X記事タイトル取得（必要時のみ）

テキストが t.co リンクのみの X記事がある場合、Chrome MCP でタイトル取得 → `--titles` で渡す。
テキストが既にある場合は **スキップ**。

### Phase 6 — レポート生成（Sonnet + Coordinator 並列）

**以下の2つを同時に実行する:**

**A. Task(Sonnet): マージ確認 & スクリプト実行**
```
Task (subagent_type: Bash, model: sonnet):
  # マージ確認（TOP10表示）
  python3 -c "..." && \
  # レポート生成
  python3 ~/0_AI/.claude/skills/x-research/generate_summary_md.py \
    --name "テーマ名" --files ... --labels ... --queries ...
```

**B. Coordinator(Opus): 全体概要 & 戦略分析を執筆** ⚡Opus
Phase 3-4 で得た TOP 結果を基に、以下を執筆する（MD 挿入は A 完了後）:

**① `## 全体概要`（最重要・必須）**
「今X上で何が起きているか」を **3〜5行の平文** で説明する。
- 議論の全体像（どんな構図か、何が争点か）
- 主要な論点・立場（何派がいて、それぞれ何を言っているか）
- 温度感（盛り上がってるのか、落ち着いてるのか、反動が来てるのか）
- テーマ固有の文脈（業界動向、直近の出来事との関連）

**書き方のルール:**
- バズ数値やメトリクスは書かない。「何が語られているか」だけを自然な文章で
- 読んだ人が「なるほど、X上ではこういう状況なのか」と全体像を掴める内容にする
- 具体的な投稿や人名を引用してもOK（裏付けとして）

**② `## 戦略サマリー`**
- 戦略的インサイト（3〜5項目: 流れ、空きポジション、ビジネス示唆）
- バズパターン分析（TOP10の共通型、保存率の高い/低い投稿の特徴）
- 具体的アクションプラン（テーマ × ユーザー文脈に合わせた提案）

### Phase 7 — MD統合 & 総括

A の MD 生成が完了したら、B で書いた全体概要 & 戦略サマリーを MD 先頭に挿入。
その後、ユーザーに **口頭で総括を提示**（MDには書かない）:
- このリサーチで分かったこと（3行以内）
- 最も重要な発見・意外だったこと
- ユーザーが次にやるべき具体的アクション1つ
- レポートファイルのパス（MD + xlsx）

### Phase 8 — レビュー（Deep dive のみ・バックグラウンド）

通常リサーチでは **スキップ**。Deep dive の場合のみ:
`pr-review-toolkit:code-reviewer`（model:sonnet, run_in_background）で MD 品質チェック。

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
- **バズ投稿が取れない** → 表記ゆれを OR で追加、`--since 3d` に絞る
- **結果から次を探す** → TOP投稿の著者/キーワードで追加クエリ
- **仮想通貨スパム** → `-$ -airdrop -giveaway -whitelist`
- **専門家のみ** → `from:username`
- **同名の別物が混じる** → 最小限の文脈語を1つだけ追加（例: `Cursor AI`）

## Key Rules

- **Opus は Phase 2, 4, 6B の3箇所のみ**。それ以外は Sonnet or 直接実行
- 並列 Task は**必ず1メッセージで全発行**
- **`max_results=100` 固定（relevancy）**。50以下はバズが漏れる
- **表記ゆれは OR で必ず網羅**（`"Claude Code" OR ClaudeCode`）
- **`--since 7d` → 取れなければ `3d` にフォールバック**
- **フォールバックは結果ベース**: TOP投稿の著者・キーワードから次のクエリを類推
- JSON 出力先は `/tmp/{slug}-{label}.json`
- **初回 1〜3 クエリ、フォールバック 1〜2 クエリ**（合計最大 5）
- X API コスト: $0.005/post read。1クエリ = 100件 = $0.50
