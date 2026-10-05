/**
 * lib/longHold.ts — "Staying Power": could this coin be HELD for weeks/months?
 * Pure and unit-tested.
 *
 * The rest of the scanner answers "will this rug me in the next hour?". This
 * answers the long-hold question the way early PEPE/BONK/WIF holders would
 * have needed it answered — using what the research actually shows separates
 * survivors from the 95%+ that die (sources in README → Long-hold radar):
 *
 *  SURVIVAL (20)    68.7% of pump.fun coins die on launch day, 80% within 48h,
 *                   4.55% reach 90 days. Age past the rug window is the single
 *                   strongest filter; < LONG_HOLD.minAgeDays is "too early".
 *  COMMUNITY (15)   Telegram: 8.9× graduation; all 3 socials: 17.4× (survival
 *                   study of 832,941 launches). Holder base + holder GROWTH.
 *  DISTRIBUTION (20) Whale dominance is a core measured fragility dimension.
 *  LIQUIDITY (15)   Survivors are defined by deep, locked liquidity.
 *  DEMAND (15)      82.6% of 100%+ gainers showed ARTIFICIAL growth (wash
 *                   trading / LP-based price inflation). Real demand = many
 *                   unique buyers and sane volume ÷ liquidity, persisting.
 *  RESILIENCE (15)  BONK fell 96% and recovered: crashes don't disqualify;
 *                   recovery, higher lows and calming volatility qualify.
 *
 * Unknown inputs score 0 and are listed as unverified — a coin cannot look
 * durable by being unscanned. Hard disqualifiers override any score.
 * 100% ≠ a buy signal. It means "has the traits survivors had", nothing more.
 */

import { LONG_HOLD } from '../config.ts';
import type { Candle } from './geckoClient.ts';
import { assessLiveState } from './liveState.ts';
import { assessRugPotential } from './rugPotential.ts';
import type { LongHoldPillar, LongHoldResult, LongHoldTier, RiskResult, TokenAnalysis } from './types.ts';

export interface LongHoldInputs {
  /** Days since the coin started trading (best available source). */
  ageDays: number | null;
  /** Daily candles, oldest first (GeckoTerminal). */
  candles: Candle[] | null;
  buyers24h: number | null;
  sellers24h: number | null;
  holderCount: number | null;
  /** Our own snapshots of the holder count, oldest first. */
  holderHistory: Array<{ at: number; holderCount: number }>;
  socials: { twitter: boolean; telegram: boolean; website: boolean };
}

type Acc = { score: number; max: number; good: string[]; bad: string[]; unknown: string[] };
const acc = (max: number): Acc => ({ score: 0, max, good: [], bad: [], unknown: [] });

