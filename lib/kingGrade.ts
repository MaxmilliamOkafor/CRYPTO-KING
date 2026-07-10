/**
 * lib/kingGrade.ts — the single 0–100% grade, pure and unit-testable.
 *
 * grade = safetyWeight·(100−risk) + qualityWeight·quality + coverageWeight·coverage%
 * then hard caps (config.KING_GRADE.caps) enforce strictness:
 *   confirmed trap → ≤10 · risk ≥60 → ≤15 · on bonding curve → ≤40
 *   partial data → ≤50 · background check not passed → ≤79
 *
 * Coverage counts how many of the 10 audit checks were actually VERIFIED, so
 * unknowns lower the grade — a coin cannot look good by being unscanned.
 * 100% means "passed everything we can check", never "guaranteed profit".
 */

import { KING_GRADE, GRADE_META } from '../config.ts';
import { gemBackgroundCheck } from './gemCriteria.ts';
import type { QualityResult, RiskResult, TokenAnalysis } from './types.ts';

export interface KingGrade {
  /** 0–100 (%), or null when there is not enough data to grade at all. */
  grade: number | null;
  /** Display bucket label (GEM GRADE / STRONG / MIXED / WEAK / AVOID). */
  label: string;
  /** Which caps limited the grade, human-readable (empty = uncapped). */
  caps: string[];
  /** Component transparency for the details panel. */
  parts: { safety: number; quality: number; coveragePct: number };
}

const known = (v: unknown): boolean => v !== null && v !== undefined;

export function computeKingGrade(a: TokenAnalysis, risk: RiskResult, quality: QualityResult): KingGrade {
  if (risk.insufficientData) {
    return { grade: null, label: 'NO DATA', caps: [], parts: { safety: 0, quality: 0, coveragePct: 0 } };
  }

  /* Audit coverage: 10 checks, each either verified or unknown. */
  const checks: boolean[] = [
    known(a.mint?.mintAuthorityActive),
    known(a.mint?.freezeAuthorityActive),
    known(a.mint?.permanentDelegateActive), // Token-2022 trap extensions readable
    known(a.mint?.metadataMutable),
    a.market !== null && a.market.lpStatus !== 'unknown',
    known(a.holders?.top10Pct),
    known(a.holders?.largestNonLpWalletPct),
    a.market?.sellSimulation != null,
    known(a.deployer?.priorLaunches),
    a.socials !== null,
  ];
  const coveragePct = (checks.filter(Boolean).length / checks.length) * 100;

  const safety = 100 - risk.riskScore;
  const raw =
    KING_GRADE.safetyWeight * safety +
    KING_GRADE.qualityWeight * quality.qualityScore +
    KING_GRADE.coverageWeight * coveragePct;
  let grade = Math.round(Math.min(100, Math.max(0, raw)));

  /* Hard caps — strictness lives here. Worst applicable cap wins. */
  const caps: string[] = [];
  const cap = (limit: number, why: string) => {
    if (grade > limit) {
      grade = limit;
      caps.push(`Capped at ${limit}%: ${why}`);
    }
  };

  const confirmedTrap =
    a.mint?.mintAuthorityActive === true ||
    a.mint?.freezeAuthorityActive === true ||
    a.mint?.permanentDelegateActive === true ||
    a.mint?.nonTransferable === true ||
    a.mint?.defaultAccountFrozen === true ||
    a.market?.sellSimulation?.ok === false ||
    a.market?.lpStatus === 'deployer_held';
  if (confirmedTrap) cap(KING_GRADE.caps.confirmedTrap, 'confirmed trap/rug mechanic present.');
  if (risk.riskScore >= 60) cap(KING_GRADE.caps.highRisk, 'risk score 60+.');
  if (a.launch?.bondingCurveComplete === false) {
    cap(KING_GRADE.caps.onBondingCurve, 'still on the bonding curve — dev can dump any second.');
  }
  if (!known(a.holders?.largestNonLpWalletPct) || a.market === null || a.market.lpStatus === 'unknown') {
    cap(KING_GRADE.caps.partialData, 'holders/LP not verified yet — run the full scan.');
  }
  if (!gemBackgroundCheck(a, risk, quality).gem) {
    cap(KING_GRADE.caps.noGemPass, '80%+ is reserved for coins that pass the full background check.');
  }

  return { grade, label: gradeLabel(grade), caps, parts: { safety, quality: quality.qualityScore, coveragePct } };
}

export function gradeLabel(grade: number | null): string {
  if (grade === null) return 'NO DATA';
  for (const bucket of GRADE_META) if (grade >= bucket.min) return bucket.label;
  return 'AVOID';
}

export function gradeColors(grade: number | null): { color: string; textColor: string } {
  if (grade === null) return { color: '#3a3f4c', textColor: '#e6e8ee' };
  for (const bucket of GRADE_META) if (grade >= bucket.min) return { color: bucket.color, textColor: bucket.textColor };
  return { color: '#e5484d', textColor: '#ffffff' };
}
