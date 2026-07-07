/**
 * content/content.ts — token detection + shadow-DOM overlay on GMGN.AI
 * (and pump.fun coin pages).
 *
 * Ground rules honored here:
 *  - All SCORING and non-GMGN network calls happen in the background worker.
 *    The one deliberate exception: on gmgn.ai we fetch GMGN's own same-origin
 *    endpoints from the page, because they sit behind Cloudflare and only
 *    respond to requests carrying the page's session cookies — a background
 *    fetch gets challenged. We fetch the raw JSON here and forward it to the
 *    background, which does all parsing, merging and scoring. No keys, no
 *    writes, no wallet access — strictly reads of data GMGN already served us.
 *  - The overlay lives inside a closed shadow root on a fixed-position host
 *    element appended to <body>, so host-page CSS can't leak in and we can't
 *    break GMGN's layout.
 *  - Both sites are SPAs: we watch location.href on an interval (content
 *    scripts can't reliably hook the page's history in the isolated world)
 *    and re-detect the token on every route change.
 *
 * Detection order: URL first (GMGN /sol/token/<addr>, pump.fun /coin/<addr>),
 * then DOM fallback (Solscan links near the token header).
 */

import { DISCLAIMER, MOCK_MODE, SIGNAL_META } from '../config.ts';
import { fetchGmgnRaw, type GmgnRaw } from '../lib/gmgnClient.ts';
import type { AnalyzeResponse, RiskResult, TokenAnalysis } from '../lib/types.ts';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`), // gmgn.ai
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`), // pump.fun
];

let currentAddress: string | null = null;
let lastHref = '';
let lastAutoToken: string | null = null;

/* ── Address detection ─────────────────────────────────────────────────── */

function addressFromUrl(): string | null {
  for (const re of URL_PATTERNS) {
    const m = location.pathname.match(re);
    if (m) return m[1];
  }
  // Fallback: a bare base58 mint as the last path segment (some pump.fun routes).
  const seg = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return BASE58_RE.test(seg) ? seg : null;
}

/** DOM fallback: a Solscan token link near the header is the most stable anchor. */
function addressFromDom(): string | null {
  const link = document.querySelector<HTMLAnchorElement>('a[href*="solscan.io/token/"]');
  const m = link?.href.match(new RegExp(`solscan\\.io/token/(${BASE58})`));
  return m ? m[1] : null;
}

/** React to the current page: auto-scan a detected token, else show the scan box. */
function detect(): void {
  if (collapsed) return; // user minimized us; don't pop back open on navigation
  const address = addressFromUrl() ?? addressFromDom();
  if (address) {
    if (address === lastAutoToken && address === currentAddress) return; // already showing it
    lastAutoToken = address;
    void analyze(address);
  } else if (currentAddress === null) {
    lastAutoToken = null;
    renderHome(); // persistent scan box on list/trending pages
  }
}

async function analyze(address: string, _manual = false): Promise<void> {
  currentAddress = address;
  showLoading(address);

  // On gmgn.ai (live mode), grab GMGN's same-origin JSON with the page's
  // cookies and hand it to the background. Failures degrade to null → the
  // background falls back to its own fetch, and unfetchable checks become
  // honest "data unavailable" — never a faked score.
  let rawGmgn: GmgnRaw | undefined;
  if (!MOCK_MODE && location.hostname.endsWith('gmgn.ai')) {
    try {
      rawGmgn = await fetchGmgnRaw(address);
    } catch {
      rawGmgn = undefined;
    }
    if (address !== currentAddress) return; // navigated away / user scanned another
  }

  chrome.runtime.sendMessage(
    { type: 'ANALYZE_TOKEN', address, rawGmgn },
    (res: AnalyzeResponse | undefined) => {
      if (address !== currentAddress) return; // superseded
      if (chrome.runtime.lastError || !res) {
        showError('Risk data unavailable.');
        return;
      }
      if (!res.ok) {
        showError(res.error);
        return;
      }
      render(res.analysis, res.risk, res.mock);
    },
  );
}

