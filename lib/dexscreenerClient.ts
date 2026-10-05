/**
 * lib/dexscreenerClient.ts — DexScreener adapter (keyless).
 *
 * Three jobs:
 *  1. AUTHORITATIVE MARKET DATA: USD price, market cap, liquidity, price change
 *     and buy/sell flow — the inputs for "already rugged / dumping right now"
 *     (lib/liveState.ts). Batched 30 mints per request for the live feed, with
 *     a short cache shared by every lookup.
 *  2. Fresh Solana token addresses for the Live feed.
 *  3. Resolving DEX pair (pool) addresses → base-token mints (DEXTools links).
 */

import { DEXSCREENER, MOCK_MODE } from '../config.ts';
import { asNumber, asString, fetchJson, pick } from './http.ts';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Resolve DEX pair addresses → base token mints (for DEXTools inline badges,
 * whose links carry pair addresses, not mints). Chunked ~30 per call; failures
 * simply drop out of the returned map.
 */
export async function fetchPairBaseTokens(
  pairAddresses: string[],
): Promise<Record<string, { address: string; symbol: string | null }>> {
  const out: Record<string, { address: string; symbol: string | null }> = {};
  if (MOCK_MODE || !DEXSCREENER.enabled || pairAddresses.length === 0) return out;

  for (let i = 0; i < pairAddresses.length; i += 30) {
    const chunk = pairAddresses.slice(i, i + 30);
    const json = await fetchJson(DEXSCREENER.pairsUrl.replace('{pairs}', chunk.join(',')));
    const pairs = (json as { pairs?: unknown[] } | null)?.pairs;
    if (!Array.isArray(pairs)) continue;
    for (const p of pairs) {
      const pairAddr = asString(pick(p, ['pairAddress']));
      const base = asString(pick(p, ['baseToken.address']));
      if (pairAddr && base && BASE58_RE.test(base)) {
        out[pairAddr] = { address: base, symbol: asString(pick(p, ['baseToken.symbol'])) };
      }
    }
  }
  return out;
}

/** Authoritative market data for a token from DexScreener (USD, matches the site). */
export interface DexTokenMarket {
  priceUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  /** Price change %, per window — how "already rugged/dumping" is detected. */
  priceChange5m: number | null;
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
  /** Buy/sell counts in the last hour — sell-dominance = exit in progress. */
  buys1h: number | null;
  sells1h: number | null;
  symbol: string | null;
  name: string | null;
  pairCreatedMs: number | null;
  /** The deepest pool's address — keys GeckoTerminal's price history. */
  pairAddress: string | null;
  /** Venue of the deepest pool ("pumpswap", "raydium", "meteora", …). */
  dexId: string | null;
}

/** Map one DexScreener pair object → our market shape. */
function toMarket(best: unknown): DexTokenMarket {
  return {
    priceUsd: asNumber(pick(best, ['priceUsd'])),
    marketCapUsd: asNumber(pick(best, ['marketCap', 'fdv'])),
    liquidityUsd: asNumber(pick(best, ['liquidity.usd'])),
    volume24hUsd: asNumber(pick(best, ['volume.h24'])),
    priceChange5m: asNumber(pick(best, ['priceChange.m5'])),
    priceChange1h: asNumber(pick(best, ['priceChange.h1'])),
    priceChange6h: asNumber(pick(best, ['priceChange.h6'])),
    priceChange24h: asNumber(pick(best, ['priceChange.h24'])),
    buys1h: asNumber(pick(best, ['txns.h1.buys'])),
    sells1h: asNumber(pick(best, ['txns.h1.sells'])),
    symbol: asString(pick(best, ['baseToken.symbol'])),
    name: asString(pick(best, ['baseToken.name'])),
    pairCreatedMs: asNumber(pick(best, ['pairCreatedAt'])),
    pairAddress: asString(pick(best, ['pairAddress'])),
    dexId: asString(pick(best, ['dexId'])),
  };
}

/**
 * Deepest-liquidity Solana pair wins — that's the canonical market for a token.
 * Pairs from a batch response are grouped by base-token mint first.
 */
function deepestByMint(pairs: unknown[]): Map<string, unknown> {
  const best = new Map<string, unknown>();
  const bestLiq = new Map<string, number>();
  for (const p of pairs) {
    if (asString(pick(p, ['chainId'])) !== 'solana') continue;
    const base = asString(pick(p, ['baseToken.address']));
    if (!base) continue;
    const liq = asNumber(pick(p, ['liquidity.usd'])) ?? 0;
    if (liq > (bestLiq.get(base) ?? -1)) {
      bestLiq.set(base, liq);
      best.set(base, p);
    }
  }
  return best;
}

/**
 * Short-lived market cache shared by the batch primer and single lookups.
 * A `null` entry is a REAL answer ("not listed on any DEX yet"), cached so a
 * whole sweep of on-curve coins doesn't re-ask for each one.
 */
const marketCache = new Map<string, { m: DexTokenMarket | null; at: number }>();
const MARKET_TTL_MS = 60_000; // market data has to stay fresh — this drives rug detection
const MARKET_CACHE_MAX = 600;

function cacheMarket(mint: string, m: DexTokenMarket | null): void {
  if (marketCache.size > MARKET_CACHE_MAX) marketCache.clear();
  marketCache.set(mint, { m, at: Date.now() });
}

