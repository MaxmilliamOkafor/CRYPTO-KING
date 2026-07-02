/**
 * mock/fixtures.ts — three deterministic fixture tokens so the extension works
 * out of the box (config.MOCK_MODE = true). Each fixture includes a worked
 * scoring walkthrough; the unit tests in test/riskScorer.test.ts pin these
 * exact numbers so weight changes are caught immediately.
 *
 * In mock mode, any real address you browse on GMGN is deterministically
 * mapped onto one of these three (see fixtureForAddress) so every token page
 * shows a working overlay.
 */

import type { TokenAnalysis } from '../lib/types.ts';

const now = () => Date.now();

/* ──────────────────────────────────────────────────────────────────────────
 * FIXTURE 1 — "RUGKING" → expected score 90 → AVOID (≥ 80)
 *
 * Worked example (weights from config.WEIGHTS):
 *   +25 Mint authority active            — supply can be inflated at any time
 *   +20 Freeze authority active          — dev can freeze holder wallets
 *   +20 LP held by deployer              — liquidity can be pulled (rug vector)
 *   +15 Top 10 holders = 72% (> 60%)     — heavy concentration
 *   +10 No socials at all
 *   ─────
 *    90 → AVOID
 * Everything else is deliberately clean/false so the arithmetic is auditable:
 * metadata immutable, no transfer fee, sell sim passes at 12% (< 40%),
 * top5 68% (< 80%), largest wallet 18% (< 30%), bundled 10% (< 20%),
 * liq €60k vs mcap €300k (no thin-liquidity trigger: mcap < €500k),
 * deployer 0 prior rugs / CEX-funded, no behavior flags, no smart money.
 * ────────────────────────────────────────────────────────────────────────── */
export const FIXTURE_AVOID: TokenAnalysis = {
  identity: {
    address: 'RugKing111111111111111111111111111111111111',
    symbol: 'RUGKING',
    name: 'Rug King (mock)',
    chain: 'sol',
    ageMinutes: 95,
    logoUri: null,
  },
  mint: {
    mintAuthorityActive: true, // +25
    freezeAuthorityActive: true, // +20
    metadataMutable: false,
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false,
  },
  holders: {
    holderCount: 3100,
    top5Pct: 68,
    top10Pct: 72, // +15
    largestNonLpWalletPct: 18,
    bundledLaunchPct: 10,
  },
  market: {
    priceEur: 0.00031,
    marketCapEur: 300_000,
    liquidityEur: 60_000,
    volume24hEur: 410_000,
    lpStatus: 'deployer_held', // +20
    sellSimulation: { ok: true, slippagePct: 12 },
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false,
  },
  deployer: { priorRugs: 0, fundingSource: 'cex' },
  socials: { website: null, twitter: null, telegram: null, verified: null }, // +10 no socials
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  sources: { gmgn: 'mock', solana: 'mock', pumpfun: 'mock', rugcheck: 'mock', deployer: 'mock' },
  fetchedAt: now(),
};

/* ──────────────────────────────────────────────────────────────────────────
 * FIXTURE 2 — "WIFCAT" → expected score 45 → WATCH (40–59)
 *
 * Worked example:
 *    +5 Metadata mutable                 — identity can change post-launch
 *   +15 Top 10 holders = 65% (> 60%)
 *   +10 Thin liquidity: €38k liq vs €720k mcap (liq < €50k, mcap > €500k)
 *   +10 22 min old with abnormal early volume (< 30 min)
 *    +5 Socials present but unverified
 *   ─────
 *    45 → WATCH
 * Clean elsewhere: mint & freeze revoked, LP burned, sell sim 6%,
 * top5 58%, largest 11%, bundled 9%, deployer clean.
 * ────────────────────────────────────────────────────────────────────────── */
