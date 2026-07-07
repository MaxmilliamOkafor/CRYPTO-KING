// config.ts
var MOCK_MODE = false;
var EUR_PER_USD = 0.92;
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
var PUMPFUN = {
  enabled: true,
  baseUrl: "https://frontend-api-v3.pump.fun",
  /** Single-coin object: creator, created_timestamp, complete, reserves, market_cap, socials, is_banned, token_program. */
  coinEndpoint: "/coins/{address}",
  /** Newest-coins list for the Live feed. sort=created_timestamp gives fresh launches first. */
  listEndpoint: "/coins?offset={offset}&limit={limit}&sort=created_timestamp&order=DESC&includeNsfw=false"
};
var LIVE_FEED = {
  enabled: true,
  /** How many newest coins to pull from the source each poll. */
  fetchCount: 50,
  /**
   * Max NEW coins to fully risk-scan per poll. Each scan makes several Solana
   * RPC calls, so keep this modest on the public RPC (raise it once you add a
   * Helius key — see SOLANA.rpcUrl). Already-scanned coins are served from cache.
   */
  scanBudgetPerPoll: 6,
  /** Panel auto-refresh / poll interval in ms. */
  pollIntervalMs: 15e3,
  /** Drop coins older than this many minutes from the feed (keep it "fresh launches"). */
  maxAgeMinutes: 180,
  /** Feed cache size. */
  maxRows: 60
};
var SOLANA = {
  /**
   * Authoritative fallback for mint/freeze authority, Token-2022 fees, and
   * top-holder accounts. Public mainnet RPC works but is heavily rate-limited.
   * For reliable data (and metadata-mutability via DAS getAsset) use a free
   * Helius key: https://www.helius.dev
   *   → 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'
   */
  rpcUrl: "https://api.mainnet-beta.solana.com",
  /** DAS (getAsset) is only available on Helius-style RPCs. Auto-detected from the URL. */
  get supportsDas() {
    return this.rpcUrl.includes("helius");
  },
  /**
   * Token accounts owned by these authorities are treated as pool/LP accounts
   * and EXCLUDED from holder-concentration math. Extend as needed.
   */
  knownPoolAuthorities: [
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    // Raydium AMM v4 authority
    "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"
    // Raydium CPMM vault authority
  ],
  burnAddresses: [
    "1nc1nerator11111111111111111111111111111111",
    // Solana incinerator
    "11111111111111111111111111111111"
    // system program (used as burn dest by some tools)
  ]
};
var RUGCHECK = {
  /** Optional pluggable adapter — OFF by default; the API spec may drift. */
  enabled: false,
  /** Public report endpoint as of 2025; verify against rugcheck.xyz docs before enabling. */
  endpoint: "https://api.rugcheck.xyz/v1/tokens/{address}/report"
};
var RATE_LIMITS_MS = {
  default: 1100,
  "gmgn.ai": 400
};
var FETCH_TIMEOUT_MS = 1e4;
var CACHE_TTL_MS = 5 * 6e4;
var RECENT_MAX = 100;
var WEIGHTS = {
  // Token structure (high weight — the actual Solana rug surface)
  mintAuthorityActive: 25,
  freezeAuthorityActive: 20,
  transferFeeHigh: 10,
  // fee > LIMITS.transferFeeHighBps
  transferFeeVeryHigh: 15,
  // fee > LIMITS.transferFeeVeryHighBps (replaces, not additive)
  feeAuthorityActive: 15,
  metadataMutable: 5,
  lpNotSecured: 20,
  // LP neither burned nor locked
  sellSimulationFailed: 30,
  // sell fails / honeypot flag / slippage > LIMITS.sellSlippageMaxPct
  // Holder concentration (medium-high)
  top10Concentrated: 15,
  // top 10 > LIMITS.top10Pct (LP/burn excluded)
  singleWalletDominant: 10,
  // one non-LP wallet > LIMITS.singleWalletPct
  top5EffectiveConcentration: 15,
  // top 5 > LIMITS.top5Pct despite ≥ LIMITS.top5MinHolders holders
  bundledLaunch: 15,
  // bundled/sniped supply > LIMITS.bundledPct
  // Liquidity & market cap (medium)
  thinLiquidityVsMcap: 10,
  // liq < LIMITS.thinLiquidityEur while mcap > LIMITS.thinLiqMcapEur
  microMcapUnlockedLp: 15,
  // mcap < LIMITS.microMcapEur AND LP not secured
  mcapSpikeNoOrganicVolume: 10,
  // Age & behavior (medium)
  youngTokenAbnormalVolume: 10,
  // age < LIMITS.youngAgeMinutes with abnormal volume
  deployerLinkedSelling: 15,
  deployerPriorRugs: 20,
  // deployer wallet linked to ≥1 prior rug
  deployerFundedByRugger: 15,
  // deployer funded from a known rugger wallet
  noSocials: 10,
  unverifiedSocials: 5,
  volumeSpikeFlatPrice: 10,
  manySmallBuysOneHugeSell: 10,
  smartMoneyExiting: 10,
  // Mitigating signals (negative; total capped at -MITIGATION_CAP)
  smartMoneyAccumulatingStrong: -10,
  // ≥ LIMITS.smartMoneyStrongWallets wallets
  smartMoneyAccumulatingLight: -5,
  verifiedSocials: -5
};
var LIMITS = {
  transferFeeHighBps: 1e3,
  // 10%
  transferFeeVeryHighBps: 2e3,
  // 20%
  sellSlippageMaxPct: 40,
  top10Pct: 60,
  singleWalletPct: 30,
  top5Pct: 80,
  top5MinHolders: 500,
  // "looks distributed but is effectively concentrated"
  bundledPct: 20,
  thinLiquidityEur: 5e4,
  thinLiqMcapEur: 5e5,
  microMcapEur: 5e4,
  youngAgeMinutes: 30,
  smartMoneyStrongWallets: 3
};
var MITIGATION_CAP = 15;
var SIGNAL_THRESHOLDS = [
  { min: 80, signal: "AVOID" },
  { min: 60, signal: "HIGH_RISK" },
  { min: 40, signal: "WATCH" },
  { min: 20, signal: "CONSIDER" },
  { min: 0, signal: "NEUTRAL" }
];