/**
 * Batch-load market data for many mints at once (30 per request).
 *
 * This exists because the Live feed's LITE scans used to skip DexScreener
 * entirely, which meant liquidity, price change and buy/sell flow were all
 * null for every coin in the feed — so `assessLiveState` could only ever
 * answer UNKNOWN and an ALREADY-RUGGED coin sailed into the feed looking
 * normal. One batched call per 30 coins makes the rug checks actually run
 * there, at roughly the cost of a single-token lookup.
 */
export async function primeDexscreenerTokens(mints: string[]): Promise<void> {
  if (MOCK_MODE || !DEXSCREENER.enabled) return;
  const now = Date.now();
  const need = [
    ...new Set(
      mints.filter((m) => {
        if (!BASE58_RE.test(m)) return false;
        const hit = marketCache.get(m);
        return !hit || now - hit.at > MARKET_TTL_MS;
      }),
    ),
  ];

  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30);
    const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`);
    if (json === null) continue; // request failed → leave uncached so it retries
    // `pairs: null` = none of these are listed yet (typical for fresh curve coins).
    const pairs = (json as { pairs?: unknown[] | null }).pairs;
    const best = deepestByMint(Array.isArray(pairs) ? pairs : []);
    // Every mint in the chunk gets an entry: a hit, or a cached "not listed".
    for (const mint of chunk) {
      const p = best.get(mint);
      cacheMarket(mint, p ? toMarket(p) : null);
    }
  }
}

/**
 * Reliable price/market-cap/liquidity for a token, straight from DexScreener's
 * token endpoint (returns `priceUsd`, `marketCap`, `liquidity.usd` directly —
 * no derivation, matches what the sites show). Picks the deepest-liquidity
 * Solana pair. null when the token isn't listed on any DEX yet (fresh pump
 * coins on the bonding curve) or on failure. Served from the batch cache when
 * a sweep already primed it.
 */
/**
 * Cached market ONLY — never touches the network. `undefined` = not cached.
 * Used by the feed's per-row refresh, which must stay O(batch calls), not
 * O(coins): the sweep primes everything first, then every row reads from here.
 */
export function peekDexscreenerToken(mint: string): DexTokenMarket | null | undefined {
  const hit = marketCache.get(mint);
  return hit && Date.now() - hit.at < MARKET_TTL_MS ? hit.m : undefined;
}

export async function fetchDexscreenerToken(mint: string, fresh = false): Promise<DexTokenMarket | null> {
  const r = await lookupDexscreenerToken(mint, fresh);
  return r.status === 'ok' ? r.market : null;
}

/**
 * Same lookup, but tells "not listed" apart from "request failed". Anything
 * that records a VERDICT (the outcome ledger) must use this: treating a
 * network blip as "delisted" used to stamp every due prediction RUGGED.
 */
export async function lookupDexscreenerToken(
  mint: string,
  /** Skip the cache — forced re-checks (tracker, watchlist) must see a
   *  graduation or a dump that happened seconds ago. */
  fresh = false,
): Promise<{ status: 'ok'; market: DexTokenMarket | null } | { status: 'error' }> {
  if (MOCK_MODE || !DEXSCREENER.enabled || !BASE58_RE.test(mint)) return { status: 'error' };
  const hit = marketCache.get(mint);
  if (!fresh && hit && Date.now() - hit.at < MARKET_TTL_MS) return { status: 'ok', market: hit.m };

  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const pairs = (json as { pairs?: unknown[] | null } | null)?.pairs;
  // DexScreener answers an unlisted token with `pairs: null` — that's a real
  // "not listed". A null BODY is a failed request.
  if (json === null) return { status: 'error' }; // failure → do NOT cache, so it retries
  if (!Array.isArray(pairs)) {
    cacheMarket(mint, null);
    return { status: 'ok', market: null };
  }
  const best = deepestByMint(pairs).get(mint) ?? null;
  const market = best ? toMarket(best) : null;
  cacheMarket(mint, market);
  return { status: 'ok', market };
}

/** Fresh Solana token mint addresses from DexScreener's latest profiles. [] on failure. */
export async function fetchDexscreenerNewSolana(limit: number): Promise<string[]> {
  if (MOCK_MODE || !DEXSCREENER.enabled) return [];
  const json = await fetchJson(DEXSCREENER.latestProfilesUrl);
  const arr = Array.isArray(json) ? json : Array.isArray((json as { profiles?: unknown })?.profiles) ? (json as { profiles: unknown[] }).profiles : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const chain = asString(pick(item, ['chainId', 'chain']));
    if (chain !== 'solana') continue;
    const addr = asString(pick(item, ['tokenAddress', 'address']));
    if (!addr || !BASE58_RE.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Solana tokens currently being BOOSTED (paid promotion) — latest and top.
 * A radar SOURCE only: boosts can be bought, so they never raise a score.
 * They just point at coins whose team is still active and spending. [] on failure.
 */
export async function fetchDexscreenerBoostedSolana(): Promise<string[]> {
  if (MOCK_MODE || !DEXSCREENER.enabled) return [];
  const out = new Set<string>();
  for (const url of DEXSCREENER.boostsUrls) {
    const json = await fetchJson(url);
    const arr = Array.isArray(json) ? json : [];
    for (const item of arr) {
      if (asString(pick(item, ['chainId'])) !== 'solana') continue;
      const addr = asString(pick(item, ['tokenAddress']));
      if (addr && BASE58_RE.test(addr)) out.add(addr);
    }
  }
  return [...out];
}