export function assessLongHold(a: TokenAnalysis, risk: RiskResult, x: LongHoldInputs, t = LONG_HOLD): LongHoldResult {
  const disqualifiers: string[] = [];
  const mcap = a.market?.marketCapEur ?? null; // USD (EUR_PER_USD = 1)
  const liq = a.market?.liquidityEur ?? null;
  const k = x.candles && x.candles.length > 0 ? x.candles : null;

  /* ── Hard disqualifiers: no score outweighs these ───────────────────── */
  const rug = assessRugPotential(a, risk);
  const live = assessLiveState(a.market);
  if (live.state === 'DEAD') disqualifiers.push(`Already rugged/dead — ${live.reasons[0] ?? 'market collapsed.'}`);
  if (live.state === 'DUMPING') disqualifiers.push(`Dumping right now — ${live.reasons[0] ?? 'price falling hard.'}`);
  if (a.mint?.mintAuthorityActive === true) disqualifiers.push('Mint authority active — supply can be inflated forever.');
  if (a.mint?.freezeAuthorityActive === true) disqualifiers.push('Freeze authority active — your wallet can be frozen.');
  if (rug.verdict === 'HIGH') disqualifiers.push(`Rug vector open: ${rug.vectors[0] ?? 'see rug check.'}`);
  const lp = a.market?.lpStatus ?? 'unknown';
  if (lp === 'unlocked' || lp === 'deployer_held') disqualifiers.push('Liquidity is not burned or locked — it can be pulled.');
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > t.maxLargestWalletPct) {
    disqualifiers.push(`One wallet holds ${whale.toFixed(1)}% — a long hold means waiting on their exit.`);
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev > t.maxDevPct) disqualifiers.push(`Dev still holds ${dev.toFixed(1)}% of supply.`);
  const top10 = a.holders?.top10Pct ?? null;
  if (top10 !== null && top10 > t.maxTop10Pct) disqualifiers.push(`Top 10 wallets hold ${top10.toFixed(0)}% — too concentrated to survive.`);
  const volLiq = a.market?.volume24hEur != null && liq ? a.market.volume24hEur / liq : null;
  if (volLiq !== null && volLiq > t.washVolLiqRatio) {
    disqualifiers.push(`24h volume is ${volLiq.toFixed(0)}× its liquidity — almost certainly wash-traded.`);
  }
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) disqualifiers.push('Creator is a serial launcher of dead coins.');

  /* ── 1. Survival (20) ────────────────────────────────────────────────── */
  const sv = acc(20);
  const age = x.ageDays;
  if (age === null) sv.unknown.push('coin age');
  else {
    const pts = age >= 90 ? 16 : age >= 30 ? 14 : age >= 14 ? 12 : age >= 7 ? 9 : age >= t.minAgeDays ? 6 : 0;
    sv.score += pts;
    if (age >= t.minAgeDays) sv.good.push(`Survived ${fmtDays(age)} — past the window where ~95% of launches die.`);
    else sv.bad.push(`Only ${fmtDays(age)} old — inside the rug/abandon window.`);
  }
  if (k && age !== null && age >= t.minAgeDays) {
    // Continuity: across the POOL's own life (first → last candle), did it
    // trade every day or go quiet? Measured on the pool, not the coin's age,
    // so time spent on a bonding curve before migrating doesn't count as gaps.
    const span = Math.max(1, Math.round((k[k.length - 1].t - k[0].t) / 86_400) + 1);
    const active = k.filter((c) => c.v > 0).length;
    const ratio = Math.min(1, active / span);
    if (ratio >= 0.9) {
      sv.score += 4;
      sv.good.push('Traded every day — never went quiet.');
    } else if (ratio < 0.7) sv.bad.push('Went quiet for stretches — interest is not continuous.');
    else sv.score += 2;
  }

  /* ── 2. Community & social presence (15) ─────────────────────────────── */
  const cm = acc(15);
  if (x.socials.telegram) cm.score += 4;
  if (x.socials.twitter) cm.score += 3;
  if (x.socials.website) cm.score += 2;
  const nSocial = Number(x.socials.telegram) + Number(x.socials.twitter) + Number(x.socials.website);
  if (nSocial === 3) cm.good.push('X + Telegram + website — the pattern with a 17× higher survival rate.');
  else if (nSocial === 0) cm.bad.push('No socials — coins without them almost never last.');
  else cm.bad.push(`Missing ${[!x.socials.telegram && 'Telegram', !x.socials.twitter && 'X', !x.socials.website && 'website'].filter(Boolean).join(', ')}.`);
  if (x.holderCount === null) cm.unknown.push('holder count');
  else if (x.holderCount >= 5000) {
    cm.score += 3;
    cm.good.push(`${fmtInt(x.holderCount)} holders.`);
  } else if (x.holderCount >= 1000) {
    cm.score += 1;
    cm.good.push(`${fmtInt(x.holderCount)} holders — a growing community.`);
  } else cm.bad.push(`Only ${fmtInt(x.holderCount)} holders.`);
  const growth = holderGrowthPerDay(x.holderHistory);
  if (growth === null) cm.unknown.push('holder growth (tracked over time — needs 1+ day of history)');
  else if (growth >= 1) {
    cm.score += 3;
    cm.good.push(`Holders growing ~${growth.toFixed(1)}%/day.`);
  } else if (growth >= 0) cm.score += 1;
  else cm.bad.push(`Holders shrinking (${growth.toFixed(1)}%/day) — people are leaving.`);

  /* ── 3. Fair distribution (20) ───────────────────────────────────────── */
  const ds = acc(20);
  if (top10 === null) ds.unknown.push('top-10 concentration');
  else {
    ds.score += top10 <= 15 ? 10 : top10 <= 25 ? 7 : top10 <= 35 ? 4 : 0;
    (top10 <= 25 ? ds.good : ds.bad).push(`Top 10 real wallets hold ${top10.toFixed(0)}%.`);
  }
  if (whale === null) ds.unknown.push('largest wallet');
  else {
    ds.score += whale <= 2 ? 6 : whale <= 4 ? 4 : whale <= t.maxLargestWalletPct ? 2 : 0;
    if (whale <= 2) ds.good.push(`No whale — largest wallet ${whale.toFixed(1)}%.`);
  }
  if (dev === null) ds.unknown.push('dev holdings');
  else {
    ds.score += dev <= 1 ? 4 : dev <= 3 ? 2 : 0;
    if (dev <= 1) ds.good.push('Dev holds ~nothing — no team bag waiting to sell.');
  }

  /* ── 4. Liquidity health (15) ────────────────────────────────────────── */
  const lq = acc(15);
  if (lp === 'burned') {
    lq.score += 5;
    lq.good.push('LP burned — liquidity can never be pulled.');
  } else if (lp === 'locked') {
    // RugCheck's lpLockedPct counts burned AND time-locked together, so this
    // can't claim "not burned" — only that a time-lock is possible.
    lq.score += 3;
    lq.bad.push('LP ≥90% locked or burned — if it is a time-lock, check when it expires.');
  } else if (lp === 'unknown') lq.unknown.push('LP burn/lock');
  if (liq === null || mcap === null || mcap <= 0) lq.unknown.push('liquidity depth');
  else {
    const r = liq / mcap;
    lq.score += r >= 0.1 ? 5 : r >= 0.05 ? 3 : r >= 0.03 ? 1 : 0;
    lq.score += liq >= 250_000 ? 5 : liq >= 100_000 ? 3 : liq >= 50_000 ? 1 : 0;
    if (r < 0.03) lq.bad.push(`Liquidity only ${(r * 100).toFixed(1)}% of cap — price is fragile.`);
    else if (liq >= 100_000) lq.good.push(`Deep liquidity ($${fmtK(liq)}, ${(r * 100).toFixed(0)}% of cap).`);
  }

  /* ── 5. Organic demand (15) ──────────────────────────────────────────── */
  const dm = acc(15);
  if (volLiq === null) dm.unknown.push('volume vs liquidity');
  else if (volLiq >= 0.1 && volLiq <= 1) {
    dm.score += 5;
    dm.good.push('Healthy trading volume for its liquidity.');
  } else if (volLiq > 1 && volLiq <= 3) dm.score += 2;
  else if (volLiq > t.suspiciousVolLiqRatio) dm.bad.push(`Volume ${volLiq.toFixed(1)}× liquidity — suspicious, possibly wash-traded.`);
  else if (volLiq < 0.1) dm.bad.push('Barely trading — interest has faded.');
  if (x.buyers24h === null) dm.unknown.push('unique buyers');
  else {
    dm.score += x.buyers24h >= 300 ? 4 : x.buyers24h >= 100 ? 2 : 0;
    if (x.buyers24h >= 300) dm.good.push(`${fmtInt(x.buyers24h)} different wallets bought in 24h — real demand.`);
    else if (x.buyers24h < 50) dm.bad.push(`Only ${x.buyers24h} unique buyers in 24h.`);
    if (x.sellers24h !== null && x.sellers24h > 0) {
      if (x.buyers24h >= x.sellers24h * 0.8) dm.score += 3;
      else dm.bad.push(`More wallets selling (${x.sellers24h}) than buying (${x.buyers24h}).`);
    }
  }
  // LP-based price inflation: a big price jump on very little real volume.
  const ch24 = a.market?.priceChange24h ?? null;
  if (ch24 !== null && ch24 >= 100 && volLiq !== null && volLiq < 0.2) {
    dm.score = Math.max(0, dm.score - 5);
    dm.bad.push(`Up ${ch24.toFixed(0)}% on thin volume — the signature of artificial price inflation.`);
  }
  if (k && k.length >= 14) {
    const recent = avg(k.slice(-7).map((c) => c.v));
    const prior = avg(k.slice(-14, -7).map((c) => c.v));
    if (prior > 0 && recent >= prior * 0.4) {
      dm.score += 3;
      if (recent >= prior) dm.good.push('Volume holding up week over week — not a one-off spike.');
    } else if (prior > 0) dm.bad.push('Volume collapsed vs the week before — hype is fading.');
  } else dm.unknown.push('volume persistence (needs 14 days of history)');

  /* ── 6. Price resilience (15) ────────────────────────────────────────── */
  const rs = acc(15);
  let deathSpiral = false;
  if (!k || k.length < 7) rs.unknown.push('price history (needs 7+ days)');
  else {
    const p = pricePath(k);
    if (k.length >= 14) {
      const lowRecent = Math.min(...k.slice(-7).map((c) => c.l));
      const lowPrior = Math.min(...k.slice(-14, -7).map((c) => c.l));
      if (lowRecent > lowPrior) {
        rs.score += 5;
        rs.good.push('Making higher lows — buyers are stepping in earlier each dip.');
      } else rs.bad.push('Still making lower lows.');
      deathSpiral = p.closeVsAth < t.deathSpiralAthShare && lowRecent <= lowPrior;
      const volRecent = stdevLogReturns(k.slice(-8));
      const volPrior = stdevLogReturns(k.slice(-15, -7));
      if (volRecent !== null && volPrior !== null && volRecent < volPrior) {
        rs.score += 3;
        rs.good.push('Volatility calming — the market is maturing.');
      }
    }
    if (p.maxDrawdown >= 0.4 && p.recoveryFromLow >= 1.6) {
      rs.score += 4;
      rs.good.push(`Survived a ${(p.maxDrawdown * 100).toFixed(0)}% shakeout and bounced ${p.recoveryFromLow.toFixed(1)}× off the low — holders didn't give up.`);
    } else if (p.maxDrawdown < 0.4 && k.length >= 14) {
      rs.score += 4;
      rs.good.push('No major crash in its history so far.');
    } else if (p.maxDrawdown >= 0.6 && p.recoveryFromLow < 1.15) {
      rs.bad.push(`Down ${(p.maxDrawdown * 100).toFixed(0)}% and still sitting at its lows.`);
    }
    if (p.closeVsAth >= 0.25) rs.score += 3;
    else rs.bad.push(`${((1 - p.closeVsAth) * 100).toFixed(0)}% below its all-time high.`);
  }
  if (deathSpiral) disqualifiers.push('Death spiral — under 10% of its high and still making lower lows.');

  /* ── Combine ─────────────────────────────────────────────────────────── */
  const parts: Array<[LongHoldPillar['key'], string, Acc]> = [
    ['survival', 'Survival', sv],
    ['community', 'Community', cm],
    ['distribution', 'Fair distribution', ds],
    ['liquidity', 'Liquidity', lq],
    ['demand', 'Organic demand', dm],
    ['resilience', 'Price resilience', rs],
  ];
  const pillars: LongHoldPillar[] = parts.map(([key, label, p]) => ({
    key,
    label,
    score: Math.min(p.max, Math.max(0, p.score)),
    max: p.max,
    good: p.good,
    bad: p.bad,
    unknown: p.unknown,
  }));
  const score = Math.round(pillars.reduce((s, p) => s + p.score, 0));
  const unverified = pillars.flatMap((p) => p.unknown);

  // Core facts a CANDIDATE must have PROVEN (not merely not-failed).
  const coreVerified =
    a.mint?.mintAuthorityActive === false &&
    a.mint?.freezeAuthorityActive === false &&
    (lp === 'burned' || lp === 'locked') &&
    top10 !== null &&
    whale !== null &&
    k !== null &&
    k.length >= 7;

  let tier: LongHoldTier;
  if (risk.insufficientData) tier = 'NO_DATA';
  else if (disqualifiers.length > 0) tier = 'NOT_A_HOLD';
  else if (age !== null && age < t.minAgeDays) tier = 'TOO_EARLY';
  else if (mcap !== null && mcap > t.lateMcapUsd) tier = 'LATE';
  else if (score >= t.candidateScore && coreVerified) tier = 'CANDIDATE';
  else if (score >= t.watchScore) tier = 'WATCH';
  else tier = 'WEAK';

  const strengths = pillars.flatMap((p) => p.good);
  if (mcap !== null && mcap < t.earlyMcapUsd && tier !== 'NOT_A_HOLD') {
    strengths.push(`Still early — $${fmtK(mcap)} market cap.`);
  }

  return {
    tier,
    score: tier === 'NO_DATA' ? null : score,
    pillars,
    disqualifiers,
    strengths,
    concerns: pillars.flatMap((p) => p.bad),
    unverified,
    coreVerified,
    ageDays: age,
    historyDays: k ? k.length : 0,
  };
}

