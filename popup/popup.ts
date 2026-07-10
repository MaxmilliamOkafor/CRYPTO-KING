/**
 * popup/popup.ts — full risk breakdown for the token on the active tab.
 * Falls back to the recently-analyzed list when no token page is open.
 * All data comes from the background worker; the popup never fetches.
 */

import { DISCLAIMER } from '../config.ts';
import { computeKingGrade, gradeColors as gradeColorsPopup, gradeLabel } from '../lib/kingGrade.ts';
import type { AnalyzeResponse, QualityResult, RecentResponse, RiskResult, TokenAnalysis } from '../lib/types.ts';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`),
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`),
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

document.addEventListener('DOMContentLoaded', () => {
  $('disclaimer').textContent = DISCLAIMER;
  $('open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
  void init();
});

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const address = extractAddress(tab?.url ?? '');
  if (!address) {
    await showRecent();
    return;
  }

  $('state').textContent = 'Analyzing token…';
  chrome.runtime.sendMessage({ type: 'ANALYZE_TOKEN', address }, (res: AnalyzeResponse | undefined) => {
    if (chrome.runtime.lastError || !res) {
      $('state').textContent = 'Risk data unavailable.';
      return;
    }
    if (!res.ok) {
      $('state').textContent = res.error;
      return;
    }
    render(res.analysis, res.risk, res.quality, res.mock);
  });
}

