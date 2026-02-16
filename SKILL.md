---
name: x-research
description: >
  General-purpose X/Twitter research agent. Searches X for real-time perspectives,
  dev discussions, product feedback, cultural takes, breaking news, and expert opinions.
  Works like a web research agent but uses X as the source.
  Use when: (1) user says "x research", "search x for", "search twitter for",
  "what are people saying about", "what's twitter saying", "check x for", "x search",
  "/x-research", (2) user is working on something where recent X discourse would provide
  useful context (new library releases, API changes, product launches, cultural events,
  industry drama), (3) user wants to find what devs/experts/community thinks about a topic.
  NOT for: posting tweets, account management, or historical archive searches beyond 7 days.
---

# X Research

General-purpose agentic research over X/Twitter. Decompose any research question into targeted searches, iteratively refine, follow threads, deep-dive linked content, and synthesize into a sourced briefing.

For X API details (endpoints, operators, response format): read `references/x-api.md`.

## CLI Tool

All commands run from this skill directory:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd ~/clawd/skills/x-research
source ~/.config/env/global.env
```

> **Note:** `export PATH` はSubagent環境でbunにパスが通らない問題の対策。直接Bash実行時にも安全のため付けておく。

### Search

```bash
bun run x-search.ts search "<query>" [options]
```

**Options:**
- `--sort likes|impressions|retweets|recent` — sort order (default: likes)
- `--since 1h|3h|12h|1d|7d` — time filter (default: last 7 days). Also accepts minutes (`30m`) or ISO timestamps.
- `--min-likes N` — filter by minimum likes
- `--min-impressions N` — filter by minimum impressions
- `--pages N` — pages to fetch, 1-5 (default: 1, 100 tweets/page)
- `--limit N` — max results to display (default: 15)
- `--quick` — quick mode: 1 page, max 10 results, auto noise filter (`-is:retweet -is:reply`), 1hr cache, cost summary
- `--from <username>` — shorthand for `from:username` in query
- `--quality` — filter low-engagement tweets (≥10 likes, post-hoc)
- `--no-replies` — exclude replies
- `--save` — save results to `~/clawd/drafts/x-research-{slug}-{date}.md`
- `--json` — raw JSON output
- `--markdown` — markdown output for research docs
- `--analyze` — run engagement/influencer/keyword analysis on results
- `--xlsx` — export results + analysis to xlsx (auto-enables `--analyze`)

Auto-adds `-is:retweet` unless query already includes it. All searches display accurate cost breakdown.

**Examples:**
```bash
bun run x-search.ts search "BNKR" --sort likes --limit 10
bun run x-search.ts search "from:frankdegods" --sort recent
bun run x-search.ts search "(opus 4.6 OR claude) trading" --pages 2 --save
bun run x-search.ts search "$BNKR (revenue OR fees)" --min-likes 5
bun run x-search.ts search "BNKR" --quick
bun run x-search.ts search "Claude Code" --pages 2 --analyze --xlsx
bun run x-search.ts search "AI agents" --quality --quick --analyze
```

### Analyze

```bash
bun run x-search.ts analyze "<query>" [--xlsx]
```

Analyzes cached search results without re-fetching from API. Outputs:
- Engagement stats (avg/median/max likes, impressions, engagement rate)
- Content type breakdown (text only vs media vs links)
- Top posting hours (UTC)
- Influencer map (high_follower / emerging_voice / regular)
- Keyword frequency, hashtags, shared URLs
- Sentiment distribution (positive/negative/neutral)

### Usage

```bash
bun run x-search.ts usage
```

Shows X API usage stats (daily tweet reads, cap reset day).

### Profile

```bash
bun run x-search.ts profile <username> [--count N] [--replies] [--json]
```

Fetches recent tweets from a specific user (excludes replies by default).

### Thread

```bash
bun run x-search.ts thread <tweet_id> [--pages N]
```

Fetches full conversation thread by root tweet ID.

### Single Tweet

```bash
bun run x-search.ts tweet <tweet_id> [--json]
```

### Watchlist

```bash
bun run x-search.ts watchlist                       # Show all
bun run x-search.ts watchlist add <user> [note]     # Add account
bun run x-search.ts watchlist remove <user>          # Remove account
bun run x-search.ts watchlist check                  # Check recent from all
```

Watchlist stored in `data/watchlist.json`. Use for heartbeat integration — check if key accounts posted anything important.

### Cache

```bash
bun run x-search.ts cache clear    # Clear all cached results
```

15-minute TTL. Avoids re-fetching identical queries. **Note:** after upgrading, run `cache clear` since old cache entries lack new fields (media, url_meta, author_followers).

## Agent Team Research（メインワークフロー）

リサーチは**エージェントチーム方式**で実行する。Coordinator（メインエージェント）がクエリ分解・統合・レポート生成を担当し、検索はSubagentで**並列実行**する。

### Phase 1: クエリ分解（Coordinator）

リサーチ質問を **4〜6個の検索クエリ** に分解する。

**クエリ設計の切り口：**
- **Core** — テーマの直接キーワード（例: `"AIマーケ" OR "AI マーケティング"`）
- **ツール/手法** — 具体ツール名（例: `"ChatGPT マーケ" OR "Claude マーケ" OR "AI広告"`）
- **課題/ペインポイント** — `(broken OR bug OR issue)` `(失敗 OR 課題 OR 困)`
- **成果/ポジティブ** — `(shipped OR love OR fast)` `(成功 OR 売上 OR 伸びた)`
- **エキスパート** — `from:username` で特定の有識者
- **関連領域** — テーマの周辺（例: AIマーケなら `AI SEO`, `AI SNS`, `AI LP/CVR`）

**ノイズ対策：**
- `-is:retweet` は自動付加
- 日本語テーマには `-is:reply` を追加推奨
- 仮想通貨ノイズ: `-airdrop -giveaway -whitelist`

各クエリにラベルを付ける（例: `"AIマーケ基本"`, `"AI×ツール"`, `"AI×SEO"`）。

### Phase 2: 並列検索（Subagents）

**全クエリを同時にTask subagent（Bash型）で並列実行する。**

```
# 1つのメッセージで複数のTask toolを同時に呼ぶ
# ⚠ Subagentではbunにパスが通らないことがある → export PATH="$HOME/.bun/bin:$PATH" を先頭に必ず付ける
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/clawd/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"AIマーケ" OR "AI マーケティング"' \
    --sort likes --limit 15 --json > /tmp/{slug}-core.json

Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/clawd/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"ChatGPT マーケ" OR "Claude マーケ"' \
    --sort likes --limit 15 --json > /tmp/{slug}-tools.json

