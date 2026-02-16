/**
 * Analysis engine for X research data.
 * Engagement analysis, influencer mapping, keyword/sentiment analysis.
 */

import type { Tweet } from "./api";

// --- Types ---

export interface EngagementStats {
  count: number;
  likes: { avg: number; median: number; max: number; total: number };
  impressions: { avg: number; median: number; max: number; total: number };
  retweets: { avg: number; median: number; max: number; total: number };
  replies: { avg: number; median: number; max: number; total: number };
  engagementRate: number; // (likes+RT+replies) / impressions
  byHour: Record<number, { count: number; avgLikes: number; avgImpressions: number }>;
  byContentType: {
    textOnly: { count: number; avgLikes: number; avgImpressions: number };
    withMedia: { count: number; avgLikes: number; avgImpressions: number };
    withLinks: { count: number; avgLikes: number; avgImpressions: number };
  };
}

export interface Influencer {
  username: string;
  name: string;
  followers: number;
  following: number;
  tweetCount: number;
  totalLikes: number;
  totalImpressions: number;
  totalRetweets: number;
  avgEngagementRate: number;
  category: "high_follower" | "emerging_voice" | "regular";
  topTweet: Tweet;
}

export interface KeywordAnalysis {
  topWords: { word: string; count: number }[];
  topHashtags: { tag: string; count: number }[];
  topUrls: { url: string; title: string; count: number }[];
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
    positiveKeywords: string[];
    negativeKeywords: string[];
  };
}

export interface AnalysisResult {
  query: string;
  tweetCount: number;
  dateRange: { from: string; to: string };
  engagement: EngagementStats;
  influencers: Influencer[];
  keywords: KeywordAnalysis;
}

// --- Helpers ---

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// --- Stop words (English + common X noise) ---

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "out", "off", "over",
  "under", "again", "further", "then", "once", "here", "there", "when",
  "where", "why", "how", "all", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "just", "about", "up", "it", "its",
  "this", "that", "these", "those", "i", "me", "my", "we", "our",
  "you", "your", "he", "him", "his", "she", "her", "they", "them",
  "their", "what", "which", "who", "whom", "and", "but", "or", "if",
  "while", "because", "until", "although", "since", "unless", "also",
  "get", "got", "like", "know", "think", "see", "come", "make", "go",
  "good", "new", "first", "last", "long", "great", "little", "right",
  "big", "high", "old", "different", "small", "even", "much", "way",
  "many", "well", "back", "still", "us", "really", "amp", "rt", "via",
  "one", "two", "three", "don", "t", "s", "re", "ve", "ll", "m", "d",
]);

// --- Sentiment keywords ---

const POSITIVE_KEYWORDS = [
  "love", "amazing", "awesome", "great", "excellent", "fantastic", "perfect",
  "incredible", "brilliant", "beautiful", "impressive", "outstanding", "wonderful",
  "best", "happy", "excited", "powerful", "innovative", "game-changer", "breakthrough",
  "revolutionary", "insane", "fire", "goat", "bullish", "based", "peak",
  "upgrade", "improved", "fast", "easy", "clean", "solid", "shipped",
];

const NEGATIVE_KEYWORDS = [
  "hate", "terrible", "awful", "horrible", "worst", "bad", "broken",
  "disappointing", "frustrated", "annoying", "useless", "slow", "buggy",
  "trash", "garbage", "scam", "overrated", "downgrade", "regression",
  "nightmare", "bearish", "dead", "dying", "failed", "crash", "disaster",
  "missing", "lacking", "poor", "weak", "concern", "worried", "issue",
];

// --- Analysis Functions ---

