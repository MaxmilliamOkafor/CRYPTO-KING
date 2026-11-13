/**
 * lib/sizing.ts — "how much, at most?" Pure, unit-tested.
 *
 * No scanner can make meme coins safe: most picks fail, including good-looking
 * ones. What decides whether an early-entry strategy survives is SIZE — losing
 * 1–2% of a bankroll on each failure is survivable for dozens of picks in a
 * row; losing 25% is over after four. So every coin card answers one question
 * the grade can't: the most this coin can justify out of YOUR bankroll.
 *
 *   max = bankroll × risk-per-pick × stage factor, capped by what the pool
 *         lets you sell without moving the price more than a tolerable amount.
 *
 * Stage factor: a minutes-old launch has the least evidence, so it gets half
 * the normal size; a coin that passed the long-hold screen gets 1.5×. A coin
 * that fails its checks gets zero. This is a CEILING for risk control — never
 * a suggestion to buy.
 */

import { SIZING } from '../config.ts';

export type SizingStage = 'launch' | 'young' | 'rooted' | 'reject';

export interface SizingPlan {
  /** Hard ceiling in USD; 0 for rejected coins; null when no bankroll is set. */
  maxUsd: number | null;
  /** One-line plan for the card. */
  headline: string;
  /** Supporting lines (what limits it, what a total loss costs). */
  notes: string[];
}

export function planPosition(
  bankrollUsd: number | null,
  riskPct: number | null,
  stage: SizingStage,
  /** Largest sell (USD) the pool absorbs within the tolerated price impact; null = unknown. */
  poolCapUsd: number | null,
  t = SIZING,
): SizingPlan {
  if (stage === 'reject') {
    return { maxUsd: 0, headline: 'Max size: $0 — this coin fails its checks.', notes: [] };
  }
  if (bankrollUsd === null || !(bankrollUsd > 0)) {
    return {
      maxUsd: null,
      headline: 'Set your bankroll (toolbar icon → Risk plan) to get a max size for every coin.',
      notes: [],
    };
  }
  const pct = Math.min(t.maxRiskPct, Math.max(t.minRiskPct, riskPct ?? t.defaultRiskPct));
  const factor = t.stageFactor[stage];
  const byBankroll = bankrollUsd * (pct / 100) * factor;
  const capped = poolCapUsd !== null && poolCapUsd < byBankroll;
  const max = roundDown(capped ? (poolCapUsd as number) : byBankroll);

  const notes: string[] = [];
  notes.push(
    stage === 'launch'
      ? `Half size: a launch this new has the least evidence (${pct}% × ${factor} of your $${fmt(bankrollUsd)}).`
      : stage === 'rooted'
        ? `Passed the long-hold screen, so up to ${factor}× your normal ${pct}% per pick.`
        : `${pct}% of your $${fmt(bankrollUsd)} bankroll per pick.`,
  );
  if (capped) notes.push(`Capped by the pool: selling more than ~$${fmt(poolCapUsd as number)} would move the price against you.`);
  if (poolCapUsd === null && stage !== 'launch') notes.push('Pool depth unknown — the real exit limit could be lower.');
  if (max > 0) {
    const share = (max / bankrollUsd) * 100;
    notes.push(`If it goes to zero you lose $${fmt(max)} — ${share < 0.1 ? '<0.1' : share.toFixed(1)}% of your bankroll. You could take ${Math.floor(bankrollUsd / max)} such losses in a row.`);
  }
  return { maxUsd: max, headline: `Max size: $${fmt(max)}`, notes };
}

/** Round DOWN to a tidy number — a ceiling must never round up. */
function roundDown(v: number): number {
  if (v < 1) return 0;
  if (v < 20) return Math.floor(v);
  if (v < 200) return Math.floor(v / 5) * 5;
  if (v < 2000) return Math.floor(v / 25) * 25;
  return Math.floor(v / 100) * 100;
}

function fmt(v: number): string {
  return v >= 1000 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100);
}