# ... 残りのクエリも同様に並列
```

**重要ルール：**
- 全Taskを **1つのメッセージ** で発行（並列実行される）
- Subagentは **`model: "sonnet"`** を指定（検索はBash実行のみなのでSonnetで十分）
- **`export PATH="$HOME/.bun/bin:$PATH"`** をコマンド先頭に必ず付ける（Subagent環境ではbunにパスが通らないことがある）
- Coordinator（Opus）がクエリ設計・結果分析・レポート解釈を担当
- 出力先は `/tmp/{slug}-{label}.json` に統一
- `--sort likes` で高エンゲージメントを優先取得
- `--limit 15` が標準（深掘り時は `--pages 2`）

### Phase 3: マージ＆品質確認（Coordinator）

`generate_summary_md.py` が自動でやること:
- **重複除去**: 同じツイートが複数クエリでヒットした場合は最初のラベルに帰属
- **自動ノイズ除去**: 韓国語・ポルトガル語・スペイン語・アラビア語を自動検出＆除外（日本語のひらがな/カタカナがあれば日本語として保持）
- 除外された件数と内容はstderrに出力される

Coordinatorがやること:
- Top 10を確認して内容の妥当性を目視チェック
- X記事でテキストがURL-onlyのものがないか確認 → あれば Phase 4 へ
- 必要なら `--exclude` で追加の手動除外

```python
# 結果の概要確認（Coordinatorが実行）
python3 -c "
import json
files = ['/tmp/{slug}-core.json', '/tmp/{slug}-tools.json', ...]
all_tweets = []
seen = set()
for path in files:
    with open(path) as f:
        for t in json.load(f):
            if t['id'] not in seen:
                seen.add(t['id'])
                all_tweets.append(t)
print(f'Total unique: {len(all_tweets)}')
all_tweets.sort(key=lambda x: x['metrics']['likes'], reverse=True)
for t in all_tweets[:10]:
    print(f'{t[\"metrics\"][\"likes\"]}L @{t[\"username\"]}: {t[\"text\"][:60]}')
