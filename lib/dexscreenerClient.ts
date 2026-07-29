/**
 * lib/dexscreenerClient.ts — DexScreener adapter (keyless fallback source).
 *
 * Only used to obtain a list of fresh Solana token addresses for the Live feed
 * when pump.fun is unavailable. Risk scoring still happens via the normal
 * pipeline (Solana RPC + GMGN + pump.fun) per address — DexScreener here is
 * purely a candidate-address source, so the tool never depends on one endpoint.
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
}

/**
 * Reliable price/market-cap/liquidity for a token, straight from DexScreener's
 * token endpoint (returns `priceUsd`, `marketCap`, `liquidity.usd` directly —
 * no derivation, matches what the sites show). Picks the deepest-liquidity
 * Solana pair. null when the token isn't listed on any DEX yet (fresh pump
 * coins on the bonding curve) or on failure.
 */
export async function fetchDexscreenerToken(mint: string): Promise<DexTokenMarket | null> {
  if (MOCK_MODE || !DEXSCREENER.enabled || !BASE58_RE.test(mint)) return null;
  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const pairs = (json as { pairs?: unknown[] } | null)?.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return null;

  // Deepest Solana pair = the canonical market for the token.
  let best: unknown = null;
  let bestLiq = -1;
  for (const p of pairs) {
    if (asString(pick(p, ['chainId'])) !== 'solana') continue;
    const liq = asNumber(pick(p, ['liquidity.usd'])) ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = p;
    }
  }
  if (!best) return null;

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
  };
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
