// config.ts
var MOCK_MODE = false;
var GMGN = {
  baseUrl: "https://gmgn.ai",
  endpoints: {
    /** Core security object: renounced_mint, renounced_freeze_account, burn_ratio/burn_status,
     *  top_10_holder_rate, is_honeypot, is_blacklist, buy_tax/sell_tax/average_tax, lock_summary. */
    security: "/api/v1/mutil_window_token_security_launchpad/sol/{address}",
    /** decimals, holder_count, total_supply, circulating_supply, liquidity, creation_timestamp, biggest_pool_address. */
    tokenInfo: "/api/v1/token_info/sol/{address}",
    /** mc, symbol, name, socials (twitter/website/telegram), price_24_change. */
    tokenPreview: "/api/v1/live/token_preview/sol/{address}",
    /** launchpad, fee_authority, is_locked, royalty bps (Token-2022 fee data). */
    feeDistribution: "/api/v1/token_fee_distribution/sol/{address}",
    /** recommend_sell_slippage, has_tax — honeypot / high-slippage signal. */
    recommendSlippage: "/api/v1/recommend_slippage/sol/{address}",
    /** Holder concentration: top_10_holder_rate, top70_sniper_hold_rate, per-wallet maker_token_tags, smart-money counts. */
    topBuyers: "/defi/quotation/v1/tokens/top_buyers/sol/{address}"
  },
  /**
   * Common query string GMGN attaches to every call. Values below are neutral
   * defaults; replace with the ones from your own DevTools capture if GMGN
   * starts rejecting requests (they are tracking params, not auth).
   */
  commonParams: {
    device_id: "crypto-king-ext",
    client_id: "gmgn_web",
    from_app: "gmgn",
    app_ver: "1.0.0",
    tz_name: "Europe/Berlin",
    tz_offset: "3600",
    app_lang: "en",
    os: "web"
  },
  /** Extra headers if GMGN requires them (keep empty unless needed). */
  headers: {}
};
var RATE_LIMITS_MS = {
  default: 1100,
  "gmgn.ai": 400
};
var FETCH_TIMEOUT_MS = 1e4;
var CACHE_TTL_MS = 5 * 6e4;
var SIGNAL_META = {
  AVOID: { color: "#e5484d", textColor: "#ffffff", label: "AVOID", blurb: "Severe risk factors observed." },
  HIGH_RISK: { color: "#f76b15", textColor: "#ffffff", label: "HIGH RISK", blurb: "Multiple serious risk factors." },
  WATCH: { color: "#ffb224", textColor: "#1b1b18", label: "WATCH", blurb: "Notable risk factors present." },
  CONSIDER: { color: "#46a758", textColor: "#ffffff", label: "CONSIDER", blurb: "Fewer observed risks \u2014 NOT a buy signal." },
  NEUTRAL: { color: "#64748b", textColor: "#ffffff", label: "NEUTRAL", blurb: "Low observed risk \u2260 safe." }
};
var DISCLAIMER = "Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice.";