"
```

### Phase 4: X記事タイトル取得（必要な場合のみ）

X記事でテキストがt.coリンクのみの場合、Chrome操作でタイトルを取得：

```bash
# Chrome MCPでX記事ページに移動し、タイトルを取得
mcp__claude-in-chrome__navigate → mcp__claude-in-chrome__get_page_text
```

タイトルを `{tweet_id: "タイトル"}` のJSONに保存し、`--titles` で渡す。
**テキストが既にある場合はスキップ可。**

### Phase 5: レポート生成（Coordinator）

```bash
python3 ~/.claude/skills/x-research/generate_summary_md.py \
  --name "テーマ名 バズ分析" \
  --files /tmp/{slug}-core.json /tmp/{slug}-tools.json ... \
  --labels "ラベルA" "ラベルB" ... \
  --exclude {noise_id_1} {noise_id_2} \
  --titles /tmp/{slug}-titles.json \
  --queries "クエリA" "クエリB" ...
```

`generate_summary_md.py` はデータ層（トピック分類・キーパーソン・数値・TOP10）を出力する。
**戦略的分析はスクリプトではなく Coordinator が担当する。**

### Phase 5.5: 戦略分析の追記（Coordinator / Opus）

生成された MD を読み、**Coordinator がテーマに合わせた戦略分析を追記**する。
スクリプトの出力 = データ。Coordinator の追記 = インテリジェンス。

**追記する内容：**

1. **戦略的インサイト**（3〜5項目）
   - このテーマで今どんな流れがあるか
   - どのポジションが空いているか（競合が少ない切り口）
   - ユーザーのビジネスに直結する示唆

2. **バズパターン分析**
   - TOP10に共通する「型」は何か（ハウツー、数字訴求、体験談、速報 等）
   - 保存率が高い投稿の共通点
   - エンゲージメントが低い投稿の共通点（避けるべきパターン）

3. **具体的アクションプラン**
   - 「次にやるべきこと」をスクリプト出力より具体化
   - テーマ×ユーザーの文脈に合わせた提案（例: 「LP制作×AI活用の切り口でスレッド投稿」）
   - 参考にすべきキーパーソンのスタイル

**追記方法:** 生成された MD ファイルの先頭（「何が語られているか」の前）に `## 戦略サマリー` セクションとして挿入する。

### Phase 6: レビュー（Review Agent / Sonnet）

**レポート生成後、`pr-review-toolkit:code-reviewer`（`model: "sonnet"`）でMDの品質チェックを行う。**

チェック観点：
- トピック例の重複がないか
- Markdownの改行崩れがないか
- ノイズツイートが混入していないか
- 数値の整合性（いいね合計、保存率等）
- 戦略サマリーがデータと矛盾していないか

### モデル使い分け

| 役割 | モデル | 理由 |
|------|--------|------|
| Coordinator（クエリ設計・結果解釈・最終出力） | **Opus** | テーマ理解、クエリの質、ユーザーへの報告 |
| 検索実行 Subagent | **Sonnet** or Bash直接 | 単純なコマンド実行のみ |
| レビュー Agent | **Sonnet** | MDチェックはSonnetで十分 |
| X記事タイトル取得（Chrome） | **Sonnet** | ページ遷移＆テキスト抽出のみ |

### コスト見積もり

| スコープ | クエリ数 | ページ | 推定ツイート | 推定コスト |
|---------|---------|-------|------------|-----------|
| Quick scan | 1-2 | 1 | ~100-200 | ~$0.50-1.00 |
| Standard | 3-4 | 1 | ~300-400 | ~$1.50-2.00 |
| Deep dive | 5-6 | 1-2 | ~500-1000 | ~$3.00-5.00 |

### 実例: AI×マーケティング リサーチ

