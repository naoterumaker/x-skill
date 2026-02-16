# Agent Team ワークフロー詳細

## Phase 0: ヒアリング（Coordinator）

検索を開始する前に、**必ず** AskUserQuestion でユーザーに確認する。

**確認項目（2問構成）:**

**Q1: 方向性・期間・品質**
- 何を知りたいか（バズ分析 / 競合調査 / 世論調査 / トレンド把握）
- 期間（直近24h / 7日 / それ以上）
- 1クエリあたりの取得件数（デフォルト: 100件）
- 最低いいね数（デフォルト: 100。50も選択可。10以下は絶対に設定しない）

**Q2: 参考情報・言語**
- 参考になるアカウントがあるか（`from:username` クエリに反映）
- 参考になるポストがあるか（クエリ設計のヒントに使う）
- 言語（日本語メイン / 英語メイン / 両方）

**ヒアリング結果の反映:**
- 期間 → `--since` パラメータ
- 取得量 → `--limit` パラメータ（デフォルト100）
- 最低いいね → `--min-likes` パラメータ（デフォルト100）
- 参考アカウント → `from:` クエリ追加
- 言語 → `lang:ja` / `lang:en` オペレータ、`-is:reply` 追加判断

## Phase 1: クエリ分解（Coordinator）

リサーチ質問を **4〜6個の検索クエリ** に分解する。

### クエリ設計の鉄則

**原則: 初手は狙って投げる。取れなかったら芸のある広げ方で対応。min-likes は絶対に下げない。**

1. **初手は狙いを絞る**
   - 感想語・文脈語を入れてピンポイントに狙うのはOK
   - 例: `"Claude Code" 便利`, `Cursor 乗り換え`, `Antigravity すごい`
   - これで100件取れれば最高。取れなければ Phase 2.5 で広げる

2. **品質は `--min-likes` + `--sort likes` に任せる**
   - `--min-likes 100` がデフォルト（ユーザー指定で変更可。ただし10以下は禁止）
   - `--sort likes` で高エンゲージメント順
   - `--pages 2` で200件取得（うち min-likes を通過したものが残る）

3. **min-likes は絶対に下げない**
   - 結果が少ない = テーマがニッチ（それ自体が有用な情報）
   - 品質を落として量を増やすのは本末転倒

### 広げ方の段階（Phase 2.5 で使う）

件数が足りない時、以下の順に広げる:

```
Stage 1: 感想語・補足語を外す
  "Claude Code" 便利 → "Claude Code"

Stage 2: 固有名詞の組み合わせを変える
  "Claude Code" MCP → "Claude Code" plugin
  "Claude Code" lang:ja → "Claude Code"（全言語に）

Stage 3: 制約を外す
  -is:reply を外す / lang: を外す

Stage 4: 取得量を増やす
  --pages 2 → --pages 3 → --pages 5

Stage 5: 期間を広げる
  --since 7d → --since 14d

⛔ 禁止: --min-likes を下げる
```

### クエリ分解の切り口

- **ツール単体** — `"Claude Code"`, `Cursor AI`, `Antigravity` → 各ツールの話題
- **ツール × ツール** — `"Claude Code" Cursor` → 比較・乗り換え文脈
- **ツール × 機能** — `"Claude Code" MCP`, `Cursor Agent` → 特定機能の話題
- **バズワード** — `"vibe coding"`, `"AI coding"` → 広域トレンド
- **エキスパート** — `from:username` → 特定の有識者

### ノイズ対策

- `-is:retweet` は自動付加
- 日本語テーマには `-is:reply` を追加推奨
- 仮想通貨ノイズ: `-airdrop -giveaway -whitelist`
- 言語フィルタ: `lang:ja` / `lang:en`

各クエリにラベルを付ける。

## Phase 2: 並列検索（Subagents）

全クエリを同時に Task subagent（Bash型）で並列実行する。