// mock/fixtures.ts
var now = () => Date.now();
var FIXTURE_AVOID = {
  identity: {
    address: "RugKing111111111111111111111111111111111111",
    symbol: "RUGKING",
    name: "Rug King (mock)",
    chain: "sol",
    ageMinutes: 95,
    logoUri: null
  },
  mint: {
    mintAuthorityActive: true,
    // +25
    freezeAuthorityActive: true,
    // +20
    metadataMutable: false,
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false
  },
  holders: {
    holderCount: 3100,
    top5Pct: 68,
    top10Pct: 72,
    // +15
    largestNonLpWalletPct: 18,
    bundledLaunchPct: 10
  },
  market: {
    priceEur: 31e-5,
    marketCapEur: 3e5,
    liquidityEur: 6e4,
    volume24hEur: 41e4,
    lpStatus: "deployer_held",
    // +20
    sellSimulation: { ok: true, slippagePct: 12 }
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false
  },
  deployer: { priorRugs: 0, fundingSource: "cex" },
  socials: { website: null, twitter: null, telegram: null, verified: null },
  // +10 no socials
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  sources: { gmgn: "mock", solana: "mock", pumpfun: "mock", rugcheck: "mock", deployer: "mock" },
  fetchedAt: now()
};
var FIXTURE_WATCH = {
  identity: {
    address: "WifCat22222222222222222222222222222222222222",
    symbol: "WIFCAT",
    name: "Wif Cat (mock)",
    chain: "sol",
    ageMinutes: 22,
    // +10 with abnormalEarlyVolume
    logoUri: null
  },
  mint: {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    metadataMutable: true,
    // +5
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false
  },
  holders: {
    holderCount: 5400,
    top5Pct: 58,
    top10Pct: 65,
    // +15
    largestNonLpWalletPct: 11,
    bundledLaunchPct: 9
  },
  market: {
    priceEur: 14e-4,
    marketCapEur: 72e4,
    // +10 with thin liquidity below
    liquidityEur: 38e3,
    volume24hEur: 95e4,
    lpStatus: "burned",
    sellSimulation: { ok: true, slippagePct: 6 }
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: true
  },
  deployer: { priorRugs: 0, fundingSource: "cex" },
  socials: { website: "https://wifcat.example", twitter: "https://x.com/wifcat", telegram: null, verified: false },
  // +5
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  sources: { gmgn: "mock", solana: "mock", pumpfun: "mock", rugcheck: "mock", deployer: "mock" },
  fetchedAt: now()
};
var FIXTURE_NEUTRAL = {
  identity: {
    address: "Quokka33333333333333333333333333333333333333",
    symbol: "QUOKKA",
    name: "Quokka (mock)",
    chain: "sol",
    ageMinutes: 4320,
    // 3 days
    logoUri: null
  },
  mint: {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    metadataMutable: false,
    isToken2022: false,
    transferFeeBps: null,
    feeAuthorityActive: false
  },
  holders: {
    holderCount: 18200,
    top5Pct: 15,
    top10Pct: 24,
    largestNonLpWalletPct: 4.5,
    bundledLaunchPct: 2
  },
  market: {
    priceEur: 0.021,
    marketCapEur: 19e5,
    liquidityEur: 26e4,
    volume24hEur: 78e4,
    lpStatus: "burned",
    sellSimulation: { ok: true, slippagePct: 2 }
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false
  },
  deployer: { priorRugs: 0, fundingSource: "cex" },
  socials: {
    website: "https://quokka.example",
    twitter: "https://x.com/quokka",
    telegram: "https://t.me/quokka",
    verified: true
    // -5
  },
  smartMoney: { accumulating: true, exiting: false, walletCount: 6 },
  // -10 (strong)
  sources: { gmgn: "mock", solana: "mock", pumpfun: "mock", rugcheck: "mock", deployer: "mock" },
  fetchedAt: now()
};

