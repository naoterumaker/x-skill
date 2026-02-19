# Agent Team ワークフロー詳細

**原則: Opus はクエリ設計・フォールバック判断・分析執筆の3箇所のみ。それ以外は Sonnet or 直接実行。**

## Phase 1: ヒアリング

検索を開始する前に、**必ず** AskUserQuestion でユーザーに確認する。

**確認項目（2問構成）:**

**Q1: 方向性・期間**
- 何を知りたいか（バズ分析 / 競合調査 / 世論調査 / トレンド把握）
- 期間（直近24h / 3d / 7d）

**Q2: 参考情報・言語**
- 参考になるアカウントがあるか（`from:username` クエリに反映）
- 参考になるポストがあるか（クエリ設計のヒントに使う）
- 言語（日本語メイン / 英語メイン / 両方）

**ヒアリング結果の反映:**
- 期間 → `--since` パラメータ（デフォルト 7d、フォールバックで 3d も試す）
- 参考アカウント → `from:` クエリ追加
- 言語 → `lang:ja` / `lang:en` オペレータ

## Phase 2: クエリ分解 ⚡Opus

リサーチ質問を **1〜3個の検索クエリ** に分解する。少数精鋭で狙い撃ち。

### X API の現実（クエリ設計の前提知識）

- **`max_results=100` 固定**。relevancy は 50 以下だとバズ投稿が完全に漏れる（検証済み）
- **ページネーション不可**（relevancy は `next_token` を返さない）
- **`min_faves` / `min_likes` は API v2 で使えない**。post-hoc フィルタのみ
- **表記ゆれが致命的**。`"Claude Code"` と `ClaudeCode` で全く異なる結果（検証済み: ClaudeCode で 778L、"Claude Code" で最大 6L）
- **relevancy ≠ いいね順**。X 独自アルゴリズムで、結果は毎回変わる
- **期間で精度が変わる**: 7d でまず投げ、バズが取れなければ 3d にフォールバック（3d の方が中間層 100-200L を拾いやすい）

### クエリ設計の鉄則

**原則: 表記ゆれを OR で網羅。結果から次のクエリを類推。**

1. **表記ゆれの OR が最重要**
   - `("Claude Code" OR ClaudeCode)` — スペースあり/なし
   - `(Antigravity OR "anti gravity" OR "Google Antigravity")` — 綴りの揺れ
   - `(AI OR 人工知能)` — 日英混在
   - これを怠ると取れるはずのバズ投稿が全滅する

2. **初手は狙いを絞る**
   - 感想語・文脈語を入れてピンポイントに狙うのはOK
   - 例: `("Claude Code" OR ClaudeCode) 便利 lang:ja`
   - これで良い結果が取れれば最高。取れなければ Phase 4 で広げる

3. **品質はクエリの質で決まる**
   - `--sort likes` でソートし、上位を使う
   - post-hoc の `--min-likes` は補助。APIレベルでは効かない

### クエリ分解の切り口

- **ツール単体** — `("Claude Code" OR ClaudeCode)`, `Cursor AI`, `Antigravity` → 各ツールの話題
- **ツール × ツール** — `("Claude Code" OR ClaudeCode) Cursor` → 比較・乗り換え文脈
- **ツール × 機能** — `("Claude Code" OR ClaudeCode) MCP`, `Cursor Agent` → 特定機能
- **バズワード** — `"vibe coding"`, `"AI coding"` → 広域トレンド
- **エキスパート** — `from:username` → 特定の有識者

### ノイズ対策

- `-is:retweet` は自動付加
- 日本語テーマには `-is:reply` を追加推奨
- 仮想通貨ノイズ: `-airdrop -giveaway -whitelist`
- 言語フィルタ: `lang:ja` / `lang:en`

各クエリにラベルを付ける。

## Phase 3: 並列検索（Sonnet）

全クエリを同時に Task subagent（Bash型）で並列実行する。

```
# 1つのメッセージで複数の Task tool を同時に呼ぶ
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/0_AI/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '("Claude Code" OR ClaudeCode) lang:ja' \
    --sort likes --since 7d \
    --json > /tmp/{slug}-core.json

Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/0_AI/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search 'Cursor (AI OR エディタ) lang:ja' \
    --sort likes --since 7d \
    --json > /tmp/{slug}-cursor.json

# ... 残りのクエリも同様に並列
```

**重要ルール:**
- 全 Task を **1つのメッセージ** で発行（並列実行される）
- Subagent は **`model: "sonnet"`** を指定
- **`export PATH="$HOME/.bun/bin:$PATH"`** をコマンド先頭に必ず付ける
- 出力先は `/tmp/{slug}-{label}.json` に統一
- `--sort likes --since 7d` が標準（max_results=100 はコード内で固定）

## Phase 4: フォールバック ⚡Opus

各クエリの結果を確認。**良い結果から次のクエリを類推する。**
十分な結果が取れていれば **スキップして Phase 5 へ直行**。

