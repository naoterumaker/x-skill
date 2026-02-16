# x-search.ts CLI リファレンス

## Search

```bash
bun run x-search.ts search "<query>" [options]
```

**オプション:**
- `--sort likes|impressions|retweets|recent` — ソート順（default: likes）
- `--since 1h|3h|12h|1d|7d` — 期間フィルタ（default: 7日）。`30m` や ISO タイムスタンプも可
- `--min-likes N` — 最低いいねフィルタ
- `--min-impressions N` — 最低インプレッションフィルタ
- `--pages N` — 取得ページ数 1-5（default: 1, 100件/ページ）
- `--limit N` — 表示件数（default: 15）
- `--quick` — 1ページ, max 10件, `-is:retweet -is:reply` 自動付加, 1時間キャッシュ
- `--from <username>` — `from:username` のショートハンド
- `--quality` — 低エンゲージメント除去（いいね ≥ 10）
- `--no-replies` — リプライ除外
- `--save` — `~/clawd/drafts/` に保存
- `--json` — JSON 出力
- `--markdown` — Markdown 出力
- `--analyze` — エンゲージメント/インフルエンサー/キーワード分析実行
- `--xlsx` — xlsx エクスポート（`--analyze` 自動有効）

`-is:retweet` はクエリに含まれていなければ自動付加。

**例:**
```bash
bun run x-search.ts search "BNKR" --sort likes --limit 10
bun run x-search.ts search "from:frankdegods" --sort recent
bun run x-search.ts search "(opus 4.6 OR claude) trading" --pages 2 --save
bun run x-search.ts search "BNKR" --quick
bun run x-search.ts search "Claude Code" --pages 2 --analyze --xlsx
```

## Analyze

```bash
bun run x-search.ts analyze "<query>" [--xlsx]
```

キャッシュ済みの検索結果を再取得なしで分析。出力:
- エンゲージメント統計（平均/中央/最大いいね、インプ、エンゲージメント率）
- コンテンツタイプ別分布
- 投稿時間帯（UTC）
- インフルエンサーマップ（high_follower / emerging_voice / regular）
- キーワード頻度、ハッシュタグ、共有 URL
- センチメント分布

## Profile

```bash
bun run x-search.ts profile <username> [--count N] [--replies] [--json]
```

特定ユーザーの最近のツイート取得（リプライはデフォルト除外）。

## Thread

```bash
bun run x-search.ts thread <tweet_id> [--pages N]
```

ルートツイート ID からスレッド全文取得。

## Single Tweet

```bash
bun run x-search.ts tweet <tweet_id> [--json]
```

## Watchlist

```bash
bun run x-search.ts watchlist                       # 一覧表示
bun run x-search.ts watchlist add <user> [note]     # 追加
bun run x-search.ts watchlist remove <user>          # 削除
bun run x-search.ts watchlist check                  # 全アカウントの最新を確認
```

`data/watchlist.json` に保存。

## Usage

```bash
bun run x-search.ts usage
```

X API 使用量（日次ツイート読み取り数、上限リセット日）。

## Cache

```bash
bun run x-search.ts cache clear
```

15分 TTL。アップグレード後は `cache clear` を実行（旧キャッシュに新フィールドがないため）。
