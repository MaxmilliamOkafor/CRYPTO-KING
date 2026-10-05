/**
 * lib/outcomeLedger.ts — does this scanner actually work? Pure scoring half.
 *
 * WHY: every grade the tool emits is a prediction, and until now none were ever
 * checked. So "is it accurate?" was unanswerable — an argument instead of a
 * measurement. The ledger records each coin's grade at scan time, re-checks it
 * later, and reports the honest truth: of the coins graded 60%+, how many
 * survived? How many died? That number tells the user whether to trust the tool
 * at all, and turns weight-tuning into evidence instead of guesswork.
 *
 * Outcomes are deliberately coarse and hard to game:
 *   RUGGED    — dead: liquidity pulled or price collapsed
 *   FADED     — still listed but well down
 *   SURVIVED  — roughly flat or better
 *   WINNER    — up meaningfully from the grade snapshot
 */

import { OUTCOME_LEDGER } from '../config.ts';
import type { LongHoldAccuracyRow, LongHoldLedgerEntry } from './types.ts';

export type Outcome = 'RUGGED' | 'FADED' | 'SURVIVED' | 'WINNER' | 'PENDING';

/** One recorded prediction. */
export interface LedgerEntry {
  address: string;
  symbol: string | null;
  gradedAt: number;
  grade: number | null;
  rugVerdict: string;
  /** Market cap at grading time — the baseline the outcome is measured against. */
  baselineMcap: number | null;
  /** Filled in on re-check. */
  checkedAt?: number;
  outcome?: Outcome;
  finalMcap?: number | null;
}

/** Classify an outcome from the baseline vs the later state. Pure. */
export function classifyOutcome(
  baselineMcap: number | null,
  nowMcap: number | null,
  isDead: boolean,
  t = OUTCOME_LEDGER,
): Outcome {
  if (isDead) return 'RUGGED';
  if (baselineMcap === null || nowMcap === null || baselineMcap <= 0) return 'PENDING';
  const ratio = nowMcap / baselineMcap;
  if (ratio <= t.ruggedRatio) return 'RUGGED';
  if (ratio <= t.fadedRatio) return 'FADED';
  if (ratio >= t.winnerRatio) return 'WINNER';
  return 'SURVIVED';
}

export interface Accuracy {
  /** Per grade band: how its predictions actually turned out. */
  bands: Array<{
    band: string;
    total: number;
    rugged: number;
    faded: number;
    survived: number;
    winners: number;
    /** % that did NOT rug — the number that matters for trusting a grade. */
    survivalPct: number;
  }>;
  totalChecked: number;
  pending: number;
}

/** Aggregate the ledger into an honest report card. Pure. */
export function computeAccuracy(entries: LedgerEntry[]): Accuracy {
  const defs: Array<{ band: string; min: number; max: number }> = [
    { band: '80–100% (gem grade)', min: 80, max: 101 },
    { band: '60–79% (strong)', min: 60, max: 80 },
    { band: '40–59% (mixed)', min: 40, max: 60 },
    { band: '0–39% (weak/avoid)', min: 0, max: 40 },
  ];

  let pending = 0;
  let totalChecked = 0;
  const bands = defs.map((d) => ({
    band: d.band,
    total: 0,
    rugged: 0,
    faded: 0,
    survived: 0,
    winners: 0,
    survivalPct: 0,
  }));

  for (const e of entries) {
    if (!e.outcome || e.outcome === 'PENDING' || e.grade === null) {
      pending++;
      continue;
    }
    const i = defs.findIndex((d) => e.grade! >= d.min && e.grade! < d.max);
    if (i < 0) continue;
    const b = bands[i];
    b.total++;
    totalChecked++;
    if (e.outcome === 'RUGGED') b.rugged++;
    else if (e.outcome === 'FADED') b.faded++;
    else if (e.outcome === 'SURVIVED') b.survived++;
    else if (e.outcome === 'WINNER') b.winners++;
  }
  for (const b of bands) {
    b.survivalPct = b.total > 0 ? Math.round(((b.total - b.rugged) / b.total) * 100) : 0;
  }
  return { bands, totalChecked, pending };
}

/* ── 🏔 Long-hold report card ──────────────────────────────────────────────
 * Same idea, longer horizon: every radar verdict is a prediction about staying
 * power. Checked at LONG_HOLD.ledgerCheckDays (7 and 30). If CANDIDATE coins
 * don't survive more often than WEAK ones, the radar isn't working — and this
 * table is where that shows up first.
 */

/** Per tier × check-day survival, winners and median market-cap multiple. Pure. */
export function computeLongHoldAccuracy(
  entries: LongHoldLedgerEntry[],
  days: readonly number[],
): LongHoldAccuracyRow[] {
  const tiers = ['CANDIDATE', 'WATCH', 'WEAK', 'NOT_A_HOLD'] as const;
  const rows: LongHoldAccuracyRow[] = [];
  for (const tier of tiers) {
    for (const day of days) {
      const done = entries
        .filter((e) => e.tier === tier)
        .map((e) => ({ e, o: e.outcomes[String(day)] }))
        .filter((x) => x.o && x.o.outcome !== 'PENDING');
      const multiples = done
        .map((x) => (x.o.mcap !== null && x.e.baselineMcap > 0 ? x.o.mcap / x.e.baselineMcap : x.o.outcome === 'RUGGED' ? 0 : null))
        .filter((m): m is number => m !== null)
        .sort((a, b) => a - b);
      rows.push({
        tier,
        day,
        checked: done.length,
        survived: done.filter((x) => x.o.outcome === 'SURVIVED' || x.o.outcome === 'WINNER').length,
        winners: done.filter((x) => x.o.outcome === 'WINNER').length,
        medianMultiple: multiples.length ? median(multiples) : null,
      });
    }
  }
  return rows;
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