```
# 1つのメッセージで複数の Task tool を同時に呼ぶ
Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"AIマーケ" OR "AI マーケティング"' \
    --sort likes --limit 100 --json > /tmp/{slug}-core.json

Task (subagent_type: Bash, model: sonnet):
  export PATH="$HOME/.bun/bin:$PATH" && \
  cd ~/.claude/skills/x-research && source ~/.config/env/global.env && \
  bun run x-search.ts search '"ChatGPT マーケ" OR "Claude マーケ"' \
    --sort likes --limit 100 --json > /tmp/{slug}-tools.json

# ... 残りのクエリも同様に並列
```

**重要ルール:**
- 全 Task を **1つのメッセージ** で発行（並列実行される）
- Subagent は **`model: "sonnet"`** を指定
- **`export PATH="$HOME/.bun/bin:$PATH"`** をコマンド先頭に必ず付ける
- 出力先は `/tmp/{slug}-{label}.json` に統一
- `--sort likes --min-likes 100 --pages 2` が標準（min-likes はユーザー指定値を使用）
- `--limit 100` が標準

## Phase 2.5: リトライ（Coordinator）

各クエリの取得件数を確認。目標の50%未満のクエリは再検索する。

**リトライは Phase 1 の「広げ方の段階」に従って実行する:**

1. 感想語・補足語を外す
2. 固有名詞の組み合わせを変える
3. `-is:reply` を外す / `lang:` を外す
4. `--pages` を増やす（2→3→5）
5. `--since` を広げる（7d→14d）

**⛔ 絶対に変えないもの:**
- `--min-likes` は絶対に下げない（ゴミが混入する）

**リトライ不要の判断:**
- 全クエリが目標の50%以上 → Phase 3 へ
- Stage 5 まで試しても件数が増えない → その旨をユーザーに報告して Phase 3 へ（件数が少ないこと自体が有用な情報）

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

## Phase 7: 総括（Coordinator / Opus）

全 Phase 完了後、**ユーザーに口頭で総括を提示する**。MD ファイルへの追記ではなく、会話として伝える。

**総括フォーマット:**

```
## 総括

**分かったこと:**
- [3行以内でリサーチの結論]

**最も重要な発見:**
- [意外だったこと、または最もインパクトのあるインサイト]

**次のアクション:**
- [ユーザーが今すぐやるべき具体的なこと1つ]

**レポート:**
- MD: [パス]
- xlsx: [パス]
```

ポイント:
- レポートの要約ではなく「so what（だから何？）」を伝える
- ユーザーの文脈（何を作っている人か、何が目的か）に合わせて具体化
- アクションは1つに絞る（多いと動けない）

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
| Standard | 4-6 | 1 | ~400-600 | ~$2.00-3.00 |
| Deep dive | 5-6 | 2 | ~1000-1200 | ~$5.00-6.00 |

## 実例: Cursor vs Claude Code vs Antigravity

```
User: "Cursor vs Claude Code vs Antigravityの論争をリサーチして"

Phase 0 — ヒアリング:
  → バズ分析+競合調査、7日、100件/クエリ、min-likes 100、日本語メイン

Phase 1 — クエリ分解（シンプルな固有名詞のみ）:
  1. "Claude Code" lang:ja          → cc-ja（JP での CC 話題）
  2. Cursor lang:ja                 → cursor-ja（JP での Cursor 話題）
  3. Antigravity lang:ja            → ag-ja（JP での AG 話題）
  4. "Claude Code"                  → cc-all（全言語 CC）
  5. "Claude Code" Cursor           → cc-cursor（CC×Cursor 比較文脈）
  6. Antigravity agent              → ag-all（AG エージェント文脈）

  ※ 感想語ゼロ。方向性はキーワードの組み合わせで表現。

Phase 2 — 6件並列検索（--sort likes --min-likes 100 --pages 2）
  → /tmp/ccvs-{cc-ja,cursor-ja,ag-ja,cc-all,cc-cursor,ag-all}.json

Phase 2.5 — リトライ判定:
  cc-ja: 50件 ✅ / cursor-ja: 30件 → --pages 3 で再検索
  ※ min-likes は絶対に下げない

Phase 3 → Phase 5 → Phase 5.5 → Phase 6 → Phase 7
```