### 結果ベースのフォールバック（優先）

```
Step 1: TOP投稿を確認
  → 778L @Beverly_15B: "claudecode × パワポ..." が見つかった

Step 2: 著者の深掘り
  → from:Beverly_15B で追加検索 → 他のバズ投稿も取得

Step 3: キーワードで横展開
  → 「パワポ」「エクセル」がバズキーワード → ClaudeCode (エクセル OR スプレッド) で追加

Step 4: 関連テーマへ展開
  → 結果に Cursor 言及が多い → Cursor (移行 OR 比較 OR 乗り換え) で追加

Step 5: 表記ゆれの発見
  → 結果内に「クロードコード」表記を発見 → 次のクエリに追加
```

**フォールバックは最大 1〜2 クエリ。** 必要なものだけピンポイントで追加。

### 従来の広げ方（補助）

結果ベースで展開した後、それでも足りなければ:
1. 感想語・補足語を外す
2. `lang:` を外す / `-is:reply` を外す
3. `--since` を短くする（7d → 3d: relevancy の精度が上がる）
4. `--since` を広げる（7d → 指定なし: 7日フル）

**⛔ やってはいけないこと:**
- `max_results` を 100 未満にする（バズが漏れる）
- 品質度外視で雑なクエリを大量に投げる
- フォールバックを 3 クエリ以上追加する（コスト膨張）

## Phase 5: X記事タイトル取得（必要時のみ）

X記事でテキストが t.co リンクのみの場合、Chrome 操作でタイトルを取得。
テキストが既にある場合は **スキップ**。

```bash
# Chrome MCPでX記事ページに移動し、タイトルを取得
mcp__claude-in-chrome__navigate → mcp__claude-in-chrome__get_page_text
```

タイトルを `{tweet_id: "タイトル"}` のJSONに保存し、`--titles` で渡す。

## Phase 6: レポート生成（Sonnet + Coordinator 並列）

**以下の A と B を同時に実行する。これが最大の高速化ポイント。**

### A. Task(Sonnet): マージ確認 & スクリプト実行

```
Task (subagent_type: Bash, model: sonnet):
  cd ~/0_AI/.claude/skills/x-research && \
  python3 -c "
  import json
  files = ['/tmp/{slug}-core.json', '/tmp/{slug}-tools.json']
  all_tweets = []; seen = set()
  for path in files:
      with open(path) as f:
          for t in json.load(f):
              if t['id'] not in seen:
                  seen.add(t['id']); all_tweets.append(t)
  print(f'Total unique: {len(all_tweets)}')
  all_tweets.sort(key=lambda x: x['metrics']['likes'], reverse=True)
  for t in all_tweets[:10]:
      print(f'{t[\"metrics\"][\"likes\"]:>5}L @{t[\"username\"]}: {t[\"text\"][:70]}')
  " && \
  python3 generate_summary_md.py \
    --name "テーマ名" \
    --files /tmp/{slug}-core.json /tmp/{slug}-tools.json \
    --labels "ラベルA" "ラベルB" \
    --queries "クエリA" "クエリB" \
    --out-dir ~/0_AI/x_skill/reports
```

### B. Coordinator(Opus): 全体概要 & 戦略分析を執筆 ⚡Opus

Phase 3-4 で得た TOP 結果を基に、**A の完了を待たずに** 以下を執筆する。

**① 全体概要（最重要・必須）**

「今X上で何が起きているか」を **3〜5行の平文** で説明する。レポートを読む人が最初に目にするセクション。

**含めるべき内容:**
- 議論の全体像（どんな構図か、何が争点か）
- 主要な論点・立場（何派がいて、それぞれ何を言っているか）
- 温度感（盛り上がってるのか、落ち着いてるのか、反動が来てるのか）
- テーマ固有の文脈（業界動向、直近の出来事との関連）

**書き方のルール:**
- バズ数値やメトリクスは書かない。「何が語られているか」だけを自然な文章で
- 読んだ人が「なるほど、X上ではこういう状況なのか」と全体像を掴める内容にする
- 具体的な投稿や人名を引用してもOK（裏付けとして）

**例（Manus vs Claude Code）:**
```
## 全体概要

X上での「Manus vs Claude Code」の議論は、対立構図ではなく
「併用」の文脈が主流になっている。Claude Code でコード管理・
情報整理を行い、Manus にブラウザ操作を任せるという棲み分けが
定着しつつある。一方、日本語圏では Manus を使った収益化事例
（LP構築、X自動返信、Stripe連携）が目立ち、非エンジニア層に
とっては Manus の方が「すぐ稼げるツール」として認識されている。
英語圏では Meta による Manus 買収を軸に、AIエージェント領域の
大企業買収戦争という文脈で語られることが多い。
```

**② 戦略サマリー**

