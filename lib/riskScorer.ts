/**
 * lib/riskScorer.ts — pure, unit-testable risk scoring.
 *
 * scoreToken(analysis) → { riskScore 0–100, signal, reasons, mitigations, dataGaps }
 *
 * Principles:
 *  - Additive points from config.WEIGHTS, clamped to [0, 100].
 *  - `null` inputs NEVER score points. They become entries in `dataGaps`
 *    ("we could not check X") so the UI can say "data unavailable" instead of
 *    faking confidence in either direction.
 *  - Mitigations are negative points, capped at -config.MITIGATION_CAP total,
 *    applied AFTER the positive sum. A clean-looking token can reach 0, but the
 *    UI must always frame low scores as "lower observed risk ≠ safe".
 *  - No I/O, no chrome.* — this file must stay importable from plain Node tests.
 */

import { LIMITS, MITIGATION_CAP, SIGNAL_THRESHOLDS, WEIGHTS } from '../config.ts';
import type { RiskReason, RiskResult, Signal, TokenAnalysis } from './types.ts';

type Weights = typeof WEIGHTS;
type Limits = typeof LIMITS;

export function signalForScore(score: number, thresholds = SIGNAL_THRESHOLDS): Signal {
  for (const t of thresholds) {
    if (score >= t.min) return t.signal;
  }
  return 'NEUTRAL';
}

