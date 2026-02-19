# X API Reference

## Authentication

Bearer token from env var `X_BEARER_TOKEN`.

```
-H "Authorization: Bearer $X_BEARER_TOKEN"
```

## Search Endpoint

```
GET https://api.x.com/2/tweets/search/recent
```

Covers last 7 days. Max 100 results per request.

### Standard Query Params

```
tweet.fields=created_at,public_metrics,author_id,conversation_id,entities
expansions=author_id
user.fields=username,name,public_metrics
max_results=100
```

Add `sort_order=relevancy` for relevance ranking (default is recency).

Paginate with `next_token` from response `meta.next_token`.

### Search Operators

| Operator | Example | Notes |
|----------|---------|-------|
| keyword | `bun 2.0` | Implicit AND |
| `OR` | `bun OR deno` | Must be uppercase |
| `-` | `-is:retweet` | Negation |
| `()` | `(fast OR perf)` | Grouping |
| `from:` | `from:elonmusk` | Posts by user |
| `to:` | `to:elonmusk` | Replies to user |
| `#` | `#buildinpublic` | Hashtag |
| `$` | `$AAPL` | Cashtag |
| `lang:` | `lang:en` | BCP-47 language code |
| `is:retweet` | `-is:retweet` | Filter retweets |
| `is:reply` | `-is:reply` | Filter replies |
| `is:quote` | `is:quote` | Quote tweets |
| `has:media` | `has:media` | Contains media |
| `has:links` | `has:links` | Contains links |
| `url:` | `url:github.com` | Links to domain |
| `conversation_id:` | `conversation_id:123` | Thread by root tweet ID |
| `place_country:` | `place_country:US` | Country filter |

**Unavailable on current tier:** `min_likes`, `min_retweets`, `min_replies`. Filter engagement post-hoc from `public_metrics`.

**Limits:** Max query length 512 chars. Max ~10 operators per query.

### Response Structure

```json
{
  "data": [{
    "id": "tweet_id",
    "text": "...",
    "author_id": "user_id",
    "created_at": "2026-...",
    "conversation_id": "root_tweet_id",
    "public_metrics": {
      "retweet_count": 0,
      "reply_count": 0,
      "like_count": 0,
      "quote_count": 0,
      "bookmark_count": 0,
      "impression_count": 0
    },
    "entities": {
      "urls": [{"expanded_url": "https://..."}],
      "mentions": [{"username": "..."}],
      "hashtags": [{"tag": "..."}]
    }
  }],
  "includes": {
    "users": [{"id": "user_id", "username": "handle", "name": "Display Name", "public_metrics": {...}}]
  },
  "meta": {"next_token": "...", "result_count": 100}
}
```

### Constructing Tweet URLs

```
https://x.com/{username}/status/{tweet_id}
```

Both values available from response data + user expansions.

### Linked Content

External URLs from tweets are in `entities.urls[].expanded_url`. Use WebFetch to deep-dive into linked pages (GitHub READMEs, blog posts, docs, etc.).

### Rate Limits

- 450 requests per 15-minute window (app-level)
- 300 requests per 15-minute window (user-level)

### Cost (Pay-Per-Use — Updated Feb 2026)

X API uses **pay-per-use pricing** with prepaid credits. No subscriptions, no monthly caps.

**Per-resource costs:**
| Resource | Cost |
|----------|------|
| Post read | $0.005 |
| User lookup | $0.010 |
| Post create | $0.010 |

A typical research session: 5 queries × 100 tweets = 500 post reads = ~$2.50.

**24-hour deduplication:** Same post requested multiple times within a UTC day = 1 charge. Re-running the same search within 24h costs significantly less.

