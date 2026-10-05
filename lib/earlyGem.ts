/**
 * lib/earlyGem.ts — "Early Conviction": the strongest evidence available for a
 * coin in its FIRST DAYS, while the market cap is still low. Pure, unit-tested.
 *
 * The long-hold radar (lib/longHold.ts) judges coins that already survived 3+
 * days. That's safer, but it's not where a long hold starts — the user wants to
 * be in at launch. At launch there's very little evidence, so this model only
 * uses signals that the data says matter that early (sources in README):
 *
 *  COMMUNITY (30)   Socials are the strongest launch-time predictor known:
 *                   Telegram 8.9×, all three 17.4× graduation rate. Replies,
 *                   holders once listed.
 *  FAIR LAUNCH (30) A long hold dies if a dev bag, whale or sniper cluster can
 *                   dump on it. Top-10 share excludes the curve/pool.
 *  MOMENTUM (25)    Curve speed (or graduation), breadth of buyers, buy
 *                   pressure — and NOT already dumped from its peak.
 *  CONVICTION (15)  Builds up while the tracker watches: new holders per hour
 *                   (early winners: 50–100/h) and whether the community held
 *                   through its first pullback. Unknown at first sight.
 *
 * Unknowns score 0 and are listed. Any hard disqualifier → REJECT. Even a
 * STRONG verdict mostly fails — this narrows the field, it doesn't pick winners.
 */

import { EARLY_GEM } from '../config.ts';
import { assessLiveState } from './liveState.ts';
import type { EarlyGemResult, EarlyVerdict, GemPortfolioRow, GemSnapshot, GemStage, LongHoldPillar, RiskResult, TokenAnalysis, TrackedGem } from './types.ts';

export interface EarlyInputs {
  ageHours: number | null;
  buyers24h: number | null;
  sellers24h: number | null;
  holderCount: number | null;
  /** Our own snapshots (oldest first) — empty at first sight. */
  history: GemSnapshot[];
  socials: { twitter: boolean; telegram: boolean; website: boolean };
}

type Acc = { score: number; max: number; good: string[]; bad: string[]; unknown: string[] };
const acc = (max: number): Acc => ({ score: 0, max, good: [], bad: [], unknown: [] });

export function stageForAge(ageHours: number | null): GemStage {
  if (ageHours === null || ageHours < 24) return 'SEED';
  return ageHours < 72 ? 'SPROUT' : 'ROOTED';
}

