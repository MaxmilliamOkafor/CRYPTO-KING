/**
 * lib/linkTargets.ts — pure link parsing, shared by the content script.
 *
 * Every coin the on-page scanner finds comes from an href, so a missing link
 * shape means an entire site silently scans nothing. That is exactly what
 * happened on DEXTools: its whole app addresses coins by POOL
 * (`/app/en/solana/pair-explorer/<pair>`), never by mint, so pages like
 * live-new-pairs produced an empty list with no error.
 *
 * Two shapes, kept apart on purpose:
 *  - MINT links point at the token itself and can be scanned directly.
 *  - PAIR links point at a liquidity pool and MUST be resolved to their base
 *    token via DexScreener first — scanning a pool address as if it were a mint
 *    returns garbage.
 */

const BASE58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';

/** Links that carry a token mint directly. */
export const MINT_HREF_RES = [
  new RegExp(`/sol/token/(${BASE58})`), // gmgn.ai
  new RegExp(`/coin/(${BASE58})`), // pump.fun
  new RegExp(`solscan\\.io/token/(${BASE58})`),
  new RegExp(`birdeye\\.so/token/(${BASE58})`),
];

/** Links that carry a pool/pair address needing resolution. */
export const PAIR_HREF_RES = [
  new RegExp(`/pair-explorer/(${BASE58})`), // dextools, all chains
  new RegExp(`dexscreener\\.com/solana/(${BASE58})`),
];

/** First capture group across a list of patterns, or null. */
export function matchFirst(res: RegExp[], href: string): string | null {
  for (const re of res) {
    const m = href.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * DEXTools serves every chain from `/pair-explorer/`, and an Ethereum pool will
 * never resolve against DexScreener's Solana endpoint — following those links
 * only burns retries. Both `/app/solana/…` and the localized `/app/en/solana/…`
 * count as Solana. Non-DEXTools hosts carry the chain in the link itself.
 */
export function pairLinksAreSolana(hostname: string, pathname: string): boolean {
  if (!hostname.endsWith('dextools.io')) return true;
  return /(^|\/)solana(\/|$)/.test(pathname);
}