export function analyzeEngagement(tweets: Tweet[]): EngagementStats {
  if (tweets.length === 0) {
    return {
      count: 0,
      likes: { avg: 0, median: 0, max: 0, total: 0 },
      impressions: { avg: 0, median: 0, max: 0, total: 0 },
      retweets: { avg: 0, median: 0, max: 0, total: 0 },
      replies: { avg: 0, median: 0, max: 0, total: 0 },
      engagementRate: 0,
      byHour: {},
      byContentType: {
        textOnly: { count: 0, avgLikes: 0, avgImpressions: 0 },
        withMedia: { count: 0, avgLikes: 0, avgImpressions: 0 },
        withLinks: { count: 0, avgLikes: 0, avgImpressions: 0 },
      },
    };
  }

  const likes = tweets.map((t) => t.metrics.likes);
  const impressions = tweets.map((t) => t.metrics.impressions);
  const retweets = tweets.map((t) => t.metrics.retweets);
  const replies = tweets.map((t) => t.metrics.replies);

  const totalEngagement = likes.reduce((a, b) => a + b, 0)
    + retweets.reduce((a, b) => a + b, 0)
    + replies.reduce((a, b) => a + b, 0);
  const totalImp = impressions.reduce((a, b) => a + b, 0);

  // By hour
  const byHour: Record<number, { likes: number[]; impressions: number[] }> = {};
  for (const t of tweets) {
    const hour = new Date(t.created_at).getUTCHours();
    if (!byHour[hour]) byHour[hour] = { likes: [], impressions: [] };
    byHour[hour].likes.push(t.metrics.likes);
    byHour[hour].impressions.push(t.metrics.impressions);
  }
  const byHourStats: Record<number, { count: number; avgLikes: number; avgImpressions: number }> = {};
  for (const [hour, data] of Object.entries(byHour)) {
    byHourStats[Number(hour)] = {
      count: data.likes.length,
      avgLikes: avg(data.likes),
      avgImpressions: avg(data.impressions),
    };
  }

  // By content type
  const textOnly = tweets.filter((t) => t.media.length === 0 && t.url_meta.length === 0);
  const withMedia = tweets.filter((t) => t.media.length > 0);
  const withLinks = tweets.filter((t) => t.url_meta.length > 0 && t.media.length === 0);

  return {
    count: tweets.length,
    likes: { avg: avg(likes), median: median(likes), max: Math.max(...likes), total: likes.reduce((a, b) => a + b, 0) },
    impressions: { avg: avg(impressions), median: median(impressions), max: Math.max(...impressions), total: totalImp },
    retweets: { avg: avg(retweets), median: median(retweets), max: Math.max(...retweets), total: retweets.reduce((a, b) => a + b, 0) },
    replies: { avg: avg(replies), median: median(replies), max: Math.max(...replies), total: replies.reduce((a, b) => a + b, 0) },
    engagementRate: totalImp > 0 ? totalEngagement / totalImp : 0,
    byHour: byHourStats,
    byContentType: {
      textOnly: {
        count: textOnly.length,
        avgLikes: avg(textOnly.map((t) => t.metrics.likes)),
        avgImpressions: avg(textOnly.map((t) => t.metrics.impressions)),
      },
      withMedia: {
        count: withMedia.length,
        avgLikes: avg(withMedia.map((t) => t.metrics.likes)),
        avgImpressions: avg(withMedia.map((t) => t.metrics.impressions)),
      },
      withLinks: {
        count: withLinks.length,
        avgLikes: avg(withLinks.map((t) => t.metrics.likes)),
        avgImpressions: avg(withLinks.map((t) => t.metrics.impressions)),
      },
    },
  };
}

export function analyzeInfluencers(tweets: Tweet[]): Influencer[] {
  const userMap: Record<string, Tweet[]> = {};
  for (const t of tweets) {
    if (!userMap[t.username]) userMap[t.username] = [];
    userMap[t.username].push(t);
  }

  const influencers: Influencer[] = [];
  for (const [username, userTweets] of Object.entries(userMap)) {
    const first = userTweets[0];
    const totalLikes = userTweets.reduce((s, t) => s + t.metrics.likes, 0);
    const totalImp = userTweets.reduce((s, t) => s + t.metrics.impressions, 0);
    const totalRT = userTweets.reduce((s, t) => s + t.metrics.retweets, 0);
    const totalEng = totalLikes + totalRT + userTweets.reduce((s, t) => s + t.metrics.replies, 0);
    const engRate = totalImp > 0 ? totalEng / totalImp : 0;

    // Categorize
    let category: Influencer["category"] = "regular";
    if (first.author_followers >= 10_000) {
      category = "high_follower";
    } else if (first.author_followers < 5_000 && engRate > 0.05) {
      category = "emerging_voice";
    }

    const topTweet = userTweets.reduce((best, t) =>
      t.metrics.likes > best.metrics.likes ? t : best
    );

    influencers.push({
      username,
      name: first.name,
      followers: first.author_followers,
      following: first.author_following,
      tweetCount: userTweets.length,
      totalLikes,
      totalImpressions: totalImp,
      totalRetweets: totalRT,
      avgEngagementRate: engRate,
      category,
      topTweet,
    });
  }

  // Sort by followers * engagement rate (descending)
  influencers.sort((a, b) => {
    const scoreA = a.followers * a.avgEngagementRate;
    const scoreB = b.followers * b.avgEngagementRate;
    return scoreB - scoreA;
  });

  return influencers;
}