/* ── Persistent on-page assistant (shadow DOM) ─────────────────────────── */

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let collapsed = false;

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .wrap {
    position: fixed; bottom: 16px; right: 16px; z-index: 2147483000;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    width: 330px; max-width: calc(100vw - 32px);
    background: #16181d; color: #e6e8ee;
    border: 1px solid #2c303a; border-radius: 14px;
    box-shadow: 0 10px 34px rgba(0,0,0,.5);
    overflow: hidden;
  }
  .titlebar {
    display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px;
    background: linear-gradient(90deg,#1d2027,#16181d); border-bottom: 1px solid #2c303a;
  }
  .crown { font-size: 15px; }
  .title { font-weight: 800; font-size: 12.5px; letter-spacing: .04em; flex: 1; }
  .title small { font-weight: 500; color: #8a91a0; letter-spacing: 0; }
  .mock { font-size: 9.5px; color: #ffb224; border: 1px solid #ffb224; border-radius: 4px; padding: 1px 5px; }
  button { background: none; border: none; color: #9aa1af; cursor: pointer; font: inherit; }
  button:hover { color: #fff; }
  .icon-btn { font-size: 15px; line-height: 1; padding: 2px 5px; border-radius: 6px; }
  .icon-btn:hover { background: #2a2f3e; }
  .body { padding: 12px; }
  /* home / scan box */
  .home-hint { color: #9aa1af; margin-bottom: 8px; }
  .scan-row { display: flex; gap: 6px; }
  .scan-row input {
    flex: 1; min-width: 0; background: #1c1f26; color: #e6e8ee;
    border: 1px solid #2c303a; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 12px;
  }
  .scan-row input::placeholder { color: #6b7280; }
  .scan-btn {
    background: #2f6df6; color: #fff; border-radius: 8px; padding: 8px 12px; font-weight: 700; font-size: 12px;
  }
  .scan-btn:hover { background: #4a82ff; color: #fff; }
  .home-note { color: #6b7280; font-size: 11px; margin-top: 8px; }
  /* result */
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .badge { font-weight: 700; font-size: 11px; letter-spacing: .04em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .score { font-weight: 800; font-size: 18px; }
  .sym { color: #cfd3dc; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .top-reason { color: #c8cdd8; margin-bottom: 8px; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .details-btn { color: #7aa2ff; font-size: 12px; }
  .back-btn { color: #7aa2ff; font-size: 12px; padding: 2px 0; }
  .panel { border-top: 1px solid #2c303a; margin-top: 10px; padding-top: 10px; max-height: 280px; overflow-y: auto; }
  .panel h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9aa1af; margin: 8px 0 4px; }
  .panel h4:first-child { margin-top: 0; }
  .panel li { list-style: none; padding: 2px 0; display: flex; gap: 6px; }
  .pts { font-weight: 700; min-width: 30px; text-align: right; }
  .pts.bad { color: #ff8589; } .pts.good { color: #6fd08c; }
  .gap { color: #8a91a0; font-style: italic; }
  .links { display: flex; gap: 12px; margin-top: 8px; }
  .links a { color: #7aa2ff; text-decoration: none; font-size: 12px; }
  .disclaimer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #2c303a; color: #8a91a0; font-size: 10.5px; }
  .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid #3a3f4c; border-top-color: #7aa2ff; border-radius: 50%; animation: r 0.8s linear infinite; vertical-align: middle; }
  @keyframes r { to { transform: rotate(360deg); } }
  .muted { color: #9aa1af; }
  /* collapsed floating button */
  .fab {
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg,#2f6df6,#1b3fae); color: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center;
    font-size: 22px; cursor: pointer; border: 1px solid #3a5bd0;
  }
  .fab:hover { filter: brightness(1.1); }
`;

function ensureHost(): ShadowRoot {
  if (host && shadow && document.body.contains(host)) return shadow;
  host = document.createElement('div');
  host.id = 'crypto-king-overlay';
  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  shadow.appendChild(wrap);
  document.body.appendChild(host);
  return shadow;
}

function wrapEl(): HTMLDivElement {
  const root = ensureHost();
  return root.querySelector('.wrap') as HTMLDivElement;
}

/** Render the collapsed crown button. */
function renderCollapsed(): void {
  const w = wrapEl();
  w.innerHTML = `<div class="fab" title="Open CRYPTO-KING risk scanner">👑</div>`;
  w.querySelector('.fab')?.addEventListener('click', () => {
    collapsed = false;
    // Re-show whatever we last had: a scanned token, or the home scan box.
    if (currentAddress) void analyze(currentAddress);
    else renderHome();
  });
}

/** Build the card shell with titlebar; returns the .body element to fill. */
function cardBody(): HTMLDivElement {
  const w = wrapEl();
  w.innerHTML = `
    <div class="card">
      <div class="titlebar">
        <span class="crown">👑</span>
        <span class="title">CRYPTO-KING <small>· risk scanner</small></span>
        <button class="icon-btn collapse" title="Collapse">–</button>
      </div>
      <div class="body"></div>
    </div>`;
  w.querySelector('.collapse')?.addEventListener('click', () => {
    collapsed = true;
    renderCollapsed();
  });
  return w.querySelector('.body') as HTMLDivElement;
}

/** Home view: the always-available "scan any token" box. */
function renderHome(): void {
  if (collapsed) return renderCollapsed();
  const body = cardBody();
  const onThisPage = addressFromUrl() ?? addressFromDom();
  body.innerHTML = `
    <div class="home-hint">Paste a Solana token address (or a gmgn/pump/solscan link) to scan its risk — live, right here.</div>
    <div class="scan-row">
      <input type="text" class="scan-input" placeholder="Token mint address or link" spellcheck="false" />
      <button class="scan-btn">Scan</button>
    </div>
    ${
      onThisPage
        ? `<div class="home-note">Detected on this page: <a href="#" class="detected">${esc(short(onThisPage))}</a></div>`
        : `<div class="home-note">Tip: open any coin on gmgn.ai and it scans automatically.</div>`
    }
    <div class="disclaimer">${esc(DISCLAIMER)}</div>`;

  const input = body.querySelector<HTMLInputElement>('.scan-input');
  const go = () => {
    const addr = extractAddress(input?.value ?? '');
    if (addr) void analyze(addr, /*manual*/ true);
    else if (input) {
      input.style.borderColor = '#e5484d';
      input.placeholder = 'Not a valid Solana address';
      input.value = '';
    }
  };
  body.querySelector('.scan-btn')?.addEventListener('click', go);
  input?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') go();
  });
  body.querySelector('.detected')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (onThisPage) void analyze(onThisPage, true);
  });
}

/** Pull a base58 mint out of raw input: a bare address, or a gmgn/pump/solscan URL. */
function extractAddress(raw: string): string | null {
  const s = raw.trim();
  if (BASE58_RE.test(s)) return s;
  const patterns = [/\/sol\/token\/(\S+)/, /\/coin\/(\S+)/, /solscan\.io\/token\/(\S+)/, new RegExp(`(${BASE58})`)];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && BASE58_RE.test(m[1])) return m[1];
  }
  return null;
}

function showLoading(address: string): void {
  if (collapsed) return;
  const body = cardBody();
  body.innerHTML = `<div><span class="spin"></span> <span class="muted">Scanning ${esc(short(address))}…</span></div>`;
}

function showError(message: string): void {
  if (collapsed) return;
  const body = cardBody();
  body.innerHTML = `
    <div class="head">
      <span class="badge" style="background:#3a3f4c;color:#e6e8ee">NO DATA</span>
      <span class="sym">${esc(message)}</span>
    </div>
    <button class="back-btn">← Scan another token</button>`;
  body.querySelector('.back-btn')?.addEventListener('click', backToHome);
}

function render(analysis: TokenAnalysis, risk: RiskResult, mock: boolean): void {
  if (collapsed) return;
  if (risk.insufficientData) {
    showError('Not enough data to assess this token.');
    return;
  }
  const body = cardBody();
  const meta = SIGNAL_META[risk.signal];
  const topReason = risk.reasons[0]?.text ?? 'No individual risk factors triggered — low observed risk ≠ safe.';
  const sym = analysis.identity.symbol ?? short(analysis.identity.address);

  body.innerHTML = `
    <div class="head">
      <span class="badge" style="background:${meta.color};color:${meta.textColor}">${meta.label}</span>
      <span class="score">${risk.riskScore}</span>
      <span class="sym" title="${esc(analysis.identity.address)}">${esc(sym)}</span>
      ${mock ? '<span class="mock">MOCK</span>' : ''}
    </div>
    <div class="top-reason">${esc(topReason)}</div>
    <div class="row">
      <button class="details-btn">Details ▾</button>
      <span class="muted" style="font-size:11px">${esc(meta.blurb)}</span>
    </div>
    <div class="panel" hidden></div>
    <button class="back-btn" style="margin-top:10px">← Scan another token</button>`;

  body.querySelector('.back-btn')?.addEventListener('click', backToHome);

  const panel = body.querySelector<HTMLDivElement>('.panel');
  const btn = body.querySelector<HTMLButtonElement>('.details-btn');
  btn?.addEventListener('click', () => {
    if (!panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    if (btn) btn.textContent = open ? 'Details ▾' : 'Details ▴';
    if (!open && panel.childElementCount === 0) fillPanel(panel, analysis, risk);
  });
}

function backToHome(): void {
  currentAddress = null;
  renderHome();
}

function fillPanel(panel: HTMLDivElement, analysis: TokenAnalysis, risk: RiskResult): void {
  const addr = analysis.identity.address;
  const reasons = risk.reasons
    .slice(0, 6)
    .map((r) => `<li><span class="pts bad">+${r.points}</span><span>${esc(r.text)}</span></li>`)
    .join('');
  const mitigations = risk.mitigations
    .map((m) => `<li><span class="pts good">${m.points}</span><span>${esc(m.text)}</span></li>`)
    .join('');
  const gaps = risk.dataGaps
    .slice(0, 5)
    .map((g) => `<li class="gap">${esc(g)}</li>`)
    .join('');

  panel.innerHTML = `
    ${reasons ? `<h4>Why this score</h4><ul>${reasons}</ul>` : '<h4>Why this score</h4><ul><li class="gap">No risk factors triggered.</li></ul>'}
    ${mitigations ? `<h4>Mitigating signals</h4><ul>${mitigations}</ul>` : ''}
    ${gaps ? `<h4>Not checked (data unavailable)</h4><ul>${gaps}</ul>` : ''}
    <div class="links">
      <a href="https://solscan.io/token/${addr}" target="_blank" rel="noreferrer">Solscan ↗</a>
      <a href="https://rugcheck.xyz/tokens/${addr}" target="_blank" rel="noreferrer">RugCheck ↗</a>
    </div>
    <div class="disclaimer">${esc(DISCLAIMER)}</div>`;
}

/* ── Utilities & SPA watch loop ────────────────────────────────────────── */

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function tick(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    currentAddress = null; // new route → re-detect fresh
    detect();
  } else if (currentAddress === null && !collapsed) {
    // SPA may still be rendering the token header — retry the DOM fallback.
    detect();
  }
}

// Show the assistant as soon as the page has a <body>, then keep watching the SPA.
function boot(): void {
  renderHome();
  detect();
  setInterval(tick, 1000);
}
if (document.body) boot();
else document.addEventListener('DOMContentLoaded', boot);