```
User: "AIとマーケの掛け算でXリサーチして"

Coordinator Phase 1 — クエリ分解:
  1. "AIマーケ" OR "AI マーケティング"        → core
  2. "ChatGPT マーケ" OR "Claude マーケ"      → tools
  3. "AI SNS" OR "AI コンテンツ作成"           → sns
  4. "AI活用 売上" OR "AI 自動化 マーケ"       → results
  5. "AI×マーケ" OR "ChatGPT 売上"            → biz
  6. (AI OR ChatGPT OR Claude) (LP OR CVR)    → pro

Phase 2 — 6件並列検索（Task Bash × 6）
  → /tmp/ai-mkt-{core,tools,sns,results,biz,pro}.json

Phase 3 — マージ: 90件 → 重複除去 → 88件（2件ノイズ除外）

Phase 5 — レポート生成:
  python3 generate_summary_md.py \
    --name "AI×マーケティング バズ分析" \
    --files /tmp/ai-mkt-*.json \
    --exclude {ポルトガル語ID} {韓国語ID}

Phase 6 — レビュー → 修正 → 完了
```

## Quick Research（単発検索）

深掘り不要な場合はAgent Teamを使わず直接実行：

```bash
cd ~/clawd/skills/x-research && source ~/.config/env/global.env
bun run x-search.ts search "<query>" --quick
```

## Refinement Heuristics

- **ノイズが多い?** → `-is:reply` 追加、`--sort likes`、キーワード絞り込み
- **結果が少ない?** → `OR` で拡張、制約オペレータ除去
- **仮想通貨スパム?** → `-$ -airdrop -giveaway -whitelist`
- **専門家の意見だけ?** → `from:` または `--min-likes 50`
- **中身のある投稿だけ?** → `has:links`
- **非ターゲット言語のノイズ?** → `--exclude` でID除外

## Python 分析スクリプト

### generate_summary_md.py — Markdown + xlsx バズ分析

任意のテーマ・複数JSONから「**何が語られているか**」を中心にmd + xlsxレポートを生成する汎用ツール。
内容（話題）→ 人（キーパーソン）→ アクション → データの順で出力。

```bash
python3 ~/.claude/skills/x-research/generate_summary_md.py \
  --name "テーマ名 バズ分析" \
  --files /tmp/a.json /tmp/b.json \
  --labels "ラベルA" "ラベルB" \
  --queries "クエリA" "クエリB" \
  --exclude {noise_tweet_id_1} {noise_tweet_id_2} \
  --titles /tmp/titles.json
```

**出力先:** `reports/YYYY-MM-DD/テーマ名/テーマ名.md` + `テーマ名.xlsx`

**オプション:**
- `--name` — レポートタイトル（必須）
- `--files` — JSONファイルパス（複数可、必須）
- `--labels` — 各ファイルのラベル（省略時はファイル名）
- `--queries` — 各ファイルの実際の検索クエリ文字列（出力に表示）
- `--exclude` — 除外するツイートID（手動ノイズ除去用、複数可）
- `--titles` — X記事タイトルのJSONマッピング `{tweet_id: "タイトル"}`
- `--topics` — カスタムTOPIC_RULESのJSONファイル（後述）
- `--no-noise-filter` — 自動ノイズ除去を無効化
- `--out-dir` — 出力先（デフォルト: `~/.claude/skills/x-research/reports`）
- `--no-xlsx` — xlsx出力をスキップ

**自動ノイズ除去:**
デフォルトで有効。韓国語・ポルトガル語・スペイン語・アラビア語のツイートを自動検出＆除外。
日本語（ひらがな/カタカナを含む）は除外しない。除外結果はstderrに出力。

**md 出力セクション:**
1. **何が語られているか** — TOPIC_RULESによる自動話題検出、トピック別いいね合計＋例（重複なし）
2. **キーパーソン** — アカウント別プロファイル（話題・形式・投稿サンプル、話題不明は除外）
3. **次にやるべきこと** — 5項目のアクションプラン（フォーマット・話題・切り口・保存率・避けるべき）
4. **バズTOP10** — 各投稿の全文・タグ・バズ効率・ポストURL
5. **数値サマリー** — クエリ一覧、全体指標テーブル、ラベル別比較
6. **保存されるコンテンツ（保存率TOP5）** — ブクマ/いいね比率が高い実用系
7. **外部リンク** — ツイートから共有された外部URL集

**話題検出（TOPIC_RULES）:**

現在のルール（マーケ向け）:
- LP/Web制作, SEO/検索流入, AI活用/テック, コンテンツ制作, AI副業/収益化
- ビジネス/起業, 𝕏攻略/SNS, 広告/集客, 速報/ニュース