// lib/http.ts
function rateLimitFor(host2) {
  const bare = host2.replace(/^www\./, "");
  return RATE_LIMITS_MS[bare] ?? RATE_LIMITS_MS.default;
}
var hostQueues = /* @__PURE__ */ new Map();
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchJson(url, init) {
  const host2 = hostOf(url);
  const q = hostQueues.get(host2) ?? { lastAt: 0, chain: Promise.resolve() };
  const run = q.chain.then(async () => {
    const wait = q.lastAt + rateLimitFor(host2) - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        console.warn(`[CRYPTO-KING] ${host2} responded ${res.status} for ${url}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn(`[CRYPTO-KING] fetch failed for ${url}:`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
  hostQueues.set(host2, { lastAt: q.lastAt, chain: run.catch(() => void 0) });
  const result = await run;
  const entry = hostQueues.get(host2);
  if (entry) entry.lastAt = Math.max(entry.lastAt, Date.now() - 1);
  return result;
}

// lib/gmgnClient.ts
async function fetchGmgnRaw(address) {
  const [security, tokenInfo, preview, feeDist, slippage, topBuyers] = await Promise.all([
    call("security", address),
    call("tokenInfo", address),
    call("tokenPreview", address),
    call("feeDistribution", address),
    call("recommendSlippage", address),
    call("topBuyers", address)
  ]);
  return { security, tokenInfo, preview, feeDist, slippage, topBuyers };
}
async function call(name, address) {
  const path = GMGN.endpoints[name];
  if (!path) return null;
  const qs = new URLSearchParams(GMGN.commonParams).toString();
  const url = `${GMGN.baseUrl}${path.replace("{address}", address)}${qs ? `?${qs}` : ""}`;
  const json = await fetchJson(url, {
    headers: { accept: "application/json", ...GMGN.headers },
    credentials: "include"
  });
  if (json === null || typeof json !== "object") return null;
  const env = json;
  if (env.code !== void 0 && env.code !== 0 && env.code !== "0") return null;
  return env.data ?? json;
}

// content/content.ts
var BASE58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
var URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`),
  // gmgn.ai
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`)
  // pump.fun
];
var currentAddress = null;
var lastHref = "";
var dismissed = /* @__PURE__ */ new Set();
function addressFromUrl() {
  for (const re of URL_PATTERNS) {
    const m = location.pathname.match(re);
    if (m) return m[1];
  }
  return null;
}
function addressFromDom() {
  const link = document.querySelector('a[href*="solscan.io/token/"]');
  const m = link?.href.match(new RegExp(`solscan\\.io/token/(${BASE58})`));
  return m ? m[1] : null;
}
function detect() {
  const address = addressFromUrl() ?? addressFromDom();
  if (address === currentAddress) return;
  currentAddress = address;
  if (!address || dismissed.has(address)) {
    removeOverlay();
    return;
  }
  showLoading(address);
  void analyze(address);
}
async function analyze(address) {
  let rawGmgn;
  if (!MOCK_MODE && location.hostname.endsWith("gmgn.ai")) {
    try {
      rawGmgn = await fetchGmgnRaw(address);
    } catch {
      rawGmgn = void 0;
    }
    if (address !== currentAddress) return;
  }
  chrome.runtime.sendMessage(
    { type: "ANALYZE_TOKEN", address, rawGmgn },
    (res) => {
      if (chrome.runtime.lastError || !res) {
        showError("Risk data unavailable.");
        return;
      }
      if (address !== currentAddress) return;
      if (!res.ok) {
        showError(res.error);
        return;
      }
      render(res.analysis, res.risk, res.mock);
    }
  );
}
var host = null;
var shadow = null;
var STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .card {
    position: fixed; top: 76px; right: 16px; z-index: 2147483000;
    width: 320px; max-width: calc(100vw - 32px);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #16181d; color: #e6e8ee;
    border: 1px solid #2c303a; border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.45);
    overflow: hidden;
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
  .badge { font-weight: 700; font-size: 11px; letter-spacing: .04em; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .score { font-weight: 800; font-size: 18px; }
  .sym { color: #9aa1af; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  button { background: none; border: none; color: #9aa1af; cursor: pointer; font: inherit; }
  button:hover { color: #fff; }
  .close { font-size: 15px; line-height: 1; padding: 2px 4px; }
  .top-reason { padding: 0 12px 10px; color: #c8cdd8; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 0 12px 10px; }
  .details-btn { color: #7aa2ff; font-size: 12px; }
  .mock { font-size: 10px; color: #ffb224; border: 1px solid #ffb224; border-radius: 4px; padding: 1px 5px; }
  .panel { border-top: 1px solid #2c303a; padding: 10px 12px; max-height: 300px; overflow-y: auto; }
  .panel h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9aa1af; margin: 8px 0 4px; }
  .panel h4:first-child { margin-top: 0; }
  .panel li { list-style: none; padding: 2px 0; display: flex; gap: 6px; }
  .pts { font-weight: 700; min-width: 30px; text-align: right; }
  .pts.bad { color: #ff8589; } .pts.good { color: #6fd08c; }
  .gap { color: #8a91a0; font-style: italic; }
  .links { display: flex; gap: 12px; margin-top: 8px; }
  .links a { color: #7aa2ff; text-decoration: none; font-size: 12px; }
  .disclaimer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #2c303a; color: #8a91a0; font-size: 11px; }
  .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid #3a3f4c; border-top-color: #7aa2ff; border-radius: 50%; animation: r 0.8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .muted { color: #9aa1af; }
`;
function ensureHost() {
  if (host && shadow && document.body.contains(host)) return shadow;
  host = document.createElement("div");
  host.id = "crypto-king-overlay";
  shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);
  document.body.appendChild(host);
  return shadow;
}
function removeOverlay() {
  host?.remove();
  host = null;
  shadow = null;
}
function card() {
  const root = ensureHost();
  root.querySelector(".card")?.remove();
  const el = document.createElement("div");
  el.className = "card";
  root.appendChild(el);
  return el;
}
function showLoading(address) {
  const el = card();
  el.innerHTML = `
    <div class="head">
      <span class="spin"></span>
      <span class="muted">CRYPTO-KING scanning ${esc(short(address))}\u2026</span>
    </div>`;
}
function showError(message) {
  const el = card();
  el.innerHTML = `
    <div class="head">
      <span class="badge" style="background:#3a3f4c;color:#e6e8ee">NO DATA</span>
      <span class="sym">${esc(message)}</span>
      <button class="close" title="Dismiss">\u2715</button>
    </div>`;
  el.querySelector(".close")?.addEventListener("click", dismiss);
}
function render(analysis, risk, mock) {
  const el = card();
  if (risk.insufficientData) {
    showError("Not enough data to assess this token.");
    return;
  }
  const meta = SIGNAL_META[risk.signal];
  const topReason = risk.reasons[0]?.text ?? "No individual risk factors triggered \u2014 low observed risk \u2260 safe.";
  const sym = analysis.identity.symbol ?? short(analysis.identity.address);
  el.innerHTML = `
    <div class="head">
      <span class="badge" style="background:${meta.color};color:${meta.textColor}">${meta.label}</span>
      <span class="score">${risk.riskScore}</span>
      <span class="sym" title="${esc(analysis.identity.address)}">${esc(sym)}</span>
      ${mock ? '<span class="mock">MOCK</span>' : ""}
      <button class="close" title="Dismiss for this token">\u2715</button>
    </div>
    <div class="top-reason">${esc(topReason)}</div>
    <div class="row">
      <button class="details-btn">Details \u25BE</button>
      <span class="muted" style="font-size:11px">${meta.blurb}</span>
    </div>
    <div class="panel" hidden></div>`;
  el.querySelector(".close")?.addEventListener("click", dismiss);
  const panel = el.querySelector(".panel");
  const btn = el.querySelector(".details-btn");
  btn?.addEventListener("click", () => {
    if (!panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    if (btn) btn.textContent = open ? "Details \u25BE" : "Details \u25B4";
    if (!open && panel.childElementCount === 0) fillPanel(panel, analysis, risk);
  });
}
function fillPanel(panel, analysis, risk) {
  const addr = analysis.identity.address;
  const reasons = risk.reasons.slice(0, 6).map((r) => `<li><span class="pts bad">+${r.points}</span><span>${esc(r.text)}</span></li>`).join("");
  const mitigations = risk.mitigations.map((m) => `<li><span class="pts good">${m.points}</span><span>${esc(m.text)}</span></li>`).join("");
  const gaps = risk.dataGaps.slice(0, 5).map((g) => `<li class="gap">${esc(g)}</li>`).join("");
  panel.innerHTML = `
    ${reasons ? `<h4>Why this score</h4><ul>${reasons}</ul>` : '<h4>Why this score</h4><ul><li class="gap">No risk factors triggered.</li></ul>'}
    ${mitigations ? `<h4>Mitigating signals</h4><ul>${mitigations}</ul>` : ""}
    ${gaps ? `<h4>Not checked (data unavailable)</h4><ul>${gaps}</ul>` : ""}
    <div class="links">
      <a href="https://solscan.io/token/${addr}" target="_blank" rel="noreferrer">Solscan \u2197</a>
      <a href="https://rugcheck.xyz/tokens/${addr}" target="_blank" rel="noreferrer">RugCheck \u2197</a>
    </div>
    <div class="disclaimer">${esc(DISCLAIMER)}</div>`;
}
function dismiss() {
  if (currentAddress) dismissed.add(currentAddress);
  removeOverlay();
}
function short(addr) {
  return `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;
}
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function tick() {
  if (location.href !== lastHref) {
    lastHref = location.href;
    detect();
  } else if (currentAddress === null) {
    detect();
  }
}
setInterval(tick, 1e3);
detect();
