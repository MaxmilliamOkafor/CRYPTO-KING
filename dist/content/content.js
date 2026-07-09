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
var LIVE_FEED = {
  enabled: true,
  /** How many newest coins to pull from the source each poll. */
  fetchCount: 50,
  /**
   * Max NEW coins to risk-scan per poll. Feed scans are LITE — one RPC call
   * (mint/freeze authority, the top rug check) + pump.fun — so the default fits
   * the public RPC; opening a coin upgrades it to the full scan. With a Helius
   * key (see SOLANA.rpcUrl) you can raise this substantially.
   */
  scanBudgetPerPoll: 6,
  /** Panel auto-refresh / poll interval in ms. */
  pollIntervalMs: 15e3,
  /** Drop coins older than this many minutes from the feed (keep it "fresh launches"). */
  maxAgeMinutes: 180,
  /** Feed cache size. */
  maxRows: 60,
  /**
   * Desktop notification when a fresh launch scans at or below notifyMaxScore
   * (with the on-chain authority checks actually completed). Framed as "lower
   * observed risk ≠ safe" — informational, never a buy signal.
   */
  notifyLowRisk: true,
  notifyMaxScore: 39
  // CONSIDER / NEUTRAL territory
};
var INLINE_BADGES = {
  enabled: true,
  /** Max distinct mints badged per page (protects the RPC budget). */
  maxPerPage: 80,
  /** Parallel lite scans for inline badges (per tab; per-host rate limits still apply). */
  scanConcurrency: 2
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
  launch: null,
  // launchpad factors don't apply to fixtures — keeps the walkthrough arithmetic exact
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
  launch: null,
  // launchpad factors don't apply to fixtures — keeps the walkthrough arithmetic exact
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
  launch: null,
  // launchpad factors don't apply to fixtures — keeps the walkthrough arithmetic exact
  sources: { gmgn: "mock", solana: "mock", pumpfun: "mock", rugcheck: "mock", deployer: "mock" },
  fetchedAt: now()
};