export function assessEarlyGem(a: TokenAnalysis, risk: RiskResult, x: EarlyInputs, t = EARLY_GEM): EarlyGemResult {
  const dq: string[] = [];
  let softOnly = true; // every DQ so far is "temporary" (a dump in progress)
  const hard = (msg: string) => {
    dq.push(msg);
    softOnly = false;
  };
  const m = a.mint;
  const L = a.launch;
  const onCurve = L?.bondingCurveComplete === false;
  const mcap = a.market?.marketCapEur ?? null;
  const liq = a.market?.liquidityEur ?? null;

  /* ── Hard disqualifiers: one-transaction rugs and broken launches ────── */
  if (m?.mintAuthorityActive === true) hard('Mint authority active — supply can be inflated.');
  if (m?.freezeAuthorityActive === true) hard('Freeze authority active — wallets can be frozen.');
  if (m?.permanentDelegateActive || m?.nonTransferable || m?.defaultAccountFrozen || m?.transferHookActive) {
    hard('Token-2022 trap extension present.');
  }
  if (a.market?.sellSimulation?.ok === false) hard('Simulated sell fails — honeypot.');
  const lp = a.market?.lpStatus ?? 'unknown';
  if (!onCurve && (lp === 'unlocked' || lp === 'deployer_held')) hard('Liquidity can be pulled (LP not burned/locked).');
  if (L?.bannedOnPlatform === true) hard('Banned on its own launchpad.');
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) hard('Creator is a serial launcher of dead coins.');
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev > t.maxDevPct) hard(`Dev holds ${dev.toFixed(1)}% — they'd be selling into your hold.`);
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > t.maxLargestWalletPct) hard(`One wallet already holds ${whale.toFixed(1)}%.`);
  const top10 = a.holders?.top10Pct ?? null;
  if (top10 !== null && top10 > t.maxTop10Pct) hard(`Top 10 wallets hold ${top10.toFixed(0)}% — snipers/insiders own it.`);
  const athR = L?.athRatio ?? null;
  if (athR !== null && athR < t.minAthRatio) {
    hard(`Already ${Math.round((1 - athR) * 100)}% below its peak — the pump-and-dump happened.`);
  }
  const volLiq = a.market?.volume24hEur != null && liq ? a.market.volume24hEur / liq : null;
  if (volLiq !== null && volLiq > 10) hard(`Volume ${volLiq.toFixed(0)}× liquidity — wash trading.`);
  const live = assessLiveState(a.market);
  if (live.state === 'DEAD') hard(`Already rugged/dead — ${live.reasons[0] ?? 'market collapsed.'}`);
  if (live.state === 'DUMPING') dq.push(`Dumping right now — ${live.reasons[0] ?? 'falling hard.'}`); // soft

  /* ── 1. Community signals (30) ───────────────────────────────────────── */
  const cm = acc(30);
  const so = x.socials;
  if (so.telegram) cm.score += 10;
  if (so.twitter) cm.score += 8;
  if (so.website) cm.score += 5;
  const n = Number(so.telegram) + Number(so.twitter) + Number(so.website);
  if (n === 3) cm.good.push('Telegram + X + website — launches like this graduate ~17× more often.');
  else if (so.telegram) cm.good.push('Has a Telegram — the strongest single launch signal (8.9×).');
  if (n < 3) cm.bad.push(`Missing ${[!so.telegram && 'Telegram', !so.twitter && 'X', !so.website && 'website'].filter(Boolean).join(', ')}.`);
  const replies = L?.replyCount ?? null;
  if (replies === null) cm.unknown.push('launchpad replies');
  else if (replies >= 50) {
    cm.score += 4;
    cm.good.push(`${replies} replies on pump.fun — people are talking.`);
  } else if (replies >= 15) cm.score += 2;
  if (x.holderCount !== null) {
    if (x.holderCount >= 500) {
      cm.score += 3;
      cm.good.push(`${x.holderCount.toLocaleString('en-US')} holders already.`);
    } else if (x.holderCount >= 200) cm.score += 1;
  }

  /* ── 2. Fair launch (30) ─────────────────────────────────────────────── */
  const fl = acc(30);
  if (top10 === null) fl.unknown.push('top-10 concentration');
  else {
    fl.score += top10 <= 10 ? 12 : top10 <= 15 ? 8 : top10 <= 20 ? 4 : 0;
    (top10 <= 15 ? fl.good : fl.bad).push(`Top 10 wallets hold ${top10.toFixed(1)}% (curve/pool excluded).`);
  }
  if (whale === null) fl.unknown.push('largest wallet');
  else fl.score += whale <= 2 ? 8 : whale <= 3 ? 6 : whale <= 5 ? 3 : 0;
  if (dev === null) fl.unknown.push('dev holdings');
  else {
    fl.score += dev <= 1 ? 6 : dev <= 3 ? 4 : dev <= 5 ? 2 : 0;
    if (dev <= 1) fl.good.push('Dev holds ~nothing — no team bag over your head.');
  }
  const d = a.deployer;
  if (d?.priorLaunches != null && d.graduatedLaunches != null && d.priorLaunches >= 2 && d.graduatedLaunches / d.priorLaunches >= 0.5) {
    fl.score += 4;
    fl.good.push(`Creator has a track record — ${d.graduatedLaunches}/${d.priorLaunches} past coins graduated.`);
  } else if (d?.priorLaunches == null) fl.unknown.push('creator history');

  /* ── 3. Organic momentum (25) ────────────────────────────────────────── */
  const mo = acc(25);
  const prog = L?.curveProgressPct ?? null;
  if (L?.bondingCurveComplete === true) {
    mo.score += 10;
    mo.good.push('Graduated off the bonding curve — real buyers carried it.');
  } else if (prog === null || x.ageHours === null) mo.unknown.push('curve progress');
  else {
    const perHour = prog / Math.max(x.ageHours, 0.25);
    mo.score += perHour >= 25 ? 10 : perHour >= 10 ? 6 : perHour >= 3 ? 3 : 0;
    if (perHour >= 10) mo.good.push(`Filling its curve fast — ${prog.toFixed(0)}% in ${fmtAge(x.ageHours)}.`);
    else if (perHour < 3) mo.bad.push(`Stalling — only ${prog.toFixed(0)}% of the curve after ${fmtAge(x.ageHours)}.`);
  }
  if (x.buyers24h !== null) {
    mo.score += x.buyers24h >= 300 ? 8 : x.buyers24h >= 100 ? 5 : x.buyers24h >= 40 ? 2 : 0;
    if (x.buyers24h >= 100) mo.good.push(`${x.buyers24h} different wallets buying — broad demand.`);
  } else if (L?.kingOfTheHill === true) {
    mo.score += 6;
    mo.good.push('Reached king of the hill on pump.fun.');
  } else mo.unknown.push('buyer breadth');
  const buys = x.buyers24h ?? a.market?.buys1h ?? null;
  const sells = x.sellers24h ?? a.market?.sells1h ?? null;
  if (buys !== null && sells !== null && buys + sells > 0) {
    if (buys >= sells) mo.score += 4;
    else mo.bad.push(`More selling than buying (${sells} vs ${buys}).`);
  }
  if (athR !== null) {
    if (athR >= 0.6) mo.score += 3;
    else if (athR >= 0.4) mo.score += 1;
    if (athR < 0.6) mo.bad.push(`${Math.round((1 - athR) * 100)}% below its peak.`);
  }
  const ch1h = a.market?.priceChange1h ?? null;
  if (ch1h !== null && ch1h >= 300 && volLiq !== null && volLiq < 0.2) {
    mo.score = Math.max(0, mo.score - 6);
    mo.bad.push(`+${ch1h.toFixed(0)}% in an hour on thin volume — artificial pump pattern.`);
  }

  /* ── 4. Holder conviction (15) — fills in while tracked ──────────────── */
  const cv = acc(15);
  const hph = holdersPerHour(x.history, x.holderCount);
  if (hph === null) cv.unknown.push('holder growth (builds up while tracked)');
  else if (hph >= t.strongHoldersPerHour) {
    cv.score += 6;
    cv.good.push(`+${Math.round(hph)} holders/hour — the pace early winners show.`);
  } else if (hph >= t.okHoldersPerHour) cv.score += 3;
  else if (hph < 0) cv.bad.push('Holders are leaving.');
  const held = heldThroughDip(x.history);
  if (held === null) cv.unknown.push('reaction to its first dip');
  else if (held) {
    cv.score += 5;
    cv.good.push("Community held through a 25%+ dip — holders didn't panic.");
  } else cv.bad.push('Holders sold out on the first dip.');
  const first = x.history.find((h) => h.mcap !== null);
  if (first?.mcap && mcap !== null) {
    if (mcap >= first.mcap) cv.score += 4;
  } else cv.unknown.push('trend since first sight');

  /* ── Combine ─────────────────────────────────────────────────────────── */
  const parts: Array<[string, string, Acc]> = [
    ['community', 'Community signals', cm],
    ['fairLaunch', 'Fair launch', fl],
    ['momentum', 'Organic momentum', mo],
    ['conviction', 'Holder conviction', cv],
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
  const score = pillars.reduce((s, p) => s + p.score, 0);
  const coreVerified = m?.mintAuthorityActive === false && m?.freezeAuthorityActive === false && top10 !== null && whale !== null;

  let verdict: EarlyVerdict;
  if (risk.insufficientData) verdict = 'NO_DATA';
  else if (dq.length > 0) verdict = 'REJECT';
  else if (score >= t.strongScore && coreVerified) verdict = 'STRONG';
  else if (score >= t.promisingScore) verdict = 'PROMISING';
  else verdict = 'WEAK';

  return {
    stage: stageForAge(x.ageHours),
    verdict,
    score: verdict === 'NO_DATA' ? null : score,
    pillars,
    disqualifiers: dq,
    hardBreak: dq.length > 0 && !softOnly,
    strengths: pillars.flatMap((p) => p.good),
    concerns: pillars.flatMap((p) => p.bad),
    unverified: pillars.flatMap((p) => p.unknown),
    ageHours: x.ageHours,
    curveProgressPct: prog,
  };
}

