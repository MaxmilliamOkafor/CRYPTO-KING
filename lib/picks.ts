/**
 * lib/picks.ts — 🏆 TOP PICKS: one ranked answer to "what is worth my
 * attention right now?". Pure, unit-tested.
 *
 * The extension watches three streams — minute-old launches (live feed),
 * young survivors (radar) and coins already being followed (gem tracker) —
 * and each had its own list. Top Picks merges them into a single short list,
 * best first, with only coins that currently PASS their checks:
 *
 *   tier 1  deep-checked and top verdict (long-hold CANDIDATE / STRONG early)
 *   tier 2  deep-checked and passing (WATCH / PROMISING)
 *   tier 3  launches with a STRONG launch score (not deep-checked yet)
 *
 * Never listed: dead or dumping coins, dropped gems, rejected coins, and
 * coins that only passed the radar's quick screen. A pick is "worth
 * researching", never "buy".
 */

import type { FeedRow, RadarRow, TrackedGem } from './types.ts';

export interface PickRow {
  address: string;
  symbol: string | null;
  /** Where the evidence comes from. */
  source: 'tracked' | 'radar' | 'launch';
  tier: 1 | 2 | 3;
  /** 0–100, higher = better (early conviction / staying power / launch score). */
  score: number | null;
  /** Short verdict text for the chip. */
  verdict: string;
  /** 🌱 SEED / 🌿 SPROUT / 🌳 ROOTED. */
  stage: 'SEED' | 'SPROUT' | 'ROOTED';
  marketCapUsd: number | null;
  ageHours: number | null;
  headline: string | null;
  /** Tracked coins only: market cap now ÷ when spotted. */
  multiple: number | null;
  /** true = full background check done (tiers 1–2). */
  deepChecked: boolean;
}

const TOP = new Set(['CANDIDATE', 'STRONG']);
const PASS = new Set(['CANDIDATE', 'STRONG', 'WATCH', 'PROMISING']);

export function buildPicks(gems: TrackedGem[], radar: RadarRow[], feed: FeedRow[], max = 20): PickRow[] {
  const out = new Map<string, PickRow>();

  // Radar: deep-checked young coins (1–21 days).
  for (const r of radar) {
    if (r.kind !== 'deep' || !r.passed || r.verdict === null || !PASS.has(r.verdict)) continue;
    out.set(r.address, {
      address: r.address,
      symbol: r.symbol,
      source: 'radar',
      tier: TOP.has(r.verdict) ? 1 : 2,
      score: r.score,
      verdict: r.verdict,
      stage: r.stage,
      marketCapUsd: r.marketCapUsd,
      ageHours: r.ageDays !== null ? r.ageDays * 24 : null,
      headline: r.headline,
      multiple: null,
      deepChecked: true,
    });
  }

  // Tracked gems: every one was deep-checked when spotted and on each re-check.
  // They override a radar row for the same coin (they carry the multiple).
  for (const g of gems) {
    if (g.status !== 'ACTIVE' || !PASS.has(g.verdict)) continue;
    const last = g.snapshots[g.snapshots.length - 1];
    if (last?.dead) continue;
    out.set(g.address, {
      address: g.address,
      symbol: g.symbol,
      source: 'tracked',
      tier: TOP.has(g.verdict) ? 1 : 2,
      score: g.score,
      verdict: g.verdict,
      stage: g.stage,
      marketCapUsd: g.lastMcap,
      ageHours: null,
      headline: g.events[0]?.text ?? null,
      multiple: g.lastMcap !== null && g.spottedMcap > 0 ? g.lastMcap / g.spottedMcap : null,
      deepChecked: true,
    });
  }

  // Launches: only a STRONG launch score, and only while nothing is wrong.
  for (const f of feed) {
    if (out.has(f.address)) continue;
    if (f.insufficientData || f.liveState === 'DEAD' || f.liveState === 'DUMPING' || f.rugVerdict === 'HIGH') continue;
    if (!f.early || f.early.verdict !== 'STRONG') continue;
    out.set(f.address, {
      address: f.address,
      symbol: f.symbol,
      source: 'launch',
      tier: 3,
      score: f.early.score,
      verdict: 'STRONG',
      stage: f.ageMinutes !== null && f.ageMinutes >= 4320 ? 'ROOTED' : f.ageMinutes !== null && f.ageMinutes >= 1440 ? 'SPROUT' : 'SEED',
      marketCapUsd: f.marketCapEur,
      ageHours: f.ageMinutes !== null ? f.ageMinutes / 60 : null,
      headline: f.early.headline,
      multiple: null,
      deepChecked: false,
    });
  }

  return [...out.values()].sort((a, b) => a.tier - b.tier || (b.score ?? -1) - (a.score ?? -1)).slice(0, max);
}
