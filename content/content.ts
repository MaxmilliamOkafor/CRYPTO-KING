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

import { DISCLAIMER, INLINE_BADGES, LIVE_FEED, MOCK_MODE, SIGNAL_META } from '../config.ts';
import { gemBackgroundCheck } from '../lib/gemCriteria.ts';
import { computeKingGrade, gradeColors, gradeLabel } from '../lib/kingGrade.ts';
import { assessRugPotential, RUG_VERDICT_META } from '../lib/rugPotential.ts';
import { fetchGmgnRaw, type GmgnRaw } from '../lib/gmgnClient.ts';
import type {
  AnalyzeResponse,
  FeedRow,
  LiveFeedResponse,
  QualityResult,
  ResolvePairsResponse,
  RiskResult,
  Signal,
  TokenAnalysis,
  WatchlistResponse,
} from '../lib/types.ts';

const BASE58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`), // gmgn.ai
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`), // pump.fun
];

let currentAddress: string | null = null;
let lastHref = '';
let view: 'none' | 'home' | 'token' = 'none';

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

/** React to the current page. Auto-scan ONLY when the URL itself is a token
 *  page, and only ONCE per navigation — never from stray DOM links (that used
 *  to hijack the panel into scanning a random coin off the page), and never
 *  re-hijacking after the user clicks "← Scan another token". */
let lastAutoScanned: string | null = null;

function detect(): void {
  if (collapsed) return; // user minimized us; don't pop back open on navigation
  const urlAddr = addressFromUrl();

  if (urlAddr && urlAddr !== lastAutoScanned) {
    lastAutoScanned = urlAddr; // one auto-scan per navigation to this token
    view = 'token';
    void analyze(urlAddr);
    return;
  }

  // Everything else (list pages, or the user navigated back home on a token
  // page) → keep/show the home view; user scans coins by clicking, only.
  if (view === 'token') return; // a card is showing (auto or user-chosen); leave it alone
  if (view !== 'home') {
    view = 'home';
    currentAddress = null;
    renderHome();
  } else if (!scanning) {
    void scanPage(); // infinite-scroll may have loaded more coins; pick them up (no re-render)
  }
}

/**
 * Ask the background to analyze one token. On gmgn.ai (live mode) we first grab
 * GMGN's same-origin JSON with the page's cookies and forward it; failures
 * degrade to null so the background falls back to its own fetch and unfetchable
 * checks become honest "data unavailable" — never a faked score.
 * `lite` limits GMGN to a single call (used for bulk page scans).
 */
async function requestAnalysis(address: string, lite = false): Promise<AnalyzeResponse> {
  let rawGmgn: GmgnRaw | undefined;
  if (!MOCK_MODE && location.hostname.endsWith('gmgn.ai')) {
    try {
      rawGmgn = await fetchGmgnRaw(address, lite);
    } catch {
      rawGmgn = undefined;
    }
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ANALYZE_TOKEN', address, rawGmgn }, (res: AnalyzeResponse | undefined) => {
      if (chrome.runtime.lastError || !res) resolve({ ok: false, error: 'Risk data unavailable.' });
      else resolve(res);
    });
  });
}