**Billing details:**
- Purchase credits upfront at [console.x.com](https://console.x.com)
- Set auto-recharge (trigger amount + threshold) to avoid interruptions
- Set spending limits per billing cycle
- Failed requests are not billed
- Streaming (Filtered Stream): each unique post delivered counts, with 24h dedup

**Usage monitoring endpoint:**
```
GET https://api.x.com/2/usage/tweets
Authorization: Bearer $BEARER_TOKEN
```
Returns daily post consumption counts per app. Use for budget tracking and alerts.

**xAI credit bonus:**
| Cumulative spend (per cycle) | xAI credit rate |
|------------------------------|-----------------|
| $0 – $199 | 0% |
| $200 – $499 | 10% |
| $500 – $999 | 15% |
| $1,000+ | 20% |

Credits are rolling — order/size of purchases doesn't affect total rewards.

**Tracked endpoints (all count toward usage):**
- Post lookup, Recent search, Full-archive search
- Filtered stream, Filtered stream webhooks
- User posts/mentions timelines
- Liked posts, Bookmarks, List posts, Spaces lookup

## X API v2 の現実（実測に基づく制約まとめ）

ドキュメントに書いてないか、書いてあっても実際と違う。全部実測で確認済み。**ほんま舐めてる。**

### 1. `min_faves` / `min_likes` は API v2 で完全に使えない

X の Web 検索では `min_faves:100` が普通に動く。だから API でも使えると思うじゃん？ **使えない。**

```
HTTP 400: "Reference to invalid operator 'min_faves'"
HTTP 400: "Reference to invalid operator 'min_likes'"
```

`min_retweets`、`min_replies` も全滅。v1 時代の遺物。API v2 のドキュメントには「使えない」とすら明記されていない。X Developer Community で何年も議論されてるのに放置。**バズ投稿だけ取りたい？ 全件取って自分でフィルタしろ。以上。**

### 2. `sort_order=relevancy` はいいね順ではない

「relevancy で取ればバズ順に並ぶでしょ」→ **並ばない。**

X 独自のアルゴリズムで、何を基準にランキングしてるか非公開。同じクエリでも毎回微妙に結果が変わる。いいね 0 の投稿が上位に来て、778L のバズ投稿が下の方に埋もれることもある。

v1 には `result_type=popular` があった。v2 で消えた。代替なし。**なぜ消した。**

### 3. `max_results=100` 未満にするとバズが全滅する

実測結果（`ClaudeCode lang:ja` / relevancy）:

| max_results | 期間 | TOP いいね | 100L 超の投稿数 |
|-------------|------|-----------|---------------|
| **100** | 7d | **778L** | 2 |
| **100** | 3d | **218L** | 4 |
| 50 | 3d | 21L | 0 |
| 50 | 7d | 6L | 0 |
| 15 | 3d | 6L | 0 |
| 15 | 7d | 3L | 0 |

**50 件にした瞬間、バズ投稿が消える。** 15 件だと最大 6L。100 件で 778L 取れるものが 50 件で 21L になる。relevancy アルゴリズムが max_results に応じて候補プールを変えてるとしか思えない。**意味不明。**

→ 結論: **`max_results=100` 固定。絶対に下げるな。**

### 4. relevancy はページネーション不可

`sort_order=relevancy` だと `next_token` が返らない。つまり **1 クエリ = 最大 100 件が上限**。200 件欲しい？ 無理。クエリを工夫して別角度から 100 件ずつ取るしかない。

`sort_order=recency` ならページネーションできるが、バズ投稿を狙い撃ちできない。**どっちかしか選べないのは設計ミスだろ。**

### 5. 表記ゆれで結果が完全に変わる

同じツール、同じ期間、同じ API:

| クエリ | TOP いいね |
|--------|-----------|
| `ClaudeCode` (スペースなし) | **778L** |
| `"Claude Code"` (引用符) | **6L** |

**同じものを指してるのに結果が 130 倍違う。** これは API の問題というよりユーザーの投稿の問題だが、API 側で fuzzy matching くらいやれ。

→ 対策: **必ず OR で全表記を網羅する** (`("Claude Code" OR ClaudeCode)`)

### 6. 期間で relevancy の精度が変わる

| 期間 | 100L 超の投稿数 | TOP |
|------|---------------|-----|
| 1d | 1 | 63L |
| **3d** | **4** | **218L** |
| 7d | 2 | 778L |

3d が一番バランスが良い。7d だと中間層（100-200L）が埋もれる。期間が長いほど「真のトップ」は取れるが、中間層が犠牲になる。**どの期間でも安定して取れるようにしてくれ。**

→ 戦略: **7d でまず投げる → バズが取れなければ 3d にフォールバック**

### 7. 24 時間デデュプの罠

同じツイートを 24 時間以内に再取得すると課金されない（ありがたい）。が、**キャッシュの挙動が不透明**。テスト中に「さっきと結果が違う」が頻発。再現性がない調査は地獄。

### まとめ

X API v2 は「検索 API」を名乗ってるが、実態は **「100 件のランダムサンプリング API」** に近い。バズ投稿を確実に取る手段がなく、クエリの書き方と期間で結果が激変し、ページネーションもできない。**$0.005/post 取るならもうちょっとマシなもの提供してくれ。**

我々の対策:
1. `max_results=100` 固定（絶対に下げない）
2. 表記ゆれを OR で全パターン網羅
3. 7d → 3d のフォールバック
4. TOP 結果から次のクエリを類推（結果ベースのフォールバック）
5. post-hoc でいいね順ソート & フィルタ

**API に期待するな。クエリの質で勝負しろ。**

---

## Single Tweet Lookup

```
GET https://api.x.com/2/tweets/{id}
```

Same fields/expansions params. Use for fetching specific tweets by ID.
