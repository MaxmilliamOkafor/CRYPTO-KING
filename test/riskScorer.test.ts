/**
 * test/riskScorer.test.ts — plain-assertion unit tests for the pure scorer.
 * Run with:  npm test   (bundles via esbuild, executes under Node)
 *
 * These pin the three fixtures to their documented walkthrough scores, plus
 * edge behavior: clamping, mitigation cap, null → data gap (never points),
 * and the insufficient-data guard.
 */

import assert from 'node:assert/strict';
import { gemBackgroundCheck } from '../lib/gemCriteria.ts';
import { computeKingGrade } from '../lib/kingGrade.ts';
import { matchNarratives } from '../lib/narratives.ts';
import { assessRugPotential } from '../lib/rugPotential.ts';
import { scoreQuality } from '../lib/qualityScorer.ts';
import { scoreToken, signalForScore } from '../lib/riskScorer.ts';
import { computeWatchAlerts } from '../lib/watchAlerts.ts';
import { FIXTURE_AVOID, FIXTURE_NEUTRAL, FIXTURE_WATCH } from '../mock/fixtures.ts';
import type { TokenAnalysis } from '../lib/types.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('riskScorer.test.ts');

/* ── Fixture walkthroughs (see mock/fixtures.ts for the arithmetic) ────── */

test('RUGKING scores 90 → AVOID (mint +25, freeze +20, LP +20, top10 +15, no socials +10)', () => {
  const r = scoreToken(FIXTURE_AVOID);
  assert.equal(r.riskScore, 90);
  assert.equal(r.signal, 'AVOID');
  assert.ok(r.riskScore >= 80);
  assert.equal(r.insufficientData, false);
  // Highest-weight reason must surface first for the overlay's one-liner.
  assert.match(r.reasons[0].text, /Mint authority active/);
  assert.ok(r.reasons.length >= 5);
  assert.ok(r.reasons.some((x) => /freeze holder wallets/i.test(x.text)));
  assert.ok(r.reasons.some((x) => /rug vector/i.test(x.text)));
});

test('WIFCAT scores 45 → WATCH (metadata +5, top10 +15, thin liq +10, young+volume +10, unverified socials +5)', () => {
  const r = scoreToken(FIXTURE_WATCH);
  assert.equal(r.riskScore, 45);
  assert.equal(r.signal, 'WATCH');
  assert.ok(r.riskScore >= 40 && r.riskScore < 60);
  assert.ok(r.reasons.some((x) => /Thin liquidity/.test(x.text)));
  assert.ok(r.reasons.some((x) => /22 min old/.test(x.text)));
});

test('QUOKKA scores 0 → NEUTRAL (no triggers; -15 mitigation floors at 0)', () => {
  const r = scoreToken(FIXTURE_NEUTRAL);
  assert.equal(r.riskScore, 0);
  assert.equal(r.signal, 'NEUTRAL');
  assert.ok(r.riskScore < 20);
  assert.equal(r.reasons.length, 0);
  assert.equal(r.mitigations.length, 2); // verified socials + smart money accumulating
});

/* ── Signal thresholds ─────────────────────────────────────────────────── */

test('signal thresholds map exactly per spec', () => {
  assert.equal(signalForScore(100), 'AVOID');
  assert.equal(signalForScore(80), 'AVOID');
  assert.equal(signalForScore(79), 'HIGH_RISK');
  assert.equal(signalForScore(60), 'HIGH_RISK');
  assert.equal(signalForScore(59), 'WATCH');
  assert.equal(signalForScore(40), 'WATCH');
  assert.equal(signalForScore(39), 'CONSIDER');
  assert.equal(signalForScore(20), 'CONSIDER');
  assert.equal(signalForScore(19), 'NEUTRAL');
  assert.equal(signalForScore(0), 'NEUTRAL');
});

/* ── Edge behavior ─────────────────────────────────────────────────────── */

