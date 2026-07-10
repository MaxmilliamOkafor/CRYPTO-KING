/**
 * lib/watchAlerts.ts — rug-condition detection for watched coins, pure and
 * unit-testable.
 *
 * The pre-buy scan can't see a dev who dumps tomorrow. For coins the user is
 * holding/watching, the background re-scans on a timer and this module diffs
 * the fresh snapshot against the BASELINE (state when watching started):
 *   - LP security lost (burned/locked → anything else)
 *   - liquidity collapsed vs baseline
 *   - market cap collapsed vs baseline
 *   - dev wallet reduced holdings (dev is selling)
 *   - King Grade collapsed
 * Each alert kind fires once per coin (the caller tracks `alerted`).
 */

import { WATCHLIST } from '../config.ts';
import type { WatchSnapshot } from './types.ts';

export interface WatchAlert {
  kind: string; // stable id for once-only firing
  message: string;
}

export function computeWatchAlerts(baseline: WatchSnapshot, current: WatchSnapshot): WatchAlert[] {
  const alerts: WatchAlert[] = [];
  const t = WATCHLIST.alerts;

  const lpWasSecured = baseline.lpStatus === 'burned' || baseline.lpStatus === 'locked';
  const lpNowSecured = current.lpStatus === 'burned' || current.lpStatus === 'locked';
  if (lpWasSecured && !lpNowSecured && current.lpStatus !== 'unknown') {
    alerts.push({
      kind: 'lp-unsecured',
      message: `LP is no longer ${baseline.lpStatus} (now ${current.lpStatus.replace('_', ' ')}) — rug risk changed.`,
    });
  }

  if (baseline.liquidityEur !== null && current.liquidityEur !== null && baseline.liquidityEur > 0) {
    const dropPct = (1 - current.liquidityEur / baseline.liquidityEur) * 100;
    if (dropPct >= t.liquidityDropPct) {
      alerts.push({ kind: 'liquidity-drop', message: `Liquidity down ${dropPct.toFixed(0)}% since you started watching.` });
    }
  }

  if (baseline.marketCapEur !== null && current.marketCapEur !== null && baseline.marketCapEur > 0) {
    const dropPct = (1 - current.marketCapEur / baseline.marketCapEur) * 100;
    if (dropPct >= t.marketCapDropPct) {
      alerts.push({ kind: 'mcap-drop', message: `Market cap down ${dropPct.toFixed(0)}% since you started watching.` });
    }
  }

  if (
    baseline.devHoldsPct !== null &&
    current.devHoldsPct !== null &&
    baseline.devHoldsPct - current.devHoldsPct >= t.devSoldPointsDrop
  ) {
    alerts.push({
      kind: 'dev-selling',
      message: `Dev wallet cut holdings from ${baseline.devHoldsPct.toFixed(1)}% to ${current.devHoldsPct.toFixed(1)}% — dev is selling.`,
    });
  }

  if (baseline.grade !== null && current.grade !== null && baseline.grade - current.grade >= t.gradeDrop) {
    alerts.push({
      kind: 'grade-collapse',
      message: `King Grade fell ${baseline.grade}% → ${current.grade}% — risk profile worsened.`,
    });
  }

  return alerts;
}