export const FIXTURE_WATCH: TokenAnalysis = {
  identity: {
    address: 'WifCat22222222222222222222222222222222222222',
    symbol: 'WIFCAT',
    name: 'Wif Cat (mock)',
    chain: 'sol',
    ageMinutes: 22, // +10 with abnormalEarlyVolume
    logoUri: null,
  },
  mint: {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    metadataMutable: true, // +5
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false,
  },
  holders: {
    holderCount: 5400,
    top5Pct: 58,
    top10Pct: 65, // +15
    largestNonLpWalletPct: 11,
    bundledLaunchPct: 9,
  },
  market: {
    priceEur: 0.0014,
    marketCapEur: 720_000, // +10 with thin liquidity below
    liquidityEur: 38_000,
    volume24hEur: 950_000,
    lpStatus: 'burned',
    sellSimulation: { ok: true, slippagePct: 6 },
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: true,
  },
  deployer: { priorRugs: 0, fundingSource: 'cex' },
  socials: { website: 'https://wifcat.example', twitter: 'https://x.com/wifcat', telegram: null, verified: false }, // +5
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  sources: { gmgn: 'mock', solana: 'mock', pumpfun: 'mock', rugcheck: 'mock', deployer: 'mock' },
  fetchedAt: now(),
};

/* ──────────────────────────────────────────────────────────────────────────
 * FIXTURE 3 — "QUOKKA" → expected score 0 → NEUTRAL (< 20)
 *
 * Worked example:
 *     0 base — no risk factor triggers: mint & freeze revoked, metadata
 *       immutable, no Token-2022 fee, LP burned, sell sim 2%, top10 24%,
 *       largest wallet 4.5%, bundled 2%, liq €260k vs mcap €1.9M, 3 days old,
 *       no behavior flags, deployer clean.
 *    -5 Verified socials
 *   -10 Smart money accumulating (6 wallets ≥ 3 → strong)
 *   ───── raw -15, mitigation cap is -15, floor at 0
 *     0 → NEUTRAL   (UI legend: "lower observed risk ≠ safe")
 * ────────────────────────────────────────────────────────────────────────── */
export const FIXTURE_NEUTRAL: TokenAnalysis = {
  identity: {
    address: 'Quokka33333333333333333333333333333333333333',
    symbol: 'QUOKKA',
    name: 'Quokka (mock)',
    chain: 'sol',
    ageMinutes: 4320, // 3 days
    logoUri: null,
  },
  mint: {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    metadataMutable: false,
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false,
  },
  holders: {
    holderCount: 18_200,
    top5Pct: 15,
    top10Pct: 24,
    largestNonLpWalletPct: 4.5,
    bundledLaunchPct: 2,
  },
  market: {
    priceEur: 0.021,
    marketCapEur: 1_900_000,
    liquidityEur: 260_000,
    volume24hEur: 780_000,
    lpStatus: 'burned',
    sellSimulation: { ok: true, slippagePct: 2 },
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false,
  },
  deployer: { priorRugs: 0, fundingSource: 'cex' },
  socials: {
    website: 'https://quokka.example',
    twitter: 'https://x.com/quokka',
    telegram: 'https://t.me/quokka',
    verified: true, // -5
  },
  smartMoney: { accumulating: true, exiting: false, walletCount: 6 }, // -10 (strong)
  sources: { gmgn: 'mock', solana: 'mock', pumpfun: 'mock', rugcheck: 'mock', deployer: 'mock' },
  fetchedAt: now(),
};

export const ALL_FIXTURES: TokenAnalysis[] = [FIXTURE_AVOID, FIXTURE_WATCH, FIXTURE_NEUTRAL];

/**
 * Deterministically map ANY address onto a fixture so that browsing real GMGN
 * token pages in mock mode always shows a working overlay. Exact fixture
 * addresses map to themselves.
 */
export function fixtureForAddress(address: string): TokenAnalysis {
  const exact = ALL_FIXTURES.find((f) => f.identity.address === address);
  const base = exact ?? ALL_FIXTURES[simpleHash(address) % ALL_FIXTURES.length];
  // Clone and substitute the browsed address so links (Solscan etc.) stay real.
  return {
    ...base,
    identity: { ...base.identity, address },
    fetchedAt: Date.now(),
  };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}