function extractAddress(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    for (const re of URL_PATTERNS) {
      const m = path.match(re);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

function render(analysis: TokenAnalysis, risk: RiskResult, quality: QualityResult, mock: boolean): void {
  $('state').hidden = true;
  $('mock-badge').hidden = !mock;

  if (risk.insufficientData) {
    $('state').hidden = false;
    $('state').textContent = 'Not enough data to assess this token — no score shown.';
    return;
  }

  $('result').hidden = false;
  const addr = analysis.identity.address;

  $('token-symbol').textContent = analysis.identity.symbol ?? '(unknown symbol)';
  $('token-address').textContent = addr;

  // Lead with the King Grade so the popup reads the SAME direction as the rest
  // of the extension: higher = better. (No opposite-direction risk number.)
  const kg = computeKingGrade(analysis, risk, quality);
  const gc = gradeColorsPopup(kg.grade);
  const badge = $('signal-badge');
  badge.textContent = kg.grade === null ? 'NO DATA' : gradeLabel(kg.grade);
  badge.style.background = gc.color;
  badge.style.color = gc.textColor;

  const fill = $('score-fill');
  fill.style.width = `${kg.grade ?? 0}%`;
  fill.style.background = gc.color;
  $('score-num').textContent = kg.grade === null ? '— / 100' : `${kg.grade}% King Grade`;

  const reasons = $('reasons');
  reasons.innerHTML = '';
  if (risk.reasons.length === 0) {
    reasons.appendChild(li('gap-item', 'No individual risk factors triggered — low observed risk ≠ safe.'));
  }
  for (const r of risk.reasons.slice(0, 6)) {
    reasons.appendChild(reasonLi(`+${r.points}`, r.text, 'bad'));
  }

  const mitigations = $('mitigations');
  mitigations.innerHTML = '';
  for (const m of risk.mitigations) {
    mitigations.appendChild(reasonLi(`${m.points}`, m.text, 'good'));
  }

  const gaps = $('gaps');
  gaps.innerHTML = '';
  for (const g of risk.dataGaps) gaps.appendChild(li('gap-item', g));
  $('gaps-details').hidden = risk.dataGaps.length === 0;

  renderMetrics(analysis, risk, quality);

  ($('link-solscan') as HTMLAnchorElement).href = `https://solscan.io/token/${addr}`;
  ($('link-rugcheck') as HTMLAnchorElement).href = `https://rugcheck.xyz/tokens/${addr}`;
  ($('link-gmgn') as HTMLAnchorElement).href = `https://gmgn.ai/sol/token/${addr}`;
}

function renderMetrics(a: TokenAnalysis, risk: RiskResult, quality: QualityResult): void {
  const m = a.market;
  const h = a.holders;
  const mint = a.mint;

  const lpText: Record<string, { v: string; cls: string }> = {
    burned: { v: 'Burned', cls: 'good' },
    locked: { v: 'Locked', cls: 'good' },
    deployer_held: { v: 'Deployer-held', cls: 'bad' },
    unlocked: { v: 'Unlocked', cls: 'bad' },
    unknown: { v: 'unknown', cls: 'unknown' },
  };
  const lp = lpText[m?.lpStatus ?? 'unknown'];

  const metrics: Array<{ k: string; v: string; cls?: string }> = [
    { k: 'Liquidity', v: eur(m?.liquidityEur) },
    { k: 'Market cap', v: eur(m?.marketCapEur) },
    { k: 'Top-10 holders', v: pct(h?.top10Pct), cls: h?.top10Pct != null && h.top10Pct > 60 ? 'bad' : undefined },
    { k: 'Token age', v: age(a.identity.ageMinutes) },
    {
      k: 'Transfer fee',
      v: mint?.transferFeeBps != null ? `${(mint.transferFeeBps / 100).toFixed(1)}%` : mint?.isToken2022 === false ? '0% (SPL)' : 'unknown',
      cls: mint?.transferFeeBps != null && mint.transferFeeBps > 1000 ? 'bad' : undefined,
    },
    { k: 'LP status', v: lp.v, cls: lp.cls },
    ...authorityMetric('Mint authority', mint?.mintAuthorityActive ?? null),
    ...authorityMetric('Freeze authority', mint?.freezeAuthorityActive ?? null),
    {
      k: 'Quality signals',
      v: quality.insufficientData ? 'unknown' : `${quality.qualityScore}/100`,
      cls: !quality.insufficientData && quality.qualityScore >= 50 ? 'good' : undefined,
    },
    (() => {
      const kg = computeKingGrade(a, risk, quality);
      return {
        k: 'King Grade',
        v: kg.grade === null ? 'unknown' : `${kg.grade}% ${gradeLabel(kg.grade)}`,
        cls: kg.grade !== null && kg.grade >= 60 ? 'good' : kg.grade !== null && kg.grade < 20 ? 'bad' : undefined,
      };
    })(),
  ];

  const grid = $('metrics');
  grid.innerHTML = '';
  for (const item of metrics) {
    const div = document.createElement('div');
    div.className = 'metric';
    const k = document.createElement('div');
    k.className = 'k';
    k.textContent = item.k;
    const v = document.createElement('div');
    v.className = `v ${item.v === 'unknown' ? 'unknown' : (item.cls ?? '')}`;
    v.textContent = item.v;
    div.append(k, v);
    grid.appendChild(div);
  }
}

function authorityMetric(label: string, active: boolean | null): Array<{ k: string; v: string; cls?: string }> {
  if (active === null) return [{ k: label, v: 'unknown' }];
  return [{ k: label, v: active ? 'ACTIVE' : 'Revoked', cls: active ? 'bad' : 'good' }];
}

/* ── Recent list fallback ──────────────────────────────────────────────── */

async function showRecent(): Promise<void> {
  $('state').hidden = true;
  $('no-token').hidden = false;
  chrome.runtime.sendMessage({ type: 'GET_RECENT' }, (res: RecentResponse | undefined) => {
    const list = $('recent-list');
    list.innerHTML = '';
    if (!res?.ok || res.recent.length === 0) {
      list.appendChild(li('gap-item', 'Nothing analyzed yet.'));
      return;
    }
    for (const row of res.recent.slice(0, 8)) {
      const gc = gradeColorsPopup(row.grade ?? null);
      const item = document.createElement('li');
      const sym = document.createElement('span');
      sym.className = 'sym';
      sym.textContent = row.symbol ?? `${row.address.slice(0, 4)}…${row.address.slice(-4)}`;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = row.grade == null ? 'NO DATA' : `${row.grade}% ${gradeLabel(row.grade)}`;
      badge.style.background = gc.color;
      badge.style.color = gc.textColor;
      item.append(sym, badge);
      list.appendChild(item);
    }
  });
}

/* ── Small helpers ─────────────────────────────────────────────────────── */

function li(cls: string, text: string): HTMLLIElement {
  const el = document.createElement('li');
  el.className = cls;
  el.textContent = text;
  return el;
}

function reasonLi(points: string, text: string, cls: 'bad' | 'good'): HTMLLIElement {
  const el = document.createElement('li');
  const pts = document.createElement('span');
  pts.className = `pts ${cls}`;
  pts.textContent = points;
  const txt = document.createElement('span');
  txt.textContent = text;
  el.append(pts, txt);
  return el;
}

function eur(v: number | null | undefined): string {
  if (v == null) return 'unknown';
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toFixed(v < 1 ? 6 : 2)}`;
}

function pct(v: number | null | undefined): string {
  return v == null ? 'unknown' : `${v.toFixed(0)}%`;
}

function age(minutes: number | null | undefined): string {
  if (minutes == null) return 'unknown';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