export function analyzeKeywords(tweets: Tweet[]): KeywordAnalysis {
  const wordFreq: Record<string, number> = {};
  const hashtagFreq: Record<string, number> = {};
  const urlFreq: Record<string, { title: string; count: number }> = {};

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  const positiveFound: Set<string> = new Set();
  const negativeFound: Set<string> = new Set();

  for (const t of tweets) {
    // Word frequency
    const words = t.text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    for (const w of words) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }

    // Hashtag frequency
    for (const tag of t.hashtags) {
      const lower = tag.toLowerCase();
      hashtagFreq[lower] = (hashtagFreq[lower] || 0) + 1;
    }

    // URL frequency
    for (const um of t.url_meta) {
      const host = (() => { try { return new URL(um.expanded_url).hostname; } catch { return um.expanded_url; } })();
      if (!urlFreq[um.expanded_url]) {
        urlFreq[um.expanded_url] = { title: um.title || host, count: 0 };
      }
      urlFreq[um.expanded_url].count++;
    }

    // Simple sentiment
    const lowerText = t.text.toLowerCase();
    let posScore = 0;
    let negScore = 0;
    for (const kw of POSITIVE_KEYWORDS) {
      if (lowerText.includes(kw)) {
        posScore++;
        positiveFound.add(kw);
      }
    }
    for (const kw of NEGATIVE_KEYWORDS) {
      if (lowerText.includes(kw)) {
        negScore++;
        negativeFound.add(kw);
      }
    }
    if (posScore > negScore) positive++;
    else if (negScore > posScore) negative++;
    else neutral++;
  }

  const topWords = Object.entries(wordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([word, count]) => ({ word, count }));

  const topHashtags = Object.entries(hashtagFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  const topUrls = Object.entries(urlFreq)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15)
    .map(([url, data]) => ({ url, title: data.title, count: data.count }));

  return {
    topWords,
    topHashtags,
    topUrls,
    sentiment: {
      positive,
      negative,
      neutral,
      positiveKeywords: [...positiveFound],
      negativeKeywords: [...negativeFound],
    },
  };
}

export function analyze(tweets: Tweet[], query: string): AnalysisResult {
  const dates = tweets.map((t) => new Date(t.created_at).getTime()).filter((d) => !isNaN(d));
  const from = dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : "";
  const to = dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : "";

  return {
    query,
    tweetCount: tweets.length,
    dateRange: { from, to },
    engagement: analyzeEngagement(tweets),
    influencers: analyzeInfluencers(tweets),
    keywords: analyzeKeywords(tweets),
  };
}

