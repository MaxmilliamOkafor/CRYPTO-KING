/**
 * lib/qualityScorer.ts — the positive axis, pure and unit-testable.
 *
 * scoreQuality(analysis) → { qualityScore 0–100, reasons, insufficientData }
 *
 * Counts OBSERVABLE good signals the same way riskScorer counts bad ones:
 * smart money accumulating, burned/locked LP, both authorities revoked,
 * healthy holder distribution, a real holder base, genuine liquidity depth,
 * organic volume, launchpad graduation, and survival milestones.
 *
 * Framing is non-negotiable: this is NOT a profit prediction. Meme coins with
 * perfect quality signals still go to zero constantly. The score exists to
 * RANK candidates worth the user's own research (🏆 sort), nothing more.
 * Nulls score zero — unknowns are never treated as positives.
 */

import { QUALITY_LIMITS, QUALITY_WEIGHTS } from '../config.ts';
import type { QualityResult, RiskReason, TokenAnalysis } from './types.ts';

type QWeights = typeof QUALITY_WEIGHTS;
type QLimits = typeof QUALITY_LIMITS;

export function scoreQuality(a: TokenAnalysis, w: QWeights = QUALITY_WEIGHTS, l: QLimits = QUALITY_LIMITS): QualityResult {
  const reasons: RiskReason[] = [];
  const hit = (points: number, text: string) => reasons.push({ points, text });

  const insufficientData = a.mint === null && a.market === null && a.holders === null;
  if (insufficientData) {
    return { qualityScore: 0, reasons, insufficientData: true };
  }

  /* Smart money (GMGN) */
  const sm = a.smartMoney;
  if (sm?.accumulating === true && sm.exiting !== true) {
    const strong = sm.walletCount !== null && sm.walletCount >= 3;
    hit(
      strong ? w.smartMoneyStrong : w.smartMoneyLight,
      `Smart-money wallets accumulating${sm.walletCount ? ` (${sm.walletCount})` : ''}.`,
    );
  }

  /* Socials */
  const s = a.socials;
  if (s?.verified === true) hit(w.verifiedSocials, 'Verified website/Twitter/Telegram.');
  if (s && s.website && s.twitter && s.telegram) {
    hit(w.fullSocialPresence, 'Full social presence (site + Twitter + Telegram).');
  }

  /* LP security */
  const lp = a.market?.lpStatus;
  if (lp === 'burned') hit(w.lpBurned, 'LP burned — liquidity cannot be pulled.');
  else if (lp === 'locked') hit(w.lpLocked, 'LP locked with a third-party locker.');

  /* Authorities */
  if (a.mint?.mintAuthorityActive === false && a.mint?.freezeAuthorityActive === false) {
    hit(w.authoritiesRevoked, 'Mint AND freeze authority revoked.');
  }

  /* Holder base & distribution */
  const h = a.holders;
  if (h?.top10Pct !== null && h?.top10Pct !== undefined && h.top10Pct <= l.healthyTop10Pct) {
    hit(w.healthyDistribution, `Healthy distribution — top 10 hold only ${h.top10Pct.toFixed(0)}%.`);
  }
  if (h?.holderCount !== null && h?.holderCount !== undefined) {
    if (h.holderCount >= l.largeHolderCount) hit(w.holderBaseLarge, `${h.holderCount.toLocaleString()} holders.`);
    else if (h.holderCount >= l.minHolderCount) hit(w.holderBase, `${h.holderCount.toLocaleString()} holders.`);
  }

  /* Liquidity depth & organic volume */
  const m = a.market;
  if (m?.liquidityEur !== null && m?.liquidityEur !== undefined && m.marketCapEur !== null) {
    if (m.liquidityEur >= l.minLiquidityEur && m.liquidityEur / m.marketCapEur >= l.minLiqMcapRatio) {
      hit(w.liquidityDepth, `Real liquidity depth (€${Math.round(m.liquidityEur / 1000)}k, ${((m.liquidityEur / m.marketCapEur) * 100).toFixed(0)}% of cap).`);
    }
    if (m.volume24hEur !== null && m.marketCapEur > 0) {
      const ratio = m.volume24hEur / m.marketCapEur;
      if (ratio >= l.volMcapMin && ratio <= l.volMcapMax) {
        hit(w.organicVolume, 'Volume/market-cap ratio in a healthy band.');
      }
    }
  }

  /* Launchpad graduation & survival */
  if (a.launch?.bondingCurveComplete === true) {
    hit(w.graduated, 'Graduated its bonding curve — survived the launchpad.');
  }
  const age = a.identity.ageMinutes;
  if (age !== null) {
    if (age >= 7 * 1440) hit(w.survived7d, 'Survived 7+ days with data intact.');
    else if (age >= 1440) hit(w.survived24h, 'Survived 24+ hours.');
  }

  reasons.sort((x, y) => y.points - x.points);
  const qualityScore = Math.min(
    100,
    Math.max(0, Math.round(reasons.reduce((sum, r) => sum + r.points, 0))),
  );

  return { qualityScore, reasons, insufficientData: false };
}
