/**
 * X API wrapper — search, threads, profiles, single tweets.
 * Uses Bearer token from env: X_BEARER_TOKEN
 */

import { readFileSync } from "fs";
import { trackPostReads, trackUserLookup } from "./cost";

const BASE = "https://api.x.com/2";
const RATE_DELAY_MS = 350; // stay under 450 req/15min

function getToken(): string {
  // Try env first
  if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN;

  // Try global.env
  try {
    const envFile = readFileSync(
      `${process.env.HOME}/.config/env/global.env`,
      "utf-8"
    );
    const match = envFile.match(/X_BEARER_TOKEN=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}

  throw new Error(
    "X_BEARER_TOKEN not found in env or ~/.config/env/global.env"
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface UrlMeta {
  url: string;
  expanded_url: string;
  title?: string;
  description?: string;
}

export interface MediaItem {
  key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_url?: string;
  alt_text?: string;
}

export interface ReferencedTweet {
  type: "quoted" | "replied_to" | "retweeted";
  id: string;
}

export type PostType = "quote" | "x_article" | "article_link" | "media" | "text";

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  username: string;
  name: string;
  author_followers: number;
  author_following: number;
  created_at: string;
  conversation_id: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    impressions: number;
    bookmarks: number;
  };
  urls: string[];
  url_meta: UrlMeta[];
  media: MediaItem[];
  mentions: string[];
  hashtags: string[];
  tweet_url: string;
  account_url: string;
  referenced_tweets: ReferencedTweet[];
  post_type: PostType;
}

interface RawResponse {
  data?: any[];
  includes?: { users?: any[]; media?: any[] };
  meta?: { next_token?: string; result_count?: number };
  errors?: any[];
  title?: string;
  detail?: string;
  status?: number;
}

function parseTweets(raw: RawResponse): Tweet[] {
  if (!raw.data) return [];
  const users: Record<string, any> = {};
  for (const u of raw.includes?.users || []) {
    users[u.id] = u;
  }

  // Build media map from includes
  const mediaMap: Record<string, any> = {};
  for (const m of raw.includes?.media || []) {
    mediaMap[m.media_key] = m;
  }

  return raw.data.map((t: any) => {
    const u = users[t.author_id] || {};
    const uMetrics = u.public_metrics || {};
    const m = t.public_metrics || {};

    // Extract URL metadata (title/description from card data)
    const urlMeta: UrlMeta[] = (t.entities?.urls || [])
      .filter((u: any) => u.expanded_url && !u.expanded_url.includes("twitter.com/") && !u.expanded_url.includes("x.com/"))
      .map((u: any) => ({
        url: u.url,
        expanded_url: u.expanded_url,
        title: u.title || undefined,
        description: u.description || undefined,
      }));

    // Extract media from attachments
    const mediaKeys: string[] = t.attachments?.media_keys || [];
    const media: MediaItem[] = mediaKeys
      .map((key: string) => {
        const md = mediaMap[key];
        if (!md) return null;
        return {
          key: md.media_key,
          type: md.type as MediaItem["type"],
          url: md.url || md.variants?.[0]?.url || undefined,
          preview_url: md.preview_image_url || undefined,
          alt_text: md.alt_text || undefined,
        };
      })
      .filter(Boolean) as MediaItem[];

    // Referenced tweets (quote, reply_to, retweet)
    const referencedTweets: ReferencedTweet[] = (t.referenced_tweets || []).map((rt: any) => ({
      type: rt.type as ReferencedTweet["type"],
      id: rt.id,
    }));

    // Determine post type
    const allUrls: string[] = (t.entities?.urls || []).map((u: any) => u.expanded_url).filter(Boolean);
    const isQuote = referencedTweets.some((rt) => rt.type === "quoted");
    const isXArticle = allUrls.some((url: string) => /x\.com\/(i\/article|[^/]+\/articles?)\//.test(url)) || !!t.note_tweet;
    const hasExternalLink = urlMeta.length > 0;
    const hasMedia = media.length > 0;

    let postType: PostType = "text";
    if (isXArticle) postType = "x_article";
    else if (isQuote) postType = "quote";
    else if (hasExternalLink) postType = "article_link";
    else if (hasMedia) postType = "media";

    const username = u.username || "?";

    return {
      id: t.id,
      text: t.text,
      author_id: t.author_id,
      username,
      name: u.name || "?",
      author_followers: uMetrics.followers_count || 0,
      author_following: uMetrics.following_count || 0,
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      metrics: {
        likes: m.like_count || 0,
        retweets: m.retweet_count || 0,
        replies: m.reply_count || 0,
        quotes: m.quote_count || 0,
        impressions: m.impression_count || 0,
        bookmarks: m.bookmark_count || 0,
      },
      urls: allUrls,
      url_meta: urlMeta,
      media,
      mentions: (t.entities?.mentions || [])
        .map((m: any) => m.username)
        .filter(Boolean),
      hashtags: (t.entities?.hashtags || [])
        .map((h: any) => h.tag)
        .filter(Boolean),
      tweet_url: `https://x.com/${username}/status/${t.id}`,
      account_url: `https://x.com/${username}`,
      referenced_tweets: referencedTweets,
      post_type: postType,
    };
  });
}

const FIELDS =
  "tweet.fields=created_at,public_metrics,author_id,conversation_id,entities,attachments,referenced_tweets,note_tweet&expansions=author_id,attachments.media_keys&user.fields=username,name,public_metrics&media.fields=media_key,type,url,preview_image_url,alt_text,variants";

/**
 * Parse a "since" value into an ISO 8601 timestamp.
 * Accepts: "1h", "2h", "6h", "12h", "1d", "2d", "3d", "7d"
 * Or a raw ISO 8601 string.
 */
function parseSince(since: string): string | null {
  // Check for shorthand like "1h", "3h", "1d"
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const num = parseInt(match[1]);
    const unit = match[2];
    const ms =
      unit === "m" ? num * 60_000 :
      unit === "h" ? num * 3_600_000 :
      num * 86_400_000;
    const startTime = new Date(Date.now() - ms);
    return startTime.toISOString();
  }

  // Check if it's already ISO 8601
  if (since.includes("T") || since.includes("-")) {
    try {
      return new Date(since).toISOString();
    } catch {
      return null;
    }
  }

  return null;
}

async function apiGet(url: string): Promise<RawResponse> {
  const token = getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const reset = res.headers.get("x-rate-limit-reset");
    const waitSec = reset
      ? Math.max(parseInt(reset) - Math.floor(Date.now() / 1000), 1)
      : 60;
    throw new Error(`Rate limited. Resets in ${waitSec}s`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Search recent tweets (last 7 days).
 */
export async function search(
  query: string,
  opts: {
    maxResults?: number;
    pages?: number;
    sortOrder?: "relevancy" | "recency";
    since?: string; // ISO 8601 timestamp or shorthand like "1h", "3h", "1d"
  } = {}
): Promise<Tweet[]> {
  const maxResults = Math.max(Math.min(opts.maxResults || 100, 100), 10);
  const pages = opts.pages || 1;
  const sort = opts.sortOrder || "relevancy";
  const encoded = encodeURIComponent(query);

  // Build time filter
  let timeFilter = "";
  if (opts.since) {
    const startTime = parseSince(opts.since);
    if (startTime) {
      timeFilter = `&start_time=${startTime}`;
    }
  }

  let allTweets: Tweet[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < pages; page++) {
    const pagination = nextToken
      ? `&pagination_token=${nextToken}`
      : "";
    const url = `${BASE}/tweets/search/recent?query=${encoded}&max_results=${maxResults}&${FIELDS}&sort_order=${sort}${timeFilter}${pagination}`;

    const raw = await apiGet(url);
    const tweets = parseTweets(raw);
    trackPostReads(raw.meta?.result_count || tweets.length);
    allTweets.push(...tweets);

    nextToken = raw.meta?.next_token;
    if (!nextToken) break;
    if (page < pages - 1) await sleep(RATE_DELAY_MS);
  }

  return allTweets;
}

/**
 * Fetch a full conversation thread by root tweet ID.
 */
export async function thread(
  conversationId: string,
  opts: { pages?: number } = {}
): Promise<Tweet[]> {
  const query = `conversation_id:${conversationId}`;
  const tweets = await search(query, {
    pages: opts.pages || 2,
    sortOrder: "recency",
  });

  // Also fetch the root tweet
  try {
    const rootUrl = `${BASE}/tweets/${conversationId}?${FIELDS}`;
    const raw = await apiGet(rootUrl);
    const rootTweets = parseTweets({ ...raw, data: raw.data ? [raw.data] : (raw as any).id ? [raw] : [] });
    // Fix: single tweet lookup returns tweet at top level
    if ((raw as any).id) {
      // raw is the tweet itself — need to re-fetch with proper structure
    }
    if (rootTweets.length > 0) {
      tweets.unshift(...rootTweets);
    }
  } catch {
    // Root tweet might be deleted
  }

  return tweets;
}

/**
 * Get recent tweets from a specific user.
 */
export async function profile(
  username: string,
  opts: { count?: number; includeReplies?: boolean } = {}
): Promise<{ user: any; tweets: Tweet[] }> {
  // First, look up user ID
  const userUrl = `${BASE}/users/by/username/${username}?user.fields=public_metrics,description,created_at`;
  const userData = await apiGet(userUrl);
  trackUserLookup();

  if (!userData.data) {
    throw new Error(`User @${username} not found`);
  }

  const user = (userData as any).data;
  await sleep(RATE_DELAY_MS);

  // Build search query
  const replyFilter = opts.includeReplies ? "" : " -is:reply";
  const query = `from:${username} -is:retweet${replyFilter}`;
  const tweets = await search(query, {
    maxResults: Math.min(opts.count || 20, 100),
    sortOrder: "recency",
  });

  return { user, tweets };
}

/**
 * Fetch a single tweet by ID.
 */
export async function getTweet(tweetId: string): Promise<Tweet | null> {
  const url = `${BASE}/tweets/${tweetId}?${FIELDS}`;
  const raw = await apiGet(url);
  trackPostReads(1);

  // Single tweet returns { data: {...}, includes: {...} }
  if (raw.data && !Array.isArray(raw.data)) {
    const parsed = parseTweets({ ...raw, data: [raw.data] });
    return parsed[0] || null;
  }
  return null;
}

/**
 * Sort tweets by engagement metric.
 */
export function sortBy(
  tweets: Tweet[],
  metric: "likes" | "impressions" | "retweets" | "replies" = "likes"
): Tweet[] {
  return [...tweets].sort((a, b) => b.metrics[metric] - a.metrics[metric]);
}

/**
 * Filter tweets by minimum engagement.
 */
export function filterEngagement(
  tweets: Tweet[],
  opts: { minLikes?: number; minImpressions?: number }
): Tweet[] {
  return tweets.filter((t) => {
    if (opts.minLikes && t.metrics.likes < opts.minLikes) return false;
    if (opts.minImpressions && t.metrics.impressions < opts.minImpressions)
      return false;
    return true;
  });
}

/**
 * Deduplicate tweets by ID.
 */
export function dedupe(tweets: Tweet[]): Tweet[] {
  const seen = new Set<string>();
  return tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/**
 * Get X API usage stats (GET /2/usage/tweets).
 */
export async function getUsage(): Promise<{
  cap_reset_day: number;
  daily_project_usage: number;
  daily_client_app_usage: { usage: { date: string; value: number }[]; app_id: string }[];
}> {
  const url = `${BASE}/usage/tweets`;
  const raw = await apiGet(url);
  return raw as any;
}
