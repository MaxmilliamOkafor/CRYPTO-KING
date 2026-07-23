/**
 * lib/twitterClient.ts — X / Twitter intelligence.
 *
 * Two honest layers:
 *  1. FREE (no auth, always works): build one-click live-search URLs so the
 *     user can monitor real-time chatter for a ticker or contract on X.
 *  2. ADVANCED (optional, bring-your-own X API bearer token — same pattern as
 *     the Helius key): query X API v2 recent-search for automated buzz — how
 *     many recent posts, and whether any notable (verified / large) account is
 *     posting. Degrades to null without a token, or if X rate-limits.
 *
 * Buzz is treated as CONTEXT, never proof: bot farms manufacture fake hype and
 * scammers buy engagement. It informs; it never raises a coin's grade.
 */

import { asNumber } from './http.ts';

/** Free live-search link (opens x.com). `live` = the "Latest" tab. */
export function xSearchUrl(query: string, live = true): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}${live ? '&f=live' : ''}`;
}

/** Best free monitor query for a coin: prefer the cashtag, fall back to the mint. */
export function xMonitorQuery(symbol: string | null, address: string): string {
  const sym = (symbol ?? '').replace(/[^A-Za-z0-9]/g, '');
  return sym ? `$${sym}` : address;
}

export interface XBuzz {
  /** Recent posts matched (last-page count — a floor, not a total). */
  tweetCount: number;
  /** Handles of notable (verified or >10k-follower) accounts posting. */
  notableAuthors: string[];
  /** The query used, so the UI can offer the same as a live-search link. */
  query: string;
}

/**
 * Automated buzz via X API v2 recent search. Requires a bearer token.
 * Returns null on no token, network error, or rate-limit (429) — the caller
 * then falls back to the free live-search link.
 */
export async function fetchXBuzz(symbol: string | null, address: string, bearer: string | null): Promise<XBuzz | null> {
  if (!bearer) return null;
  const base = xMonitorQuery(symbol, address);
  const query = `${base} -is:retweet`;
  const url =
    `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}` +
    `&max_results=50&expansions=author_id&user.fields=verified,public_metrics`;

  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null; // 401 bad token, 429 rate limit, etc → fall back to free link
    const json = (await res.json()) as {
      data?: unknown[];
      includes?: { users?: Array<Record<string, unknown>> };
    };
    const tweetCount = Array.isArray(json.data) ? json.data.length : 0;
    const users = json.includes?.users ?? [];
    const notableAuthors = users
      .filter((u) => {
        const followers = asNumber((u.public_metrics as Record<string, unknown> | undefined)?.followers_count) ?? 0;
        return u.verified === true || followers >= 10_000;
      })
      .map((u) => `@${String(u.username ?? '')}`)
      .filter((h) => h.length > 1)
      .slice(0, 5);
    return { tweetCount, notableAuthors, query: base };
  } catch {
    return null;
  }
}