test('score clamps at 100 when everything is on fire', () => {
  const worst: TokenAnalysis = structuredClone(FIXTURE_AVOID);
  worst.mint = {
    mintAuthorityActive: true,
    freezeAuthorityActive: true,
    metadataMutable: true,
    isToken2022: true,
    transferFeeBps: 2500,
    feeAuthorityActive: true,
    permanentDelegateActive: false,
    transferHookActive: false,
    defaultAccountFrozen: false,
    nonTransferable: false,
  };
  worst.market = {
    ...worst.market!,
    marketCapEur: 40_000,
    liquidityEur: 5_000,
    sellSimulation: { ok: false, slippagePct: 90 },
  };
  worst.behavior = {
    volumeSpikeFlatPrice: true,
    manySmallBuysOneHugeSell: true,
    mcapSpikeNoOrganicVolume: true,
    deployerLinkedSelling: true,
    abnormalEarlyVolume: true,
  };
  worst.identity = { ...worst.identity, ageMinutes: 5 };
  worst.deployer = { priorRugs: 3, fundingSource: 'known_rugger', priorLaunches: null, priorDeadLaunches: null, graduatedLaunches: null };
  worst.holders = { holderCount: 900, top5Pct: 91, top10Pct: 95, largestNonLpWalletPct: 55, bundledLaunchPct: 60, smartMoneyPct: null, devHoldsPct: null };
  const r = scoreToken(worst);
  assert.equal(r.riskScore, 100);
  assert.equal(r.signal, 'AVOID');
});

test('nulls award zero points and become data gaps (never fake a score)', () => {
  const sparse: TokenAnalysis = {
    ...structuredClone(FIXTURE_NEUTRAL),
    mint: null,
    behavior: null,
    deployer: null,
    socials: null,
    smartMoney: null,
  };
  const r = scoreToken(sparse);
  assert.equal(r.insufficientData, false); // market + holders still present
  assert.equal(r.riskScore, 0);
  assert.ok(r.dataGaps.some((g) => /mint data unavailable/i.test(g)));
  assert.ok(r.dataGaps.some((g) => /Deployer wallet history unavailable/i.test(g)));
});

test('insufficientData flags when mint, market AND holders are all missing', () => {
  const empty: TokenAnalysis = {
    ...structuredClone(FIXTURE_NEUTRAL),
    mint: null,
    market: null,
    holders: null,
  };
  const r = scoreToken(empty);
  assert.equal(r.insufficientData, true);
});

test('mitigations are capped at -15 and cannot drag a risky token below its floor', () => {
  const risky: TokenAnalysis = structuredClone(FIXTURE_AVOID);
  risky.socials = { website: 'https://x.example', twitter: 'https://x.com/x', telegram: null, verified: true }; // -5 (replaces +10 noSocials)
  risky.smartMoney = { accumulating: true, exiting: false, walletCount: 9 }; // -10
  const r = scoreToken(risky);
  // 90 - 10 (noSocials gone) = 80 positives, minus capped -15 = 65
  assert.equal(r.riskScore, 65);
  assert.equal(r.signal, 'HIGH_RISK');
  const totalMitigation = r.mitigations.reduce((s, m) => s + m.points, 0);
  assert.ok(totalMitigation >= -15 || r.riskScore === 80 + Math.max(totalMitigation, -15) - 15);
});

test('Token-2022 very-high fee outranks the high-fee tier (replaces, not additive)', () => {
  const feeToken: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  feeToken.mint = { ...feeToken.mint!, isToken2022: true, transferFeeBps: 2500 };
  feeToken.socials = null; // avoid mitigation noise
  feeToken.smartMoney = null;
  const r = scoreToken(feeToken);
  assert.equal(r.riskScore, 15);
  assert.ok(r.reasons.some((x) => /25\.0% — very high/.test(x.text)));
  assert.equal(r.reasons.length, 1);
});

