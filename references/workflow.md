# Agent Team ワークフロー詳細

## Phase 1: クエリ分解（Coordinator）

リサーチ質問を **4〜6個の検索クエリ** に分解する。

**クエリ設計の切り口:**
- **Core** — テーマの直接キーワード（例: `"AIマーケ" OR "AI マーケティング"`）
- **ツール/手法** — 具体ツール名（例: `"ChatGPT マーケ" OR "Claude マーケ" OR "AI広告"`）
- **課題/ペインポイント** — `(broken OR bug OR issue)` `(失敗 OR 課題 OR 困)`
- **成果/ポジティブ** — `(shipped OR love OR fast)` `(成功 OR 売上 OR 伸びた)`
- **エキスパート** — `from:username` で特定の有識者
- **関連領域** — テーマの周辺（例: AIマーケなら `AI SEO`, `AI SNS`, `AI LP/CVR`）

**ノイズ対策:**
- `-is:retweet` は自動付加
- 日本語テーマには `-is:reply` を追加推奨
- 仮想通貨ノイズ: `-airdrop -giveaway -whitelist`

各クエリにラベルを付ける（例: `"AIマーケ基本"`, `"AI×ツール"`, `"AI×SEO"`）。

## Phase 2: 並列検索（Subagents）

全クエリを同時に Task subagent（Bash型）で並列実行する。

```
# 1つのメッセージで複数の Task tool を同時に呼ぶ
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"AIマーケ" OR "AI マーケティング"' \
    --sort likes --limit 15 --json > /tmp/{slug}-core.json

Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"ChatGPT マーケ" OR "Claude マーケ"' \
    --sort likes --limit 15 --json > /tmp/{slug}-tools.json

# ... 残りのクエリも同様に並列
```

**重要ルール:**
- 全 Task を **1つのメッセージ** で発行（並列実行される）
- Subagent は **`model: "sonnet"`** を指定（検索は Bash 実行のみなので Sonnet で十分）
- **`export PATH="$HOME/.bun/bin:$PATH"`** をコマンド先頭に必ず付ける
- 出力先は `/tmp/{slug}-{label}.json` に統一
- `--sort likes` で高エンゲージメントを優先取得
- `--limit 15` が標準（深掘り時は `--pages 2`）

## Phase 3: マージ & 品質確認（Coordinator）

`generate_summary_md.py` が自動でやること:
- **重複除去**: 同じツイートが複数クエリでヒットした場合は最初のラベルに帰属
- **自動ノイズ除去**: 韓国語・ポルトガル語・スペイン語・アラビア語を自動検出 & 除外（日本語のひらがな/カタカナがあれば日本語として保持）
- 除外された件数と内容は stderr に出力される

Coordinator がやること:
- Top 10 を確認して内容の妥当性チェック
- X記事でテキストが URL-only のものがないか確認 → あれば Phase 4 へ
- 必要なら `--exclude` で追加の手動除外

```python
# 結果の概要確認（Coordinator が実行）
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

## Phase 4: X記事タイトル取得（必要な場合のみ）

X記事でテキストが t.co リンクのみの場合、Chrome 操作でタイトルを取得:

```bash
# Chrome MCP でX記事ページに移動し、タイトルを取得
mcp__claude-in-chrome__navigate → mcp__claude-in-chrome__get_page_text
```

タイトルを `{tweet_id: "タイトル"}` の JSON に保存し、`--titles` で渡す。
テキストが既にある場合はスキップ可。

## Phase 5: レポート生成（Coordinator）

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
戦略的分析はスクリプトではなく Coordinator が担当する。

## Phase 5.5: 戦略分析の追記（Coordinator / Opus）

生成された MD を読み、**Coordinator がテーマに合わせた戦略分析を追記** する。
スクリプトの出力 = データ。Coordinator の追記 = インテリジェンス。

**追記する内容:**

1. **戦略的インサイト**（3〜5項目）
   - このテーマで今どんな流れがあるか
   - どのポジションが空いているか（競合が少ない切り口）
   - ユーザーのビジネスに直結する示唆

2. **バズパターン分析**
   - TOP10 に共通する「型」は何か（ハウツー、数字訴求、体験談、速報 等）
   - 保存率が高い投稿の共通点
   - エンゲージメントが低い投稿の共通点（避けるべきパターン）

3. **具体的アクションプラン**
   - 「次にやるべきこと」をスクリプト出力より具体化
   - テーマ × ユーザーの文脈に合わせた提案
   - 参考にすべきキーパーソンのスタイル

**追記方法:** 生成された MD ファイルの先頭（「何が語られているか」の前）に `## 戦略サマリー` セクションとして挿入する。

## Phase 6: レビュー（Review Agent / Sonnet）

レポート生成後、`pr-review-toolkit:code-reviewer`（`model: "sonnet"`）で MD の品質チェックを行う。

チェック観点:
- トピック例の重複がないか
- Markdown の改行崩れがないか
- ノイズツイートが混入していないか
- 数値の整合性（いいね合計、保存率等）
- 戦略サマリーがデータと矛盾していないか

## モデル使い分け

| 役割 | モデル | 理由 |
|------|--------|------|
| Coordinator（クエリ設計・結果解釈・最終出力） | **Opus** | テーマ理解、クエリの質、ユーザーへの報告 |
| 検索実行 Subagent | **Sonnet** or Bash 直接 | 単純なコマンド実行のみ |
| レビュー Agent | **Sonnet** | MD チェックは Sonnet で十分 |
| X記事タイトル取得（Chrome） | **Sonnet** | ページ遷移 & テキスト抽出のみ |

## コスト見積もり

| スコープ | クエリ数 | ページ | 推定ツイート | 推定コスト |
|---------|---------|-------|------------|-----------|
| Quick scan | 1-2 | 1 | ~100-200 | ~$0.50-1.00 |
| Standard | 3-4 | 1 | ~300-400 | ~$1.50-2.00 |
| Deep dive | 5-6 | 1-2 | ~500-1000 | ~$3.00-5.00 |

## 実例: AI×マーケティング リサーチ

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

Phase 5.5 — 戦略分析追記

Phase 6 — レビュー → 修正 → 完了
```
