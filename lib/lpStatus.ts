/**
 * lib/lpStatus.ts — is the liquidity burned, locked, or pullable? Pure.
 *
 * Why this exists: LP status used to come ONLY from GMGN, and GMGN only
 * answers on gmgn.ai. Everywhere else — pump.fun, DEXTools, the background
 * long-hold radar — LP was permanently "unknown", which capped every King
 * Grade at 50% and made a long-hold CANDIDATE impossible. Two keyless
 * sources close the gap:
 *
 *  1. PROTOCOL BURN. pump.fun's docs: at graduation the bonding-curve
 *     liquidity is migrated to a pool and the LP tokens are BURNED — PumpSwap
 *     since March 2025, Raydium before that. So for a coin pump.fun reports as
 *     graduated, whose deepest pool is on one of those venues, the canonical
 *     liquidity is burned by protocol. (A dev can open a SEPARATE pool
 *     elsewhere; if that one is the deepest, this rule doesn't apply.)
 *  2. RugCheck's public summary (`lpLockedPct`), which counts burned and
 *     locked together.
 *
 * Precedence: GMGN (on-site, most specific) → protocol burn → RugCheck.
 */

import type { LpStatus } from './types.ts';

/** Venues pump.fun migrates graduated coins to (DexScreener `dexId`). */
export const PUMP_MIGRATION_DEXES = new Set(['pumpswap', 'raydium']);

export function resolveLpStatus(i: {
  gmgn: LpStatus | null;
  /** pump.fun says the bonding curve completed (coin graduated). */
  pumpGraduated: boolean | null;
  /** DexScreener `dexId` of the deepest pool. */
  deepestDexId: string | null;
  /** RugCheck verdict (already mapped from lpLockedPct). */
  audit: LpStatus | null;
}): LpStatus {
  if (i.gmgn && i.gmgn !== 'unknown') return i.gmgn;
  if (i.pumpGraduated === true) {
    if (i.deepestDexId !== null && PUMP_MIGRATION_DEXES.has(i.deepestDexId)) return 'burned';
    // Graduated but the pool isn't listed yet (minutes after migration):
    // auditors often still see the old curve and report "0% locked". Taking
    // that as "pullable" dropped good coins AT graduation. Wait for the pool.
    if (i.deepestDexId === null) return i.audit === 'unlocked' ? 'unknown' : (i.audit ?? 'unknown');
    // Deepest pool is on some OTHER venue (a dev-made pool) → trust the auditor.
  }
  // Still on the bonding curve: there is no AMM pool, so there is no LP to
  // lock — the curve's SOL is program-held and nobody can withdraw it. An
  // auditor's "0% LP locked" here describes a pool that doesn't exist and
  // would brand every fresh launch "liquidity can be pulled". Stay unknown.
  if (i.pumpGraduated === false) return 'unknown';
  return i.audit ?? 'unknown';
}

/**
 * RugCheck `lpLockedPct` → status. Mid values stay unknown on purpose: an
 * "unlocked" verdict is a hard negative everywhere, so it needs a clear reading.
 */
export function lpStatusFromLockedPct(pct: number | null): LpStatus | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct >= 90) return 'locked';
  if (pct <= 50) return 'unlocked';
  return null;
}