/** Scan a single token and show its full card. */
async function analyze(address: string, _manual = false): Promise<void> {
  stopLiveFeed(); // we're leaving the home/live view
  view = 'token'; // set here (not just in detect) so feed-row clicks count too
  currentAddress = address;
  showLoading(address);
  const res = await requestAnalysis(address, false);
  if (address !== currentAddress) return; // superseded by another scan/navigation
  if (!res.ok) {
    showError(res.error);
    return;
  }
  render(res.analysis, res.risk, res.quality, res.mock);
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
    width: 430px; max-width: calc(100vw - 32px);
    max-height: calc(100vh - 24px);
    display: flex; flex-direction: column;
    background: #16181d; color: #e6e8ee;
    border: 1px solid #2c303a; border-radius: 14px;
    box-shadow: 0 10px 34px rgba(0,0,0,.5);
    overflow: hidden;
  }
  .body { flex: 1 1 auto; overflow-y: auto; }
  .titlebar { flex: 0 0 auto; }
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
  .rug-banner { display: flex; flex-direction: column; gap: 2px; padding: 7px 10px; border-radius: 8px; margin-bottom: 8px; font-size: 11.5px; }
  .rug-banner span { font-weight: 400; opacity: .92; }
  .watch-btn { color: #ffc83c; font-size: 12px; padding: 2px 6px; border: 1px solid #4d3f1e; border-radius: 6px; }
  .watch-btn:hover { border-color: #ffc83c; }
  .watch-btn:disabled { opacity: .7; cursor: default; }
  .panel { border-top: 1px solid #2c303a; margin-top: 10px; padding-top: 10px; max-height: 48vh; overflow-y: auto; }
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
    position: relative;
    width: 46px; height: 46px; border-radius: 50%;
    background: linear-gradient(135deg,#2f6df6,#1b3fae); color: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center;
    font-size: 22px; cursor: pointer; border: 1px solid #3a5bd0;
  }
  .fab:hover { filter: brightness(1.1); }
  @keyframes gemPulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,200,60,.65); }
    50% { box-shadow: 0 0 14px 5px rgba(255,200,60,.25); }
  }
  .fab.gem-alert { border-color: #ffc83c; animation: gemPulse 1.2s infinite; }
  .fab-badge {
    position: absolute; top: -4px; right: -4px;
    min-width: 18px; height: 18px; border-radius: 999px;
    background: #ffc83c; color: #1b1b18; font: 800 11px/18px system-ui, sans-serif;
    text-align: center; padding: 0 4px; border: 1px solid #b8860b;
  }
  .scan-item.gem {
    border: 1px solid #b8860b; border-radius: 8px;
    background: linear-gradient(90deg, #251f0e, #1a1d24);
    animation: gemPulse 1.8s infinite;
  }
  .scan-item.gem:hover { background: linear-gradient(90deg, #2c2510, #1e222b); }
  /* page scan list */
  .scan-section { margin-top: 12px; border-top: 1px solid #2c303a; padding-top: 10px; }
  .scan-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .scan-head .t { font-weight: 700; font-size: 11.5px; letter-spacing: .04em; flex: 1; color: #cfd3dc; }
  .scan-head .rescan { color: #7aa2ff; font-size: 11px; }
  .scan-status { color: #8a91a0; font-size: 11px; margin-bottom: 6px; }
  .scanlist { max-height: 42vh; overflow-y: auto; margin: 0 -4px; }
  .scan-item {
    display: flex; align-items: center; gap: 8px; padding: 6px 6px; border-radius: 8px; cursor: pointer;
  }
  .scan-item:hover { background: #1c1f26; }
  .mini-badge { font-weight: 800; font-size: 10px; letter-spacing: .03em; padding: 2px 6px; border-radius: 6px; min-width: 58px; text-align: center; }
  .si-main { flex: 1; min-width: 0; }
  .si-sym { font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .si-reason { color: #9aa1af; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .replica { background: #4a1d1d; color: #ff9b9b; border: 1px solid #7a2e2e; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 5px; letter-spacing: .02em; }
  .scan-empty { color: #8a91a0; font-size: 11.5px; font-style: italic; padding: 4px; }
  /* live feed */
  .live-section { margin-bottom: 4px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4d4d; box-shadow: 0 0 0 0 rgba(255,77,77,.6); animation: pulse 1.6s infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,77,77,.6); } 70% { box-shadow: 0 0 0 6px rgba(255,77,77,0); } 100% { box-shadow: 0 0 0 0 rgba(255,77,77,0); } }
  .live-status { color: #9aa1af; font-size: 11px; margin: 4px 0 6px; }
  .livelist { max-height: 62vh; overflow-y: auto; margin: 0 -4px; }
  .safe-toggle { display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: #8a91a0; cursor: pointer; }
  .safe-toggle input { accent-color: #2f6df6; }
  .age { color: #6b7280; font-size: 10px; font-weight: 500; }
  .live-controls { display: flex; align-items: center; gap: 10px; margin: 6px 0 2px; flex-wrap: wrap; }
  .sort-toggle { color: #7aa2ff; font-size: 10.5px; padding: 1px 6px; border: 1px solid #2c303a; border-radius: 6px; }
  .sort-toggle:hover { border-color: #7aa2ff; }
  .mcap { color: #b8c0cf; font-size: 10px; font-weight: 600; }
  .price { color: #6fd08c; font-size: 10px; font-weight: 700; }
  .new-flash { background: #2f6df6; color: #fff; font-size: 8.5px; font-weight: 800; padding: 1px 4px; border-radius: 4px; letter-spacing: .04em; animation: newpulse 1s ease-in-out infinite; }
  @keyframes newpulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  .qchip { background: #143024; color: #6fd08c; border: 1px solid #245c3f; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 5px; }
  .ntag { background: #221a33; color: #b79bff; border: 1px solid #45348a; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 5px; }
  .rug-tag { font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 5px; letter-spacing: .02em; }
  .rug-tag.high { background: #4a1414; color: #ff8589; border: 1px solid #8a2626; }
  .rug-tag.poss { background: #3d260f; color: #ffb076; border: 1px solid #7a4a1e; }
  .quality-line { color: #9fd8b1; font-size: 11.5px; margin: -2px 0 8px; }
  .quality-line .muted { color: #8a91a0; font-size: 10px; }
  .copy { color: #8a91a0; font-size: 13px; line-height: 1; padding: 3px 6px; border-radius: 6px; flex: none; }
  .copy:hover { color: #fff; background: #2a2f3e; }
  .copy.copied { color: #6fd08c; }
  .uv { background: #1f2a3f; color: #8fb3ff; border: 1px solid #2e4a7a; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 5px; letter-spacing: .02em; }
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

/** Render the collapsed crown button. Live polling KEEPS running while
 *  minimized so the crown can pulse gold when a 💎 candidate appears. */
function renderCollapsed(): void {
  const w = wrapEl();
  w.innerHTML = `
    <div class="fab" title="Open CRYPTO-KING risk scanner">👑
      <span class="fab-badge" hidden>0</span>
    </div>`;
  refreshGemAlerts();
  w.querySelector('.fab')?.addEventListener('click', () => {
    collapsed = false;
    // Re-show whatever we last had: a scanned token, or the home scan box.
    if (currentAddress) {
      view = 'token';
      void analyze(currentAddress);
    } else {
      view = 'home';
      renderHome();
    }
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

/** Home view: the live auto-scanning feed + manual scan box + page-link scan. */
function renderHome(): void {
  if (collapsed) return renderCollapsed();
  const body = cardBody();
  const onThisPage = addressFromUrl() ?? addressFromDom();
  body.innerHTML = `
    <div class="live-section">
      <div class="scan-head">
        <span class="live-dot"></span>
        <span class="t">Live Solana launches — auto-scanning</span>
      </div>
      <div class="live-controls">
        <label class="safe-toggle"><input type="checkbox" class="safe-only" /> hide high-risk</label>
        <label class="safe-toggle"><input type="checkbox" class="low-cap" /> low caps only</label>
        <label class="safe-toggle"><input type="checkbox" class="fresh-only" /> fresh &lt;1h</label>
        <label class="safe-toggle"><input type="checkbox" class="grad-only" /> graduated</label>
        <button class="sort-toggle" title="Toggle between newest-first and best quality−risk first">Sort: newest</button>
      </div>
      <div class="live-status">Starting live scan…</div>
      <div class="livelist"></div>
    </div>

    <div class="scan-section">
      <div class="scan-head"><span class="t">Scan a specific coin (Solana only)</span></div>
      <div class="scan-row">
        <input type="text" class="scan-input" placeholder="Token mint address or link" spellcheck="false" />
        <button class="scan-btn">Scan</button>
      </div>
      ${
        onThisPage
          ? `<div class="home-note">On this page: <a href="#" class="detected">${esc(short(onThisPage))}</a></div>`
          : ''
      }
    </div>

    <div class="scan-section">
      <div class="scan-head"><span class="t">👁 Watching (rug alerts)</span></div>
      <div class="watchlist-box"><div class="scan-empty">Nothing watched — open a coin and hit "👁 Watch".</div></div>
    </div>

    <div class="scan-section">
      <div class="scan-head">
        <span class="t">Coins linked on this page</span>
        <button class="rescan">↻ Rescan</button>
      </div>
      <div class="scan-status"></div>
      <div class="scanlist"></div>
    </div>
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
  body.querySelector('.rescan')?.addEventListener('click', () => {
    pageScan.clear();
    void scanPage();
  });
  const safeToggle = body.querySelector<HTMLInputElement>('.safe-only');
  if (safeToggle) {
    safeToggle.checked = liveSafeOnly;
    safeToggle.addEventListener('change', () => {
      liveSafeOnly = safeToggle.checked;
      updateLiveList();
    });
  }
  const lowCapToggle = body.querySelector<HTMLInputElement>('.low-cap');
  if (lowCapToggle) {
    lowCapToggle.checked = liveLowCapOnly;
    lowCapToggle.addEventListener('change', () => {
      liveLowCapOnly = lowCapToggle.checked;
      updateLiveList();
    });
  }
  const freshToggle = body.querySelector<HTMLInputElement>('.fresh-only');
  if (freshToggle) {
    freshToggle.checked = liveFreshOnly;
    freshToggle.addEventListener('change', () => {
      liveFreshOnly = freshToggle.checked;
      updateLiveList();
    });
  }
  const gradToggle = body.querySelector<HTMLInputElement>('.grad-only');
  if (gradToggle) {
    gradToggle.checked = liveGraduatedOnly;
    gradToggle.addEventListener('change', () => {
      liveGraduatedOnly = gradToggle.checked;
      updateLiveList();
    });
  }
  const sortToggle = body.querySelector<HTMLButtonElement>('.sort-toggle');
  if (sortToggle) {
    sortToggle.textContent = liveSortBest ? 'Sort: 🏆 best' : 'Sort: newest';
    sortToggle.addEventListener('click', () => {
      liveSortBest = !liveSortBest;
      sortToggle.textContent = liveSortBest ? 'Sort: 🏆 best' : 'Sort: newest';
      updateLiveList();
    });
  }

  updateLiveList();
  refreshWatchlistBox();
  startLiveFeed();

  updateScanList();
  void scanPage(); // auto-scan the coins visible on this page
}

/* ── Whole-page scanning + replica/copycat detection ───────────────────── */

interface ScanRow {
  address: string;
  symbol: string | null;
  name: string | null;
  score: number;
  signal: Signal;
  topReason: string | null;
  rugVerdict: 'HIGH' | 'POSSIBLE' | 'LOW' | 'UNVERIFIED';
  insufficient: boolean;
}

const MAX_SCAN = 40; // cap coins per sweep so we never hammer GMGN
const pageScan = new Map<string, ScanRow>();
const symbolHints = new Map<string, string>(); // mint → symbol read from the page link text
let scanning = false;

/** Every distinct token mint linked from the current page (gmgn/pump/solscan links),
 *  capturing a symbol hint from each link's text for replica detection + display. */
function collectMints(): string[] {
  const set = new Set<string>();
  const res = [
    new RegExp(`/sol/token/(${BASE58})`),
    new RegExp(`/coin/(${BASE58})`),
    new RegExp(`solscan\\.io/token/(${BASE58})`),
  ];
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    for (const re of res) {
      const m = href.match(re);
      if (m) {
        set.add(m[1]);
        const hint = symbolFromText(a.textContent ?? '');
        if (hint && !symbolHints.has(m[1])) symbolHints.set(m[1], hint);
        break;
      }
    }
  });
  return [...set].slice(0, MAX_SCAN);
}

/** Best-effort leading ticker from a link's text, e.g. "$W26 / SOL" → "W26". */
function symbolFromText(t: string): string | null {
  const m = t.trim().match(/\$?([A-Za-z][A-Za-z0-9]{0,14})/);
  return m ? m[1].toUpperCase() : null;
}

async function scanPage(): Promise<void> {
  if (scanning || collapsed) return;
  const queue = collectMints().filter((m) => !pageScan.has(m));
  if (queue.length === 0) {
    updateScanList();
    return;
  }
  scanning = true;
  setScanStatus(`Scanning ${queue.length} coin${queue.length > 1 ? 's' : ''}…`);

  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const mint = queue[i++];
      const res = await requestAnalysis(mint, /*lite*/ true);
      const hint = symbolHints.get(mint) ?? null;
      pageScan.set(
        mint,
        res.ok
          ? {
              address: mint,
              symbol: res.analysis.identity.symbol ?? hint,
              name: res.analysis.identity.name,
              score: res.risk.riskScore,
              signal: res.risk.signal,
              topReason: res.risk.reasons[0]?.text ?? null,
              rugVerdict: assessRugPotential(res.analysis, res.risk).verdict,
              insufficient: res.risk.insufficientData,
            }
          : { address: mint, symbol: hint, name: null, score: 0, signal: 'NEUTRAL', topReason: null, rugVerdict: 'UNVERIFIED', insufficient: true },
      );
      updateScanList();
    }
  };
  await Promise.all([worker(), worker()]); // concurrency 2; per-host rate limiter throttles further
  scanning = false;
  updateScanList();
}

/** Symbols that appear on more than one distinct mint → likely copycats/replicas. */
function replicaSymbols(): Set<string> {
  const counts = new Map<string, number>();
  for (const r of pageScan.values()) {
    if (!r.symbol) continue;
    const k = r.symbol.trim().toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}

function setScanStatus(text: string): void {
  const el = shadow?.querySelector('.scan-status');
  if (el) el.textContent = text;
}

function updateScanList(): void {
  const list = shadow?.querySelector<HTMLDivElement>('.scanlist');
  if (!list) return; // home view not mounted right now; data is retained in pageScan

  const replicas = replicaSymbols();
  const rows = [...pageScan.values()].sort((a, b) => {
    // Worst first: insufficient-data last, otherwise highest risk score first.
    if (a.insufficient !== b.insufficient) return a.insufficient ? 1 : -1;
    return b.score - a.score;
  });

  const replicaCount = rows.filter((r) => r.symbol && replicas.has(r.symbol.trim().toUpperCase())).length;
  const avoid = rows.filter((r) => !r.insufficient && (r.signal === 'AVOID' || r.signal === 'HIGH_RISK')).length;
  if (!scanning) {
    const parts: string[] = [];
    parts.push(rows.length ? `${rows.length} scanned` : '');
    if (avoid) parts.push(`⚠ ${avoid} high-risk`);
    if (replicaCount) parts.push(`👥 ${replicaCount} possible copycat${replicaCount > 1 ? 's' : ''}`);
    setScanStatus(parts.filter(Boolean).join(' · ') || 'No linked coins found on this page.');
  }

  if (rows.length === 0) {
    list.innerHTML = `<div class="scan-empty">No token links detected here yet. Use the scan box above, or open a coin.</div>`;
    return;
  }

  list.innerHTML = rows
    .map((r) => {
      const meta = SIGNAL_META[r.signal];
      const isReplica = r.symbol && replicas.has(r.symbol.trim().toUpperCase());
      const label = r.insufficient ? 'NO DATA' : `${r.score} ${meta.label}`;
      const bg = r.insufficient ? '#3a3f4c' : meta.color;
      const fg = r.insufficient ? '#e6e8ee' : meta.textColor;
      const sym = r.symbol ?? short(r.address);
      const reason = r.insufficient
        ? 'Not enough data to assess'
        : isReplica
          ? 'Shares a symbol with another coin here — possible copycat/rug'
          : (r.topReason ?? 'Lower observed risk — not a buy signal');
      const rugTag =
        r.rugVerdict === 'HIGH'
          ? '<span class="rug-tag high">🚩 RUG RISK</span>'
          : r.rugVerdict === 'POSSIBLE'
            ? '<span class="rug-tag poss">🚩 possible</span>'
            : '';
      return `
        <div class="scan-item" data-addr="${esc(r.address)}">
          <span class="mini-badge" style="background:${bg};color:${fg}">${esc(label)}</span>
          <span class="si-main">
            <span class="si-sym">${esc(sym)}${rugTag}${isReplica ? '<span class="replica">COPYCAT?</span>' : ''}</span>
            <span class="si-reason">${esc(reason)}</span>
          </span>
          <button class="copy" data-copy="${esc(r.address)}" title="Copy token address">⧉</button>
        </div>`;
    })
    .join('');

  wireRowHandlers(list);
}

/* ── Live feed: real-time auto-scan of the newest launches ─────────────── */

let liveRows: FeedRow[] = [];
let liveTimer: ReturnType<typeof setInterval> | null = null;
let livePolling = false;
let liveSafeOnly = false;
let liveLowCapOnly = false;
let liveFreshOnly = false;
let liveGraduatedOnly = false;
let liveSortBest = true; // default: best King Grade at the top

function startLiveFeed(): void {
  if (liveTimer) return; // already running
  void pollLiveFeed();
  liveTimer = setInterval(() => void pollLiveFeed(), LIVE_FEED.pollIntervalMs);
}

function stopLiveFeed(): void {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}

async function pollLiveFeed(): Promise<void> {
  // Keeps polling while COLLAPSED too — the crown pulses gold on 💎 candidates.
  if (livePolling || view !== 'home') return;
  livePolling = true;
  try {
    const res = await new Promise<LiveFeedResponse | undefined>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_LIVE_FEED' }, (r: LiveFeedResponse | undefined) => resolve(r));
    });
    if (view !== 'home') return;
    if (!res || !res.ok) {
      if (!collapsed) setLiveStatus(res?.ok === false ? res.error : 'Live feed unavailable.');
      return;
    }
    liveRows = res.feed;
    if (!collapsed) {
      updateLiveList();
      const worst = liveRows.filter((r) => !r.insufficientData && (r.signal === 'AVOID' || r.signal === 'HIGH_RISK')).length;
      const gems = liveRows.filter(isGem).length;
      setLiveStatus(
        `🔴 live · ${liveRows.length} fresh coins · ⚠ ${worst} high-risk · 💎 ${gems} candidates` +
          (res.source === 'mock' ? ' · MOCK' : ''),
      );
    }
    refreshGemAlerts();
  } finally {
    livePolling = false;
  }
}

/* ── 💎 gem alerts: eye-catching pulse for research candidates ──────────
 * "Gem" = low observed risk AND real quality signals — worth the user's OWN
 * research, never a buy signal. Rows pulse gold in the feed; when the panel is
 * collapsed the crown pulses with an unseen-count bubble so nothing is missed.
 */

const gemSeen = new Set<string>();

/** Gem status comes from the background's FULL background check — never
 *  recomputed here from partial data (that's how a rug got highlighted once). */
function isGem(r: FeedRow): boolean {
  return r.gem;
}

function refreshGemAlerts(): void {
  const gems = liveRows.filter(isGem);
  if (!collapsed && view === 'home') {
    // Panel visible → the pulsing rows themselves are the alert; mark as seen.
    for (const g of gems) gemSeen.add(g.address);
  }
  const fab = shadow?.querySelector<HTMLElement>('.fab');
  const badge = shadow?.querySelector<HTMLElement>('.fab-badge');
  if (!fab || !badge) return;
  const unseen = gems.filter((g) => !gemSeen.has(g.address)).length;
  fab.classList.toggle('gem-alert', unseen > 0);
  badge.hidden = unseen === 0;
  badge.textContent = String(unseen);
  fab.title = unseen > 0 ? `CRYPTO-KING: ${unseen} 💎 candidate${unseen > 1 ? 's' : ''} — click to review` : 'Open CRYPTO-KING risk scanner';
}

function setLiveStatus(text: string): void {
  const el = shadow?.querySelector('.live-status');
  if (el) el.textContent = text;
}

function updateLiveList(): void {
  const list = shadow?.querySelector<HTMLDivElement>('.livelist');
  if (!list) return;

  let rows = [...liveRows];
  if (liveSafeOnly) {
    rows = rows.filter(
      (r) => !r.insufficientData && r.signal !== 'AVOID' && r.signal !== 'HIGH_RISK' && r.rugVerdict !== 'HIGH',
    );
  }
  // "Low caps only" keeps 💎 gem-grade coins visible even above the cap —
  // a strong candidate shouldn't vanish just because it already grew.
  if (liveLowCapOnly) {
    rows = rows.filter((r) => (r.marketCapEur !== null && r.marketCapEur <= LIVE_FEED.lowCapMaxEur) || isGem(r));
  }
  if (liveFreshOnly) rows = rows.filter((r) => r.ageMinutes !== null && r.ageMinutes < 60);
  if (liveGraduatedOnly) rows = rows.filter((r) => r.graduated === true);
  if (liveSortBest) {
    // 🏆 highest King Grade first. A ranking aid for research — NOT a profit prediction.
    rows.sort((a, b) => (b.grade ?? -1) - (a.grade ?? -1));
  }

  if (rows.length === 0) {
    list.innerHTML = `<div class="scan-empty">${
      liveSafeOnly || liveLowCapOnly ? 'No fresh launches match the filters right now.' : 'Waiting for the first live results…'
    }</div>`;
    return;
  }

  list.innerHTML = rows
    .map((r) => {
      const gc = gradeColors(r.grade);
      const label = r.grade === null ? 'NO DATA' : `${r.grade}% ${gradeLabel(r.grade)}`;
      const bg = gc.color;
      const fg = gc.textColor;
      const sym = r.symbol ?? short(r.address);
      const reason = r.insufficientData
        ? 'Not enough data yet'
        : (r.topReason ??
          (r.unverified
            ? 'Early checks clean — holders/LP not verified yet (click for full scan)'
            : 'No risk factors triggered — still not a buy signal'));
      const gem = isGem(r);
      const rugTag =
        r.rugVerdict === 'HIGH'
          ? '<span class="rug-tag high">🚩 RUG RISK</span>'
          : r.rugVerdict === 'POSSIBLE'
            ? '<span class="rug-tag poss">🚩 possible</span>'
            : '';
      return `
        <div class="scan-item${gem ? ' gem' : ''}" data-addr="${esc(r.address)}">
          <span class="mini-badge" style="background:${bg};color:${fg}">${esc(label)}</span>
          <span class="si-main">
            <span class="si-sym">${r.ageMinutes !== null && r.ageMinutes < 2 ? '<span class="new-flash">NEW</span> ' : ''}${gem ? '💎 ' : ''}${esc(sym)}${rugTag}
              <span class="age">${esc(ageShort(r.ageMinutes))}</span>
              ${r.priceUsd !== null ? `<span class="price">${esc(fmtPrice(r.priceUsd))}</span>` : ''}
              ${r.marketCapEur !== null ? `<span class="mcap">${esc(eurShort(r.marketCapEur))}</span>` : ''}
              ${r.qualityScore !== null && r.qualityScore > 0 ? `<span class="qchip" title="Quality signals — not a profit prediction">Q${r.qualityScore}</span>` : ''}
              ${r.narratives.length > 0 ? `<span class="ntag" title="Narrative tag — informational only, scammers ride trends too">${esc(r.narratives.slice(0, 2).join('·'))}</span>` : ''}
              ${r.unverified && !r.insufficientData ? '<span class="uv">PARTIAL</span>' : ''}</span>
            <span class="si-reason">${esc(reason)}</span>
          </span>
          <button class="copy" data-copy="${esc(r.address)}" title="Copy token address">⧉</button>
        </div>`;
    })
    .join('');

  wireRowHandlers(list);
}

/** Watched coins list on the home panel: current grade, liq drift, unwatch. */
function refreshWatchlistBox(): void {
  const box = shadow?.querySelector<HTMLDivElement>('.watchlist-box');
  if (!box) return;
  chrome.runtime.sendMessage({ type: 'GET_WATCHLIST' }, (res: WatchlistResponse | undefined) => {
    if (chrome.runtime.lastError || !res?.ok || !box.isConnected) return;
    if (res.watchlist.length === 0) {
      box.innerHTML = `<div class="scan-empty">Nothing watched — open a coin and hit "👁 Watch".</div>`;
      return;
    }
    box.innerHTML = res.watchlist
      .map((w) => {
        const gc = gradeColors(w.last.grade);
        const liqDrift =
          w.baseline.liquidityEur && w.last.liquidityEur
            ? Math.round((w.last.liquidityEur / w.baseline.liquidityEur - 1) * 100)
            : null;
        const drift = liqDrift === null ? '' : ` · liq ${liqDrift >= 0 ? '+' : ''}${liqDrift}%`;
        return `
          <div class="scan-item" data-addr="${esc(w.address)}">
            <span class="mini-badge" style="background:${gc.color};color:${gc.textColor}">${w.last.grade === null ? '—' : `${w.last.grade}%`}</span>
            <span class="si-main">
              <span class="si-sym">${esc(w.symbol ?? short(w.address))}</span>
              <span class="si-reason">${w.alerted.length > 0 ? `🚨 ${w.alerted.length} alert${w.alerted.length > 1 ? 's' : ''} fired` : 'no rug conditions detected'}${esc(drift)}</span>
            </span>
            <button class="copy unwatch" data-unwatch="${esc(w.address)}" title="Stop watching">✕</button>
          </div>`;
      })
      .join('');
    box.querySelectorAll<HTMLElement>('.scan-item').forEach((el) => {
      el.addEventListener('click', () => {
        const addr = el.getAttribute('data-addr');
        if (addr) void analyze(addr, true);
      });
    });
    box.querySelectorAll<HTMLButtonElement>('.unwatch').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'UNWATCH_TOKEN', address: btn.getAttribute('data-unwatch') ?? '' }, () =>
          refreshWatchlistBox(),
        );
      });
    });
  });
}

/** Meme-style price: $0.0₄1337 — compresses long leading-zero runs. */
function fmtPrice(v: number): string {
  if (v <= 0) return '';
  if (v >= 1) return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  const s = v.toFixed(20);
  const m = s.match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${v.toPrecision(3)}`;
  const zeros = m[1].length;
  return zeros >= 4 ? `$0.0(${zeros})${m[2]}` : `$0.${m[1]}${m[2]}`;
}

function eurShort(v: number): string {
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toFixed(0)}`;
}

/** Row click = full scan; ⧉ = one-click copy of the mint address. */
function wireRowHandlers(list: HTMLElement): void {
  list.querySelectorAll<HTMLElement>('.scan-item').forEach((el) => {
    el.addEventListener('click', () => {
      const addr = el.getAttribute('data-addr');
      if (addr) void analyze(addr, true);
    });
  });
  list.querySelectorAll<HTMLButtonElement>('.copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(btn.getAttribute('data-copy') ?? '', btn);
    });
  });
}

function copyToClipboard(text: string, btn: HTMLButtonElement): void {
  if (!text) return;
  void navigator.clipboard
    .writeText(text)
    .then(() => {
      const prev = btn.textContent;
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove('copied');
      }, 1200);
    })
    .catch(() => {
      btn.textContent = '✕';
    });
}

function ageShort(m: number | null): string {
  if (m === null) return '';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(0)}d`;
}

/* ── Inline badges: risk chips injected into the site's own rows ────────
 * The primary browsing experience: every Solana token link on the page gets a
 * small colored `👑 score SIGNAL` chip appended inside it, scanned automatically
 * as rows appear (the 1.5s tick sweeps new DOM — covers infinite scroll and
 * live-updating lists). Clicking a chip opens the full breakdown in the panel.
 * On dextools.io, links carry PAIR addresses; those are batch-resolved to base
 * token mints via DexScreener in the background first.
 */

interface InlineResult {
  score: number;
  signal: Signal;
  topReason: string | null;
  quality: number | null;
  grade: number | null;
  rugVerdict: 'HIGH' | 'POSSIBLE' | 'LOW' | 'UNVERIFIED';
  insufficient: boolean;
  unverified: boolean;
}

const inlineResults = new Map<string, InlineResult | 'pending'>();
const badgeEls = new Map<string, Set<HTMLElement>>(); // mint → live badge elements
const badgedLinks = new WeakSet<HTMLAnchorElement>();
const pairCache = new Map<string, string | null>(); // pairAddr → mint (null = resolving/unknown)
let inlineQueue: string[] = [];
let inlineWorkers = 0;

const MINT_HREF_RES = [
  new RegExp(`/sol/token/(${BASE58})`),
  new RegExp(`/coin/(${BASE58})`),
  new RegExp(`solscan\\.io/token/(${BASE58})`),
];
const PAIR_HREF_RE = new RegExp(`/pair-explorer/(${BASE58})`);

function sweepInlineBadges(): void {
  if (!INLINE_BADGES.enabled || inlineResults.size >= INLINE_BADGES.maxPerPage) return;

  const pendingPairs: Array<{ a: HTMLAnchorElement; pair: string }> = [];

  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    if (badgedLinks.has(a)) return;
    const href = a.getAttribute('href') ?? '';

    for (const re of MINT_HREF_RES) {
      const m = href.match(re);
      if (m) {
        badgedLinks.add(a);
        attachBadge(a, m[1]);
        queueInlineScan(m[1]);
        return;
      }
    }

    // DEXTools: pair address links, Solana pages only.
    if (location.hostname.endsWith('dextools.io') && location.pathname.includes('/solana/')) {
      const pm = href.match(PAIR_HREF_RE);
      if (pm) {
        badgedLinks.add(a);
        const known = pairCache.get(pm[1]);
        if (known) {
          attachBadge(a, known);
          queueInlineScan(known);
        } else if (known === undefined) {
          pairCache.set(pm[1], null); // mark resolving
          pendingPairs.push({ a, pair: pm[1] });
        }
      }
    }
  });

  if (pendingPairs.length > 0) resolvePairs(pendingPairs);
}

function resolvePairs(pending: Array<{ a: HTMLAnchorElement; pair: string }>): void {
  chrome.runtime.sendMessage(
    { type: 'RESOLVE_PAIRS', pairAddresses: pending.map((p) => p.pair) },
    (res: ResolvePairsResponse | undefined) => {
      if (chrome.runtime.lastError || !res?.ok) return;
      for (const { a, pair } of pending) {
        const tok = res.tokens[pair];
        if (!tok || !a.isConnected) continue;
        pairCache.set(pair, tok.address);
        attachBadge(a, tok.address);
        queueInlineScan(tok.address);
      }
    },
  );
}

/** Append the chip INSIDE the link (keeps table layouts intact). */
function attachBadge(anchor: HTMLAnchorElement, mint: string): void {
  const chip = document.createElement('span');
  chip.setAttribute('data-ck-badge', mint);
  chip.style.cssText =
    'all:initial;display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;' +
    'border-radius:999px;font:700 10px/1.7 system-ui,sans-serif;letter-spacing:.02em;' +
    'cursor:pointer;vertical-align:middle;white-space:nowrap;background:#3a3f4c;color:#e6e8ee;';
  chip.textContent = '👑 …';
  chip.title = 'CRYPTO-KING: scanning…';
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    collapsed = false;
    void analyze(mint, true); // full scan in the panel
  });
  anchor.appendChild(chip);

  let set = badgeEls.get(mint);
  if (!set) {
    set = new Set();
    badgeEls.set(mint, set);
  }
  set.add(chip);
  paintBadges(mint); // paint immediately if a result already exists
}

function queueInlineScan(mint: string): void {
  if (inlineResults.has(mint)) return;
  inlineResults.set(mint, 'pending');
  inlineQueue.push(mint);
  pumpInlineQueue();
}

function pumpInlineQueue(): void {
  while (inlineWorkers < INLINE_BADGES.scanConcurrency && inlineQueue.length > 0) {
    const mint = inlineQueue.shift();
    if (!mint) break;
    inlineWorkers++;
    void requestAnalysis(mint, /*lite*/ true)
      .then((res) => {
        inlineResults.set(
          mint,
          res.ok
            ? {
                score: res.risk.riskScore,
                signal: res.risk.signal,
                topReason: res.risk.reasons[0]?.text ?? null,
                quality: res.quality.insufficientData ? null : res.quality.qualityScore,
                grade: computeKingGrade(res.analysis, res.risk, res.quality).grade,
                rugVerdict: assessRugPotential(res.analysis, res.risk).verdict,
                insufficient: res.risk.insufficientData,
                unverified: res.analysis.holders === null || res.analysis.market?.lpStatus === 'unknown',
              }
            : { score: 0, signal: 'NEUTRAL', topReason: null, quality: null, grade: null, rugVerdict: 'UNVERIFIED', insufficient: true, unverified: true },
        );
        paintBadges(mint);
      })
      .finally(() => {
        inlineWorkers--;
        pumpInlineQueue();
      });
  }
}

function paintBadges(mint: string): void {
  const result = inlineResults.get(mint);
  const els = badgeEls.get(mint);
  if (!result || result === 'pending' || !els) return;
  const gc = gradeColors(result.grade);
  const rugFlag = result.rugVerdict === 'HIGH' ? '🚩' : '';
  const label = result.insufficient ? '👑 ?' : `${rugFlag}👑 ${result.grade}%${result.unverified ? '*' : ''}`;
  const bg = result.insufficient ? '#3a3f4c' : gc.color;
  const fg = result.insufficient ? '#e6e8ee' : gc.textColor;
  // All numbers same direction as the grade: higher = better.
  const tip = result.insufficient
    ? 'CRYPTO-KING: not enough data — click for details'
    : `CRYPTO-KING: ${result.rugVerdict === 'HIGH' ? '🚩 RUG POTENTIAL HIGH · ' : result.rugVerdict === 'POSSIBLE' ? '🚩 rug possible · ' : ''}King Grade ${result.grade}% (${gradeLabel(result.grade)}) · safety ${100 - result.score}/100` +
      `${result.quality !== null ? ` · quality ${result.quality}/100` : ''}` +
      `${result.unverified ? ' — holders/LP not verified yet, grade capped' : ''}` +
      `${result.topReason ? ` — top risk: ${result.topReason}` : ''} · click for full breakdown`;
  for (const el of els) {
    if (!el.isConnected) {
      els.delete(el);
      continue;
    }
    el.textContent = label;
    el.style.background = bg;
    el.style.color = fg;
    el.title = tip;
  }
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

function render(analysis: TokenAnalysis, risk: RiskResult, quality: QualityResult, mock: boolean): void {
  if (collapsed) return;
  if (risk.insufficientData) {
    showError('Not enough data to assess this token.');
    return;
  }
  const body = cardBody();
  const meta = SIGNAL_META[risk.signal];
  const kg = computeKingGrade(analysis, risk, quality);
  const gc = gradeColors(kg.grade);
  const topReason = risk.reasons[0]?.text ?? 'No individual risk factors triggered — low observed risk ≠ safe.';
  const sym = analysis.identity.symbol ?? short(analysis.identity.address);
  // The PRE-BUY question, answered first: can this coin rug me?
  const rug = assessRugPotential(analysis, risk);
  const rm = RUG_VERDICT_META[rug.verdict];
  const rugDetail =
    rug.verdict === 'LOW'
      ? ''
      : esc(rug.vectors[0] ?? (rug.unverified.length ? `Unverified: ${rug.unverified.join(', ')}.` : ''));
  const rugBanner = `
    <div class="rug-banner" style="background:${rm.color};color:${rm.textColor}">
      <b>${esc(rm.label)}</b>${rugDetail ? `<span>${rugDetail}</span>` : ''}
      ${rug.vectors.length > 1 ? `<span>+${rug.vectors.length - 1} more vector${rug.vectors.length > 2 ? 's' : ''} — see Details</span>` : ''}
    </div>`;
  // Everything here reads the SAME direction as the grade: higher = better.
  const subLine = quality.insufficientData
    ? ''
    : `<div class="quality-line">Safety <b>${Math.round(kg.parts.safety)}/100</b> · Quality <b>${quality.qualityScore}/100</b> · Audit coverage <b>${Math.round(kg.parts.coveragePct)}%</b></div>`;

  body.innerHTML = `
    <div class="head">
      <span class="badge" style="background:${gc.color};color:${gc.textColor}">${esc(kg.label)}</span>
      <span class="score">${kg.grade === null ? '—' : `${kg.grade}%`}</span>
      <span class="sym" title="${esc(analysis.identity.address)}">${esc(sym)}</span>
      ${mock ? '<span class="mock">MOCK</span>' : ''}
      <button class="copy" data-copy="${esc(analysis.identity.address)}" title="Copy token address">⧉</button>
    </div>
    ${rugBanner}
    <div class="top-reason">${esc(topReason)}</div>
    ${subLine}
    <div class="row">
      <button class="details-btn">Details ▾</button>
      <span class="muted" style="font-size:11px">${esc(meta.blurb)}</span>
    </div>
    <div class="panel" hidden></div>
    <div class="row" style="margin-top:10px">
      <button class="back-btn">← Scan another token</button>
      <button class="watch-btn" title="For coins you ALREADY hold: re-scans every few minutes and alerts you if rug conditions develop (LP change, liquidity drop, dev selling, grade collapse)">👁 Holding it? Watch</button>
    </div>`;

  body.querySelector('.back-btn')?.addEventListener('click', backToHome);
  const copyBtn = body.querySelector<HTMLButtonElement>('.copy');
  copyBtn?.addEventListener('click', () => copyToClipboard(analysis.identity.address, copyBtn));
  const watchBtn = body.querySelector<HTMLButtonElement>('.watch-btn');
  watchBtn?.addEventListener('click', () => {
    watchBtn.disabled = true;
    watchBtn.textContent = '👁 setting up…';
    chrome.runtime.sendMessage(
      { type: 'WATCH_TOKEN', address: analysis.identity.address, symbol: analysis.identity.symbol },
      (res: WatchlistResponse | undefined) => {
        if (chrome.runtime.lastError || !res?.ok) {
          watchBtn.textContent = `✕ ${res && !res.ok ? res.error : 'failed'}`;
          watchBtn.disabled = false;
          return;
        }
        watchBtn.textContent = '✓ watching — you will be alerted';
      },
    );
  });

  const panel = body.querySelector<HTMLDivElement>('.panel');
  const btn = body.querySelector<HTMLButtonElement>('.details-btn');
  btn?.addEventListener('click', () => {
    if (!panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    if (btn) btn.textContent = open ? 'Details ▾' : 'Details ▴';
    if (!open && panel.childElementCount === 0) fillPanel(panel, analysis, risk, quality);
  });
}

function backToHome(): void {
  currentAddress = null;
  view = 'home';
  renderHome();
}

function fillPanel(panel: HTMLDivElement, analysis: TokenAnalysis, risk: RiskResult, quality: QualityResult): void {
  const addr = analysis.identity.address;
  const reasons = risk.reasons
    .slice(0, 6)
    .map((r) => `<li><span class="pts bad">+${r.points}</span><span>${esc(r.text)}</span></li>`)
    .join('');
  const mitigations = risk.mitigations
    .map((m) => `<li><span class="pts good">${m.points}</span><span>${esc(m.text)}</span></li>`)
    .join('');
  const qualityItems = quality.reasons
    .slice(0, 6)
    .map((q) => `<li><span class="pts good">+${q.points}</span><span>${esc(q.text)}</span></li>`)
    .join('');
  const rug = assessRugPotential(analysis, risk);
  const rugItems =
    rug.vectors.map((v) => `<li><span class="pts bad">🚩</span><span>${esc(v)}</span></li>`).join('') +
    rug.unverified.map((u) => `<li class="gap">Not verified: ${esc(u)}</li>`).join('');
  const rugSection = rugItems
    ? `<h4>Rug-pull vectors</h4><ul>${rugItems}</ul>`
    : `<h4>Rug-pull vectors</h4><ul><li><span class="pts good">✓</span><span>None found on verified data — market risk still applies.</span></li></ul>`;
  const verdict = gemBackgroundCheck(analysis, risk, quality);
  const kg = computeKingGrade(analysis, risk, quality);
  const capItems = kg.caps.map((c) => `<li><span class="pts bad">▼</span><span>${esc(c)}</span></li>`).join('');
  const gemSection =
    (verdict.gem
      ? `<h4>💎 Background check</h4><ul><li><span class="pts good">✓</span><span>PASSED — graduated, LP secured, no whale wallet, creator screened. Still speculative; research it yourself.</span></li></ul>`
      : `<h4>💎 Background check — not passed</h4><ul>${verdict.blockers
          .map((b) => `<li><span class="pts bad">✗</span><span>${esc(b)}</span></li>`)
          .join('')}</ul>`) +
    (capItems ? `<h4>Why the grade is capped</h4><ul>${capItems}</ul>` : '');
  const gaps = risk.dataGaps
    .slice(0, 5)
    .map((g) => `<li class="gap">${esc(g)}</li>`)
    .join('');

  panel.innerHTML = `
    ${rugSection}
    ${reasons ? `<h4>Why this score</h4><ul>${reasons}</ul>` : '<h4>Why this score</h4><ul><li class="gap">No risk factors triggered.</li></ul>'}
    ${gemSection}
    ${mitigations ? `<h4>Mitigating signals</h4><ul>${mitigations}</ul>` : ''}
    ${qualityItems ? `<h4>Quality signals (not a profit prediction)</h4><ul>${qualityItems}</ul>` : ''}
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
    currentAddress = null;
    view = 'none'; // new route → re-detect fresh (token page vs list page)
    lastAutoScanned = null; // a NEW token page may auto-scan once again
    pageScan.clear(); // coins differ per page
    symbolHints.clear();
    inlineResults.clear(); // badges died with the old DOM; results re-serve from bg cache
    badgeEls.clear();
    inlineQueue = [];
    if (!collapsed) detect();
  } else if (!collapsed) {
    // Same route: retry detection so we catch a late-rendering token header or
    // newly loaded coins on an infinite-scroll list. detect() is idempotent.
    detect();
  }
  // Inline badges sweep runs even while the panel is collapsed — that's the
  // "see it in place while browsing" experience.
  sweepInlineBadges();
}

// Show the assistant as soon as the page has a <body>, then keep watching the SPA.
function boot(): void {
  detect();
  setInterval(tick, 1500);
}
if (document.body) boot();
else document.addEventListener('DOMContentLoaded', boot);
