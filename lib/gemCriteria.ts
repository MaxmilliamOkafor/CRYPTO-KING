/**
 * lib/gemCriteria.ts — the 💎 background check, pure and unit-testable.
 *
 * A coin only earns the gold gem highlight when EVERY gate passes on
 * fully-verified data. Design rule (learned the hard way): the gem must never
 * point at a coin whose dev can still nuke it in one transaction. Concretely:
 *  - still on the bonding curve → NEVER a gem (dev/insiders can dump any second)
 *  - LP not burned/locked → NEVER a gem (classic pull)
 *  - any wallet > GEM_CRITERIA.maxLargestWalletPct → NEVER a gem (one-seller crash)
 *  - holders/LP unverified (lite scan) → NEVER a gem (no highlight on partial data)
 *  - mint/freeze authority not PROVEN revoked, any Token-2022 trap, live fee
 *    authority, honeypot → NEVER a gem (explicit gates, not score arithmetic)
 *  - already dead / dumping → NEVER a gem
 *  - plus the score gates: risk ≤ LIVE_FEED.notifyMaxScore, quality ≥ LIVE_FEED.gemMinQuality
 *
 * Passing every gate still does NOT mean "buy" — it means "survived the
 * background check; worth your own research". Most meme coins die regardless.
 */

import { GEM_CRITERIA, LIMITS, LIVE_FEED } from '../config.ts';
import { assessLiveState } from './liveState.ts';
import type { QualityResult, RiskResult, TokenAnalysis } from './types.ts';

export interface GemVerdict {
  gem: boolean;
  /** Human-readable list of failed gates (empty when gem === true). */
  blockers: string[];
}

export function gemBackgroundCheck(a: TokenAnalysis, risk: RiskResult, quality: QualityResult): GemVerdict {
  const blockers: string[] = [];

  if (risk.insufficientData || quality.insufficientData) {
    blockers.push('Not enough data for a background check.');
    return { gem: false, blockers };
  }

  // Worded so the user never sees a second, inverted "score" competing with the
  // King Grade — these are pass/fail gates, not numbers to compare grades against.
  if (risk.riskScore > LIVE_FEED.notifyMaxScore) {
    blockers.push(`Too many weighted red flags to clear the gem gate (${risk.reasons.length} flag${risk.reasons.length === 1 ? '' : 's'}).`);
  }
  if (quality.qualityScore < LIVE_FEED.gemMinQuality) {
    blockers.push('Not enough positive signals yet (liquidity depth, holder spread, socials, age).');
  }

  // HARD mechanism gates — checked explicitly, never left to the risk score.
  // The score gate alone let a coin with a LIVE MINT AUTHORITY through: +25
  // for the authority, minus mitigations for good socials/smart money, landed
  // at 10 — under the 39 gate — and the coin pulsed gold as a "gem". Any of
  // these alone is a one-transaction rug, so no amount of good signal offsets it.
  // Unknown (null) blocks too: a gem must be PROVEN clean, not assumed clean.
  const m = a.mint;
  if (!m) {
    blockers.push('Mint account not verified — cannot rule out mint/freeze authority.');
  } else {
    if (m.mintAuthorityActive !== false) {
      blockers.push(m.mintAuthorityActive ? 'Mint authority is ACTIVE — dev can print unlimited supply.' : 'Mint authority not verified.');
    }
    if (m.freezeAuthorityActive !== false) {
      blockers.push(m.freezeAuthorityActive ? 'Freeze authority is ACTIVE — your wallet can be frozen.' : 'Freeze authority not verified.');
    }
    if (m.permanentDelegateActive === true) blockers.push('Permanent delegate — dev can take tokens out of your wallet.');
    if (m.nonTransferable === true) blockers.push('Non-transferable token — you cannot sell.');
    if (m.defaultAccountFrozen === true) blockers.push('New holder accounts start frozen.');
    if (m.transferHookActive === true) blockers.push('Transfer hook — dev code runs on every transfer and can block sells.');
    if (m.isToken2022 === true && m.feeAuthorityActive === true) {
      blockers.push('Fee authority live — the transfer tax can be raised after you buy.');
    }
    if (m.transferFeeBps !== null && m.transferFeeBps > LIMITS.transferFeeHighBps) {
      blockers.push(`Transfer tax ${(m.transferFeeBps / 100).toFixed(1)}% on every sell.`);
    }
  }
  if (a.market?.sellSimulation?.ok === false) blockers.push('Simulated sell FAILS — honeypot.');

  // Dev-dump window: on the bonding curve, insiders can sell any second.
  if (GEM_CRITERIA.requireGraduated && a.launch?.bondingCurveComplete === false) {
    blockers.push('Still on the bonding curve — dev/insiders can dump at any moment.');
  }

  // LP must be verifiably secured.
  const lp = a.market?.lpStatus ?? 'unknown';
  if (GEM_CRITERIA.requireLpSecured && lp !== 'burned' && lp !== 'locked') {
    blockers.push(lp === 'unknown' ? 'LP status not verified yet.' : `LP not secured (${lp.replace('_', ' ')}).`);
  }

  // Whale gate: one big holder = one transaction from -90%.
  const largest = a.holders?.largestNonLpWalletPct ?? null;
  if (largest === null) {
    blockers.push('Holder distribution not verified yet.');
  } else if (largest > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`A single wallet holds ${largest.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }

  // Dev gate: the creator's own wallet is the most motivated seller. UNKNOWN is
  // a blocker, not a pass — an unchecked dev bag is exactly how a "gem" turns
  // out to have already been dumped on.
  const dev = a.holders?.devHoldsPct ?? null;
  if (a.launch?.platform === 'pumpfun' && dev === null) {
    blockers.push('Dev wallet holdings not verified yet — cannot clear it as gem grade.');
  } else if (dev !== null && dev > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`Dev wallet holds ${dev.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }

  // LIVE STATE gate: never call a corpse or an actively-dumping coin a gem,
  // however clean its structure looks. This is the check whose absence let
  // already-rugged coins reach the top of the feed.
  const live = assessLiveState(a.market);
  if (live.state === 'DEAD') {
    blockers.push(`Already rugged/dead: ${live.reasons[0] ?? 'market collapsed.'}`);
  } else if (live.state === 'DUMPING') {
    blockers.push(`Dumping right now: ${live.reasons[0] ?? 'price falling hard.'}`);
  }

  // Creator history must have been checked (serial-launcher screen).
  if (a.deployer === null || (a.deployer.priorLaunches === null && a.launch?.platform === 'pumpfun')) {
    blockers.push("Creator's launch history not checked yet.");
  }

  return { gem: blockers.length === 0, blockers };
}
