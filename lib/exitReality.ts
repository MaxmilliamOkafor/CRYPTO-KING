/**
 * lib/exitReality.ts — "can I actually get OUT?" Pure, unit-testable.
 *
 * The loss nobody plans for: you pick a coin that doesn't rug, and still lose
 * money because your own exit moves the price. In a constant-product AMM,
 * selling S worth into a pool whose quote-side reserve is R costs roughly
 *   impact ≈ S / (S + R)
 * and DexScreener's `liquidity.usd` is the TOTAL pool value, so R ≈ liquidity/2.
 *
 * Inverting it gives the honest answer to the only sizing question that matters:
 *   maxPosition(for impact x) = R · x / (1 − x)
 *
 * Token-2022 transfer fees are added on top, because they're charged on the way
 * out too. Everything degrades to null when liquidity is unknown — never a
 * guess, because a wrong number here is a real loss.
 */

import { EXIT_REALITY } from '../config.ts';
import type { MarketInfo, MintInfo } from './types.ts';

export interface ExitReality {
  /** Largest position (USD) exitable within EXIT_REALITY.gentleImpactPct. */
  maxGentleUsd: number | null;
  /** Largest position (USD) exitable within EXIT_REALITY.toleratedImpactPct. */
  maxToleratedUsd: number | null;
  /** Exit cost % for the user's reference position size (config). */
  refPositionImpactPct: number | null;
  /** Token-2022 transfer fee % charged on the way out (0 for plain SPL). */
  transferFeePct: number | null;
  /** Plain-language verdict for the card. */
  note: string;
}

export function assessExitReality(
  market: MarketInfo | null,
  mint: MintInfo | null,
  t = EXIT_REALITY,
): ExitReality {
  const liquidity = market?.liquidityEur ?? null; // USD (EUR_PER_USD = 1)
  const feePct = mint?.transferFeeBps != null ? mint.transferFeeBps / 100 : mint?.isToken2022 === false ? 0 : null;

  if (liquidity === null || liquidity <= 0) {
    return {
      maxGentleUsd: null,
      maxToleratedUsd: null,
      refPositionImpactPct: null,
      transferFeePct: feePct,
      note: 'Liquidity unknown — exit cost cannot be estimated. Assume you may not get out cleanly.',
    };
  }

  const reserve = liquidity / 2; // quote-side reserve of the pool
  const maxFor = (impact: number) => (reserve * impact) / (1 - impact);
  const maxGentleUsd = maxFor(t.gentleImpactPct / 100);
  const maxToleratedUsd = maxFor(t.toleratedImpactPct / 100);

  const ref = t.referencePositionUsd;
  const rawImpact = (ref / (ref + reserve)) * 100;
  const refPositionImpactPct = rawImpact + (feePct ?? 0);

  let note: string;
  if (maxGentleUsd < t.dangerouslyThinUsd) {
    note = `Dangerously thin: even a $${Math.round(maxGentleUsd)} exit moves the price. You likely cannot sell a real position without collapsing it.`;
  } else if (refPositionImpactPct > t.toleratedImpactPct) {
    note = `A $${ref} position would cost ~${refPositionImpactPct.toFixed(1)}% to exit. Size down to ~$${Math.round(maxToleratedUsd)} or less.`;
  } else {
    note = `A $${ref} position exits at ~${refPositionImpactPct.toFixed(1)}% cost. Rough ceiling before it hurts: ~$${Math.round(maxToleratedUsd)}.`;
  }

  return { maxGentleUsd, maxToleratedUsd, refPositionImpactPct, transferFeePct: feePct, note };
}