// lib/http.ts
function rateLimitFor(host2) {
  const bare = host2.replace(/^www\./, "");
  return RATE_LIMITS_MS[bare] ?? RATE_LIMITS_MS.default;
}
var hostState = /* @__PURE__ */ new Map();
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
  let st = hostState.get(host2);
  if (!st) {
    st = { nextAt: 0, chain: Promise.resolve() };
    hostState.set(host2, st);
  }
  const run = st.chain.then(async () => {
    const wait = st.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    st.nextAt = Date.now() + rateLimitFor(host2);
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
  st.chain = run.catch(() => void 0);
  return run;
}

// lib/gmgnClient.ts
async function fetchGmgnRaw(address, lite = false) {
  if (lite) {
    return { security: await call("security", address), tokenInfo: null, preview: null, feeDist: null, slippage: null, topBuyers: null };
  }
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
var BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`),
  // gmgn.ai
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`)
  // pump.fun
];
var currentAddress = null;
var lastHref = "";
var view = "none";
function addressFromUrl() {
  for (const re of URL_PATTERNS) {
    const m = location.pathname.match(re);
    if (m) return m[1];
  }
  const seg = location.pathname.split("/").filter(Boolean).pop() ?? "";
  return BASE58_RE.test(seg) ? seg : null;
}
function addressFromDom() {
  const link = document.querySelector('a[href*="solscan.io/token/"]');
  const m = link?.href.match(new RegExp(`solscan\\.io/token/(${BASE58})`));
  return m ? m[1] : null;
}
function detect() {
  if (collapsed) return;
  const address = addressFromUrl() ?? addressFromDom();
  if (address) {
    if (view === "token" && address === currentAddress) return;
    view = "token";
    void analyze(address);
    return;
  }
  if (view !== "home") {
    view = "home";
    currentAddress = null;
    renderHome();
  } else if (!scanning) {
    void scanPage();
  }
}
async function requestAnalysis(address, lite = false) {
  let rawGmgn;
  if (!MOCK_MODE && location.hostname.endsWith("gmgn.ai")) {
    try {
      rawGmgn = await fetchGmgnRaw(address, lite);
    } catch {
      rawGmgn = void 0;
    }
  }
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "ANALYZE_TOKEN", address, rawGmgn }, (res) => {
      if (chrome.runtime.lastError || !res) resolve({ ok: false, error: "Risk data unavailable." });
      else resolve(res);
    });
  });
}
async function analyze(address, _manual = false) {
  stopLiveFeed();
  view = "token";
  currentAddress = address;
  showLoading(address);
  const res = await requestAnalysis(address, false);
  if (address !== currentAddress) return;
  if (!res.ok) {
    showError(res.error);
    return;
  }
  render(res.analysis, res.risk, res.mock);
}
var host = null;
var shadow = null;
var collapsed = false;
var STYLES = `
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
  /* page scan list */
  .scan-section { margin-top: 12px; border-top: 1px solid #2c303a; padding-top: 10px; }
  .scan-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .scan-head .t { font-weight: 700; font-size: 11.5px; letter-spacing: .04em; flex: 1; color: #cfd3dc; }
  .scan-head .rescan { color: #7aa2ff; font-size: 11px; }
  .scan-status { color: #8a91a0; font-size: 11px; margin-bottom: 6px; }
  .scanlist { max-height: 260px; overflow-y: auto; margin: 0 -4px; }
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
  .livelist { max-height: 300px; overflow-y: auto; margin: 0 -4px; }
  .safe-toggle { display: flex; align-items: center; gap: 4px; font-size: 10.5px; color: #8a91a0; cursor: pointer; }
  .safe-toggle input { accent-color: #2f6df6; }
  .age { color: #6b7280; font-size: 10px; font-weight: 500; }
  .copy { color: #8a91a0; font-size: 13px; line-height: 1; padding: 3px 6px; border-radius: 6px; flex: none; }
  .copy:hover { color: #fff; background: #2a2f3e; }
  .copy.copied { color: #6fd08c; }
  .uv { background: #1f2a3f; color: #8fb3ff; border: 1px solid #2e4a7a; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 5px; letter-spacing: .02em; }
`;
function ensureHost() {
  if (host && shadow && document.body.contains(host)) return shadow;
  host = document.createElement("div");
  host.id = "crypto-king-overlay";
  shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  shadow.appendChild(style);
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  shadow.appendChild(wrap);
  document.body.appendChild(host);
  return shadow;
}
function wrapEl() {
  const root = ensureHost();
  return root.querySelector(".wrap");
}
function renderCollapsed() {
  const w = wrapEl();
  w.innerHTML = `<div class="fab" title="Open CRYPTO-KING risk scanner">\u{1F451}</div>`;
  stopLiveFeed();
  w.querySelector(".fab")?.addEventListener("click", () => {
    collapsed = false;
    if (currentAddress) {
      view = "token";
      void analyze(currentAddress);
    } else {
      view = "home";
      renderHome();
    }
  });
}
function cardBody() {
  const w = wrapEl();
  w.innerHTML = `
    <div class="card">
      <div class="titlebar">
        <span class="crown">\u{1F451}</span>
        <span class="title">CRYPTO-KING <small>\xB7 risk scanner</small></span>
        <button class="icon-btn collapse" title="Collapse">\u2013</button>
      </div>
      <div class="body"></div>
    </div>`;
  w.querySelector(".collapse")?.addEventListener("click", () => {
    collapsed = true;
    renderCollapsed();
  });
  return w.querySelector(".body");
}
function renderHome() {
  if (collapsed) return renderCollapsed();
  const body = cardBody();
  const onThisPage = addressFromUrl() ?? addressFromDom();
  body.innerHTML = `
    <div class="live-section">
      <div class="scan-head">
        <span class="live-dot"></span>
        <span class="t">Live Solana launches \u2014 auto-scanning</span>
        <label class="safe-toggle"><input type="checkbox" class="safe-only" /> hide high-risk</label>
      </div>
      <div class="live-status">Starting live scan\u2026</div>
      <div class="livelist"></div>
    </div>

    <div class="scan-section">
      <div class="scan-head"><span class="t">Scan a specific coin (Solana only)</span></div>
      <div class="scan-row">
        <input type="text" class="scan-input" placeholder="Token mint address or link" spellcheck="false" />
        <button class="scan-btn">Scan</button>
      </div>
      ${onThisPage ? `<div class="home-note">On this page: <a href="#" class="detected">${esc(short(onThisPage))}</a></div>` : ""}
    </div>

    <div class="scan-section">
      <div class="scan-head">
        <span class="t">Coins linked on this page</span>
        <button class="rescan">\u21BB Rescan</button>
      </div>
      <div class="scan-status"></div>
      <div class="scanlist"></div>
    </div>
    <div class="disclaimer">${esc(DISCLAIMER)}</div>`;
  const input = body.querySelector(".scan-input");
  const go = () => {
    const addr = extractAddress(input?.value ?? "");
    if (addr) void analyze(
      addr,
      /*manual*/
      true
    );
    else if (input) {
      input.style.borderColor = "#e5484d";
      input.placeholder = "Not a valid Solana address";
      input.value = "";
    }
  };
  body.querySelector(".scan-btn")?.addEventListener("click", go);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  body.querySelector(".detected")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (onThisPage) void analyze(onThisPage, true);
  });
  body.querySelector(".rescan")?.addEventListener("click", () => {
    pageScan.clear();
    void scanPage();
  });
  const safeToggle = body.querySelector(".safe-only");
  if (safeToggle) {
    safeToggle.checked = liveSafeOnly;
    safeToggle.addEventListener("change", () => {
      liveSafeOnly = safeToggle.checked;
      updateLiveList();
    });
  }
  updateLiveList();
  startLiveFeed();
  updateScanList();
  void scanPage();
}
var MAX_SCAN = 40;
var pageScan = /* @__PURE__ */ new Map();
var symbolHints = /* @__PURE__ */ new Map();
var scanning = false;
function collectMints() {
  const set = /* @__PURE__ */ new Set();
  const res = [
    new RegExp(`/sol/token/(${BASE58})`),
    new RegExp(`/coin/(${BASE58})`),
    new RegExp(`solscan\\.io/token/(${BASE58})`)
  ];
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    for (const re of res) {
      const m = href.match(re);
      if (m) {
        set.add(m[1]);
        const hint = symbolFromText(a.textContent ?? "");
        if (hint && !symbolHints.has(m[1])) symbolHints.set(m[1], hint);
        break;
      }
    }
  });
  return [...set].slice(0, MAX_SCAN);
}
function symbolFromText(t) {
  const m = t.trim().match(/\$?([A-Za-z][A-Za-z0-9]{0,14})/);
  return m ? m[1].toUpperCase() : null;
}
async function scanPage() {
  if (scanning || collapsed) return;
  const queue = collectMints().filter((m) => !pageScan.has(m));
  if (queue.length === 0) {
    updateScanList();
    return;
  }
  scanning = true;
  setScanStatus(`Scanning ${queue.length} coin${queue.length > 1 ? "s" : ""}\u2026`);
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const mint = queue[i++];
      const res = await requestAnalysis(
        mint,
        /*lite*/
        true
      );
      const hint = symbolHints.get(mint) ?? null;
      pageScan.set(
        mint,
        res.ok ? {
          address: mint,
          symbol: res.analysis.identity.symbol ?? hint,
          name: res.analysis.identity.name,
          score: res.risk.riskScore,
          signal: res.risk.signal,
          topReason: res.risk.reasons[0]?.text ?? null,
          insufficient: res.risk.insufficientData
        } : { address: mint, symbol: hint, name: null, score: 0, signal: "NEUTRAL", topReason: null, insufficient: true }
      );
      updateScanList();
    }
  };
  await Promise.all([worker(), worker()]);
  scanning = false;
  updateScanList();
}
function replicaSymbols() {
  const counts = /* @__PURE__ */ new Map();
  for (const r of pageScan.values()) {
    if (!r.symbol) continue;
    const k = r.symbol.trim().toUpperCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
}
function setScanStatus(text) {
  const el = shadow?.querySelector(".scan-status");
  if (el) el.textContent = text;
}
function updateScanList() {
  const list = shadow?.querySelector(".scanlist");
  if (!list) return;
  const replicas = replicaSymbols();
  const rows = [...pageScan.values()].sort((a, b) => {
    if (a.insufficient !== b.insufficient) return a.insufficient ? 1 : -1;
    return b.score - a.score;
  });
  const replicaCount = rows.filter((r) => r.symbol && replicas.has(r.symbol.trim().toUpperCase())).length;
  const avoid = rows.filter((r) => !r.insufficient && (r.signal === "AVOID" || r.signal === "HIGH_RISK")).length;
  if (!scanning) {
    const parts = [];
    parts.push(rows.length ? `${rows.length} scanned` : "");
    if (avoid) parts.push(`\u26A0 ${avoid} high-risk`);
    if (replicaCount) parts.push(`\u{1F465} ${replicaCount} possible copycat${replicaCount > 1 ? "s" : ""}`);
    setScanStatus(parts.filter(Boolean).join(" \xB7 ") || "No linked coins found on this page.");
  }
  if (rows.length === 0) {
    list.innerHTML = `<div class="scan-empty">No token links detected here yet. Use the scan box above, or open a coin.</div>`;
    return;
  }
  list.innerHTML = rows.map((r) => {
    const meta = SIGNAL_META[r.signal];
    const isReplica = r.symbol && replicas.has(r.symbol.trim().toUpperCase());
    const label = r.insufficient ? "NO DATA" : `${r.score} ${meta.label}`;
    const bg = r.insufficient ? "#3a3f4c" : meta.color;
    const fg = r.insufficient ? "#e6e8ee" : meta.textColor;
    const sym = r.symbol ?? short(r.address);
    const reason = r.insufficient ? "Not enough data to assess" : isReplica ? "Shares a symbol with another coin here \u2014 possible copycat/rug" : r.topReason ?? "Lower observed risk \u2014 not a buy signal";
    return `
        <div class="scan-item" data-addr="${esc(r.address)}">
          <span class="mini-badge" style="background:${bg};color:${fg}">${esc(label)}</span>
          <span class="si-main">
            <span class="si-sym">${esc(sym)}${isReplica ? '<span class="replica">COPYCAT?</span>' : ""}</span>
            <span class="si-reason">${esc(reason)}</span>
          </span>
          <button class="copy" data-copy="${esc(r.address)}" title="Copy token address">\u29C9</button>
        </div>`;
  }).join("");
  wireRowHandlers(list);
}
var liveRows = [];
var liveTimer = null;
var livePolling = false;
var liveSafeOnly = false;
function startLiveFeed() {
  if (liveTimer) return;
  void pollLiveFeed();
  liveTimer = setInterval(() => void pollLiveFeed(), LIVE_FEED.pollIntervalMs);
}
function stopLiveFeed() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
}
async function pollLiveFeed() {
  if (livePolling || collapsed || view !== "home") return;
  livePolling = true;
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_LIVE_FEED" }, (r) => resolve(r));
    });
    if (view !== "home") return;
    if (!res || !res.ok) {
      setLiveStatus(res?.ok === false ? res.error : "Live feed unavailable.");
      return;
    }
    liveRows = res.feed;
    updateLiveList();
    const worst = liveRows.filter((r) => !r.insufficientData && (r.signal === "AVOID" || r.signal === "HIGH_RISK")).length;
    const lower = liveRows.filter((r) => !r.insufficientData && (r.signal === "CONSIDER" || r.signal === "NEUTRAL")).length;
    setLiveStatus(
      `\u{1F534} live \xB7 ${liveRows.length} fresh coins \xB7 \u26A0 ${worst} high-risk \xB7 ${lower} lower-risk` + (res.source === "mock" ? " \xB7 MOCK" : "")
    );
  } finally {
    livePolling = false;
  }
}
function setLiveStatus(text) {
  const el = shadow?.querySelector(".live-status");
  if (el) el.textContent = text;
}
function updateLiveList() {
  const list = shadow?.querySelector(".livelist");
  if (!list) return;
  let rows = [...liveRows];
  if (liveSafeOnly) rows = rows.filter((r) => !r.insufficientData && r.signal !== "AVOID" && r.signal !== "HIGH_RISK");
  if (rows.length === 0) {
    list.innerHTML = `<div class="scan-empty">${liveSafeOnly ? "No lower-risk fresh launches right now." : "Waiting for the first live results\u2026"}</div>`;
    return;
  }
  list.innerHTML = rows.map((r) => {
    const meta = SIGNAL_META[r.signal];
    const label = r.insufficientData ? "NO DATA" : `${r.riskScore} ${meta.label}`;
    const bg = r.insufficientData ? "#3a3f4c" : meta.color;
    const fg = r.insufficientData ? "#e6e8ee" : meta.textColor;
    const sym = r.symbol ?? short(r.address);
    const reason = r.insufficientData ? "Not enough data yet" : r.topReason ?? (r.unverified ? "Early checks clean \u2014 holders/LP not verified yet (click for full scan)" : "No risk factors triggered \u2014 still not a buy signal");
    return `
        <div class="scan-item" data-addr="${esc(r.address)}">
          <span class="mini-badge" style="background:${bg};color:${fg}">${esc(label)}</span>
          <span class="si-main">
            <span class="si-sym">${esc(sym)} <span class="age">${esc(ageShort(r.ageMinutes))}</span>${r.unverified && !r.insufficientData ? '<span class="uv">PARTIAL</span>' : ""}</span>
            <span class="si-reason">${esc(reason)}</span>
          </span>
          <button class="copy" data-copy="${esc(r.address)}" title="Copy token address">\u29C9</button>
        </div>`;
  }).join("");
  wireRowHandlers(list);
}
function wireRowHandlers(list) {
  list.querySelectorAll(".scan-item").forEach((el) => {
    el.addEventListener("click", () => {
      const addr = el.getAttribute("data-addr");
      if (addr) void analyze(addr, true);
    });
  });
  list.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyToClipboard(btn.getAttribute("data-copy") ?? "", btn);
    });
  });
}
function copyToClipboard(text, btn) {
  if (!text) return;
  void navigator.clipboard.writeText(text).then(() => {
    const prev = btn.textContent;
    btn.textContent = "\u2713";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove("copied");
    }, 1200);
  }).catch(() => {
    btn.textContent = "\u2715";
  });
}
function ageShort(m) {
  if (m === null) return "";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(0)}d`;
}
var inlineResults = /* @__PURE__ */ new Map();
var badgeEls = /* @__PURE__ */ new Map();
var badgedLinks = /* @__PURE__ */ new WeakSet();
var pairCache = /* @__PURE__ */ new Map();
var inlineQueue = [];
var inlineWorkers = 0;
var MINT_HREF_RES = [
  new RegExp(`/sol/token/(${BASE58})`),
  new RegExp(`/coin/(${BASE58})`),
  new RegExp(`solscan\\.io/token/(${BASE58})`)
];
var PAIR_HREF_RE = new RegExp(`/pair-explorer/(${BASE58})`);
function sweepInlineBadges() {
  if (!INLINE_BADGES.enabled || inlineResults.size >= INLINE_BADGES.maxPerPage) return;
  const pendingPairs = [];
  document.querySelectorAll("a[href]").forEach((a) => {
    if (badgedLinks.has(a)) return;
    const href = a.getAttribute("href") ?? "";
    for (const re of MINT_HREF_RES) {
      const m = href.match(re);
      if (m) {
        badgedLinks.add(a);
        attachBadge(a, m[1]);
        queueInlineScan(m[1]);
        return;
      }
    }
    if (location.hostname.endsWith("dextools.io") && location.pathname.includes("/solana/")) {
      const pm = href.match(PAIR_HREF_RE);
      if (pm) {
        badgedLinks.add(a);
        const known = pairCache.get(pm[1]);
        if (known) {
          attachBadge(a, known);
          queueInlineScan(known);
        } else if (known === void 0) {
          pairCache.set(pm[1], null);
          pendingPairs.push({ a, pair: pm[1] });
        }
      }
    }
  });
  if (pendingPairs.length > 0) resolvePairs(pendingPairs);
}
function resolvePairs(pending) {
  chrome.runtime.sendMessage(
    { type: "RESOLVE_PAIRS", pairAddresses: pending.map((p) => p.pair) },
    (res) => {
      if (chrome.runtime.lastError || !res?.ok) return;
      for (const { a, pair } of pending) {
        const tok = res.tokens[pair];
        if (!tok || !a.isConnected) continue;
        pairCache.set(pair, tok.address);
        attachBadge(a, tok.address);
        queueInlineScan(tok.address);
      }
    }
  );
}
function attachBadge(anchor, mint) {
  const chip = document.createElement("span");
  chip.setAttribute("data-ck-badge", mint);
  chip.style.cssText = "all:initial;display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;font:700 10px/1.7 system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;vertical-align:middle;white-space:nowrap;background:#3a3f4c;color:#e6e8ee;";
  chip.textContent = "\u{1F451} \u2026";
  chip.title = "CRYPTO-KING: scanning\u2026";
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    collapsed = false;
    void analyze(mint, true);
  });
  anchor.appendChild(chip);
  let set = badgeEls.get(mint);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    badgeEls.set(mint, set);
  }
  set.add(chip);
  paintBadges(mint);
}
function queueInlineScan(mint) {
  if (inlineResults.has(mint)) return;
  inlineResults.set(mint, "pending");
  inlineQueue.push(mint);
  pumpInlineQueue();
}
function pumpInlineQueue() {
  while (inlineWorkers < INLINE_BADGES.scanConcurrency && inlineQueue.length > 0) {
    const mint = inlineQueue.shift();
    if (!mint) break;
    inlineWorkers++;
    void requestAnalysis(
      mint,
      /*lite*/
      true
    ).then((res) => {
      inlineResults.set(
        mint,
        res.ok ? {
          score: res.risk.riskScore,
          signal: res.risk.signal,
          topReason: res.risk.reasons[0]?.text ?? null,
          insufficient: res.risk.insufficientData,
          unverified: res.analysis.holders === null || res.analysis.market?.lpStatus === "unknown"
        } : { score: 0, signal: "NEUTRAL", topReason: null, insufficient: true, unverified: true }
      );
      paintBadges(mint);
    }).finally(() => {
      inlineWorkers--;
      pumpInlineQueue();
    });
  }
}
function paintBadges(mint) {
  const result = inlineResults.get(mint);
  const els = badgeEls.get(mint);
  if (!result || result === "pending" || !els) return;
  const meta = SIGNAL_META[result.signal];
  const label = result.insufficient ? "\u{1F451} ?" : `\u{1F451} ${result.score} ${meta.label}${result.unverified ? "*" : ""}`;
  const bg = result.insufficient ? "#3a3f4c" : meta.color;
  const fg = result.insufficient ? "#e6e8ee" : meta.textColor;
  const tip = result.insufficient ? "CRYPTO-KING: not enough data \u2014 click for details" : `CRYPTO-KING: ${result.score}/100 ${meta.label}${result.unverified ? " (holders/LP not verified yet)" : ""}${result.topReason ? ` \u2014 ${result.topReason}` : ""} \xB7 click for full breakdown`;
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
function extractAddress(raw) {
  const s = raw.trim();
  if (BASE58_RE.test(s)) return s;
  const patterns = [/\/sol\/token\/(\S+)/, /\/coin\/(\S+)/, /solscan\.io\/token\/(\S+)/, new RegExp(`(${BASE58})`)];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && BASE58_RE.test(m[1])) return m[1];
  }
  return null;
}
function showLoading(address) {
  if (collapsed) return;
  const body = cardBody();
  body.innerHTML = `<div><span class="spin"></span> <span class="muted">Scanning ${esc(short(address))}\u2026</span></div>`;
}
function showError(message) {
  if (collapsed) return;
  const body = cardBody();
  body.innerHTML = `
    <div class="head">
      <span class="badge" style="background:#3a3f4c;color:#e6e8ee">NO DATA</span>
      <span class="sym">${esc(message)}</span>
    </div>
    <button class="back-btn">\u2190 Scan another token</button>`;
  body.querySelector(".back-btn")?.addEventListener("click", backToHome);
}
function render(analysis, risk, mock) {
  if (collapsed) return;
  if (risk.insufficientData) {
    showError("Not enough data to assess this token.");
    return;
  }
  const body = cardBody();
  const meta = SIGNAL_META[risk.signal];
  const topReason = risk.reasons[0]?.text ?? "No individual risk factors triggered \u2014 low observed risk \u2260 safe.";
  const sym = analysis.identity.symbol ?? short(analysis.identity.address);
  body.innerHTML = `
    <div class="head">
      <span class="badge" style="background:${meta.color};color:${meta.textColor}">${meta.label}</span>
      <span class="score">${risk.riskScore}</span>
      <span class="sym" title="${esc(analysis.identity.address)}">${esc(sym)}</span>
      ${mock ? '<span class="mock">MOCK</span>' : ""}
      <button class="copy" data-copy="${esc(analysis.identity.address)}" title="Copy token address">\u29C9</button>
    </div>
    <div class="top-reason">${esc(topReason)}</div>
    <div class="row">
      <button class="details-btn">Details \u25BE</button>
      <span class="muted" style="font-size:11px">${esc(meta.blurb)}</span>
    </div>
    <div class="panel" hidden></div>
    <button class="back-btn" style="margin-top:10px">\u2190 Scan another token</button>`;
  body.querySelector(".back-btn")?.addEventListener("click", backToHome);
  const copyBtn = body.querySelector(".copy");
  copyBtn?.addEventListener("click", () => copyToClipboard(analysis.identity.address, copyBtn));
  const panel = body.querySelector(".panel");
  const btn = body.querySelector(".details-btn");
  btn?.addEventListener("click", () => {
    if (!panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    if (btn) btn.textContent = open ? "Details \u25BE" : "Details \u25B4";
    if (!open && panel.childElementCount === 0) fillPanel(panel, analysis, risk);
  });
}
function backToHome() {
  currentAddress = null;
  view = "home";
  renderHome();
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
function short(addr) {
  return `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;
}
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function tick() {
  if (location.href !== lastHref) {
    lastHref = location.href;
    currentAddress = null;
    view = "none";
    pageScan.clear();
    symbolHints.clear();
    inlineResults.clear();
    badgeEls.clear();
    inlineQueue = [];
    if (!collapsed) detect();
  } else if (!collapsed) {
    detect();
  }
  sweepInlineBadges();
}
function boot() {
  detect();
  setInterval(tick, 1500);
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot);
