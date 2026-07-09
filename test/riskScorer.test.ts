/**
 * test/riskScorer.test.ts — plain-assertion unit tests for the pure scorer.
 * Run with:  npm test   (bundles via esbuild, executes under Node)
 *
 * These pin the three fixtures to their documented walkthrough scores, plus
 * edge behavior: clamping, mitigation cap, null → data gap (never points),
 * and the insufficient-data guard.
 */

import assert from 'node:assert/strict';
import { scoreQuality } from '../lib/qualityScorer.ts';
import { scoreToken, signalForScore } from '../lib/riskScorer.ts';
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
  worst.deployer = { priorRugs: 3, fundingSource: 'known_rugger', priorLaunches: null, priorDeadLaunches: null };
  worst.holders = { holderCount: 900, top5Pct: 91, top10Pct: 95, largestNonLpWalletPct: 55, bundledLaunchPct: 60 };
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

test('launchpad factors: bonding curve + brand-new age score 20 → CONSIDER', () => {
  const fresh: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  fresh.identity = { ...fresh.identity, ageMinutes: 4 };
  fresh.launch = { platform: 'pumpfun', bondingCurveComplete: false, bannedOnPlatform: false };
  fresh.socials = null; // mute mitigations for exact arithmetic
  fresh.smartMoney = null;
  const r = scoreToken(fresh);
  assert.equal(r.riskScore, 20); // +10 bonding curve, +10 brand-new
  assert.equal(r.signal, 'CONSIDER');
  assert.ok(r.reasons.some((x) => /bonding curve/i.test(x.text)));
  assert.ok(r.reasons.some((x) => /Brand-new launch/.test(x.text)));
});

test('platform-banned coins take +30 and cannot look clean', () => {
  const banned: TokenAnalysis = structuredClone(FIXTURE_NEUTRAL);
  banned.launch = { platform: 'pumpfun', bondingCurveComplete: true, bannedOnPlatform: true };
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
  serial.deployer = { priorRugs: null, fundingSource: 'unknown', priorLaunches: 8, priorDeadLaunches: 7 };
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

console.log(`\n${passed} tests passed.`);