/** New holders per hour across our snapshots (+ the current count). Needs ≥ 1h. */
export function holdersPerHour(h: GemSnapshot[], current: number | null): number | null {
  const pts = h.filter((s) => s.holders !== null).map((s) => ({ at: s.at, n: s.holders as number }));
  if (current !== null) pts.push({ at: Date.now(), n: current });
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const hours = (b.at - a.at) / 3_600_000;
  if (hours < 1) return null;
  return (b.n - a.n) / hours;
}

/**
 * Did holders stay (or grow) through the first ≥25% pullback from a high?
 * null = no such dip yet, or no holder data across it. Research on early
 * winners: how a community reacts to its FIRST dip tends to repeat later.
 */
export function heldThroughDip(h: GemSnapshot[]): boolean | null {
  let peakMcap = 0;
  let peakHolders: number | null = null;
  for (const s of h) {
    if (s.mcap === null) continue;
    if (s.mcap > peakMcap) {
      peakMcap = s.mcap;
      peakHolders = s.holders;
      continue;
    }
    if (s.mcap <= peakMcap * 0.75 && peakHolders !== null && s.holders !== null) {
      return s.holders >= peakHolders * 0.97; // a few % churn is noise
    }
  }
  return null;
}

/**
 * "If you had put the same amount into every tracked coin at first sight":
 * multiple at each horizon (dead = 0×). Includes DROPPED coins — leaving them
 * out would turn this into survivorship bias. Pure.
 */
