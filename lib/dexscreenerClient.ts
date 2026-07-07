/**
 * lib/dexscreenerClient.ts — DexScreener adapter (keyless fallback source).
 *
 * Only used to obtain a list of fresh Solana token addresses for the Live feed
 * when pump.fun is unavailable. Risk scoring still happens via the normal
 * pipeline (Solana RPC + GMGN + pump.fun) per address — DexScreener here is
 * purely a candidate-address source, so the tool never depends on one endpoint.
 */

import { DEXSCREENER, MOCK_MODE } from '../config.ts';
import { asString, fetchJson, pick } from './http.ts';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
