/**
 * Cost tracking for X API usage.
 * Post Read: $0.005 per tweet
 * User Lookup: $0.010 per lookup
 */

const COST_PER_POST_READ = 0.005;
const COST_PER_USER_LOOKUP = 0.010;

interface CostSession {
  postReads: number;
  userLookups: number;
}

const session: CostSession = {
  postReads: 0,
  userLookups: 0,
};

export function trackPostReads(count: number): void {
  session.postReads += count;
}

export function trackUserLookup(count: number = 1): void {
  session.userLookups += count;
}

export function getSession(): Readonly<CostSession> {
  return { ...session };
}

export function resetSession(): void {
  session.postReads = 0;
  session.userLookups = 0;
}

export function totalCost(): number {
  return session.postReads * COST_PER_POST_READ + session.userLookups * COST_PER_USER_LOOKUP;
}

export function formatCostBreakdown(): string {
  const postCost = session.postReads * COST_PER_POST_READ;
  const userCost = session.userLookups * COST_PER_USER_LOOKUP;
  const total = postCost + userCost;

  const parts: string[] = [];
  if (session.postReads > 0) {
    parts.push(`${session.postReads} post reads ($${postCost.toFixed(2)})`);
  }
  if (session.userLookups > 0) {
    parts.push(`${session.userLookups} user lookup${session.userLookups > 1 ? "s" : ""} ($${userCost.toFixed(2)})`);
  }

  if (parts.length === 0) return "No API calls";
  return `${parts.join(" + ")} = $${total.toFixed(2)}`;
}