// lib/deployerClient.ts
var nullDeployerAdapter = {
  async fetchDeployerHistory() {
    return {
      status: "disabled",
      deployer: { priorRugs: null, fundingSource: "unknown" }
    };
  }
};

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
var ALL_FIXTURES = [FIXTURE_AVOID, FIXTURE_WATCH, FIXTURE_NEUTRAL];
function fixtureForAddress(address) {
  const exact = ALL_FIXTURES.find((f) => f.identity.address === address);
  const base = exact ?? ALL_FIXTURES[simpleHash(address) % ALL_FIXTURES.length];
  return {
    ...base,
    identity: { ...base.identity, address },
    fetchedAt: Date.now()
  };
}
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = h * 31 + s.charCodeAt(i) >>> 0;
  }
  return h;
}

// lib/http.ts
function rateLimitFor(host) {
  const bare = host.replace(/^www\./, "");
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
  const host = hostOf(url);
  const q = hostQueues.get(host) ?? { lastAt: 0, chain: Promise.resolve() };
  const run = q.chain.then(async () => {
    const wait = q.lastAt + rateLimitFor(host) - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        console.warn(`[CRYPTO-KING] ${host} responded ${res.status} for ${url}`);
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
  hostQueues.set(host, { lastAt: q.lastAt, chain: run.catch(() => void 0) });
  const result = await run;
  const entry = hostQueues.get(host);
  if (entry) entry.lastAt = Math.max(entry.lastAt, Date.now() - 1);
  return result;
}
async function rpcCall(rpcUrl, method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: "crypto-king", method, params });
  const json = await fetchJson(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  if (json && typeof json === "object" && "result" in json) {
    return json.result ?? null;
  }
  return null;
}
function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path.split(".")) {
      if (cur !== null && typeof cur === "object" && key in cur) {
        cur = cur[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== void 0 && cur !== null) return cur;
  }
  return void 0;
}
function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function asString(v) {
  return typeof v === "string" && v.length > 0 ? v : null;
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
async function fetchGmgnData(address) {
  if (MOCK_MODE) return mockGmgnData(address);
  return parseGmgn(await fetchGmgnRaw(address));
}
function parseGmgn(raw) {
  const { security, tokenInfo, preview, feeDist, slippage, topBuyers } = raw;
  const out = { ...EMPTY };
  if (security !== null) {
    out.mintRenounced = asBool(pick(security, ["renounced_mint", "security.renounced_mint"]));
    out.freezeRenounced = asBool(pick(security, ["renounced_freeze_account", "security.renounced_freeze_account"]));
    out.isHoneypot = asBool(pick(security, ["is_honeypot", "security.is_honeypot"]));
    out.isBlacklist = asBool(pick(security, ["is_blacklist", "security.is_blacklist"]));
    out.top10Pct = ratioToPct(asNumber(pick(security, ["top_10_holder_rate", "security.top_10_holder_rate"])));
    const buyTax = asNumber(pick(security, ["buy_tax", "security.buy_tax"]));
    const sellTax = asNumber(pick(security, ["sell_tax", "security.sell_tax"]));
    const avgTax = asNumber(pick(security, ["average_tax", "security.average_tax"]));
    const maxTax = [buyTax, sellTax, avgTax].reduce(
      (m, t) => t === null ? m : m === null ? t : Math.max(m, t),
      null
    );
    out.taxBps = taxToBps(maxTax);
    out.lpStatus = deriveLpStatus(security);
  }
  if (tokenInfo !== null) {
    out.holderCount = out.holderCount ?? asNumber(pick(tokenInfo, ["holder_count"]));
    out.liquidityEur = usdToEur(asNumber(pick(tokenInfo, ["liquidity"])));
    const createdSec = asNumber(pick(tokenInfo, ["creation_timestamp", "open_timestamp"]));
    if (createdSec !== null) out.ageMinutes = Math.max(0, (Date.now() / 1e3 - createdSec) / 60);
  }
  if (preview !== null) {
    out.symbol = asString(pick(preview, ["symbol", "token.symbol"]));
    out.name = asString(pick(preview, ["name", "token.name"]));
    out.marketCapEur = usdToEur(asNumber(pick(preview, ["mc", "market_cap", "usd_market_cap"])));
    out.priceEur = usdToEur(asNumber(pick(preview, ["price", "usd_price"])));
    out.volume24hEur = usdToEur(asNumber(pick(preview, ["volume_24h", "volume24h", "v24h"])));
    const twitter = asString(pick(preview, ["twitter", "socials.twitter", "twitter_username", "link.twitter_username"]));
    const website = asString(pick(preview, ["website", "socials.website", "link.website"]));
    const telegram = asString(pick(preview, ["telegram", "socials.telegram", "link.telegram"]));
    out.socials = { website, twitter, telegram, verified: null };
  }
  if (feeDist !== null) {
    const feeAuth = pick(feeDist, ["fee_authority"]);
    out.feeAuthorityActive = feeAuth === void 0 ? null : feeAuth !== null && feeAuth !== "";
    const royaltyBps = asNumber(pick(feeDist, ["royalty", "royalty_bps"]));
    if (out.taxBps === null && royaltyBps !== null) out.taxBps = royaltyBps;
  }
  if (slippage !== null) {
    out.sellSlippagePct = ratioToPct(asNumber(pick(slippage, ["recommend_sell_slippage", "sell_slippage"])));
    out.hasTax = asBool(pick(slippage, ["has_tax"]));
  }
  if (topBuyers !== null) {
    out.top10Pct = out.top10Pct ?? ratioToPct(asNumber(pick(topBuyers, ["top_10_holder_rate", "holders.top_10_holder_rate"])));
    out.sniperHoldPct = ratioToPct(
      asNumber(pick(topBuyers, ["top70_sniper_hold_rate", "holders.top70_sniper_hold_rate", "sniper_hold_rate"]))
    );
    const smartCount = asNumber(
      pick(topBuyers, ["smart_degen_count", "holders.smart_degen_count", "smart_wallets", "smart_money_count"])
    );
    const smartSells = asNumber(pick(topBuyers, ["smart_sell_count", "holders.smart_sell_count"]));
    if (smartCount !== null || smartSells !== null) {
      out.smartMoney = {
        accumulating: smartCount !== null && smartCount > 0,
        exiting: smartSells !== null && smartSells > Math.max(1, smartCount ?? 0),
        walletCount: smartCount
      };
    }
  }
  const anyData = out.mintRenounced !== null || out.marketCapEur !== null || out.liquidityEur !== null || out.holderCount !== null;
  const allCore = security !== null && tokenInfo !== null && preview !== null;
  out.status = anyData ? allCore ? "ok" : "partial" : "unavailable";
  return out;
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
function deriveLpStatus(security) {
  const burnStatus = asString(pick(security, ["burn_status", "security.burn_status"]));
  const burnRatio = ratioToPct(asNumber(pick(security, ["burn_ratio", "security.burn_ratio"])));
  if (burnStatus === "burn" || burnRatio !== null && burnRatio >= 95) return "burned";
  const lockSummary = pick(security, ["lock_summary", "security.lock_summary"]);
  if (lockSummary && typeof lockSummary === "object") {
    const isLocked = asBool(pick(lockSummary, ["is_locked"]));
    const lockPct = ratioToPct(asNumber(pick(lockSummary, ["lock_percent"])));
    const details = pick(lockSummary, ["lock_detail"]);
    const blackhole = Array.isArray(details) && details.some((d) => asBool(pick(d, ["is_blackhole"])) === true);
    if (isLocked === true && (lockPct === null || lockPct >= 90)) return blackhole ? "burned" : "locked";
  }
  if (burnStatus !== null || burnRatio !== null) return "unlocked";
  return "unknown";
}
var usdToEur = (v) => v === null ? null : v * EUR_PER_USD;
function ratioToPct(v) {
  if (v === null) return null;
  return v <= 1 ? v * 100 : v;
}
function taxToBps(v) {
  if (v === null) return null;
  if (v <= 1) return Math.round(v * 1e4);
  if (v <= 100) return Math.round(v * 100);
  return Math.round(v);
}
function asBool(v) {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}
function mockGmgnData(address) {
  const f = fixtureForAddress(address);
  return {
    status: "mock",
    symbol: f.identity.symbol,
    name: f.identity.name,
    ageMinutes: f.identity.ageMinutes,
    priceEur: f.market?.priceEur ?? null,
    marketCapEur: f.market?.marketCapEur ?? null,
    liquidityEur: f.market?.liquidityEur ?? null,
    volume24hEur: f.market?.volume24hEur ?? null,
    mintRenounced: f.mint ? !f.mint.mintAuthorityActive : null,
    freezeRenounced: f.mint ? !f.mint.freezeAuthorityActive : null,
    isHoneypot: f.market?.sellSimulation ? !f.market.sellSimulation.ok : null,
    isBlacklist: f.mint?.freezeAuthorityActive ?? null,
    taxBps: f.mint?.transferFeeBps ?? null,
    lpStatus: f.market?.lpStatus ?? null,
    feeAuthorityActive: f.mint?.feeAuthorityActive ?? null,
    sellSlippagePct: f.market?.sellSimulation?.slippagePct ?? null,
    hasTax: f.mint?.transferFeeBps !== null && (f.mint?.transferFeeBps ?? 0) > 0,
    holderCount: f.holders?.holderCount ?? null,
    top10Pct: f.holders?.top10Pct ?? null,
    sniperHoldPct: f.holders?.bundledLaunchPct ?? null,
    socials: f.socials,
    smartMoney: f.smartMoney,
    behavior: f.behavior
  };
}
var EMPTY = {
  status: "unavailable",
  symbol: null,
  name: null,
  ageMinutes: null,
  priceEur: null,
  marketCapEur: null,
  liquidityEur: null,
  volume24hEur: null,
  mintRenounced: null,
  freezeRenounced: null,
  isHoneypot: null,
  isBlacklist: null,
  taxBps: null,
  lpStatus: null,
  feeAuthorityActive: null,
  sellSlippagePct: null,
  hasTax: null,
  holderCount: null,
  top10Pct: null,
  sniperHoldPct: null,
  socials: null,
  smartMoney: null,
  behavior: null
};

// lib/pumpfunClient.ts
var TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
async function fetchPumpfunData(address) {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return {
      status: "mock",
      symbol: f.identity.symbol,
      name: f.identity.name,
      ageMinutes: f.identity.ageMinutes,
      marketCapEur: f.market?.marketCapEur ?? null,
      bondingCurveComplete: true,
      isBanned: false,
      isToken2022: f.mint?.isToken2022 ?? null,
      creator: null,
      socials: f.socials
    };
  }
  if (!PUMPFUN.enabled) return { ...EMPTY2, status: "disabled" };
  const url = `${PUMPFUN.baseUrl}${PUMPFUN.coinEndpoint.replace("{address}", address)}`;
  const json = await fetchJson(url);
  if (json === null) return { ...EMPTY2, status: "unavailable" };
  const createdMs = asNumber(pick(json, ["created_timestamp"]));
  const tokenProgram = asString(pick(json, ["token_program"]));
  const website = asString(pick(json, ["website"]));
  const twitter = asString(pick(json, ["twitter"]));
  const telegram = asString(pick(json, ["telegram"]));
  return {
    status: "ok",
    symbol: asString(pick(json, ["symbol"])),
    name: asString(pick(json, ["name"])),
    ageMinutes: createdMs !== null ? Math.max(0, (Date.now() - createdMs) / 6e4) : null,
    marketCapEur: usdToEur2(asNumber(pick(json, ["usd_market_cap", "market_cap"]))),
    bondingCurveComplete: asBoolLoose(pick(json, ["complete"])),
    isBanned: asBoolLoose(pick(json, ["is_banned"])),
    isToken2022: tokenProgram !== null ? tokenProgram === TOKEN_2022_PROGRAM : null,
    creator: asString(pick(json, ["creator"])),
    socials: website || twitter || telegram ? { website, twitter, telegram, verified: null } : null
  };
}
var BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function fetchPumpfunNewCoins(limit, offset = 0) {
  if (MOCK_MODE || !PUMPFUN.enabled) return [];
  const path = PUMPFUN.listEndpoint.replace("{offset}", String(offset)).replace("{limit}", String(limit));
  const json = await fetchJson(`${PUMPFUN.baseUrl}${path}`);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.coins) ? json.coins : [];
  const out = [];
  for (const c of arr) {
    const mint = asString(pick(c, ["mint", "address", "coin_mint"]));
    if (!mint || !BASE58_RE.test(mint)) continue;
    out.push({
      mint,
      symbol: asString(pick(c, ["symbol"])),
      name: asString(pick(c, ["name"])),
      createdMs: asNumber(pick(c, ["created_timestamp"]))
    });
  }
  return out;
}
var usdToEur2 = (v) => v === null ? null : v * EUR_PER_USD;
function asBoolLoose(v) {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  return null;
}
var EMPTY2 = {
  status: "unavailable",
  symbol: null,
  name: null,
  ageMinutes: null,
  marketCapEur: null,
  bondingCurveComplete: null,
  isBanned: null,
  isToken2022: null,
  creator: null,
  socials: null
};