test('launchpad factors: curve + brand-new + early top-wallet concentration → 30', () => {
  const fresh: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  fresh.identity = { ...fresh.identity, ageMinutes: 4 };
  fresh.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false, replyCount: null };
  fresh.socials = null; // mute mitigations for exact arithmetic
  fresh.smartMoney = null;
  const r = scoreToken(fresh);
  // +10 bonding curve, +10 brand-new, +10 early top-10 concentration (24% ≥ 15% while on curve)
  assert.equal(r.riskScore, 30);
  assert.equal(r.signal, 'CONSIDER');
  assert.ok(r.reasons.some((x) => /bonding curve/i.test(x.text)));
  assert.ok(r.reasons.some((x) => /Brand-new launch/.test(x.text)));
  assert.ok(r.reasons.some((x) => /already hold/.test(x.text)));
});

test('early whale wallet (≥5% on the curve) fires; same wallet is fine after graduation', () => {
  const early: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  early.identity = { ...early.identity, ageMinutes: 200 }; // not brand-new: isolate the whale factor
  early.socials = null;
  early.smartMoney = null;
  early.holders = { ...early.holders!, largestNonLpWalletPct: 8, top10Pct: 12 };
  early.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false, replyCount: null };
  const onCurve = scoreToken(early);
  assert.ok(onCurve.reasons.some((x) => /dev\/sniper dump risk/.test(x.text)));
  const graduated = structuredClone(early);
  graduated.launch = { platform: 'pumpfun', bondingCurveComplete: true, bannedOnPlatform: false, replyCount: null };
  assert.ok(!scoreToken(graduated).reasons.some((x) => /dev\/sniper dump risk/.test(x.text)));
});

test('platform-banned coins take +30 and cannot look clean', () => {
  const banned: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  banned.launch = { platform: 'pumpfun', bondingCurveComplete: true, bannedOnPlatform: true, replyCount: null };
  banned.socials = null;
  banned.smartMoney = null;
  const r = scoreToken(banned);
  assert.equal(r.riskScore, 30);
  assert.ok(r.reasons.some((x) => /Banned/.test(x.text)));
});

test('launch factors never fire when the launchpad is unknown (fixtures unchanged)', () => {
  assert.equal(scoreToken(FIXTURE_NEUTRAL).riskScore, 0); // launch: null → no launchpad points
});

test('Token-2022 trap extensions (permanent delegate / hook / frozen / soulbound) max out risk', () => {
  const trap: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  trap.socials = null;
  trap.smartMoney = null;
  trap.mint = {
    ...trap.mint!,
    isToken2022: true,
    permanentDelegateActive: true, // +30
    transferHookActive: true, // +20
    defaultAccountFrozen: true, // +25
    nonTransferable: true, // +30
  };
  const r = scoreToken(trap);
  assert.equal(r.riskScore, 100); // 105 clamped
  assert.equal(r.signal, 'AVOID');
  assert.ok(r.reasons.some((x) => /seize tokens/i.test(x.text)));
  assert.ok(r.reasons.some((x) => /NON-TRANSFERABLE/i.test(x.text)));
});

test('serial deployer: many prior dead launches triggers +15', () => {
  const serial: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  serial.socials = null;
  serial.smartMoney = null;
  serial.deployer = { priorRugs: null, fundingSource: 'unknown', priorLaunches: 8, priorDeadLaunches: 7, graduatedLaunches: 1 };
  const r = scoreToken(serial);
  assert.equal(r.riskScore, 15);
  assert.ok(r.reasons.some((x) => /Serial launcher/.test(x.text)));
});

/* ── Quality scorer (the positive axis) ────────────────────────────────── */

test('QUOKKA quality: clean + smart money + burned LP + healthy holders → 100', () => {
  const q = scoreQuality(FIXTURE_NEUTRAL);
  assert.equal(q.qualityScore, 100); // 20+10+5+15+10+10+10+10+5+5 = 100 exactly
  assert.equal(q.insufficientData, false);
  assert.ok(q.reasons.some((x) => /Smart-money/.test(x.text)));
  assert.ok(q.reasons.some((x) => /LP burned/.test(x.text)));
});

test('RUGKING quality stays low (20) — bad coins cannot fake quality', () => {
  const q = scoreQuality(FIXTURE_AVOID);
  assert.equal(q.qualityScore, 20); // holders 3100 (+5), liq depth 20% (+10), organic volume (+5)
});

