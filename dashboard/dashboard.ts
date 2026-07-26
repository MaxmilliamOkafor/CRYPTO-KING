/**
 * dashboard/dashboard.ts — extension page with:
 *  - the recently-analyzed table (chrome.storage.local via the background
 *    worker) with signal/score/mcap/age filters,
 *  - a manual P&L journal (chrome.storage.local, 'ck:journal').
 *
 * Journal entries are MANUAL ONLY — the extension never connects to a wallet.
 * Open positions show unrealized P&L against the last price the scanner saw
 * for that mint address, when available.
 */

import { DISCLAIMER, MOCK_MODE } from '../config.ts';
import { gradeColors as gradeColorsDash, gradeLabel as gradeLabelDash } from '../lib/kingGrade.ts';
import type { JournalEntry, RecentResponse, RecentToken } from '../lib/types.ts';

const JOURNAL_KEY = 'ck:journal';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let recent: RecentToken[] = [];
let journal: JournalEntry[] = [];

document.addEventListener('DOMContentLoaded', () => {
  $('disclaimer').textContent = `⚠ ${DISCLAIMER}`;
  $('footer-disclaimer').textContent = DISCLAIMER;
  $('mock-badge').hidden = !MOCK_MODE;

  for (const id of ['f-signal', 'f-min-score', 'f-max-mcap', 'f-max-age']) {
    $(id).addEventListener('input', renderRecent);
  }
  $('clear-recent').addEventListener('click', () => {
    if (!confirm('Clear the analyzed-tokens history?')) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_RECENT' }, () => {
      recent = [];
      renderRecent();
    });
  });
  $('journal-form').addEventListener('submit', onJournalSubmit);

  void loadAll();
});

async function loadAll(): Promise<void> {
  chrome.runtime.sendMessage({ type: 'GET_RECENT' }, (res: RecentResponse | undefined) => {
    recent = res?.ok ? res.recent : [];
    renderRecent();
    renderJournal(); // unrealized P&L depends on recent prices
  });
  const data = await chrome.storage.local.get(JOURNAL_KEY);
  journal = Array.isArray(data[JOURNAL_KEY]) ? (data[JOURNAL_KEY] as JournalEntry[]) : [];
  renderJournal();
}

/* ── Recently analyzed ─────────────────────────────────────────────────── */

function activeFilters(): (row: RecentToken) => boolean {
  const gradeBucket = ($('f-signal') as HTMLSelectElement).value; // now a grade label
  const minGrade = numOrNull(($('f-min-score') as HTMLInputElement).value);
  const maxMcap = numOrNull(($('f-max-mcap') as HTMLInputElement).value);
  const maxAge = numOrNull(($('f-max-age') as HTMLInputElement).value);

  return (row) => {
    if (gradeBucket && gradeLabelDash(row.grade ?? null) !== gradeBucket) return false;
    if (minGrade !== null && (row.grade ?? -1) < minGrade) return false;
    if (maxMcap !== null && (row.marketCapEur === null || row.marketCapEur > maxMcap)) return false;
    if (maxAge !== null && (row.ageMinutes === null || row.ageMinutes > maxAge)) return false;
    return true;
  };
}

function renderRecent(): void {
  const body = $('recent-body');
  body.innerHTML = '';
  const rows = recent.filter(activeFilters());
  $('recent-empty').hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');

    const token = document.createElement('td');
    const sym = document.createElement('div');
    sym.className = 'sym';
    sym.textContent = row.symbol ?? '(unknown)';
    const addr = document.createElement('div');
    addr.className = 'addr';
    const link = document.createElement('a');
    link.href = `https://gmgn.ai/sol/token/${row.address}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = short(row.address);
    addr.appendChild(link);
    token.append(sym, addr);

    // King Grade — consistent direction (higher = better) everywhere.
    const score = document.createElement('td');
    score.className = 'score';
    score.textContent = row.insufficientData || row.grade == null ? '—' : `${row.grade}%`;

    const signal = document.createElement('td');
    if (row.insufficientData || row.grade == null) {
      signal.textContent = 'NO DATA';
    } else {
      const gc = gradeColorsDash(row.grade);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = gradeLabelDash(row.grade);
      badge.style.background = gc.color;
      badge.style.color = gc.textColor;
      signal.appendChild(badge);
    }

    tr.append(
      token,
      td(age(row.ageMinutes)),
      td(eur(row.marketCapEur)),
      td(eur(row.liquidityEur)),
      score,
      signal,
      td(new Date(row.updatedAt).toLocaleString()),
      td(''),
    );
    body.appendChild(tr);
  }
}

/* ── P&L journal ───────────────────────────────────────────────────────── */

function onJournalSubmit(ev: Event): void {
  ev.preventDefault();
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    symbol: ($('j-symbol') as HTMLInputElement).value.trim().toUpperCase(),
    address: ($('j-address') as HTMLInputElement).value.trim(),
    entryPriceEur: Number(($('j-entry') as HTMLInputElement).value),
    amountTokens: Number(($('j-amount') as HTMLInputElement).value),
    exitPriceEur: numOrNull(($('j-exit') as HTMLInputElement).value),
    note: ($('j-note') as HTMLInputElement).value.trim(),
    createdAt: Date.now(),
  };
  if (!entry.symbol || !(entry.entryPriceEur > 0) || !(entry.amountTokens > 0)) return;

  journal = [entry, ...journal];
  void chrome.storage.local.set({ [JOURNAL_KEY]: journal });
  ($('journal-form') as HTMLFormElement).reset();
  renderJournal();
}

function renderJournal(): void {
  const body = $('journal-body');
  body.innerHTML = '';
  $('journal-empty').hidden = journal.length > 0;

  for (const e of journal) {
    const tr = document.createElement('tr');

    const pnlCell = document.createElement('td');
    if (e.exitPriceEur !== null) {
      const pnl = (e.exitPriceEur - e.entryPriceEur) * e.amountTokens;
      pnlCell.className = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
      pnlCell.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`;
    } else {
      const last = e.address ? recent.find((r) => r.address === e.address)?.priceEur : null;
      if (last != null) {
        const pnl = (last - e.entryPriceEur) * e.amountTokens;
        pnlCell.className = pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
        pnlCell.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (unrealized)`;
      } else {
        pnlCell.className = 'pnl-open';
        pnlCell.textContent = 'open';
      }
    }

    const del = document.createElement('button');
    del.className = 'del';
    del.title = 'Delete entry';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      journal = journal.filter((x) => x.id !== e.id);
      void chrome.storage.local.set({ [JOURNAL_KEY]: journal });
      renderJournal();
    });
    const delCell = document.createElement('td');
    delCell.appendChild(del);

    tr.append(
      td(e.symbol + (e.address ? ` (${short(e.address)})` : '')),
      td(fmtPrice(e.entryPriceEur)),
      td(String(e.amountTokens)),
      td(e.exitPriceEur !== null ? fmtPrice(e.exitPriceEur) : '—'),
      pnlCell,
      td(e.note || '—'),
      td(new Date(e.createdAt).toLocaleDateString()),
      delCell,
    );
    body.appendChild(tr);
  }
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function td(text: string): HTMLTableCellElement {
  const el = document.createElement('td');
  el.textContent = text;
  return el;
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function eur(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(2)}`;
}

function fmtPrice(v: number): string {
  return `$${v < 0.01 ? v.toFixed(8) : v.toFixed(4)}`;
}

function age(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