// lib/riskScorer.ts
function signalForScore(score, thresholds = SIGNAL_THRESHOLDS) {
  for (const t of thresholds) {
    if (score >= t.min) return t.signal;
  }
  return "NEUTRAL";
}
function scoreToken(a, w = WEIGHTS, l = LIMITS) {
  const reasons = [];
  const mitigations = [];
  const dataGaps = [];
  const hit = (points, text) => reasons.push({ points, text });
  const mitigate = (points, text) => mitigations.push({ points, text });
  const gap = (text) => dataGaps.push(text);
  const mint = a.mint;
  if (!mint) {
    gap("On-chain mint data unavailable \u2014 mint/freeze authority and Token-2022 fees were NOT checked.");
  } else {
    if (mint.mintAuthorityActive === true) {
      hit(w.mintAuthorityActive, "Mint authority active \u2014 supply can be inflated at any time.");
    } else if (mint.mintAuthorityActive === null) {
      gap("Mint authority status unknown.");
    }
    if (mint.freezeAuthorityActive === true) {
      hit(w.freezeAuthorityActive, "Freeze authority active \u2014 dev can freeze holder wallets (honeypot-style trap).");
    } else if (mint.freezeAuthorityActive === null) {
      gap("Freeze authority status unknown.");
    }
    if (mint.transferFeeBps !== null) {
      if (mint.transferFeeBps > l.transferFeeVeryHighBps) {
        hit(
          w.transferFeeVeryHigh,
          `Token-2022 transfer fee is ${(mint.transferFeeBps / 100).toFixed(1)}% \u2014 very high transfer tax reduces exit value.`
        );
      } else if (mint.transferFeeBps > l.transferFeeHighBps) {
        hit(
          w.transferFeeHigh,
          `Token-2022 transfer fee is ${(mint.transferFeeBps / 100).toFixed(1)}% \u2014 high transfer tax reduces exit value.`
        );
      }
    } else if (mint.isToken2022 === true) {
      gap("Token-2022 mint but transfer-fee extension could not be read.");
    }
    if (mint.feeAuthorityActive === true) {
      hit(w.feeAuthorityActive, "Fee/withdraw authority still active \u2014 fees can be changed after you buy.");
    }
    if (mint.metadataMutable === true) {
      hit(w.metadataMutable, "Metadata mutable \u2014 token identity (name/symbol/socials) can be changed post-launch.");
    } else if (mint.metadataMutable === null) {
      gap("Metadata mutability unknown (needs a DAS-capable RPC such as Helius).");
    }
  }
  const market = a.market;
  const lpSecured = market ? market.lpStatus === "burned" || market.lpStatus === "locked" : null;
  if (!market) {
    gap("Market data (liquidity, market cap, LP status) unavailable.");
  } else {
    if (market.lpStatus === "unknown") {
      gap("LP burn/lock status could not be determined.");
    } else if (lpSecured === false) {
      const detail = market.lpStatus === "deployer_held" ? "held by the deployer" : "unlocked";
      hit(w.lpNotSecured, `LP not burned/locked (${detail}) \u2014 liquidity can be pulled: classic rug vector.`);
    }
    const sim = market.sellSimulation;
    if (sim === null) {
      gap("Sell simulation unavailable \u2014 honeypot-like behavior was NOT checked.");
    } else if (!sim.ok || sim.slippagePct !== null && sim.slippagePct > l.sellSlippageMaxPct) {
      const why = !sim.ok ? "a simulated sell fails" : `simulated sell slippage is ${sim.slippagePct}%`;
      hit(w.sellSimulationFailed, `Honeypot-like behavior detected \u2014 ${why}.`);
    }
    if (market.liquidityEur !== null && market.marketCapEur !== null) {
      if (market.liquidityEur < l.thinLiquidityEur && market.marketCapEur > l.thinLiqMcapEur) {
        hit(
          w.thinLiquidityVsMcap,
          `Thin liquidity (\u20AC${fmtK(market.liquidityEur)}) vs. cap (\u20AC${fmtK(market.marketCapEur)}) \u2014 easy to manipulate.`
        );
      }
      if (market.marketCapEur < l.microMcapEur && lpSecured === false) {
        hit(w.microMcapUnlockedLp, `Micro cap (\u20AC${fmtK(market.marketCapEur)}) with unsecured LP \u2014 high rug exposure.`);
      }
    } else {
      gap("Liquidity/market-cap figures incomplete.");
    }
  }
  const h = a.holders;
  if (!h) {
    gap("Holder distribution unavailable.");
  } else {
    if (h.top10Pct !== null && h.top10Pct > l.top10Pct) {
      hit(w.top10Concentrated, `Top 10 holders control ${h.top10Pct.toFixed(0)}% of supply (LP/burn excluded).`);
    }
    if (h.largestNonLpWalletPct !== null && h.largestNonLpWalletPct > l.singleWalletPct) {
      hit(w.singleWalletDominant, `A single non-LP wallet holds ${h.largestNonLpWalletPct.toFixed(0)}% of supply.`);
    }
    if (h.top5Pct !== null && h.holderCount !== null && h.top5Pct > l.top5Pct && h.holderCount >= l.top5MinHolders) {
      hit(
        w.top5EffectiveConcentration,
        `Top 5 wallets hold ${h.top5Pct.toFixed(0)}% despite ${h.holderCount} holders \u2014 looks distributed but is effectively concentrated.`
      );
    }
    if (h.bundledLaunchPct !== null && h.bundledLaunchPct > l.bundledPct) {
      hit(
        w.bundledLaunch,
        `${h.bundledLaunchPct.toFixed(0)}% of supply was bundled/sniped at launch by wallets funded from one source.`
      );
    }
  }
  const b = a.behavior;
  if (b) {
    if (b.mcapSpikeNoOrganicVolume === true) {
      hit(w.mcapSpikeNoOrganicVolume, "Market cap spiked with no matching organic volume.");
    }
    if (a.identity.ageMinutes !== null && a.identity.ageMinutes < l.youngAgeMinutes && b.abnormalEarlyVolume === true) {
      hit(
        w.youngTokenAbnormalVolume,
        `Token is only ${Math.round(a.identity.ageMinutes)} min old with abnormal volume.`
      );
    }
    if (b.deployerLinkedSelling === true) {
      hit(w.deployerLinkedSelling, "Deployer-linked wallets are selling shortly after launch.");
    }
    if (b.volumeSpikeFlatPrice === true) {
      hit(w.volumeSpikeFlatPrice, "Volume spike with flat price \u2014 wash-trading pattern.");
    }
    if (b.manySmallBuysOneHugeSell === true) {
      hit(w.manySmallBuysOneHugeSell, "Many small buys followed by one huge sell \u2014 exit-scam pattern.");
    }
  } else {
    gap("Trade-behavior heuristics unavailable.");
  }
  const d = a.deployer;
  if (!d) {
    gap("Deployer wallet history unavailable.");
  } else {
    if (d.priorRugs !== null && d.priorRugs > 0) {
      hit(w.deployerPriorRugs, `Deployer wallet linked to ${d.priorRugs} prior rug${d.priorRugs > 1 ? "s" : ""}.`);
    }
    if (d.fundingSource === "known_rugger") {
      hit(w.deployerFundedByRugger, "Deployer was funded from a wallet linked to known rugs.");
    }
  }
  const s = a.socials;
  if (!s) {
    gap("Social links unavailable.");
  } else {
    const hasAny = Boolean(s.website || s.twitter || s.telegram);
    if (!hasAny) {
      hit(w.noSocials, "No website, Twitter or Telegram found.");
    } else if (s.verified === false) {
      hit(w.unverifiedSocials, "Socials present but unverified.");
    } else if (s.verified === true) {
      mitigate(w.verifiedSocials, "Verified website/Twitter/Telegram.");
    }
  }
  const sm = a.smartMoney;
  if (sm) {
    if (sm.exiting === true) {
      hit(w.smartMoneyExiting, "Smart-money wallets are exiting this token.");
    } else if (sm.accumulating === true) {
      const strong = sm.walletCount !== null && sm.walletCount >= l.smartMoneyStrongWallets;
      mitigate(
        strong ? w.smartMoneyAccumulatingStrong : w.smartMoneyAccumulatingLight,
        `Known smart-money wallets accumulating${sm.walletCount ? ` (${sm.walletCount} wallets)` : ""}.`
      );
    }
  } else {
    gap("Smart-money flow data unavailable.");
  }
  const positive = reasons.reduce((sum, r) => sum + r.points, 0);
  const rawMitigation = mitigations.reduce((sum, r) => sum + r.points, 0);
  const cappedMitigation = Math.max(rawMitigation, -MITIGATION_CAP);
  const riskScore = clamp(Math.round(positive + cappedMitigation), 0, 100);
  reasons.sort((x, y) => y.points - x.points);
  const insufficientData = a.mint === null && a.market === null && a.holders === null;
  return {
    riskScore,
    signal: signalForScore(riskScore),
    reasons,
    mitigations,
    dataGaps,
    insufficientData
  };
}
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}