/* ── Price-path helpers (exported for tests) ──────────────────────────── */

export interface PricePath {
  /** Deepest peak-to-trough fall, 0–1. */
  maxDrawdown: number;
  /** Current close ÷ the low of that deepest fall. */
  recoveryFromLow: number;
  /** Current close ÷ all-time high. */
  closeVsAth: number;
}

export function pricePath(k: Candle[]): PricePath {
  let peak = k[0].h;
  let maxDd = 0;
  let ddLow = k[0].l;
  for (const c of k) {
    if (c.h > peak) peak = c.h;
    const dd = 1 - c.l / peak;
    if (dd > maxDd) {
      maxDd = dd;
      ddLow = c.l;
    }
  }
  const ath = Math.max(...k.map((c) => c.h));
  const close = k[k.length - 1].c;
  return { maxDrawdown: maxDd, recoveryFromLow: ddLow > 0 ? close / ddLow : 1, closeVsAth: ath > 0 ? close / ath : 0 };
}

export function stdevLogReturns(k: Candle[]): number | null {
  if (k.length < 3) return null;
  const r: number[] = [];
  for (let i = 1; i < k.length; i++) if (k[i - 1].c > 0 && k[i].c > 0) r.push(Math.log(k[i].c / k[i - 1].c));
  if (r.length < 2) return null;
  const m = avg(r);
  return Math.sqrt(avg(r.map((v) => (v - m) ** 2)));
}