全体概要の後に、ビジネス寄りの分析を追記する:
- 戦略的インサイト（3〜5項目: 流れ、空きポジション、ビジネス示唆）
- バズパターン分析（TOP10の共通型、保存率の高い/低い投稿の特徴）
- 具体的アクションプラン（テーマ × ユーザー文脈に合わせた提案）

## Phase 7: MD統合 & 総括

A の MD 生成が完了したら、B で書いた全体概要 & 戦略サマリーを MD 先頭に挿入。

その後、ユーザーに **口頭で総括を提示**（MDには書かない）:
- このリサーチで分かったこと（3行以内）
- 最も重要な発見・意外だったこと
- ユーザーが次にやるべき具体的アクション1つ
- レポートファイルのパス（MD + xlsx）

## Phase 8: レビュー（Deep dive のみ・バックグラウンド）

通常リサーチでは **スキップ**。Deep dive の場合のみ:
`pr-review-toolkit:code-reviewer`（model:sonnet, run_in_background）で MD 品質チェック。

チェック観点:
- トピック例の重複がないか
- Markdownの改行崩れがないか
- ノイズツイートが混入していないか
- 数値の整合性（いいね合計、保存率等）

## モデル使い分け

| Phase | 役割 | モデル | 理由 |
|-------|------|--------|------|
| 1 | ヒアリング | Coordinator（どのモデルでもOK） | AskUserQuestion を投げるだけ |
| 2 | クエリ分解 | **⚡Opus** | テーマ理解、クエリの質が全てを決める |
| 3 | 並列検索 | **Sonnet** Task(Bash) | コマンド実行のみ |
| 4 | フォールバック | **⚡Opus** | 結果を読んで次を類推する判断力 |
| 5 | X記事タイトル取得 | Chrome MCP | 必要時のみ。大半スキップ |
| 6A | スクリプト実行 | **Sonnet** Task(Bash) | python 実行するだけ |
| 6B | 全体概要 & 戦略 | **⚡Opus** | **本丸。** 分析・執筆の質が最終アウトプットを決める |
| 7 | MD統合 & 総括 | Coordinator | Edit で挿入 + ユーザーに報告 |
| 8 | レビュー | **Sonnet**（BG） | MD チェックは Sonnet で十分。Deep dive のみ |

**Opus の実質稼働: Phase 2, 4, 6B の3回のみ。**

## コスト見積もり

| スコープ | クエリ数 | 推定ツイート | 推定コスト |
|---------|---------|------------|-----------|
| Quick scan | 1 | ~100 | ~$0.50 |
| Standard | 1-3 | ~100-300 | ~$0.50-1.50 |
| Deep dive（フォールバック含む） | 3-5 | ~300-500 | ~$1.50-2.50 |

## 処理フロー図

```
Phase 1: ヒアリング
  │
Phase 2: クエリ分解 ⚡Opus
  │
Phase 3: ┌─ Task(Sonnet): 検索A ─┐
          ├─ Task(Sonnet): 検索B ─┤ 並列
          └─ Task(Sonnet): 検索C ─┘
  │
Phase 4: フォールバック判断 ⚡Opus（スキップ可）
  │        └─ Task(Sonnet): 追加検索 ×1-2
  │
Phase 5: X記事タイトル取得（必要時のみ・大半スキップ）
  │
Phase 6: ┌─ A: Task(Sonnet): スクリプト実行 ─┐ 並列
          └─ B: Opus: 全体概要 & 戦略執筆 ──┘
  │
Phase 7: MD統合 & 総括
  │
Phase 8: レビュー（Deep dive のみ, BG）
```

## 実例: Cursor vs Claude Code vs Antigravity

```
User: "Cursor vs Claude Code vs Antigravityの論争をリサーチして"

Phase 1 — ヒアリング:
  → バズ分析+競合調査、7d、日本語メイン

Phase 2 — クエリ分解 ⚡Opus（1〜3クエリ、表記ゆれを OR で網羅）:
  1. ("Claude Code" OR ClaudeCode) lang:ja       → cc-ja
  2. (Cursor AI OR CursorAI) lang:ja              → cursor-ja
  3. (Antigravity OR "Google Antigravity") lang:ja → ag-ja

Phase 3 — 3件並列検索（Sonnet, --sort likes --since 7d）
  → /tmp/ccvs-{cc-ja,cursor-ja,ag-ja}.json

Phase 4 — フォールバック ⚡Opus（1〜2クエリ追加）:
  cc-ja TOP: 778L @Beverly_15B ("claudecode × パワポ")
  → from:Beverly_15B で追加検索（フォールバック1）
  → ("Claude Code" OR ClaudeCode) Cursor で比較文脈を取得（フォールバック2）

Phase 5 — X記事タイトル取得（スキップ）

Phase 6 — 並列実行:
  A: Task(Sonnet) → generate_summary_md.py 実行
  B: Opus → 全体概要 & 戦略サマリー執筆

Phase 7 — MD統合 & 総括
```