export function computeGemPortfolio(gems: TrackedGem[], horizonsDays: readonly number[], now = Date.now()): GemPortfolioRow[] {
  return horizonsDays.map((days) => {
    const ms = days * 86_400_000;
    const eligible = gems.filter((g) => now - g.spottedAt >= ms && g.spottedMcap > 0);
    const results: Array<{ mult: number; dead: boolean; sym: string | null }> = [];
    for (const g of eligible) {
      const target = g.spottedAt + ms;
      // The snapshot nearest the horizon, within a quarter of it (min 6h).
      const tol = Math.max(6 * 3_600_000, ms / 4);
      let best: GemSnapshot | null = null;
      for (const s of g.snapshots) {
        if (Math.abs(s.at - target) <= tol && (!best || Math.abs(s.at - target) < Math.abs(best.at - target))) best = s;
      }
      if (!best) continue;
      if (best.dead) results.push({ mult: 0, dead: true, sym: g.symbol });
      else if (best.mcap !== null) results.push({ mult: best.mcap / g.spottedMcap, dead: false, sym: g.symbol });
    }
    const mults = results.map((r) => r.mult).sort((a, b) => a - b);
    const top = results.reduce<{ mult: number; sym: string | null } | null>((b, r) => (!b || r.mult > b.mult ? r : b), null);
    return {
      horizonDays: days,
      eligible: eligible.length,
      measured: results.length,
      alive: results.filter((r) => !r.dead && r.mult >= 0.1).length,
      portfolioMultiple: mults.length ? mults.reduce((s, v) => s + v, 0) / mults.length : null,
      medianMultiple: mults.length ? median(mults) : null,
      bestMultiple: top ? top.mult : null,
      bestSymbol: top ? top.sym : null,
    };
  });
}

export const GEM_STAGE_META: Record<GemStage | 'DROPPED', { label: string; color: string; textColor: string }> = {
  SEED: { label: '🌱 SEED', color: '#2f6f3e', textColor: '#dff5e3' },
  SPROUT: { label: '🌿 SPROUT', color: '#3f8f4f', textColor: '#ffffff' },
  ROOTED: { label: '🌳 ROOTED', color: '#d4a017', textColor: '#1b1b18' },
  DROPPED: { label: '✂ DROPPED', color: '#5a2a2a', textColor: '#ffd9d9' },
};

export const EARLY_VERDICT_META: Record<EarlyVerdict, { label: string; color: string; textColor: string }> = {
  STRONG: { label: '🌱 STRONG EARLY SIGNALS', color: '#d4a017', textColor: '#1b1b18' },
  PROMISING: { label: '🌿 PROMISING', color: '#46a758', textColor: '#ffffff' },
  WEAK: { label: 'WEAK', color: '#f76b15', textColor: '#ffffff' },
  REJECT: { label: '⛔ REJECT', color: '#e5484d', textColor: '#ffffff' },
  NO_DATA: { label: 'NO DATA', color: '#3a3f4c', textColor: '#e6e8ee' },
};

function median(sorted: number[]): number {
  const k = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
}

function fmtAge(h: number): string {
  return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)}h` : `${Math.floor(h / 24)} days`;
}
