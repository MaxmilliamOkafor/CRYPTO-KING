/**
 * lib/radarScreen.ts — the radar's QUICK SCREEN. Pure, unit-tested.
 *
 * The radar runs continuously and watches thousands of young coins, so it
 * can't deep-check them all (a deep check = full on-chain scan + price
 * history + holders, and the free APIs are rate-limited). Every coin gets this
 * cheap screen first, from one batched DexScreener call per 30 coins; only the
 * top-ranked survivors get the deep check. Wide funnel, short list: the user
 * sees the best few, not everything that was looked at.
 *
 * Filters target YOUNG + LOW-CAP survivors — old/big coins already did their
 * run. Ranking favours real activity, buy pressure, liquidity depth, an
 * uptrend, and EARLINESS (a 2-day-old coin beats a 20-day-old one).
 */

import { LONG_HOLD } from '../config.ts';
import type { DexTokenMarket } from './dexscreenerClient.ts';
import { assessLiveState } from './liveState.ts';

export interface QuickResult {
  /** Passed every filter — worth listing (and maybe a deep check). */
  pass: boolean;
  /** Effectively dead — stop watching it entirely. */
  dead: boolean;
  /** Why it failed (null when it passed). */
  reason: string | null;
  /** 0–100 ranking among passing coins (higher = better). */
  rank: number;
  /** One-line summary for the list. */
  headline: string;
}

export function quickScreen(m: DexTokenMarket, ageDays: number | null, t = LONG_HOLD): QuickResult {
  const liq = m.liquidityUsd;
  const mcap = m.marketCapUsd;
  const fail = (reason: string, dead = false): QuickResult => ({ pass: false, dead, reason, rank: 0, headline: reason });

  const live = assessLiveState({
    priceEur: m.priceUsd,
    marketCapEur: mcap,
    liquidityEur: liq,
    volume24hEur: m.volume24hUsd,
    lpStatus: 'unknown',
    sellSimulation: null,
    priceChange1h: m.priceChange1h,
    priceChange6h: m.priceChange6h,
    priceChange24h: m.priceChange24h,
    buys1h: m.buys1h,
    sells1h: m.sells1h,
  });
  if (liq === null || liq < 5_000 || live.state === 'DEAD') return fail('Dead — liquidity gone or price collapsed.', true);
  if (ageDays === null) return fail('Age unknown.');
  if (ageDays < t.radarMinAgeDays) return fail('Under a day old — the gem tracker covers launches.');
  if (ageDays > t.radarMaxAgeDays) return fail(`${Math.floor(ageDays)} days old — past the early window.`);
  if (mcap === null || mcap < t.radarMinMcapUsd) return fail('Market cap too small to trade safely.');
  if (mcap > t.radarMaxMcapUsd) return fail('Already big — the early run is done.');
  if (liq < t.radarMinLiquidityUsd) return fail('Liquidity too thin.');
  if (liq / mcap < 0.03) return fail('Liquidity under 3% of cap — fragile.');
  const vol = m.volume24hUsd;
  if (vol !== null && vol / liq > t.washVolLiqRatio) return fail('Volume over 10× liquidity — wash trading.');
  if (live.state === 'DUMPING') return fail(`Dumping — ${live.reasons[0] ?? 'falling hard.'}`);
  if (m.priceChange24h !== null && m.priceChange24h <= -50) return fail('Down 50%+ in 24h.');

  /* Rank (0–100) */
  const buys = m.buys1h ?? 0;
  const sells = m.sells1h ?? 0;
  const tx = buys + sells;
  let rank = Math.min(30, Math.log10(1 + tx) * 12); // real activity (100 tx/h ≈ 24, 300 ≈ 30)
  const buyShare = tx > 0 ? buys / tx : 0;
  rank += buyShare >= 0.6 ? 20 : buyShare >= 0.5 ? 12 : buyShare >= 0.4 ? 5 : 0;
  const depth = liq / mcap;
  rank += depth >= 0.15 ? 20 : depth >= 0.1 ? 15 : depth >= 0.05 ? 8 : 0;
  const h6 = m.priceChange6h ?? 0;
  const h24 = m.priceChange24h ?? 0;
  rank += h6 > 0 && h24 > 0 ? 15 : h24 > 0 ? 8 : 0;
  rank += ageDays <= 7 ? 15 : ageDays <= 14 ? 10 : 5; // earlier = more upside left

  const headline =
    `${fmtAge(ageDays)} · ${usd(mcap)} cap · ${usd(liq)} liq` +
    (tx > 0 ? ` · ${buys}/${sells} buys/sells 1h` : '') +
    (m.priceChange24h !== null ? ` · ${m.priceChange24h >= 0 ? '+' : ''}${m.priceChange24h.toFixed(0)}% 24h` : '');
  return { pass: true, dead: false, reason: null, rank: Math.round(rank), headline };
}

function usd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtAge(d: number): string {
  return d < 2 ? `${Math.round(d * 24)}h old` : `${Math.floor(d)}d old`;
}
