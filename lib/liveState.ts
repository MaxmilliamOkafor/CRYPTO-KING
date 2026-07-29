/**
 * lib/liveState.ts — "is this coin already dead, or dumping right now?"
 *
 * WHY THIS EXISTS: the structural audit (authorities, LP, holders) describes
 * how a coin is BUILT. It says nothing about whether the rug already happened.
 * A coin whose dev dumped an hour ago can still look structurally clean — which
 * is exactly how a scanner ends up surfacing corpses. This module reads live
 * market momentum and answers the separate question: what is happening NOW.
 *
 *   DEAD    — liquidity pulled / price collapsed. The rug already happened.
 *   DUMPING — falling hard and/or sells dominating. Exit in progress.
 *   HEALTHY — no collapse signature in the available windows.
 *   UNKNOWN — no momentum data (fresh on-curve coin, or unlisted). NEVER
 *             treated as healthy: unproven, not safe.
 *
 * Pure + unit-tested. Nulls never imply health.
 */

import { LIVE_STATE } from '../config.ts';
import type { LiveState, MarketInfo } from './types.ts';

export interface LiveStateResult {
  state: LiveState;
  /** Human-readable evidence, worst first. */
  reasons: string[];
}

export function assessLiveState(market: MarketInfo | null, t = LIVE_STATE): LiveStateResult {
  if (!market) return { state: 'UNKNOWN', reasons: ['No market data.'] };

  const reasons: string[] = [];
  const { priceChange1h: h1, priceChange6h: h6, priceChange24h: h24, liquidityEur: liq, marketCapEur: mcap } = market;
  const haveMomentum = h1 !== null || h6 !== null || h24 !== null;

  /* DEAD — the rug/collapse already happened. */
  let dead = false;
  if (liq !== null && liq < t.deadLiquidityUsd && (mcap === null || mcap > t.deadLiquidityUsd)) {
    dead = true;
    reasons.push(`Liquidity is only $${Math.round(liq)} — effectively pulled; you could not exit.`);
  }
  if (h24 !== null && h24 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h24))}% in 24h — this already collapsed.`);
  }
  if (h6 !== null && h6 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h — collapse in progress/complete.`);
  }
  if (dead) return { state: 'DEAD', reasons };

  /* DUMPING — actively bleeding or sells dominating. */
  if (h1 !== null && h1 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h1))}% in the last hour — actively dumping.`);
  }
  if (h6 !== null && h6 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h — sustained bleed.`);
  }
  const { buys1h: buys, sells1h: sells } = market;
  if (buys !== null && sells !== null && buys + sells >= t.minTxnsForFlow && sells > buys * t.sellDominanceRatio) {
    reasons.push(`Sells dominating (${sells} sells vs ${buys} buys in 1h) — holders exiting.`);
  }
  if (reasons.length > 0) return { state: 'DUMPING', reasons };

  if (!haveMomentum) return { state: 'UNKNOWN', reasons: ['No price-momentum data yet (unlisted/too fresh).'] };
  return { state: 'HEALTHY', reasons: [] };
}

export const LIVE_STATE_META: Record<LiveState, { label: string; color: string; textColor: string }> = {
  DEAD: { label: '💀 ALREADY RUGGED/DEAD', color: '#7a1d1d', textColor: '#ffd9d9' },
  DUMPING: { label: '📉 DUMPING NOW', color: '#8a3a10', textColor: '#ffe0c9' },
  HEALTHY: { label: 'no collapse detected', color: '#2e5a3c', textColor: '#c9f0d4' },
  UNKNOWN: { label: 'momentum unknown', color: '#3a3f4c', textColor: '#e6e8ee' },
};