/** Average % change in holder count per day across our own snapshots. */
export function holderGrowthPerDay(h: Array<{ at: number; holderCount: number }>): number | null {
  if (h.length < 2) return null;
  const first = h[0];
  const last = h[h.length - 1];
  const days = (last.at - first.at) / 86_400_000;
  if (days < 0.8 || first.holderCount <= 0) return null; // need ~a day of history
  return ((last.holderCount / first.holderCount - 1) * 100) / days;
}

export const LONG_HOLD_TIER_META: Record<LongHoldTier, { label: string; color: string; textColor: string }> = {
  CANDIDATE: { label: '🏔 LONG-HOLD CANDIDATE', color: '#d4a017', textColor: '#1b1b18' },
  WATCH: { label: '👀 WATCH', color: '#46a758', textColor: '#ffffff' },
  WEAK: { label: 'WEAK', color: '#f76b15', textColor: '#ffffff' },
  TOO_EARLY: { label: '⏳ TOO EARLY', color: '#3a3f4c', textColor: '#e6e8ee' },
  LATE: { label: '📈 ALREADY BIG', color: '#5b4bb7', textColor: '#ffffff' },
  NOT_A_HOLD: { label: '⛔ NOT A HOLD', color: '#e5484d', textColor: '#ffffff' },
  NO_DATA: { label: 'NO DATA', color: '#3a3f4c', textColor: '#e6e8ee' },
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}
function fmtDays(d: number): string {
  return d < 1 ? `${Math.round(d * 24)}h` : `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'}`;
}
