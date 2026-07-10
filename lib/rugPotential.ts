/**
 * lib/rugPotential.ts — the pre-buy "can this rug me?" verdict, pure and
 * unit-testable.
 *
 * This deliberately isolates EXIT-SCAM vectors from general market risk:
 * a coin can be volatile without being ruggable, and the user's question
 * before entering is specifically "can insiders take my money by force?".
 * Vectors checked:
 *   - liquidity pull:   LP not burned/locked (deployer-held = worst)
 *   - supply inflation: mint authority active
 *   - sell blocking:    freeze authority, honeypot sim, Token-2022 traps
 *   - insider dump:     dev wallet %, whale wallet %, still on bonding curve
 *   - operator history: serial deployer
 *
 * Verdicts:
 *   HIGH       — a mechanism exists RIGHT NOW for insiders to rug (don't enter)
 *   POSSIBLE   — at least one dump/pull vector open; a rug needs no new setup
 *   LOW        — no pull/dump vectors found on verified data (≠ safe: market
 *                risk and undetectable off-chain coordination remain)
 *   UNVERIFIED — key checks missing; a rug CANNOT be ruled out yet
 */

import { GEM_CRITERIA, LIMITS } from '../config.ts';
import type { RiskResult, TokenAnalysis } from './types.ts';

export type RugVerdict = 'HIGH' | 'POSSIBLE' | 'LOW' | 'UNVERIFIED';

export interface RugPotential {
  verdict: RugVerdict;
  /** The specific rug vectors found (empty for LOW). */
  vectors: string[];
  /** Which rug-relevant checks could not be verified. */
  unverified: string[];
}

export function assessRugPotential(a: TokenAnalysis, risk: RiskResult): RugPotential {
  const hard: string[] = []; // mechanisms that enable a rug outright → HIGH
  const soft: string[] = []; // open dump/pull vectors → POSSIBLE
  const unverified: string[] = [];

  const mint = a.mint;
  if (!mint) {
    unverified.push('mint/freeze authority');
  } else {
    if (mint.mintAuthorityActive === true) hard.push('Supply can be inflated (mint authority active).');
    if (mint.freezeAuthorityActive === true) hard.push('Your wallet can be frozen (freeze authority active).');
    if (mint.permanentDelegateActive === true) hard.push('Dev can seize tokens (permanent delegate).');
    if (mint.nonTransferable === true) hard.push('Token is soulbound — you cannot sell.');
    if (mint.defaultAccountFrozen === true) hard.push('New holder accounts start frozen.');
    if (mint.transferHookActive === true) hard.push('Transfers run dev code that can block sells.');
    if (mint.mintAuthorityActive === null) unverified.push('mint authority');
    if (mint.freezeAuthorityActive === null) unverified.push('freeze authority');
  }

  const sim = a.market?.sellSimulation;
  if (sim?.ok === false) hard.push('Simulated sell FAILS — honeypot behavior.');

  const lp = a.market?.lpStatus ?? 'unknown';
  if (lp === 'deployer_held') hard.push('Deployer holds the LP — liquidity can be pulled in one transaction.');
  else if (lp === 'unlocked') soft.push('LP not burned/locked — liquidity can be pulled.');
  else if (lp === 'unknown') unverified.push('LP burn/lock status');

  if (a.launch?.bondingCurveComplete === false) {
    soft.push('Still on the bonding curve — insiders can dump at any moment.');
  }

  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev >= LIMITS.devHoldsPct) soft.push(`Dev wallet holds ${dev.toFixed(1)}% — positioned to dump.`);
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > GEM_CRITERIA.maxLargestWalletPct) {
    soft.push(`A single wallet holds ${whale.toFixed(1)}% — one seller from a crash.`);
  }
  if (whale === null) unverified.push('holder concentration');

  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) {
    hard.push('Creator is a serial launcher with mostly dead coins.');
  }

  /* Verdict — hard vectors dominate; combinations of soft vectors escalate. */
  let verdict: RugVerdict;
  if (hard.length > 0) verdict = 'HIGH';
  else if (soft.length >= 2) verdict = 'HIGH'; // e.g. unlocked LP AND a positioned dumper
  else if (soft.length === 1) verdict = 'POSSIBLE';
  else if (unverified.length > 0) verdict = 'UNVERIFIED';
  else verdict = 'LOW';

  return { verdict, vectors: [...hard, ...soft], unverified };
}

export const RUG_VERDICT_META: Record<RugVerdict, { color: string; textColor: string; label: string }> = {
  HIGH: { color: '#e5484d', textColor: '#ffffff', label: '🚩 RUG POTENTIAL: HIGH' },
  POSSIBLE: { color: '#f76b15', textColor: '#ffffff', label: '🚩 RUG POTENTIAL: POSSIBLE' },
  LOW: { color: '#2e5a3c', textColor: '#c9f0d4', label: 'RUG VECTORS: none found (≠ safe)' },
  UNVERIFIED: { color: '#3a3f4c', textColor: '#e6e8ee', label: 'RUG CHECK: not fully verified yet' },
};