// --- Console Formatting ---

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function formatAnalysisConsole(result: AnalysisResult): string {
  const { engagement: eng, influencers, keywords } = result;
  let out = "";

  // Header
  out += `\n=== Analysis: "${result.query}" (${result.tweetCount} tweets) ===\n`;
  if (result.dateRange.from) {
    out += `Period: ${result.dateRange.from.split("T")[0]} → ${result.dateRange.to.split("T")[0]}\n`;
  }

  // Engagement
  out += `\n--- Engagement ---\n`;
  out += `Likes:       avg ${compactNumber(eng.likes.avg)} | med ${compactNumber(eng.likes.median)} | max ${compactNumber(eng.likes.max)} | total ${compactNumber(eng.likes.total)}\n`;
  out += `Impressions: avg ${compactNumber(eng.impressions.avg)} | med ${compactNumber(eng.impressions.median)} | max ${compactNumber(eng.impressions.max)} | total ${compactNumber(eng.impressions.total)}\n`;
  out += `Retweets:    avg ${compactNumber(eng.retweets.avg)} | med ${compactNumber(eng.retweets.median)} | max ${compactNumber(eng.retweets.max)} | total ${compactNumber(eng.retweets.total)}\n`;
  out += `Replies:     avg ${compactNumber(eng.replies.avg)} | med ${compactNumber(eng.replies.median)} | max ${compactNumber(eng.replies.max)} | total ${compactNumber(eng.replies.total)}\n`;
  out += `Engagement rate: ${pct(eng.engagementRate)}\n`;

  // Content type breakdown
  out += `\n--- Content Type ---\n`;
  out += `Text only:  ${eng.byContentType.textOnly.count} tweets (avg ${compactNumber(eng.byContentType.textOnly.avgLikes)} likes, ${compactNumber(eng.byContentType.textOnly.avgImpressions)} imp)\n`;
  out += `With media: ${eng.byContentType.withMedia.count} tweets (avg ${compactNumber(eng.byContentType.withMedia.avgLikes)} likes, ${compactNumber(eng.byContentType.withMedia.avgImpressions)} imp)\n`;
  out += `With links: ${eng.byContentType.withLinks.count} tweets (avg ${compactNumber(eng.byContentType.withLinks.avgLikes)} likes, ${compactNumber(eng.byContentType.withLinks.avgImpressions)} imp)\n`;

  // Top hours
  const hourEntries = Object.entries(eng.byHour)
    .sort(([, a], [, b]) => b.avgLikes - a.avgLikes)
    .slice(0, 5);
  if (hourEntries.length > 0) {
    out += `\n--- Top Hours (UTC) ---\n`;
    for (const [hour, data] of hourEntries) {
      out += `${String(hour).padStart(2, "0")}:00  ${data.count} tweets, avg ${compactNumber(data.avgLikes)} likes\n`;
    }
  }

  // Influencers
  const topInf = influencers.slice(0, 10);
  if (topInf.length > 0) {
    out += `\n--- Top Influencers ---\n`;
    for (const inf of topInf) {
      const tag = inf.category === "high_follower" ? " [HF]" : inf.category === "emerging_voice" ? " [EV]" : "";
      out += `@${inf.username}${tag} — ${compactNumber(inf.followers)} followers, ${inf.tweetCount} tweets, ${compactNumber(inf.totalLikes)} likes, eng ${pct(inf.avgEngagementRate)}\n`;
    }
  }

  // Keywords
  const topKw = keywords.topWords.slice(0, 15);
  if (topKw.length > 0) {
    out += `\n--- Top Keywords ---\n`;
    out += topKw.map((w) => `${w.word}(${w.count})`).join(", ") + "\n";
  }

  // Hashtags
  if (keywords.topHashtags.length > 0) {
    out += `\n--- Top Hashtags ---\n`;
    out += keywords.topHashtags.map((h) => `#${h.tag}(${h.count})`).join(", ") + "\n";
  }

  // Shared URLs
  if (keywords.topUrls.length > 0) {
    out += `\n--- Shared URLs ---\n`;
    for (const u of keywords.topUrls.slice(0, 10)) {
      out += `(${u.count}x) ${u.title} — ${u.url}\n`;
    }
  }

  // Sentiment
  const { sentiment } = keywords;
  const total = sentiment.positive + sentiment.negative + sentiment.neutral;
  if (total > 0) {
    out += `\n--- Sentiment ---\n`;
    out += `Positive: ${sentiment.positive} (${((sentiment.positive / total) * 100).toFixed(0)}%)`;
    if (sentiment.positiveKeywords.length > 0) out += ` [${sentiment.positiveKeywords.slice(0, 5).join(", ")}]`;
    out += `\n`;
    out += `Negative: ${sentiment.negative} (${((sentiment.negative / total) * 100).toFixed(0)}%)`;
    if (sentiment.negativeKeywords.length > 0) out += ` [${sentiment.negativeKeywords.slice(0, 5).join(", ")}]`;
    out += `\n`;
    out += `Neutral:  ${sentiment.neutral} (${((sentiment.neutral / total) * 100).toFixed(0)}%)\n`;
  }

  return out;
}