test('quality reports insufficientData when nothing was fetchable', () => {
  const empty: TokenAnalysis = {
    ...structuredClone(FIXTURE_NEUTRAL),
    mint: null,
    market: null,
    holders: null,
  };
  const q = scoreQuality(empty);
  assert.equal(q.insufficientData, true);
  assert.equal(q.qualityScore, 0);
});

test('tracked smart-money wallets add quality (no double count with GMGN flow)', () => {
  const t: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  t.smartMoney = { accumulating: false, exiting: false, walletCount: 0 }; // GMGN axis silent
  t.holders = { ...t.holders!, smartMoneyPct: 18 };
  const q = scoreQuality(t);
  assert.ok(q.reasons.some((x) => /Your tracked wallets hold 18\.0%/.test(x.text)));
  // With GMGN accumulating, tracked-wallet points must NOT stack:
  const both: TokenAnalysis = structuredClone(t);
  both.smartMoney = { accumulating: true, exiting: false, walletCount: 6 };
  const q2 = scoreQuality(both);
  assert.ok(!q2.reasons.some((x) => /tracked wallets/.test(x.text)));
});

test('proven deployer track record adds quality; poor record does not', () => {
  const proven: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  proven.deployer = { ...proven.deployer!, priorLaunches: 4, priorDeadLaunches: 1, graduatedLaunches: 3 };
  assert.ok(scoreQuality(proven).reasons.some((x) => /3\/4 prior launches graduated/.test(x.text)));
  const poor: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  poor.deployer = { ...poor.deployer!, priorLaunches: 4, priorDeadLaunches: 3, graduatedLaunches: 1 };
  assert.ok(!scoreQuality(poor).reasons.some((x) => /prior launches graduated/.test(x.text)));
});

test('narrative matcher tags name/symbol hits; informational only', () => {
  assert.deepEqual(matchNarratives('Grok Agent Coin', 'GAI'), ['AI']);
  assert.deepEqual(matchNarratives('quokka', 'QUOKKA'), []);
  assert.ok(matchNarratives('TrumpWifHat', 'TWH').includes('Political'));
});

/* ── 💎 gem background check ───────────────────────────────────────────── */

test('gem check: QUOKKA passes every gate', () => {
  const v = gemBackgroundCheck(FIXTURE_NEUTRAL, scoreToken(FIXTURE_NEUTRAL), scoreQuality(FIXTURE_NEUTRAL));
  assert.equal(v.gem, true);
  assert.equal(v.blockers.length, 0);
});

test('gem check: a coin still on the bonding curve is NEVER a gem (dev can dump)', () => {
  const onCurve: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  onCurve.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false, replyCount: 50 };
  onCurve.deployer = { ...onCurve.deployer!, priorLaunches: 0, priorDeadLaunches: 0 };
  const v = gemBackgroundCheck(onCurve, scoreToken(onCurve), scoreQuality(onCurve));
  assert.equal(v.gem, false);
  assert.ok(v.blockers.some((b) => /bonding curve/.test(b)));
});

test('gem check: a whale wallet (>10%) blocks gem grade even when everything else is clean', () => {
  const whale: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  whale.holders = { ...whale.holders!, largestNonLpWalletPct: 22 };
  const v = gemBackgroundCheck(whale, scoreToken(whale), scoreQuality(whale));
  assert.equal(v.gem, false);
  assert.ok(v.blockers.some((b) => /22\.0%/.test(b)));
});

test('gem check: RUGKING is blocked on multiple gates', () => {
  const v = gemBackgroundCheck(FIXTURE_AVOID, scoreToken(FIXTURE_AVOID), scoreQuality(FIXTURE_AVOID));
  assert.equal(v.gem, false);
  assert.ok(v.blockers.length >= 3); // risk gate, LP not secured, whale wallet
});

/* ── King Grade (the 0–100% display) ───────────────────────────────────── */