短い英単語キーワード（4文字以下: ai, seo, gpt, lp, css等）はワードバウンダリ `\b` で検索し、誤マッチを防止。

テーマに応じて `--topics` でカスタムルールを渡せる:
```json
[
  {"name": "LP/Web制作", "keywords": ["lp", "ランディング", "figma", "html"]},
  {"name": "SEO/検索流入", "keywords": ["seo", "検索", "google", "organic"]},
  {"name": "AI活用/テック", "keywords": ["claude", "chatgpt", "ai", "プロンプト"]}
]
```
`--topics` 省略時はスクリプト内蔵のデフォルトルールを使用。

**xlsx シート構成:**
1. **全ツイート** — いいね順一覧（話題列付き、バズ効率≥1.0を緑ハイライト）
2. **アカウント別** — ユーザーごとの話題・合計いいね・平均保存率・主な投稿タイプ
3. **ラベル別** — ラベルごとの件数・いいね・保存率比較（複数ラベル時のみ）
4. **投稿タイプ別** — タイプごとの件数・いいね・保存率・バズ効率

**X記事の扱い:**
- X記事（`x.com/i/article/` 等）のテキストがt.coリンクのみの場合、`--titles` でタイトルJSONを渡す
- テキストが既にある場合（大半のケース）はタイトル取得不要
- Chrome操作でタイトル取得: `mcp__claude-in-chrome__navigate` → `get_page_text`

**バズ要因タグ:** X記事, ビジュアル, 短文一撃, ハウツー/まとめ, 収益系, 体験談/リアル, 速報/リリース, スレッド, 問いかけ, 高保存率

## フォルダ構成

```
~/.claude/skills/x-research/     ← すべて1ディレクトリに統合
├── SKILL.md                     （このファイル）
├── x-search.ts                  （CLI エントリポイント）
├── generate_summary_md.py       （md + xlsx バズ分析 — 汎用、TOPIC_RULES内蔵）
├── lib/
│   ├── api.ts                   （X API wrapper: search, thread, profile, tweet, usage）
│   ├── cache.ts                 （ファイルキャッシュ, 15分TTL）
│   ├── format.ts                （Markdown フォーマッタ）
│   ├── cost.ts                  （APIコスト追跡: $0.005/post, $0.010/user）
│   ├── analyze.ts               （エンゲージメント・インフルエンサー・キーワード分析）
│   └── xlsx.ts                  （xlsx export TSラッパー）
├── data/
│   ├── watchlist.example.json   （ウォッチリスト例）
│   └── cache/                   （自動管理）
├── references/
│   └── x-api.md                 （X APIリファレンス）
└── reports/                     （レポート出力先、git管理外）
    └── YYYY-MM-DD/
        └── テーマ名/
            ├── テーマ名.md      （Markdownサマリー + 戦略分析）
            └── テーマ名.xlsx    （スプレッドシート）
```

## Agent Team アーキテクチャ図

```
┌──────────────────────────────────────────────┐
│  Coordinator（メインエージェント）              │
│                                              │
│  1. クエリ分解（4-6クエリ）                    │
│  2. Task Bash × N を並列発行                  │
│  3. 結果マージ & ノイズ除去                    │
│  4. generate_summary_md.py 実行（データ層）    │
│  5. Coordinator が戦略分析を追記               │
│  6. Review Agent でMD品質チェック             │
└────────┬──────┬──────┬──────┬────────────────┘
         │      │      │      │  Phase 2: 並列
    ┌────▼─┐┌───▼──┐┌──▼───┐┌─▼────┐
    │Search││Search││Search││Search│  Task(Bash)
    │core  ││tools ││sns   ││pro   │  subagents
    └──┬───┘└──┬───┘└──┬───┘└──┬───┘
       │       │       │       │
       ▼       ▼       ▼       ▼
    /tmp/    /tmp/    /tmp/    /tmp/    JSON出力
    slug-    slug-    slug-    slug-
    core     tools    sns      pro
       │       │       │       │
       └───────┴───────┴───────┘
                    │
                    ▼  Phase 3-5
           ┌────────────────┐
           │ Merge + Report │
           │ + Review Agent │
           └────────────────┘
                    │
                    ▼
           reports/YYYY-MM-DD/
           テーマ名/テーマ名.md + .xlsx
```
