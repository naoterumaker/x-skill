#!/usr/bin/env bun
/**
 * x-search — CLI for X/Twitter research.
 *
 * Commands:
 *   search <query> [options]    Search recent tweets
 *   thread <tweet_id>           Fetch full conversation thread
 *   profile <username>          Recent tweets from a user
 *   tweet <tweet_id>            Fetch a single tweet
 *   analyze <query>             Analyze cached results (no re-fetch)
 *   usage                       Show X API usage stats
 *   watchlist                   Show watchlist
 *   watchlist add <user>        Add user to watchlist
 *   watchlist remove <user>     Remove user from watchlist
 *   watchlist check             Check recent tweets from all watchlist accounts
 *   cache clear                 Clear search cache
 *
 * Search options:
 *   --sort likes|impressions|retweets|recent   Sort order (default: likes)
 *   --min-likes N              Filter by minimum likes
 *   --min-impressions N        Filter by minimum impressions
 *   --pages N                  Number of pages to fetch (default: 1, max 5)
 *   --no-replies               Exclude replies
 *   --no-retweets              Exclude retweets (added by default)
 *   --limit N                  Max results to display (default: 15)
 *   --quick                    Quick mode: 1 page, noise filter, 1hr cache
 *   --from <username>          Shorthand for from:username in query
 *   --quality                  Pre-filter low-engagement (min_faves:10)
 *   --save                     Save results to ~/clawd/drafts/
 *   --json                     Output raw JSON
 *   --markdown                 Output as markdown (for research docs)
 *   --analyze                  Run analysis on results
 *   --xlsx                     Export results + analysis to xlsx
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import * as api from "./lib/api";
import * as cache from "./lib/cache";
import * as fmt from "./lib/format";
import * as cost from "./lib/cost";
import { analyze, formatAnalysisConsole } from "./lib/analyze";
import { exportXlsx } from "./lib/xlsx";

const SKILL_DIR = import.meta.dir;
const WATCHLIST_PATH = join(SKILL_DIR, "data", "watchlist.json");
const DRAFTS_DIR = join(process.env.HOME!, "clawd", "drafts");

// --- Arg parsing ---

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): boolean {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

function getOpt(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
}

// --- Watchlist ---

interface Watchlist {
  accounts: { username: string; note?: string; addedAt: string }[];
}

function loadWatchlist(): Watchlist {
  if (!existsSync(WATCHLIST_PATH))
    return { accounts: [] };
  return JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
}

function saveWatchlist(wl: Watchlist) {
  writeFileSync(WATCHLIST_PATH, JSON.stringify(wl, null, 2));
}

// --- Commands ---

async function cmdSearch() {
  // Parse new flags first (before getOpt consumes positional args)
  const quick = getFlag("quick");
  const quality = getFlag("quality");
  const fromUser = getOpt("from");
  const doAnalyze = getFlag("analyze");
  const doXlsx = getFlag("xlsx");

  const sortOpt = getOpt("sort") || "likes";
  const minLikes = parseInt(getOpt("min-likes") || "0");
  const minImpressions = parseInt(getOpt("min-impressions") || "0");
  let pages = Math.min(parseInt(getOpt("pages") || "1"), 5);
  let limit = parseInt(getOpt("limit") || "15");
  const since = getOpt("since");
  const noReplies = getFlag("no-replies");
  const noRetweets = getFlag("no-retweets");
  const save = getFlag("save");
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");

  // Quick mode overrides
  if (quick) {
    pages = 1;
    limit = Math.min(limit, 10);
  }

  // Everything after "search" that isn't a flag is the query
  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  let query = queryParts.join(" ");

  if (!query) {
    console.error("Usage: x-search.ts search <query> [options]");
    process.exit(1);
  }

  // --from shorthand: add from:username if not already in query
  if (fromUser && !query.toLowerCase().includes("from:")) {
    query += ` from:${fromUser.replace(/^@/, "")}`;
  }

  // Auto-add noise filters unless already present
  if (!query.includes("is:retweet") && !noRetweets) {
    query += " -is:retweet";
  }
  if (quick && !query.includes("is:reply")) {
    query += " -is:reply";
  } else if (noReplies && !query.includes("is:reply")) {
    query += " -is:reply";
  }

  // Cache TTL: 1hr for quick mode, 15min default
  const cacheTtlMs = quick ? 3_600_000 : 900_000;

  // Check cache (cache key does NOT include quick flag — shared between modes)
  const cacheParams = `sort=${sortOpt}&pages=${pages}&since=${since || "7d"}`;
  const cached = cache.get(query, cacheParams, cacheTtlMs);
  let tweets: api.Tweet[];

  if (cached) {
    tweets = cached;
    console.error(`(cached — ${tweets.length} tweets)`);
  } else {
    tweets = await api.search(query, {
      pages,
      // Always use recency for API pagination (relevancy doesn't paginate).
      // Local sort by likes/impressions/retweets is applied after fetching.
      sortOrder: "recency",
      since: since || undefined,
    });
    cache.set(query, cacheParams, tweets);
  }

  // Track raw count for cost (API charges per tweet read, regardless of post-hoc filters)
  const rawTweetCount = tweets.length;

  // Filter
  if (minLikes > 0 || minImpressions > 0) {
    tweets = api.filterEngagement(tweets, {
      minLikes: minLikes || undefined,
      minImpressions: minImpressions || undefined,
    });
  }

  // --quality: post-hoc filter for min 10 likes (min_faves operator unavailable on Basic tier)
  if (quality) {
    tweets = api.filterEngagement(tweets, { minLikes: 10 });
  }

  // Sort
  if (sortOpt !== "recent") {
    const metric = sortOpt as "likes" | "impressions" | "retweets";
    tweets = api.sortBy(tweets, metric);
  }

  tweets = api.dedupe(tweets);

  // Output
  if (asJson) {
    console.log(JSON.stringify(tweets.slice(0, limit), null, 2));
  } else if (asMarkdown) {
    const md = fmt.formatResearchMarkdown(query, tweets, {
      queries: [query],
    });
    console.log(md);
  } else {
    console.log(fmt.formatResultsTelegram(tweets, { query, limit }));
  }

  // Save
  if (save) {
    const slug = query
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .toLowerCase();
    const date = new Date().toISOString().split("T")[0];
    const path = join(DRAFTS_DIR, `x-research-${slug}-${date}.md`);
    const md = fmt.formatResearchMarkdown(query, tweets, {
      queries: [query],
    });
    writeFileSync(path, md);
    console.error(`\nSaved to ${path}`);
  }

  // Analysis (--analyze or --xlsx implies analyze)
  if (doAnalyze || doXlsx) {
    const result = analyze(tweets, query);
    console.error(formatAnalysisConsole(result));

    // xlsx export
    if (doXlsx) {
      try {
        const xlsxPath = await exportXlsx(tweets, result);
        console.error(`\n📊 xlsx saved: ${xlsxPath}`);
      } catch (e: any) {
        console.error(`\n❌ xlsx export failed: ${e.message}`);
      }
    }
  }

  // Cost display (accurate breakdown)
  const costBreakdown = cost.formatCostBreakdown();
  if (quick) {
    console.error(`\n⚡ quick mode · ${costBreakdown}`);
  } else {
    console.error(`\n💰 ${costBreakdown}`);
  }

  // Stats to stderr
  const filtered = rawTweetCount !== tweets.length ? ` → ${tweets.length} after filters` : "";
  const sinceLabel = since ? ` | since ${since}` : "";
  console.error(
    `${rawTweetCount} tweets${filtered} | sorted by ${sortOpt} | ${pages} page(s)${sinceLabel}`
  );
}

async function cmdAnalyze() {
  const doXlsx = getFlag("xlsx");

  // Everything after "analyze" that isn't a flag is the query
  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  const query = queryParts.join(" ");

  if (!query) {
    console.error("Usage: x-search.ts analyze <query> [--xlsx]");
    console.error("Analyzes cached results without re-fetching from API.");
    process.exit(1);
  }

  // Try to find cached results — check multiple common cache param patterns
  const paramPatterns = [
    "sort=likes&pages=1&since=7d",
    "sort=likes&pages=2&since=7d",
    "sort=likes&pages=3&since=7d",
    "sort=recent&pages=1&since=7d",
    "sort=impressions&pages=1&since=7d",
  ];

  let tweets: api.Tweet[] | null = null;
  // Try with noise filter appended (most common)
  const queryVariants = [
    query,
    query + " -is:retweet",
    query + " -is:retweet -is:reply",
  ];

  for (const qv of queryVariants) {
    for (const params of paramPatterns) {
      const cached = cache.get(qv, params, 24 * 3_600_000); // 24hr TTL for analyze
      if (cached) {
        tweets = cached;
        console.error(`Found cached results for "${qv}" (${tweets.length} tweets)`);
        break;
      }
    }
    if (tweets) break;
  }

  if (!tweets) {
    console.error(`No cached results found for "${query}".`);
    console.error(`Run a search first: bun run x-search.ts search "${query}"`);
    process.exit(1);
  }

  const result = analyze(tweets, query);
  console.log(formatAnalysisConsole(result));

  if (doXlsx) {
    try {
      const xlsxPath = await exportXlsx(tweets, result);
      console.error(`\n📊 xlsx saved: ${xlsxPath}`);
    } catch (e: any) {
      console.error(`\n❌ xlsx export failed: ${e.message}`);
    }
  }
}

async function cmdUsage() {
  try {
    const usage = await api.getUsage();
    console.log("=== X API Usage ===\n");

    if (usage.daily_client_app_usage) {
      for (const app of usage.daily_client_app_usage) {
        console.log(`App ID: ${app.app_id}`);
        if (app.usage && app.usage.length > 0) {
          for (const u of app.usage.slice(-7)) {
            console.log(`  ${u.date}: ${u.value} tweets read`);
          }
        }
      }
    }

    if (usage.daily_project_usage !== undefined) {
      console.log(`\nDaily project usage: ${usage.daily_project_usage}`);
    }
    if (usage.cap_reset_day !== undefined) {
      console.log(`Cap reset day: ${usage.cap_reset_day}`);
    }
  } catch (e: any) {
    console.error(`Failed to fetch usage: ${e.message}`);
    process.exit(1);
  }
}

async function cmdThread() {
  const tweetId = args[1];
  if (!tweetId) {
    console.error("Usage: x-search.ts thread <tweet_id>");
    process.exit(1);
  }

  const pages = Math.min(parseInt(getOpt("pages") || "2"), 5);
  const tweets = await api.thread(tweetId, { pages });

  if (tweets.length === 0) {
    console.log("No tweets found in thread.");
    return;
  }

  console.log(`🧵 Thread (${tweets.length} tweets)\n`);
  for (const t of tweets) {
    console.log(fmt.formatTweetTelegram(t));
    console.log();
  }

  console.error(`\n💰 ${cost.formatCostBreakdown()}`);
}

async function cmdProfile() {
  const username = args[1]?.replace(/^@/, "");
  if (!username) {
    console.error("Usage: x-search.ts profile <username>");
    process.exit(1);
  }

  const count = parseInt(getOpt("count") || "20");
  const includeReplies = getFlag("replies");
  const asJson = getFlag("json");

  const { user, tweets } = await api.profile(username, {
    count,
    includeReplies,
  });

  if (asJson) {
    console.log(JSON.stringify({ user, tweets }, null, 2));
  } else {
    console.log(fmt.formatProfileTelegram(user, tweets));
  }

  console.error(`\n💰 ${cost.formatCostBreakdown()}`);
}

async function cmdTweet() {
  const tweetId = args[1];
  if (!tweetId) {
    console.error("Usage: x-search.ts tweet <tweet_id>");
    process.exit(1);
  }

  const tweet = await api.getTweet(tweetId);
  if (!tweet) {
    console.log("Tweet not found.");
    return;
  }

  const asJson = getFlag("json");
  if (asJson) {
    console.log(JSON.stringify(tweet, null, 2));
  } else {
    console.log(fmt.formatTweetTelegram(tweet));
  }

  console.error(`\n💰 ${cost.formatCostBreakdown()}`);
}

async function cmdWatchlist() {
  const sub = args[1];
  const wl = loadWatchlist();

  if (sub === "add") {
    const username = args[2]?.replace(/^@/, "");
    const note = args.slice(3).join(" ") || undefined;
    if (!username) {
      console.error("Usage: x-search.ts watchlist add <username> [note]");
      process.exit(1);
    }
    if (wl.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase())) {
      console.log(`@${username} already on watchlist.`);
      return;
    }
    wl.accounts.push({
      username,
      note,
      addedAt: new Date().toISOString(),
    });
    saveWatchlist(wl);
    console.log(`Added @${username} to watchlist.${note ? ` (${note})` : ""}`);
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const username = args[2]?.replace(/^@/, "");
    if (!username) {
      console.error("Usage: x-search.ts watchlist remove <username>");
      process.exit(1);
    }
    const before = wl.accounts.length;
    wl.accounts = wl.accounts.filter(
      (a) => a.username.toLowerCase() !== username.toLowerCase()
    );
    saveWatchlist(wl);
    console.log(
      wl.accounts.length < before
        ? `Removed @${username} from watchlist.`
        : `@${username} not found on watchlist.`
    );
    return;
  }

  if (sub === "check") {
    if (wl.accounts.length === 0) {
      console.log("Watchlist is empty. Add accounts with: watchlist add <username>");
      return;
    }
    console.log(`Checking ${wl.accounts.length} watchlist accounts...\n`);
    for (const acct of wl.accounts) {
      try {
        const { user, tweets } = await api.profile(acct.username, { count: 5 });
        const label = acct.note ? ` (${acct.note})` : "";
        console.log(`\n--- @${acct.username}${label} ---`);
        if (tweets.length === 0) {
          console.log("  No recent tweets.");
        } else {
          for (const t of tweets.slice(0, 3)) {
            console.log(fmt.formatTweetTelegram(t));
            console.log();
          }
        }
      } catch (e: any) {
        console.error(`  Error checking @${acct.username}: ${e.message}`);
      }
    }
    console.error(`\n💰 ${cost.formatCostBreakdown()}`);
    return;
  }

  // Default: show watchlist
  if (wl.accounts.length === 0) {
    console.log("Watchlist is empty. Add accounts with: watchlist add <username>");
    return;
  }
  console.log(`📋 Watchlist (${wl.accounts.length} accounts)\n`);
  for (const acct of wl.accounts) {
    const note = acct.note ? ` — ${acct.note}` : "";
    console.log(`  @${acct.username}${note} (added ${acct.addedAt.split("T")[0]})`);
  }
}

async function cmdCache() {
  const sub = args[1];
  if (sub === "clear") {
    const removed = cache.clear();
    console.log(`Cleared ${removed} cached entries.`);
  } else {
    const removed = cache.prune();
    console.log(`Pruned ${removed} expired entries.`);
  }
}

function showUsage() {
  console.log(`x-search — X/Twitter research CLI

Commands:
  search <query> [options]    Search recent tweets (last 7 days)
  thread <tweet_id>           Fetch full conversation thread
  profile <username>          Recent tweets from a user
  tweet <tweet_id>            Fetch a single tweet
  analyze <query> [--xlsx]    Analyze cached results (no re-fetch)
  usage                       Show X API usage stats
  watchlist                   Show watchlist
  watchlist add <user> [note] Add user to watchlist
  watchlist remove <user>     Remove user from watchlist
  watchlist check             Check recent from all watchlist accounts
  cache clear                 Clear search cache

Search options:
  --sort likes|impressions|retweets|recent   (default: likes)
  --since 1h|3h|12h|1d|7d   Time filter (default: last 7 days)
  --min-likes N              Filter minimum likes
  --min-impressions N        Filter minimum impressions
  --pages N                  Pages to fetch, 1-5 (default: 1)
  --limit N                  Results to display (default: 15)
  --quick                    Quick mode: 1 page, max 10 results, auto noise
                             filter, 1hr cache TTL, cost summary
  --from <username>          Shorthand for from:username in query
  --quality                  Pre-filter low-engagement tweets (min_faves:10)
  --no-replies               Exclude replies
  --save                     Save to ~/clawd/drafts/
  --json                     Raw JSON output
  --markdown                 Markdown output
  --analyze                  Run analysis on search results
  --xlsx                     Export to xlsx (auto-enables --analyze)`);
}

// --- Main ---

async function main() {
  switch (command) {
    case "search":
    case "s":
      await cmdSearch();
      break;
    case "analyze":
    case "a":
      await cmdAnalyze();
      break;
    case "usage":
      await cmdUsage();
      break;
    case "thread":
    case "t":
      await cmdThread();
      break;
    case "profile":
    case "p":
      await cmdProfile();
      break;
    case "tweet":
      await cmdTweet();
      break;
    case "watchlist":
    case "wl":
      await cmdWatchlist();
      break;
    case "cache":
      await cmdCache();
      break;
    default:
      showUsage();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