// lib/rugcheckClient.ts
var rugcheckAdapter = {
  async fetchAudit(address) {
    if (MOCK_MODE) return { status: "mock", lpStatus: null, externalFlags: [] };
    if (!RUGCHECK.enabled) return { status: "disabled", lpStatus: null, externalFlags: [] };
    const json = await fetchJson(RUGCHECK.endpoint.replace("{address}", address));
    if (json === null) return { status: "unavailable", lpStatus: null, externalFlags: [] };
    const externalFlags = [];
    const risks = pick(json, ["risks"]);
    if (Array.isArray(risks)) {
      for (const r of risks) {
        const name = pick(r, ["name", "description"]);
        if (typeof name === "string") externalFlags.push(`RugCheck: ${name}`);
      }
    }
    let lpStatus = null;
    const lockedPct = asNumber(pick(json, ["markets.0.lp.lpLockedPct", "lpLockedPct"]));
    if (lockedPct !== null) lpStatus = lockedPct >= 90 ? "locked" : "unlocked";
    return { status: "ok", lpStatus, externalFlags };
  }
};

// lib/solanaClient.ts
var TOKEN_2022_PROGRAM2 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
async function fetchSolanaData(address) {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return { mint: f.mint, holders: f.holders, status: "mock" };
  }
  const [mint, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfo(address)]);
  const status = mint && holders ? "ok" : mint || holders ? "partial" : "unavailable";
  return { mint, holders, status };
}
async function fetchMintInfo(address) {
  const result = await rpcCall(SOLANA.rpcUrl, "getAccountInfo", [
    address,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const value = result?.value;
  const parsed = value?.data?.parsed;
  if (!value || !parsed || parsed.type !== "mint" || !parsed.info) return null;
  const info = parsed.info;
  const isToken2022 = value.owner === TOKEN_2022_PROGRAM2;
  const mintAuthorityActive = info.mintAuthority != null;
  const freezeAuthorityActive = info.freezeAuthority != null;
  let transferFeeBps = null;
  let feeAuthorityActive = isToken2022 ? false : null;
  const extensions = Array.isArray(info.extensions) ? info.extensions : [];
  for (const ext of extensions) {
    if (ext.extension === "transferFeeConfig") {
      const state = ext.state ?? {};
      const newer = state.newerTransferFee ?? {};
      transferFeeBps = asNumber(newer.transferFeeBasisPoints) ?? 0;
      feeAuthorityActive = state.transferFeeConfigAuthority != null || state.withdrawWithheldAuthority != null;
    }
  }
  return {
    mintAuthorityActive,
    freezeAuthorityActive,
    metadataMutable: await fetchMetadataMutable(address),
    isToken2022,
    transferFeeBps,
    feeAuthorityActive
  };
}
async function fetchMetadataMutable(address) {
  if (!SOLANA.supportsDas) return null;
  const asset = await rpcCall(SOLANA.rpcUrl, "getAsset", { id: address });
  return typeof asset?.mutable === "boolean" ? asset.mutable : null;
}
async function fetchHolderInfo(address) {
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(SOLANA.rpcUrl, "getTokenSupply", [address, { commitment: "confirmed" }]),
    rpcCall(SOLANA.rpcUrl, "getTokenLargestAccounts", [address, { commitment: "confirmed" }])
  ]);
  const supply = asNumber(supplyRes?.value?.uiAmount);
  const accounts = (largestRes?.value ?? []).map((a) => ({ address: a.address ?? "", amount: asNumber(a.uiAmount) ?? 0 })).filter((a) => a.address && a.amount > 0);
  if (supply === null || supply <= 0 || accounts.length === 0) return null;
  const owners = await fetchOwners(accounts.map((a) => a.address));
  const excluded = /* @__PURE__ */ new Set([...SOLANA.knownPoolAuthorities, ...SOLANA.burnAddresses]);
  const realHolders = accounts.filter((_a, i) => {
    const owner = owners[i];
    return owner === null || !excluded.has(owner);
  });
  const pct = (slice) => Math.min(100, slice.reduce((s, a) => s + a.amount, 0) / supply * 100);
  return {
    holderCount: null,
    // plain RPC has no cheap holder count; GMGN fills this in when live
    top5Pct: pct(realHolders.slice(0, 5)),
    top10Pct: pct(realHolders.slice(0, 10)),
    largestNonLpWalletPct: realHolders.length > 0 ? pct(realHolders.slice(0, 1)) : null,
    bundledLaunchPct: null
    // needs block-0..2 funding-graph analysis; honest "unknown" for now
  };
}
async function fetchOwners(tokenAccounts) {
  const result = await rpcCall(SOLANA.rpcUrl, "getMultipleAccounts", [
    tokenAccounts,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const values = result?.value ?? [];
  return tokenAccounts.map((_, i) => values[i]?.data?.parsed?.info?.owner ?? null);
}

// background/service-worker.ts
var RECENT_KEY = "ck:recent";
var BASE58_RE2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var cache = /* @__PURE__ */ new Map();
var inFlight = /* @__PURE__ */ new Map();
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});
async function handle(msg) {
  switch (msg.type) {
    case "ANALYZE_TOKEN":
      return analyzeToken(msg.address, msg.force === true, msg.rawGmgn);
    case "GET_RECENT": {
      const recent = await loadRecent();
      return { ok: true, recent };
    }
    case "CLEAR_RECENT":
      await chrome.storage.local.set({ [RECENT_KEY]: [] });
      return { ok: true, recent: [] };
    case "GET_LIVE_FEED":
      return getLiveFeed();
    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}
var feed = /* @__PURE__ */ new Map();
async function getLiveFeed() {
  if (!LIVE_FEED.enabled) return { ok: false, error: "Live feed disabled in config." };
  const coins = await fetchPumpfunNewCoins(LIVE_FEED.fetchCount);
  if (coins.length === 0 && feed.size === 0) {
    return {
      ok: false,
      error: MOCK_MODE ? "Live feed needs live mode (MOCK_MODE=false)." : "Live launch source unavailable right now."
    };
  }
  const cutoff = Date.now() - LIVE_FEED.maxAgeMinutes * 6e4;
  for (const [mint, row] of feed) {
    if (row.ageMinutes !== null && row.scannedAt < cutoff && row.ageMinutes > LIVE_FEED.maxAgeMinutes) feed.delete(mint);
  }
  let scannedThisPoll = 0;
  for (const c of coins) {
    const cached = cache.get(c.mint);
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (!fresh) {
      if (scannedThisPoll >= LIVE_FEED.scanBudgetPerPoll) continue;
      await analyzeToken(c.mint, false);
      scannedThisPoll++;
    }
    const entry = cache.get(c.mint);
    if (!entry) continue;
    feed.set(c.mint, {
      address: c.mint,
      symbol: entry.analysis.identity.symbol ?? c.symbol,
      name: entry.analysis.identity.name ?? c.name,
      ageMinutes: entry.analysis.identity.ageMinutes ?? (c.createdMs ? Math.max(0, (Date.now() - c.createdMs) / 6e4) : null),
      marketCapEur: entry.analysis.market?.marketCapEur ?? null,
      riskScore: entry.risk.riskScore,
      signal: entry.risk.signal,
      topReason: entry.risk.reasons[0]?.text ?? null,
      insufficientData: entry.risk.insufficientData,
      scannedAt: Date.now()
    });
  }
  const rows = [...feed.values()].sort((a, b) => (a.ageMinutes ?? 1e9) - (b.ageMinutes ?? 1e9)).slice(0, LIVE_FEED.maxRows);
  if (feed.size > LIVE_FEED.maxRows * 2) {
    const keep = new Set(rows.map((r) => r.address));
    for (const k of feed.keys()) if (!keep.has(k)) feed.delete(k);
  }
  return { ok: true, feed: rows, source: MOCK_MODE ? "mock" : "ok", scannedThisPoll };
}
async function analyzeToken(address, force, rawGmgn) {
  if (!BASE58_RE2.test(address)) {
    return { ok: false, error: "Not a valid Solana address." };
  }
  const cached = cache.get(address);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, analysis: cached.analysis, risk: cached.risk, mock: MOCK_MODE };
  }
  const pending = inFlight.get(address);
  if (pending) return pending;
  const job = doAnalyze(address, rawGmgn).finally(() => inFlight.delete(address));
  inFlight.set(address, job);
  return job;
}
async function doAnalyze(address, rawGmgn) {
  try {
    const gmgnPromise = !MOCK_MODE && rawGmgn ? Promise.resolve(parseGmgn(rawGmgn)) : fetchGmgnData(address);
    const [gmgn, solana, pumpfun, audit] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address),
      fetchPumpfunData(address),
      rugcheckAdapter.fetchAudit(address)
    ]);
    const deployerHist = await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);
    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, {
      gmgn: gmgn.status,
      solana: solana.status,
      pumpfun: pumpfun.status,
      rugcheck: audit.status,
      deployer: deployerHist.status
    });
    const risk = scoreToken(analysis);
    cache.set(address, { analysis, risk, at: Date.now() });
    await saveRecent(analysis, risk);
    return { ok: true, analysis, risk, mock: MOCK_MODE };
  } catch (err) {
    console.error("[CRYPTO-KING] analysis failed:", err);
    return { ok: false, error: "Analysis failed \u2014 data unavailable." };
  }
}
function mergeSources(address, gmgn, solana, pumpfun, auditLpStatus, deployer, sources) {
  let mint = solana.mint;
  if (!mint && (gmgn.mintRenounced !== null || gmgn.freezeRenounced !== null || gmgn.taxBps !== null)) {
    mint = {
      mintAuthorityActive: gmgn.mintRenounced === null ? null : !gmgn.mintRenounced,
      freezeAuthorityActive: gmgn.freezeRenounced !== null ? !gmgn.freezeRenounced : gmgn.isBlacklist === true ? true : null,
      metadataMutable: null,
      isToken2022: pumpfun.isToken2022,
      transferFeeBps: gmgn.taxBps,
      feeAuthorityActive: gmgn.feeAuthorityActive
    };
  } else if (mint) {
    mint = {
      ...mint,
      transferFeeBps: mint.transferFeeBps ?? gmgn.taxBps,
      feeAuthorityActive: mint.feeAuthorityActive ?? gmgn.feeAuthorityActive,
      isToken2022: mint.isToken2022 ?? pumpfun.isToken2022
    };
  }
  const holders = solana.holders || gmgn.top10Pct !== null || gmgn.holderCount !== null ? {
    holderCount: gmgn.holderCount ?? solana.holders?.holderCount ?? null,
    top5Pct: solana.holders?.top5Pct ?? null,
    top10Pct: solana.holders?.top10Pct ?? gmgn.top10Pct,
    largestNonLpWalletPct: solana.holders?.largestNonLpWalletPct ?? null,
    bundledLaunchPct: solana.holders?.bundledLaunchPct ?? gmgn.sniperHoldPct
  } : null;
  const lpStatus = gmgn.lpStatus && gmgn.lpStatus !== "unknown" ? gmgn.lpStatus : auditLpStatus ?? gmgn.lpStatus ?? "unknown";
  const sellSimulation = gmgn.isHoneypot === true ? { ok: false, slippagePct: gmgn.sellSlippagePct } : gmgn.sellSlippagePct !== null ? { ok: true, slippagePct: gmgn.sellSlippagePct } : gmgn.isHoneypot === false ? { ok: true, slippagePct: null } : null;
  const hasMarket = gmgn.marketCapEur !== null || gmgn.liquidityEur !== null || pumpfun.marketCapEur !== null || lpStatus !== "unknown";
  const market = hasMarket ? {
    priceEur: gmgn.priceEur,
    marketCapEur: gmgn.marketCapEur ?? pumpfun.marketCapEur,
    liquidityEur: gmgn.liquidityEur,
    volume24hEur: gmgn.volume24hEur,
    lpStatus,
    sellSimulation
  } : null;
  const behavior = gmgn.behavior ?? (pumpfun.isBanned === true ? {
    volumeSpikeFlatPrice: null,
    manySmallBuysOneHugeSell: null,
    mcapSpikeNoOrganicVolume: null,
    deployerLinkedSelling: null,
    abnormalEarlyVolume: null
  } : null);
  return {
    identity: {
      address,
      symbol: gmgn.symbol ?? pumpfun.symbol,
      name: gmgn.name ?? pumpfun.name,
      chain: "sol",
      ageMinutes: gmgn.ageMinutes ?? pumpfun.ageMinutes,
      logoUri: null
    },
    mint,
    holders,
    market,
    behavior,
    deployer,
    socials: gmgn.socials ?? pumpfun.socials,
    smartMoney: gmgn.smartMoney,
    sources,
    fetchedAt: Date.now()
  };
}
async function loadRecent() {
  const data = await chrome.storage.local.get(RECENT_KEY);
  const list = data[RECENT_KEY];
  return Array.isArray(list) ? list : [];
}
async function saveRecent(analysis, risk) {
  const row = {
    address: analysis.identity.address,
    symbol: analysis.identity.symbol,
    name: analysis.identity.name,
    ageMinutes: analysis.identity.ageMinutes,
    marketCapEur: analysis.market?.marketCapEur ?? null,
    liquidityEur: analysis.market?.liquidityEur ?? null,
    priceEur: analysis.market?.priceEur ?? null,
    riskScore: risk.riskScore,
    signal: risk.signal,
    insufficientData: risk.insufficientData,
    updatedAt: Date.now()
  };
  const recent = await loadRecent();
  const rest = recent.filter((r) => r.address !== row.address);
  await chrome.storage.local.set({ [RECENT_KEY]: [row, ...rest].slice(0, RECENT_MAX) });
}