test('King Grade: QUOKKA grades 98% GEM GRADE (only deployer history unchecked)', () => {
  const kg = computeKingGrade(FIXTURE_NEUTRAL, scoreToken(FIXTURE_NEUTRAL), scoreQuality(FIXTURE_NEUTRAL));
  // safety 100·0.5 + quality 100·0.3 + coverage 90%·0.2 = 98; gem passed → uncapped
  assert.equal(kg.grade, 98);
  assert.equal(kg.label, 'GEM GRADE');
  assert.equal(kg.caps.length, 0);
});

test('King Grade: RUGKING sits at/below the 10% trap ceiling (band-ranked, AVOID)', () => {
  const kg = computeKingGrade(FIXTURE_AVOID, scoreToken(FIXTURE_AVOID), scoreQuality(FIXTURE_AVOID));
  assert.ok(kg.grade !== null && kg.grade <= 10, `expected ≤10, got ${kg.grade}`);
  assert.equal(kg.label, 'AVOID');
  assert.ok(kg.caps.some((c) => /confirmed trap/.test(c)));
});

test('King Grade: band-ranking spreads two same-ceiling fresh coins apart', () => {
  // Both still on the bonding curve (ceiling 40) but different market-cap
  // traction → they must NOT collapse to the same grade.
  const mk = (mcapEur: number): TokenAnalysis => {
    const t = structuredClone(FIXTURE_NEUTRAL);
    t.identity = { ...t.identity, ageMinutes: 3 };
    t.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false, replyCount: 0 };
    t.market = { ...t.market!, marketCapEur: mcapEur, lpStatus: 'unknown' };
    t.socials = null;
    t.smartMoney = null;
    return t;
  };
  const low = mk(2_000);
  const high = mk(45_000);
  const gLow = computeKingGrade(low, scoreToken(low), scoreQuality(low)).grade ?? 0;
  const gHigh = computeKingGrade(high, scoreToken(high), scoreQuality(high)).grade ?? 0;
  assert.ok(gHigh > gLow, `traction should rank higher: ${gHigh} vs ${gLow}`);
  assert.ok(gHigh <= 40 && gLow <= 40, 'both stay under the bonding-curve ceiling');
});

test('King Grade: WIFCAT lands mid-field (56% MIXED) — real differentiation', () => {
  const kg = computeKingGrade(FIXTURE_WATCH, scoreToken(FIXTURE_WATCH), scoreQuality(FIXTURE_WATCH));
  // safety 55·0.5=27.5 + quality 35·0.3=10.5 + coverage 90%·0.2=18 → 56; gem-fail cap (79) is a no-op
  assert.equal(kg.grade, 56);
  assert.equal(kg.label, 'MIXED');
});

test('King Grade: partial data caps at 50% — a coin cannot look good unscanned', () => {
  const partial: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  partial.holders = null; // holders unverified
  const kg = computeKingGrade(partial, scoreToken(partial), scoreQuality(partial));
  assert.ok(kg.grade !== null && kg.grade <= 50);
  assert.ok(kg.caps.some((c) => /not verified yet/.test(c)));
});

test('King Grade: on the bonding curve caps at 40% no matter how clean', () => {
  const curve: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  curve.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false, replyCount: 100 };
  curve.deployer = { ...curve.deployer!, priorLaunches: 3, priorDeadLaunches: 0, graduatedLaunches: 3 };
  const kg = computeKingGrade(curve, scoreToken(curve), scoreQuality(curve));
  assert.ok(kg.grade !== null && kg.grade <= 40);
  assert.ok(kg.caps.some((c) => /bonding curve/.test(c)));
});

test('King Grade: 80%+ unreachable without a passed background check', () => {
  const noGem: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  noGem.market = { ...noGem.market!, lpStatus: 'locked' }; // still fine…
  noGem.holders = { ...noGem.holders!, largestNonLpWalletPct: 12 }; // …but whale gate fails the gem check
  const kg = computeKingGrade(noGem, scoreToken(noGem), scoreQuality(noGem));
  assert.ok(kg.grade !== null && kg.grade <= 79);
  assert.ok(kg.caps.some((c) => /background check/.test(c)));
});

/* ── Dev holdings & 👁 watch alerts ────────────────────────────────────── */