export function scoreToken(a: TokenAnalysis, w: Weights = WEIGHTS, l: Limits = LIMITS): RiskResult {
  const reasons: RiskReason[] = [];
  const mitigations: RiskReason[] = [];
  const dataGaps: string[] = [];

  const hit = (points: number, text: string) => reasons.push({ points, text });
  const mitigate = (points: number, text: string) => mitigations.push({ points, text });
  const gap = (text: string) => dataGaps.push(text);

  /* ── Token structure (high weight) ─────────────────────────────────── */
  const mint = a.mint;
  if (!mint) {
    gap('On-chain mint data unavailable — mint/freeze authority and Token-2022 fees were NOT checked.');
  } else {
    if (mint.mintAuthorityActive === true) {
      hit(w.mintAuthorityActive, 'Mint authority active — supply can be inflated at any time.');
    } else if (mint.mintAuthorityActive === null) {
      gap('Mint authority status unknown.');
    }

    if (mint.freezeAuthorityActive === true) {
      hit(w.freezeAuthorityActive, 'Freeze authority active — dev can freeze holder wallets (honeypot-style trap).');
    } else if (mint.freezeAuthorityActive === null) {
      gap('Freeze authority status unknown.');
    }

    if (mint.transferFeeBps !== null) {
      if (mint.transferFeeBps > l.transferFeeVeryHighBps) {
        hit(
          w.transferFeeVeryHigh,
          `Token-2022 transfer fee is ${(mint.transferFeeBps / 100).toFixed(1)}% — very high transfer tax reduces exit value.`,
        );
      } else if (mint.transferFeeBps > l.transferFeeHighBps) {
        hit(
          w.transferFeeHigh,
          `Token-2022 transfer fee is ${(mint.transferFeeBps / 100).toFixed(1)}% — high transfer tax reduces exit value.`,
        );
      }
    } else if (mint.isToken2022 === true) {
      gap('Token-2022 mint but transfer-fee extension could not be read.');
    }

    if (mint.feeAuthorityActive === true) {
      hit(w.feeAuthorityActive, 'Fee/withdraw authority still active — fees can be changed after you buy.');
    }

    if (mint.metadataMutable === true) {
      hit(w.metadataMutable, 'Metadata mutable — token identity (name/symbol/socials) can be changed post-launch.');
    } else if (mint.metadataMutable === null) {
      gap('Metadata mutability unknown (needs a DAS-capable RPC such as Helius).');
    }
  }

  /* ── Liquidity, LP status & sell simulation ────────────────────────── */
  const market = a.market;
  const lpSecured = market ? market.lpStatus === 'burned' || market.lpStatus === 'locked' : null;
  if (!market) {
    gap('Market data (liquidity, market cap, LP status) unavailable.');
  } else {
    if (market.lpStatus === 'unknown') {
      gap('LP burn/lock status could not be determined.');
    } else if (lpSecured === false) {
      const detail = market.lpStatus === 'deployer_held' ? 'held by the deployer' : 'unlocked';
      hit(w.lpNotSecured, `LP not burned/locked (${detail}) — liquidity can be pulled: classic rug vector.`);
    }

    const sim = market.sellSimulation;
    if (sim === null) {
      gap('Sell simulation unavailable — honeypot-like behavior was NOT checked.');
    } else if (!sim.ok || (sim.slippagePct !== null && sim.slippagePct > l.sellSlippageMaxPct)) {
      const why = !sim.ok ? 'a simulated sell fails' : `simulated sell slippage is ${sim.slippagePct}%`;
      hit(w.sellSimulationFailed, `Honeypot-like behavior detected — ${why}.`);
    }

    if (market.liquidityEur !== null && market.marketCapEur !== null) {
      if (market.liquidityEur < l.thinLiquidityEur && market.marketCapEur > l.thinLiqMcapEur) {
        hit(
          w.thinLiquidityVsMcap,
          `Thin liquidity (€${fmtK(market.liquidityEur)}) vs. cap (€${fmtK(market.marketCapEur)}) — easy to manipulate.`,
        );
      }
      if (market.marketCapEur < l.microMcapEur && lpSecured === false) {
        hit(w.microMcapUnlockedLp, `Micro cap (€${fmtK(market.marketCapEur)}) with unsecured LP — high rug exposure.`);
      }
    } else {
      gap('Liquidity/market-cap figures incomplete.');
    }
  }

  /* ── Holder concentration ──────────────────────────────────────────── */
  const h = a.holders;
  if (!h) {
    gap('Holder distribution unavailable.');
  } else {
    if (h.top10Pct !== null && h.top10Pct > l.top10Pct) {
      hit(w.top10Concentrated, `Top 10 holders control ${h.top10Pct.toFixed(0)}% of supply (LP/burn excluded).`);
    }
    if (h.largestNonLpWalletPct !== null && h.largestNonLpWalletPct > l.singleWalletPct) {
      hit(w.singleWalletDominant, `A single non-LP wallet holds ${h.largestNonLpWalletPct.toFixed(0)}% of supply.`);
    }
    if (
      h.top5Pct !== null &&
      h.holderCount !== null &&
      h.top5Pct > l.top5Pct &&
      h.holderCount >= l.top5MinHolders
    ) {
      hit(
        w.top5EffectiveConcentration,
        `Top 5 wallets hold ${h.top5Pct.toFixed(0)}% despite ${h.holderCount} holders — looks distributed but is effectively concentrated.`,
      );
    }
    if (h.bundledLaunchPct !== null && h.bundledLaunchPct > l.bundledPct) {
      hit(
        w.bundledLaunch,
        `${h.bundledLaunchPct.toFixed(0)}% of supply was bundled/sniped at launch by wallets funded from one source.`,
      );
    }
  }

  /* ── Age & behavior ────────────────────────────────────────────────── */
  const b = a.behavior;
  if (b) {
    if (b.mcapSpikeNoOrganicVolume === true) {
      hit(w.mcapSpikeNoOrganicVolume, 'Market cap spiked with no matching organic volume.');
    }
    if (a.identity.ageMinutes !== null && a.identity.ageMinutes < l.youngAgeMinutes && b.abnormalEarlyVolume === true) {
      hit(
        w.youngTokenAbnormalVolume,
        `Token is only ${Math.round(a.identity.ageMinutes)} min old with abnormal volume.`,
      );
    }
    if (b.deployerLinkedSelling === true) {
      hit(w.deployerLinkedSelling, 'Deployer-linked wallets are selling shortly after launch.');
    }
    if (b.volumeSpikeFlatPrice === true) {
      hit(w.volumeSpikeFlatPrice, 'Volume spike with flat price — wash-trading pattern.');
    }
    if (b.manySmallBuysOneHugeSell === true) {
      hit(w.manySmallBuysOneHugeSell, 'Many small buys followed by one huge sell — exit-scam pattern.');
    }
  } else {
    gap('Trade-behavior heuristics unavailable.');
  }

  /* ── Deployer history ──────────────────────────────────────────────── */
  const d = a.deployer;
  if (!d) {
    gap('Deployer wallet history unavailable.');
  } else {
    if (d.priorRugs !== null && d.priorRugs > 0) {
      hit(w.deployerPriorRugs, `Deployer wallet linked to ${d.priorRugs} prior rug${d.priorRugs > 1 ? 's' : ''}.`);
    }
    if (d.fundingSource === 'known_rugger') {
      hit(w.deployerFundedByRugger, 'Deployer was funded from a wallet linked to known rugs.');
    }
  }

  /* ── Socials ───────────────────────────────────────────────────────── */
  const s = a.socials;
  if (!s) {
    gap('Social links unavailable.');
  } else {
    const hasAny = Boolean(s.website || s.twitter || s.telegram);
    if (!hasAny) {
      hit(w.noSocials, 'No website, Twitter or Telegram found.');
    } else if (s.verified === false) {
      hit(w.unverifiedSocials, 'Socials present but unverified.');
    } else if (s.verified === true) {
      mitigate(w.verifiedSocials, 'Verified website/Twitter/Telegram.');
    }
  }

  /* ── Smart money (GMGN data) ───────────────────────────────────────── */
  const sm = a.smartMoney;
  if (sm) {
    if (sm.exiting === true) {
      hit(w.smartMoneyExiting, 'Smart-money wallets are exiting this token.');
    } else if (sm.accumulating === true) {
      const strong = sm.walletCount !== null && sm.walletCount >= l.smartMoneyStrongWallets;
      mitigate(
        strong ? w.smartMoneyAccumulatingStrong : w.smartMoneyAccumulatingLight,
        `Known smart-money wallets accumulating${sm.walletCount ? ` (${sm.walletCount} wallets)` : ''}.`,
      );
    }
  } else {
    gap('Smart-money flow data unavailable.');
  }

  /* ── Total: positives, capped mitigations, clamp ───────────────────── */
  const positive = reasons.reduce((sum, r) => sum + r.points, 0);
  const rawMitigation = mitigations.reduce((sum, r) => sum + r.points, 0); // negative
  const cappedMitigation = Math.max(rawMitigation, -MITIGATION_CAP);
  const riskScore = clamp(Math.round(positive + cappedMitigation), 0, 100);

  reasons.sort((x, y) => y.points - x.points);

  // If none of the three core sources produced anything, refuse to pretend.
  const insufficientData = a.mint === null && a.market === null && a.holders === null;

  return {
    riskScore,
    signal: signalForScore(riskScore),
    reasons,
    mitigations,
    dataGaps,
    insufficientData,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}