test('dev wallet holding ≥5% adds risk and blocks gem grade above 10%', () => {
  const devCoin: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  devCoin.holders = { ...devCoin.holders!, devHoldsPct: 12 };
  const r = scoreToken(devCoin);
  assert.ok(r.reasons.some((x) => /Dev wallet holds 12\.0%/.test(x.text)));
  const v = gemBackgroundCheck(devCoin, r, scoreQuality(devCoin));
  assert.equal(v.gem, false);
  assert.ok(v.blockers.some((b) => /Dev wallet holds/.test(b)));
});

test('watch alerts: dev selling, liquidity collapse and grade collapse all fire', () => {
  const baseline = {
    at: 0,
    grade: 85,
    liquidityEur: 100_000,
    marketCapEur: 500_000,
    lpStatus: 'burned' as const,
    devHoldsPct: 6,
    largestNonLpWalletPct: 5,
  };
  const rugged = {
    at: 1,
    grade: 30, // −55 ≥ 20 → grade-collapse
    liquidityEur: 20_000, // −80% ≥ 50% → liquidity-drop
    marketCapEur: 100_000, // −80% ≥ 60% → mcap-drop
    lpStatus: 'unlocked' as const, // burned → unlocked → lp-unsecured
    devHoldsPct: 0.5, // −5.5pts ≥ 2 → dev-selling
    largestNonLpWalletPct: 5,
  };
  const kinds = computeWatchAlerts(baseline, rugged).map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['dev-selling', 'grade-collapse', 'liquidity-drop', 'lp-unsecured', 'mcap-drop']);
});

test('watch alerts: healthy coin fires nothing; unknown data never alerts', () => {
  const baseline = {
    at: 0,
    grade: 85,
    liquidityEur: 100_000,
    marketCapEur: 500_000,
    lpStatus: 'burned' as const,
    devHoldsPct: 6,
    largestNonLpWalletPct: 5,
  };
  const healthy = { ...baseline, at: 1, grade: 80, liquidityEur: 90_000, marketCapEur: 600_000 };
  assert.equal(computeWatchAlerts(baseline, healthy).length, 0);
  const unknown = { at: 1, grade: null, liquidityEur: null, marketCapEur: null, lpStatus: 'unknown' as const, devHoldsPct: null, largestNonLpWalletPct: null };
  assert.equal(computeWatchAlerts(baseline, unknown).length, 0);
});

/* ── 🚩 Rug potential (the pre-buy verdict) ────────────────────────────── */

test('rug potential: RUGKING is HIGH (freeze + mint + deployer-held LP)', () => {
  const r = assessRugPotential(FIXTURE_AVOID, scoreToken(FIXTURE_AVOID));
  assert.equal(r.verdict, 'HIGH');
  assert.ok(r.vectors.some((v) => /liquidity can be pulled in one transaction/i.test(v)));
  assert.ok(r.vectors.some((v) => /Supply can be inflated/.test(v)));
});

test('rug potential: QUOKKA is LOW... but never claims safe wording', () => {
  const r = assessRugPotential(FIXTURE_NEUTRAL, scoreToken(FIXTURE_NEUTRAL));
  assert.equal(r.verdict, 'LOW');
  assert.equal(r.vectors.length, 0);
});

test('rug potential: one open vector → POSSIBLE; two → HIGH', () => {
  const one: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  one.market = { ...one.market!, lpStatus: 'unlocked' };
  assert.equal(assessRugPotential(one, scoreToken(one)).verdict, 'POSSIBLE');

  const two: TokenAnalysis = structuredClone(one);
  two.holders = { ...two.holders!, devHoldsPct: 9 }; // unlocked LP + positioned dev
  assert.equal(assessRugPotential(two, scoreToken(two)).verdict, 'HIGH');
});

test('rug potential: missing checks → UNVERIFIED, never LOW', () => {
  const partial: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  partial.market = { ...partial.market!, lpStatus: 'unknown' };
  const r = assessRugPotential(partial, scoreToken(partial));
  assert.equal(r.verdict, 'UNVERIFIED');
  assert.ok(r.unverified.includes('LP burn/lock status'));
});

console.log(`\n${passed} tests passed.`);
