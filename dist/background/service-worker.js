// config.ts
var MOCK_MODE = false;
var DEBUG = false;
var EUR_PER_USD = 1;
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
  listEndpoint: "/coins?offset={offset}&limit={limit}&sort=created_timestamp&order=DESC&includeNsfw=false",
  /** Coins previously created by a wallet — powers the serial-deployer check. Unverified path; degrades to null. */
  creatorCoinsEndpoint: "/coins/user-created-coins/{creator}?offset=0&limit=20&includeNsfw=true"
};
var LIVE_FEED = {
  enabled: true,
  /** How many newest coins to pull from the source each poll. */
  fetchCount: 80,
  /**
   * Max NEW coins to risk-scan per poll. Feed scans are LITE — one RPC call
   * (mint/freeze authority, the top rug check) + pump.fun. The default is tuned
   * to move fast on the public RPC without tripping its rate limit; with a
   * Helius key (see SOLANA.rpcUrl) push this to 30–50 for a real firehose.
   */
  scanBudgetPerPoll: 14,
  /** Parallel lite scans per poll (per-host rate limiter still applies). */
  scanConcurrency: 4,
  /** Panel auto-refresh / poll interval in ms. Lower = catch launches sooner
   *  (newest coins are scanned first each poll). 6s is aggressive but safe on
   *  the public RPC with lite scans; drop to 3–4s once you add a Helius key. */
  pollIntervalMs: 6e3,
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
  notifyMaxScore: 39,
  // CONSIDER / NEUTRAL territory
  /** "Low caps only" feed filter threshold (early-stage hunting ground).
   *  💎 gem-grade coins stay visible even above this cap. */
  lowCapMaxEur: 1e5,
  /**
   * 💎 gem-alert threshold: a feed coin pulses gold when risk ≤ notifyMaxScore
   * AND quality ≥ gemMinQuality. An attention aid for candidates worth YOUR
   * research — emphatically not a buy signal.
   */
  gemMinQuality: 30
};
var DEXSCREENER = {
  enabled: true,
  /** Recently-updated token profiles across chains; we filter chainId === 'solana'. */
  latestProfilesUrl: "https://api.dexscreener.com/token-profiles/latest/v1",
  /** Pair lookup — up to ~30 comma-joined pair addresses per call. */
  pairsUrl: "https://api.dexscreener.com/latest/dex/pairs/solana/{pairs}"
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
  /**
   * Extra FREE, no-signup RPC endpoints to spread load across (failover order).
   * The scanner tries the primary first, then these — so one endpoint being
   * rate-limited doesn't stall a scan. Empty by default (the tool works fine on
   * the single public endpoint); paste any keyless Solana RPCs you trust here
   * to speed up without ever creating an account. A Helius key, if set, takes
   * priority over this whole list.
   */
  fallbackRpcUrls: [],
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
var SMART_MONEY_WALLETS = [];
var TRENDING_NARRATIVES = {
  AI: ["ai", "gpt", "agent", "neural", "grok"],
  Dog: ["dog", "doge", "shib", "inu", "wif", "pup"],
  Cat: ["cat", "kitty", "meow"],
  Political: ["trump", "maga", "biden", "election", "president"],
  Celebrity: ["elon", "musk", "kanye", "drake"],
  Frog: ["pepe", "frog", "toad"]
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
  // Live state — the rug already happened / is happening (lib/liveState.ts)
  alreadyDead: 60,
  // liquidity pulled or price collapsed: do not enter
  activelyDumping: 30,
  // falling hard / sells dominating right now
  // Token-2022 trap extensions — the current generation of rug tricks
  permanentDelegate: 30,
  // delegate can SEIZE tokens from any holder wallet
  nonTransferable: 30,
  // soulbound — you cannot sell at all
  defaultAccountFrozen: 25,
  // new holder accounts start frozen
  transferHook: 20,
  // transfers run dev code that can block sells
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
  // Launch-platform reality (applies when the launchpad is identified)
  platformBanned: 30,
  // banned/flagged on its own launch platform
  bondingCurveActive: 10,
  // still on the bonding curve — ultra-early, pre-AMM
  brandNewLaunch: 10,
  // launchpad coin younger than LIMITS.youngAgeMinutes — peak failure window
  // Early-stage concentration: for coins STILL ON THE CURVE, whale thresholds
  // are much lower — a wallet holding 5%+ of total supply minutes after launch
  // is the dev/snipers, and they can dump at any second.
  earlyWhaleWallet: 15,
  // one non-curve wallet ≥ LIMITS.earlyWhalePct this early
  earlyTopConcentration: 10,
  // top-10 non-curve wallets ≥ LIMITS.earlyTop10Pct this early
  // Age & behavior (medium)
  youngTokenAbnormalVolume: 10,
  // age < LIMITS.youngAgeMinutes with abnormal volume
  serialDeployer: 15,
  // creator launched many coins, most dead (see LIMITS.serial*)
  devHoldingsHigh: 10,
  // creator wallet holds ≥ LIMITS.devHoldsPct of supply — can dump on you
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
  smartMoneyStrongWallets: 3,
  serialMinLaunches: 3,
  // serial-deployer factor needs at least this many prior coins…
  serialDeadRatio: 0.7,
  // …with at least this share dead/abandoned
  earlyWhalePct: 5,
  // % of TOTAL supply in one non-curve wallet while still on the curve
  earlyTop10Pct: 15,
  // % of TOTAL supply in top-10 non-curve wallets while on the curve
  devHoldsPct: 5
  // creator holdings at/above this % → devHoldingsHigh risk
};
var WATCHLIST = {
  maxCoins: 10,
  // full re-scans are RPC-heavy; keep the list focused
  pollMinutes: 5,
  alerts: {
    liquidityDropPct: 50,
    // liquidity fell ≥ this % from your baseline
    marketCapDropPct: 60,
    // mcap fell ≥ this % from your baseline
    devSoldPointsDrop: 2,
    // dev holdings fell ≥ this many percentage points
    gradeDrop: 20
    // King Grade fell ≥ this many points
  }
};
var QUALITY_WEIGHTS = {
  smartMoneyStrong: 20,
  // ≥ LIMITS.smartMoneyStrongWallets smart wallets accumulating
  smartMoneyLight: 10,
  verifiedSocials: 10,
  fullSocialPresence: 5,
  // website + twitter + telegram all present
  lpBurned: 15,
  lpLocked: 10,
  authoritiesRevoked: 10,
  // BOTH mint and freeze authority revoked
  healthyDistribution: 10,
  // top-10 holders ≤ QUALITY_LIMITS.healthyTop10Pct
  holderBaseLarge: 10,
  // ≥ QUALITY_LIMITS.largeHolderCount holders
  holderBase: 5,
  // ≥ QUALITY_LIMITS.minHolderCount holders
  liquidityDepth: 10,
  // liq ≥ minLiquidityEur AND liq/mcap ≥ minLiqMcapRatio
  organicVolume: 5,
  // vol24h/mcap inside a sane band
  graduated: 10,
  // bonding curve completed — survived the launchpad
  survived7d: 10,
  survived24h: 5,
  curveTraction: 10,
  // still on the curve but real buyers pushed mcap ≥ curveTractionMinEur
  communityActivity: 5,
  // launchpad comment count ≥ minReplies
  smartWalletStrong: 20,
  // YOUR tracked wallets hold ≥ smartWalletStrongPct of supply
  smartWalletLight: 10,
  // …or ≥ smartWalletLightPct
  provenDeployer: 10
  // creator's prior launches mostly graduated (track record)
};
var QUALITY_LIMITS = {
  healthyTop10Pct: 30,
  minHolderCount: 1e3,
  largeHolderCount: 1e4,
  minLiquidityEur: 3e4,
  minLiqMcapRatio: 0.08,
  volMcapMin: 0.2,
  volMcapMax: 8,
  curveTractionMinEur: 2e4,
  minReplies: 20,
  smartWalletStrongPct: 15,
  smartWalletLightPct: 5,
  minGraduationRate: 0.5,
  // provenDeployer needs ≥ this share of prior launches graduated…
  minLaunchesForProven: 2
  // …across at least this many prior launches
};
var OUTCOME_LEDGER = {
  enabled: true,
  /** Re-check a graded coin after this many hours. */
  recheckAfterHours: 24,
  /** Max predictions kept (rolling). */
  maxEntries: 400,
  /** mcap ratio ≤ this vs baseline = rugged. */
  ruggedRatio: 0.25,
  /** ≤ this = faded. */
  fadedRatio: 0.7,
  /** ≥ this = winner. */
  winnerRatio: 2
};
var LIVE_STATE = {
  /** Liquidity below this (USD) on a listed coin = effectively pulled. */
  deadLiquidityUsd: 1500,
  /** Price change ≤ this % (6h or 24h) = the collapse already happened. */
  deadDropPct: -70,
  /** Price change ≤ this % (1h or 6h) = actively dumping. */
  dumpingDropPct: -30,
  /** Sells > buys × this (1h) = holders exiting. */
  sellDominanceRatio: 1.8,
  /** Minimum 1h transactions before buy/sell flow is meaningful. */
  minTxnsForFlow: 15
};
var KING_GRADE = {
  safetyWeight: 0.5,
  // (100 - riskScore) share
  qualityWeight: 0.3,
  // qualityScore share
  coverageWeight: 0.2,
  // % of the 10 audit checks actually verified
  caps: {
    confirmedTrap: 10,
    // active mint/freeze auth, trap extension, honeypot, deployer-held LP
    highRisk: 15,
    // riskScore ≥ 60
    onBondingCurve: 40,
    // dev/insiders can dump any second
    partialData: 50,
    // holders or LP not verified yet
    noGemPass: 79
    // 80%+ is reserved for coins that passed the full background check
  }
};
var GRADE_META = [
  { min: 80, label: "GEM GRADE", color: "#d4a017", textColor: "#1b1b18" },
  { min: 60, label: "STRONG", color: "#46a758", textColor: "#ffffff" },
  { min: 40, label: "MIXED", color: "#ffb224", textColor: "#1b1b18" },
  { min: 20, label: "WEAK", color: "#f76b15", textColor: "#ffffff" },
  { min: 0, label: "AVOID", color: "#e5484d", textColor: "#ffffff" }
];
var GEM_CRITERIA = {
  /** Must be OFF the bonding curve (graduated) — on-curve devs can dump any second. */
  requireGraduated: true,
  /** LP must be burned or locked. */
  requireLpSecured: true,
  /** No single non-LP wallet may hold more than this % of supply. */
  maxLargestWalletPct: 10
  /** Risk score must be at or below LIVE_FEED.notifyMaxScore, quality at or above LIVE_FEED.gemMinQuality. */
};
var MITIGATION_CAP = 15;
var SIGNAL_THRESHOLDS = [
  { min: 80, signal: "AVOID" },
  { min: 60, signal: "HIGH_RISK" },
  { min: 40, signal: "WATCH" },
  { min: 20, signal: "CONSIDER" },
  { min: 0, signal: "NEUTRAL" }
];

// lib/outcomeLedger.ts
function classifyOutcome(baselineMcap, nowMcap, isDead, t = OUTCOME_LEDGER) {
  if (isDead) return "RUGGED";
  if (baselineMcap === null || nowMcap === null || baselineMcap <= 0) return "PENDING";
  const ratio = nowMcap / baselineMcap;
  if (ratio <= t.ruggedRatio) return "RUGGED";
  if (ratio <= t.fadedRatio) return "FADED";
  if (ratio >= t.winnerRatio) return "WINNER";
  return "SURVIVED";
}
function computeAccuracy(entries) {
  const defs = [
    { band: "80\u2013100% (gem grade)", min: 80, max: 101 },
    { band: "60\u201379% (strong)", min: 60, max: 80 },
    { band: "40\u201359% (mixed)", min: 40, max: 60 },
    { band: "0\u201339% (weak/avoid)", min: 0, max: 40 }
  ];
  let pending = 0;
  let totalChecked = 0;
  const bands = defs.map((d) => ({
    band: d.band,
    total: 0,
    rugged: 0,
    faded: 0,
    survived: 0,
    winners: 0,
    survivalPct: 0
  }));
  for (const e of entries) {
    if (!e.outcome || e.outcome === "PENDING" || e.grade === null) {
      pending++;
      continue;
    }
    const i = defs.findIndex((d) => e.grade >= d.min && e.grade < d.max);
    if (i < 0) continue;
    const b = bands[i];
    b.total++;
    totalChecked++;
    if (e.outcome === "RUGGED") b.rugged++;
    else if (e.outcome === "FADED") b.faded++;
    else if (e.outcome === "SURVIVED") b.survived++;
    else if (e.outcome === "WINNER") b.winners++;
  }
  for (const b of bands) {
    b.survivalPct = b.total > 0 ? Math.round((b.total - b.rugged) / b.total * 100) : 0;
  }
  return { bands, totalChecked, pending };
}

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
    feeAuthorityActive: false,
    permanentDelegateActive: false,
    transferHookActive: false,
    defaultAccountFrozen: false,
    nonTransferable: false
  },
  holders: {
    holderCount: 3100,
    top5Pct: 68,
    top10Pct: 72,
    // +15
    largestNonLpWalletPct: 18,
    bundledLaunchPct: 10,
    smartMoneyPct: null,
    devHoldsPct: null
  },
  market: {
    priceEur: 31e-5,
    marketCapEur: 3e5,
    liquidityEur: 6e4,
    volume24hEur: 41e4,
    lpStatus: "deployer_held",
    // +20
    sellSimulation: { ok: true, slippagePct: 12 },
    priceChange1h: null,
    priceChange6h: null,
    priceChange24h: null,
    buys1h: null,
    sells1h: null
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false
  },
  deployer: { priorRugs: 0, fundingSource: "cex", priorLaunches: null, priorDeadLaunches: null, graduatedLaunches: null },
  socials: { website: null, twitter: null, telegram: null, verified: null },
  // +10 no socials
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  launch: null,
  // launchpad factors don't apply to fixtures — keeps the walkthrough arithmetic exact
  narratives: [],
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
    feeAuthorityActive: false,
    permanentDelegateActive: false,
    transferHookActive: false,
    defaultAccountFrozen: false,
    nonTransferable: false
  },
  holders: {
    holderCount: 5400,
    top5Pct: 58,
    top10Pct: 65,
    // +15
    largestNonLpWalletPct: 11,
    bundledLaunchPct: 9,
    smartMoneyPct: null,
    devHoldsPct: null
  },
  market: {
    priceEur: 14e-4,
    marketCapEur: 72e4,
    // +10 with thin liquidity below
    liquidityEur: 38e3,
    volume24hEur: 95e4,
    lpStatus: "burned",
    sellSimulation: { ok: true, slippagePct: 6 },
    priceChange1h: null,
    priceChange6h: null,
    priceChange24h: null,
    buys1h: null,
    sells1h: null
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: true
  },
  deployer: { priorRugs: 0, fundingSource: "cex", priorLaunches: null, priorDeadLaunches: null, graduatedLaunches: null },
  socials: { website: "https://wifcat.example", twitter: "https://x.com/wifcat", telegram: null, verified: false },
  // +5
  smartMoney: { accumulating: false, exiting: false, walletCount: 0 },
  launch: null,
  // launchpad factors don't apply to fixtures — keeps the walkthrough arithmetic exact
  narratives: [],
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
    feeAuthorityActive: false,
    permanentDelegateActive: false,
    transferHookActive: false,
    defaultAccountFrozen: false,
    nonTransferable: false
  },
  holders: {
    holderCount: 18200,
    top5Pct: 15,
    top10Pct: 24,
    largestNonLpWalletPct: 4.5,
    bundledLaunchPct: 2,
    smartMoneyPct: null,
    devHoldsPct: null
  },
  market: {
    priceEur: 0.021,
    marketCapEur: 19e5,
    liquidityEur: 26e4,
    volume24hEur: 78e4,
    lpStatus: "burned",
    sellSimulation: { ok: true, slippagePct: 2 },
    priceChange1h: null,
    priceChange6h: null,
    priceChange24h: null,
    buys1h: null,
    sells1h: null
  },
  behavior: {
    volumeSpikeFlatPrice: false,
    manySmallBuysOneHugeSell: false,
    mcapSpikeNoOrganicVolume: false,
    deployerLinkedSelling: false,
    abnormalEarlyVolume: false
  },
  deployer: { priorRugs: 0, fundingSource: "cex", priorLaunches: null, priorDeadLaunches: null, graduatedLaunches: null },
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
  narratives: [],
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
  const host = hostOf(url);
  let st = hostState.get(host);
  if (!st) {
    st = { nextAt: 0, chain: Promise.resolve() };
    hostState.set(host, st);
  }
  const run = st.chain.then(async () => {
    const wait = st.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    st.nextAt = Date.now() + rateLimitFor(host);
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
  st.chain = run.catch(() => void 0);
  return run;
}
async function rpcCall(rpcUrl, method, params) {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  const body = JSON.stringify({ jsonrpc: "2.0", id: "crypto-king", method, params });
  for (const url of urls) {
    const json = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    if (json && typeof json === "object" && "result" in json) {
      return json.result ?? null;
    }
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
      priceEur: f.market?.priceEur ?? null,
      bondingCurveComplete: true,
      isBanned: false,
      isToken2022: f.mint?.isToken2022 ?? null,
      creator: null,
      socials: f.socials,
      replyCount: null,
      bondingCurveAccounts: []
    };
  }
  if (!PUMPFUN.enabled) return { ...EMPTY, status: "disabled" };
  const url = `${PUMPFUN.baseUrl}${PUMPFUN.coinEndpoint.replace("{address}", address)}`;
  const json = await fetchJson(url);
  if (json === null) return { ...EMPTY, status: "unavailable" };
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
    // USD ONLY: pump.fun's `market_cap` is denominated in SOL — using it as USD
    // was showing ~$30–70 for real coins. `usd_market_cap` is the dollar value.
    marketCapEur: usdToEur(asNumber(pick(json, ["usd_market_cap", "market_cap_usd"]))),
    priceEur: derivePriceEur(
      asNumber(pick(json, ["usd_market_cap", "market_cap_usd"])),
      asNumber(pick(json, ["total_supply"]))
    ),
    bondingCurveComplete: asBoolLoose(pick(json, ["complete"])),
    isBanned: asBoolLoose(pick(json, ["is_banned"])),
    isToken2022: tokenProgram !== null ? tokenProgram === TOKEN_2022_PROGRAM : null,
    creator: asString(pick(json, ["creator"])),
    // The coin object DID load, so absent links are KNOWLEDGE ("has no
    // socials"), not a data gap — return the object with nulls, never null.
    socials: { website, twitter, telegram, verified: null },
    replyCount: asNumber(pick(json, ["reply_count"])),
    bondingCurveAccounts: [
      asString(pick(json, ["bonding_curve"])),
      asString(pick(json, ["associated_bonding_curve"])),
      asString(pick(json, ["pool_address"]))
    ].filter((s) => s !== null)
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
async function fetchCreatorCoins(creator) {
  if (MOCK_MODE || !PUMPFUN.enabled) return null;
  const path = PUMPFUN.creatorCoinsEndpoint.replace("{creator}", creator);
  const json = await fetchJson(`${PUMPFUN.baseUrl}${path}`);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.coins) ? json.coins : null;
  if (!arr) return null;
  const out = [];
  for (const c of arr) {
    const mint = asString(pick(c, ["mint", "address"]));
    if (!mint) continue;
    out.push({
      mint,
      createdMs: asNumber(pick(c, ["created_timestamp"])),
      usdMarketCap: asNumber(pick(c, ["usd_market_cap", "market_cap"])),
      complete: asBoolLoose(pick(c, ["complete"]))
    });
  }
  return out;
}
var usdToEur = (v) => v === null ? null : v * EUR_PER_USD;
function derivePriceEur(usdMarketCap, totalSupplyRaw) {
  if (usdMarketCap === null || totalSupplyRaw === null || totalSupplyRaw <= 0) return null;
  const tokens = totalSupplyRaw > 1e12 ? totalSupplyRaw / 1e6 : totalSupplyRaw;
  if (tokens <= 0) return null;
  return usdMarketCap / tokens * EUR_PER_USD;
}
function asBoolLoose(v) {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  return null;
}
var EMPTY = {
  status: "unavailable",
  symbol: null,
  name: null,
  ageMinutes: null,
  marketCapEur: null,
  priceEur: null,
  bondingCurveComplete: null,
  isBanned: null,
  isToken2022: null,
  creator: null,
  socials: null,
  replyCount: null,
  bondingCurveAccounts: []
};

// lib/deployerClient.ts
var nullDeployerAdapter = {
  async fetchDeployerHistory() {
    return {
      status: "disabled",
      deployer: {
        priorRugs: null,
        fundingSource: "unknown",
        priorLaunches: null,
        priorDeadLaunches: null,
        graduatedLaunches: null
      }
    };
  }
};
var pumpfunDeployerAdapter = {
  async fetchDeployerHistory(tokenAddress, creatorAddress) {
    if (!creatorAddress) return nullDeployerAdapter.fetchDeployerHistory(tokenAddress, creatorAddress);
    const coins = await fetchCreatorCoins(creatorAddress);
    if (coins === null) return nullDeployerAdapter.fetchDeployerHistory(tokenAddress, creatorAddress);
    const dayAgo = Date.now() - 24 * 60 * 6e4;
    const prior = coins.filter((c) => c.mint !== tokenAddress);
    const dead = prior.filter(
      (c) => c.complete === false && (c.usdMarketCap ?? 0) < 1e4 && c.createdMs !== null && c.createdMs < dayAgo
    );
    const graduated = prior.filter((c) => c.complete === true);
    return {
      status: "ok",
      deployer: {
        priorRugs: null,
        // we never claim "rug" from launch records alone
        fundingSource: "unknown",
        priorLaunches: prior.length,
        priorDeadLaunches: dead.length,
        graduatedLaunches: graduated.length
      }
    };
  }
};

// lib/dexscreenerClient.ts
var BASE58_RE2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function fetchPairBaseTokens(pairAddresses) {
  const out = {};
  if (MOCK_MODE || !DEXSCREENER.enabled || pairAddresses.length === 0) return out;
  for (let i = 0; i < pairAddresses.length; i += 30) {
    const chunk = pairAddresses.slice(i, i + 30);
    const json = await fetchJson(DEXSCREENER.pairsUrl.replace("{pairs}", chunk.join(",")));
    const pairs = json?.pairs;
    if (!Array.isArray(pairs)) continue;
    for (const p of pairs) {
      const pairAddr = asString(pick(p, ["pairAddress"]));
      const base = asString(pick(p, ["baseToken.address"]));
      if (pairAddr && base && BASE58_RE2.test(base)) {
        out[pairAddr] = { address: base, symbol: asString(pick(p, ["baseToken.symbol"])) };
      }
    }
  }
  return out;
}
async function fetchDexscreenerToken(mint) {
  if (MOCK_MODE || !DEXSCREENER.enabled || !BASE58_RE2.test(mint)) return null;
  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const pairs = json?.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  let best = null;
  let bestLiq = -1;
  for (const p of pairs) {
    if (asString(pick(p, ["chainId"])) !== "solana") continue;
    const liq = asNumber(pick(p, ["liquidity.usd"])) ?? 0;
    if (liq > bestLiq) {
      bestLiq = liq;
      best = p;
    }
  }
  if (!best) return null;
  return {
    priceUsd: asNumber(pick(best, ["priceUsd"])),
    marketCapUsd: asNumber(pick(best, ["marketCap", "fdv"])),
    liquidityUsd: asNumber(pick(best, ["liquidity.usd"])),
    volume24hUsd: asNumber(pick(best, ["volume.h24"])),
    priceChange5m: asNumber(pick(best, ["priceChange.m5"])),
    priceChange1h: asNumber(pick(best, ["priceChange.h1"])),
    priceChange6h: asNumber(pick(best, ["priceChange.h6"])),
    priceChange24h: asNumber(pick(best, ["priceChange.h24"])),
    buys1h: asNumber(pick(best, ["txns.h1.buys"])),
    sells1h: asNumber(pick(best, ["txns.h1.sells"])),
    symbol: asString(pick(best, ["baseToken.symbol"])),
    name: asString(pick(best, ["baseToken.name"])),
    pairCreatedMs: asNumber(pick(best, ["pairCreatedAt"]))
  };
}
async function fetchDexscreenerNewSolana(limit) {
  if (MOCK_MODE || !DEXSCREENER.enabled) return [];
  const json = await fetchJson(DEXSCREENER.latestProfilesUrl);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.profiles) ? json.profiles : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of arr) {
    const chain = asString(pick(item, ["chainId", "chain"]));
    if (chain !== "solana") continue;
    const addr = asString(pick(item, ["tokenAddress", "address"]));
    if (!addr || !BASE58_RE2.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
    if (out.length >= limit) break;
  }
  return out;
}

// lib/liveState.ts
function assessLiveState(market, t = LIVE_STATE) {
  if (!market) return { state: "UNKNOWN", reasons: ["No market data."] };
  const reasons = [];
  const { priceChange1h: h1, priceChange6h: h6, priceChange24h: h24, liquidityEur: liq, marketCapEur: mcap } = market;
  const haveMomentum = h1 !== null || h6 !== null || h24 !== null;
  let dead = false;
  if (liq !== null && liq < t.deadLiquidityUsd && (mcap === null || mcap > t.deadLiquidityUsd)) {
    dead = true;
    reasons.push(`Liquidity is only $${Math.round(liq)} \u2014 effectively pulled; you could not exit.`);
  }
  if (h24 !== null && h24 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h24))}% in 24h \u2014 this already collapsed.`);
  }
  if (h6 !== null && h6 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h \u2014 collapse in progress/complete.`);
  }
  if (dead) return { state: "DEAD", reasons };
  if (h1 !== null && h1 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h1))}% in the last hour \u2014 actively dumping.`);
  }
  if (h6 !== null && h6 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h \u2014 sustained bleed.`);
  }
  const { buys1h: buys, sells1h: sells } = market;
  if (buys !== null && sells !== null && buys + sells >= t.minTxnsForFlow && sells > buys * t.sellDominanceRatio) {
    reasons.push(`Sells dominating (${sells} sells vs ${buys} buys in 1h) \u2014 holders exiting.`);
  }
  if (reasons.length > 0) return { state: "DUMPING", reasons };
  if (!haveMomentum) return { state: "UNKNOWN", reasons: ["No price-momentum data yet (unlisted/too fresh)."] };
  return { state: "HEALTHY", reasons: [] };
}

// lib/gemCriteria.ts
function gemBackgroundCheck(a, risk, quality) {
  const blockers = [];
  if (risk.insufficientData || quality.insufficientData) {
    blockers.push("Not enough data for a background check.");
    return { gem: false, blockers };
  }
  if (risk.riskScore > LIVE_FEED.notifyMaxScore) {
    blockers.push(`Risk score ${risk.riskScore} above the ${LIVE_FEED.notifyMaxScore} gate.`);
  }
  if (quality.qualityScore < LIVE_FEED.gemMinQuality) {
    blockers.push(`Quality ${quality.qualityScore} below the ${LIVE_FEED.gemMinQuality} gate.`);
  }
  if (GEM_CRITERIA.requireGraduated && a.launch?.bondingCurveComplete === false) {
    blockers.push("Still on the bonding curve \u2014 dev/insiders can dump at any moment.");
  }
  const lp = a.market?.lpStatus ?? "unknown";
  if (GEM_CRITERIA.requireLpSecured && lp !== "burned" && lp !== "locked") {
    blockers.push(lp === "unknown" ? "LP status not verified yet." : `LP not secured (${lp.replace("_", " ")}).`);
  }
  const largest = a.holders?.largestNonLpWalletPct ?? null;
  if (largest === null) {
    blockers.push("Holder distribution not verified yet.");
  } else if (largest > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`A single wallet holds ${largest.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (a.launch?.platform === "pumpfun" && dev === null) {
    blockers.push("Dev wallet holdings not verified yet \u2014 cannot clear it as gem grade.");
  } else if (dev !== null && dev > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`Dev wallet holds ${dev.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") {
    blockers.push(`Already rugged/dead: ${live.reasons[0] ?? "market collapsed."}`);
  } else if (live.state === "DUMPING") {
    blockers.push(`Dumping right now: ${live.reasons[0] ?? "price falling hard."}`);
  }
  if (a.deployer === null || a.deployer.priorLaunches === null && a.launch?.platform === "pumpfun") {
    blockers.push("Creator's launch history not checked yet.");
  }
  return { gem: blockers.length === 0, blockers };
}

// lib/kingGrade.ts
var known = (v) => v !== null && v !== void 0;
function computeKingGrade(a, risk, quality) {
  if (risk.insufficientData) {
    return { grade: null, label: "NO DATA", caps: [], parts: { safety: 0, quality: 0, coveragePct: 0 } };
  }
  const checks = [
    known(a.mint?.mintAuthorityActive),
    known(a.mint?.freezeAuthorityActive),
    known(a.mint?.permanentDelegateActive),
    // Token-2022 trap extensions readable
    known(a.mint?.metadataMutable),
    a.market !== null && a.market.lpStatus !== "unknown",
    known(a.holders?.top10Pct),
    known(a.holders?.largestNonLpWalletPct),
    a.market?.sellSimulation != null,
    known(a.deployer?.priorLaunches),
    a.socials !== null
  ];
  const coveragePct = checks.filter(Boolean).length / checks.length * 100;
  const safety = 100 - risk.riskScore;
  const raw = Math.min(
    100,
    Math.max(
      0,
      KING_GRADE.safetyWeight * safety + KING_GRADE.qualityWeight * quality.qualityScore + KING_GRADE.coverageWeight * coveragePct
    )
  );
  const caps = [];
  let ceiling = 100;
  const applyCap = (limit, why) => {
    if (limit < ceiling) ceiling = limit;
    if (raw > limit) caps.push(`Ceiling ${limit}%: ${why}`);
  };
  const confirmedTrap = a.mint?.mintAuthorityActive === true || a.mint?.freezeAuthorityActive === true || a.mint?.permanentDelegateActive === true || a.mint?.nonTransferable === true || a.mint?.defaultAccountFrozen === true || a.market?.sellSimulation?.ok === false || a.market?.lpStatus === "deployer_held";
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") applyCap(KING_GRADE.caps.confirmedTrap, "already rugged/dead \u2014 market collapsed.");
  else if (live.state === "DUMPING") applyCap(KING_GRADE.caps.highRisk, "dumping right now.");
  if (confirmedTrap) applyCap(KING_GRADE.caps.confirmedTrap, "confirmed trap/rug mechanic present.");
  if (risk.riskScore >= 60) applyCap(KING_GRADE.caps.highRisk, "risk score 60+.");
  if (a.launch?.bondingCurveComplete === false) {
    applyCap(KING_GRADE.caps.onBondingCurve, "still on the bonding curve \u2014 dev can dump any second.");
  }
  if (!known(a.holders?.largestNonLpWalletPct) || a.market === null || a.market.lpStatus === "unknown") {
    applyCap(KING_GRADE.caps.partialData, "holders/LP not verified yet \u2014 run the full scan.");
  }
  if (!gemBackgroundCheck(a, risk, quality).gem) {
    applyCap(KING_GRADE.caps.noGemPass, "80%+ is reserved for coins that pass the full background check.");
  }
  let gradeF;
  if (raw <= ceiling) {
    gradeF = raw;
  } else {
    const band = Math.min(22, ceiling);
    gradeF = ceiling - band + band * ((raw - ceiling) / (100 - ceiling));
  }
  const grade = Math.round(Math.min(ceiling, Math.max(0, gradeF)));
  return { grade, label: gradeLabel(grade), caps, parts: { safety, quality: quality.qualityScore, coveragePct } };
}
function gradeLabel(grade) {
  if (grade === null) return "NO DATA";
  for (const bucket of GRADE_META) if (grade >= bucket.min) return bucket.label;
  return "AVOID";
}

// lib/narratives.ts
function matchNarratives(name, symbol, table = TRENDING_NARRATIVES) {
  const haystack = `${name ?? ""} ${symbol ?? ""}`.toLowerCase();
  if (haystack.trim() === "") return [];
  const out = [];
  for (const [narrative, keywords] of Object.entries(table)) {
    if (keywords.some((kw) => haystack.includes(kw.toLowerCase()))) out.push(narrative);
  }
  return out;
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
  const out = { ...EMPTY2 };
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
    out.liquidityEur = usdToEur2(asNumber(pick(tokenInfo, ["liquidity"])));
    const createdSec = asNumber(pick(tokenInfo, ["creation_timestamp", "open_timestamp"]));
    if (createdSec !== null) out.ageMinutes = Math.max(0, (Date.now() / 1e3 - createdSec) / 60);
  }
  if (preview !== null) {
    out.symbol = asString(pick(preview, ["symbol", "token.symbol"]));
    out.name = asString(pick(preview, ["name", "token.name"]));
    out.marketCapEur = usdToEur2(asNumber(pick(preview, ["mc", "market_cap", "usd_market_cap"])));
    out.priceEur = usdToEur2(asNumber(pick(preview, ["price", "usd_price"])));
    out.volume24hEur = usdToEur2(asNumber(pick(preview, ["volume_24h", "volume24h", "v24h"])));
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
var usdToEur2 = (v) => v === null ? null : v * EUR_PER_USD;
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
function emptyGmgnData() {
  return { ...EMPTY2 };
}
var EMPTY2 = {
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

// lib/qualityScorer.ts
var GRAD_CAP_EUR = 63e3;
function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}
function scoreQuality(a, w = QUALITY_WEIGHTS, l = QUALITY_LIMITS) {
  const reasons = [];
  const hit = (points, text) => reasons.push({ points, text });
  const insufficientData = a.mint === null && a.market === null && a.holders === null;
  if (insufficientData) {
    return { qualityScore: 0, reasons, insufficientData: true };
  }
  const sm = a.smartMoney;
  const trackedPct = a.holders?.smartMoneyPct ?? null;
  if (sm?.accumulating === true && sm.exiting !== true) {
    const strong = sm.walletCount !== null && sm.walletCount >= 3;
    hit(
      strong ? w.smartMoneyStrong : w.smartMoneyLight,
      `Smart-money wallets accumulating${sm.walletCount ? ` (${sm.walletCount})` : ""}.`
    );
  } else if (trackedPct !== null && trackedPct >= l.smartWalletLightPct) {
    const strong = trackedPct >= l.smartWalletStrongPct;
    hit(
      strong ? w.smartWalletStrong : w.smartWalletLight,
      `Your tracked wallets hold ${trackedPct.toFixed(1)}% of supply.`
    );
  }
  const d = a.deployer;
  if (d?.priorLaunches !== null && d?.priorLaunches !== void 0 && d.graduatedLaunches !== null && d.priorLaunches >= l.minLaunchesForProven && d.graduatedLaunches / d.priorLaunches >= l.minGraduationRate) {
    hit(w.provenDeployer, `Creator track record: ${d.graduatedLaunches}/${d.priorLaunches} prior launches graduated.`);
  }
  const s = a.socials;
  if (s?.verified === true) hit(w.verifiedSocials, "Verified website/Twitter/Telegram.");
  if (s && s.website && s.twitter && s.telegram) {
    hit(w.fullSocialPresence, "Full social presence (site + Twitter + Telegram).");
  }
  const lp = a.market?.lpStatus;
  if (lp === "burned") hit(w.lpBurned, "LP burned \u2014 liquidity cannot be pulled.");
  else if (lp === "locked") hit(w.lpLocked, "LP locked with a third-party locker.");
  if (a.mint?.mintAuthorityActive === false && a.mint?.freezeAuthorityActive === false) {
    hit(w.authoritiesRevoked, "Mint AND freeze authority revoked.");
  }
  const h = a.holders;
  if (h?.top10Pct !== null && h?.top10Pct !== void 0 && h.top10Pct <= l.healthyTop10Pct) {
    hit(w.healthyDistribution, `Healthy distribution \u2014 top 10 hold only ${h.top10Pct.toFixed(0)}%.`);
  }
  if (h?.holderCount !== null && h?.holderCount !== void 0) {
    if (h.holderCount >= l.largeHolderCount) hit(w.holderBaseLarge, `${h.holderCount.toLocaleString()} holders.`);
    else if (h.holderCount >= l.minHolderCount) hit(w.holderBase, `${h.holderCount.toLocaleString()} holders.`);
  }
  const m = a.market;
  if (m?.liquidityEur !== null && m?.liquidityEur !== void 0 && m.marketCapEur !== null) {
    if (m.liquidityEur >= l.minLiquidityEur && m.liquidityEur / m.marketCapEur >= l.minLiqMcapRatio) {
      hit(w.liquidityDepth, `Real liquidity depth (\u20AC${Math.round(m.liquidityEur / 1e3)}k, ${(m.liquidityEur / m.marketCapEur * 100).toFixed(0)}% of cap).`);
    }
    if (m.volume24hEur !== null && m.marketCapEur > 0) {
      const ratio = m.volume24hEur / m.marketCapEur;
      if (ratio >= l.volMcapMin && ratio <= l.volMcapMax) {
        hit(w.organicVolume, "Volume/market-cap ratio in a healthy band.");
      }
    }
  }
  if (a.launch?.bondingCurveComplete === true) {
    hit(w.graduated, "Graduated its bonding curve \u2014 survived the launchpad.");
  } else if (a.launch?.bondingCurveComplete === false && a.market?.marketCapEur != null) {
    const progress = Math.min(1, a.market.marketCapEur / GRAD_CAP_EUR);
    const pts = Math.round(w.curveTraction * progress);
    if (pts > 0) {
      hit(pts, `Curve traction: \u20AC${fmtK(a.market.marketCapEur)} cap (~${Math.round(progress * 100)}% to graduation).`);
    }
  }
  if (a.launch?.replyCount !== null && a.launch?.replyCount !== void 0 && a.launch.replyCount >= l.minReplies) {
    hit(w.communityActivity, `Active launchpad community (${a.launch.replyCount} comments).`);
  }
  const age = a.identity.ageMinutes;
  if (age !== null) {
    if (age >= 7 * 1440) hit(w.survived7d, "Survived 7+ days with data intact.");
    else if (age >= 1440) hit(w.survived24h, "Survived 24+ hours.");
  }
  reasons.sort((x, y) => y.points - x.points);
  const qualityScore = Math.min(
    100,
    Math.max(0, Math.round(reasons.reduce((sum, r) => sum + r.points, 0)))
  );
  return { qualityScore, reasons, insufficientData: false };
}

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
    if (mint.permanentDelegateActive === true) {
      hit(w.permanentDelegate, "PERMANENT DELEGATE set \u2014 the dev can seize tokens out of your wallet.");
    }
    if (mint.nonTransferable === true) {
      hit(w.nonTransferable, "Token is NON-TRANSFERABLE (soulbound) \u2014 you cannot sell at all.");
    }
    if (mint.defaultAccountFrozen === true) {
      hit(w.defaultAccountFrozen, "New holder accounts start FROZEN \u2014 classic modern honeypot setup.");
    }
    if (mint.transferHookActive === true) {
      hit(w.transferHook, "Transfer hook installed \u2014 transfers run dev code that can block sells.");
    }
    if (mint.isToken2022 === true && (mint.permanentDelegateActive === null || mint.transferHookActive === null)) {
      gap("Token-2022 extension traps (permanent delegate / transfer hook) could not be read.");
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
          `Thin liquidity (\u20AC${fmtK2(market.liquidityEur)}) vs. cap (\u20AC${fmtK2(market.marketCapEur)}) \u2014 easy to manipulate.`
        );
      }
      if (market.marketCapEur < l.microMcapEur && lpSecured === false) {
        hit(w.microMcapUnlockedLp, `Micro cap (\u20AC${fmtK2(market.marketCapEur)}) with unsecured LP \u2014 high rug exposure.`);
      }
    } else {
      gap("Liquidity/market-cap figures incomplete.");
    }
  }
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") {
    hit(w.alreadyDead, `ALREADY RUGGED/DEAD \u2014 ${live.reasons[0] ?? "market collapsed."}`);
  } else if (live.state === "DUMPING") {
    hit(w.activelyDumping, `DUMPING NOW \u2014 ${live.reasons[0] ?? "price falling hard."}`);
  } else if (live.state === "UNKNOWN" && a.market !== null) {
    gap("Live price momentum unavailable \u2014 cannot tell if it is already dumping.");
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
    if (h.devHoldsPct !== null && h.devHoldsPct >= l.devHoldsPct) {
      hit(w.devHoldingsHigh, `Dev wallet holds ${h.devHoldsPct.toFixed(1)}% of supply \u2014 can dump on holders.`);
    }
    if (h.bundledLaunchPct !== null && h.bundledLaunchPct > l.bundledPct) {
      hit(
        w.bundledLaunch,
        `${h.bundledLaunchPct.toFixed(0)}% of supply was bundled/sniped at launch by wallets funded from one source.`
      );
    }
  }
  const launch = a.launch;
  if (launch) {
    if (launch.bannedOnPlatform === true) {
      hit(w.platformBanned, "Banned/flagged on its own launch platform.");
    }
    if (launch.bondingCurveComplete === false) {
      hit(w.bondingCurveActive, "Still on the launch bonding curve \u2014 ultra-early, most such coins fail.");
    }
    if (a.identity.ageMinutes !== null && a.identity.ageMinutes < l.youngAgeMinutes) {
      hit(
        w.brandNewLaunch,
        `Brand-new launch (${Math.round(a.identity.ageMinutes)} min) \u2014 the peak rug/failure window.`
      );
    }
    if (launch.bondingCurveComplete === false && a.holders) {
      const lw = a.holders.largestNonLpWalletPct;
      if (lw !== null && lw >= l.earlyWhalePct) {
        hit(w.earlyWhaleWallet, `One wallet already grabbed ${lw.toFixed(1)}% of total supply this early \u2014 dev/sniper dump risk.`);
      }
      const t10 = a.holders.top10Pct;
      if (t10 !== null && t10 >= l.earlyTop10Pct) {
        hit(w.earlyTopConcentration, `Top wallets already hold ${t10.toFixed(1)}% of supply this early.`);
      }
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
    if (d.priorLaunches !== null && d.priorDeadLaunches !== null && d.priorLaunches >= l.serialMinLaunches && d.priorDeadLaunches / d.priorLaunches >= l.serialDeadRatio) {
      hit(
        w.serialDeployer,
        `Serial launcher \u2014 creator has ${d.priorLaunches} prior coins, ${d.priorDeadLaunches} dead/abandoned.`
      );
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
function fmtK2(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}

// lib/rugPotential.ts
function assessRugPotential(a, risk) {
  const hard = [];
  const soft = [];
  const unverified = [];
  const mint = a.mint;
  if (!mint) {
    unverified.push("mint/freeze authority");
  } else {
    if (mint.mintAuthorityActive === true) hard.push("Supply can be inflated (mint authority active).");
    if (mint.freezeAuthorityActive === true) hard.push("Your wallet can be frozen (freeze authority active).");
    if (mint.permanentDelegateActive === true) hard.push("Dev can seize tokens (permanent delegate).");
    if (mint.nonTransferable === true) hard.push("Token is soulbound \u2014 you cannot sell.");
    if (mint.defaultAccountFrozen === true) hard.push("New holder accounts start frozen.");
    if (mint.transferHookActive === true) hard.push("Transfers run dev code that can block sells.");
    if (mint.mintAuthorityActive === null) unverified.push("mint authority");
    if (mint.freezeAuthorityActive === null) unverified.push("freeze authority");
  }
  const sim = a.market?.sellSimulation;
  if (sim?.ok === false) hard.push("Simulated sell FAILS \u2014 honeypot behavior.");
  const lp = a.market?.lpStatus ?? "unknown";
  if (lp === "deployer_held") hard.push("Deployer holds the LP \u2014 liquidity can be pulled in one transaction.");
  else if (lp === "unlocked") soft.push("LP not burned/locked \u2014 liquidity can be pulled.");
  else if (lp === "unknown") unverified.push("LP burn/lock status");
  if (a.launch?.bondingCurveComplete === false) {
    soft.push("Still on the bonding curve \u2014 insiders can dump at any moment.");
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev >= LIMITS.devHoldsPct) soft.push(`Dev wallet holds ${dev.toFixed(1)}% \u2014 positioned to dump.`);
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > GEM_CRITERIA.maxLargestWalletPct) {
    soft.push(`A single wallet holds ${whale.toFixed(1)}% \u2014 one seller from a crash.`);
  }
  if (whale === null) unverified.push("holder concentration");
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) {
    hard.push("Creator is a serial launcher with mostly dead coins.");
  }
  let verdict;
  if (hard.length > 0) verdict = "HIGH";
  else if (soft.length >= 2) verdict = "HIGH";
  else if (soft.length === 1) verdict = "POSSIBLE";
  else if (unverified.length > 0) verdict = "UNVERIFIED";
  else verdict = "LOW";
  return { verdict, vectors: [...hard, ...soft], unverified };
}

// lib/settings.ts
var KEY = "ck:settings";
var current = { heliusKey: null, xBearerToken: null };
var clean = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
async function loadSettings() {
  const d = await chrome.storage.local.get(KEY);
  const s = d[KEY];
  if (s) current = { heliusKey: clean(s.heliusKey), xBearerToken: clean(s.xBearerToken) };
}
async function setSettings(patch) {
  current = {
    heliusKey: "heliusKey" in patch ? clean(patch.heliusKey) : current.heliusKey,
    xBearerToken: "xBearerToken" in patch ? clean(patch.xBearerToken) : current.xBearerToken
  };
  await chrome.storage.local.set({ [KEY]: current });
  return current;
}
function getSettings() {
  return current;
}
function hasHelius() {
  return Boolean(current.heliusKey);
}
function xBearerToken() {
  return current.xBearerToken;
}
function hasX() {
  return Boolean(current.xBearerToken);
}
function rpcUrlPool() {
  if (current.heliusKey) return [`https://mainnet.helius-rpc.com/?api-key=${current.heliusKey}`];
  return [SOLANA.rpcUrl, ...SOLANA.fallbackRpcUrls];
}
function activeSupportsDas() {
  return hasHelius() || SOLANA.supportsDas;
}
function effectiveScanBudget() {
  return hasHelius() ? LIVE_FEED.scanBudgetPerPoll * 3 : LIVE_FEED.scanBudgetPerPoll;
}
function effectiveConcurrency() {
  return hasHelius() ? LIVE_FEED.scanConcurrency * 2 : LIVE_FEED.scanConcurrency;
}

// lib/twitterClient.ts
function xMonitorQuery(symbol, address) {
  const sym = (symbol ?? "").replace(/[^A-Za-z0-9]/g, "");
  return sym ? `$${sym}` : address;
}
async function fetchXBuzz(symbol, address, bearer) {
  if (!bearer) return null;
  const base = xMonitorQuery(symbol, address);
  const query = `${base} -is:retweet`;
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=50&expansions=author_id&user.fields=verified,public_metrics`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const tweetCount = Array.isArray(json.data) ? json.data.length : 0;
    const users = json.includes?.users ?? [];
    const notableAuthors = users.filter((u) => {
      const followers = asNumber(u.public_metrics?.followers_count) ?? 0;
      return u.verified === true || followers >= 1e4;
    }).map((u) => `@${String(u.username ?? "")}`).filter((h) => h.length > 1).slice(0, 5);
    return { tweetCount, notableAuthors, query: base };
  } catch {
    return null;
  }
}

// lib/watchAlerts.ts
function computeWatchAlerts(baseline, current2) {
  const alerts = [];
  const t = WATCHLIST.alerts;
  const lpWasSecured = baseline.lpStatus === "burned" || baseline.lpStatus === "locked";
  const lpNowSecured = current2.lpStatus === "burned" || current2.lpStatus === "locked";
  if (lpWasSecured && !lpNowSecured && current2.lpStatus !== "unknown") {
    alerts.push({
      kind: "lp-unsecured",
      message: `LP is no longer ${baseline.lpStatus} (now ${current2.lpStatus.replace("_", " ")}) \u2014 rug risk changed.`
    });
  }
  if (baseline.liquidityEur !== null && current2.liquidityEur !== null && baseline.liquidityEur > 0) {
    const dropPct = (1 - current2.liquidityEur / baseline.liquidityEur) * 100;
    if (dropPct >= t.liquidityDropPct) {
      alerts.push({ kind: "liquidity-drop", message: `Liquidity down ${dropPct.toFixed(0)}% since you started watching.` });
    }
  }
  if (baseline.marketCapEur !== null && current2.marketCapEur !== null && baseline.marketCapEur > 0) {
    const dropPct = (1 - current2.marketCapEur / baseline.marketCapEur) * 100;
    if (dropPct >= t.marketCapDropPct) {
      alerts.push({ kind: "mcap-drop", message: `Market cap down ${dropPct.toFixed(0)}% since you started watching.` });
    }
  }
  if (baseline.devHoldsPct !== null && current2.devHoldsPct !== null && baseline.devHoldsPct - current2.devHoldsPct >= t.devSoldPointsDrop) {
    alerts.push({
      kind: "dev-selling",
      message: `Dev wallet cut holdings from ${baseline.devHoldsPct.toFixed(1)}% to ${current2.devHoldsPct.toFixed(1)}% \u2014 dev is selling.`
    });
  }
  if (baseline.grade !== null && current2.grade !== null && baseline.grade - current2.grade >= t.gradeDrop) {
    alerts.push({
      kind: "grade-collapse",
      message: `King Grade fell ${baseline.grade}% \u2192 ${current2.grade}% \u2014 risk profile worsened.`
    });
  }
  return alerts;
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
async function fetchSolanaData(address, lite = false, excludeTokenAccounts = [], creatorAddress = null) {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return { mint: f.mint, holders: f.holders, status: "mock" };
  }
  if (lite) {
    const [mint2, holders2] = await Promise.all([fetchMintInfo(address), fetchHolderInfoLite(address, excludeTokenAccounts)]);
    return { mint: mint2, holders: holders2, status: mint2 ? "partial" : "unavailable" };
  }
  const [mint, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfo(address, creatorAddress)]);
  const status = mint && holders ? "ok" : mint || holders ? "partial" : "unavailable";
  return { mint, holders, status };
}
async function fetchMintInfo(address) {
  const result = await rpcCall(rpcUrlPool(), "getAccountInfo", [
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
  let permanentDelegateActive = false;
  let transferHookActive = false;
  let defaultAccountFrozen = false;
  let nonTransferable = false;
  const extensions = Array.isArray(info.extensions) ? info.extensions : [];
  for (const ext of extensions) {
    const state = ext.state ?? {};
    switch (ext.extension) {
      case "transferFeeConfig": {
        const newer = state.newerTransferFee ?? {};
        transferFeeBps = asNumber(newer.transferFeeBasisPoints) ?? 0;
        feeAuthorityActive = state.transferFeeConfigAuthority != null || state.withdrawWithheldAuthority != null;
        break;
      }
      case "permanentDelegate":
        permanentDelegateActive = state.delegate != null;
        break;
      case "transferHook":
        transferHookActive = state.programId != null;
        break;
      case "defaultAccountState":
        defaultAccountFrozen = state.accountState === "frozen";
        break;
      case "nonTransferable":
      case "nonTransferableAccount":
        nonTransferable = true;
        break;
    }
  }
  return {
    mintAuthorityActive,
    freezeAuthorityActive,
    metadataMutable: await fetchMetadataMutable(address),
    isToken2022,
    transferFeeBps,
    feeAuthorityActive,
    permanentDelegateActive,
    transferHookActive,
    defaultAccountFrozen,
    nonTransferable
  };
}
async function fetchMetadataMutable(address) {
  if (!activeSupportsDas()) return null;
  const asset = await rpcCall(rpcUrlPool(), "getAsset", { id: address });
  return typeof asset?.mutable === "boolean" ? asset.mutable : null;
}
async function fetchHolderInfo(address, creatorAddress = null) {
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), "getTokenSupply", [address, { commitment: "confirmed" }]),
    rpcCall(rpcUrlPool(), "getTokenLargestAccounts", [address, { commitment: "confirmed" }])
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
  const smartSet = new Set(SMART_MONEY_WALLETS);
  const smartMoneyPct = smartSet.size === 0 ? null : Math.min(
    100,
    accounts.reduce((s, a, i) => owners[i] !== null && smartSet.has(owners[i]) ? s + a.amount : s, 0) / supply * 100
  );
  const devHoldsPct = creatorAddress === null ? null : Math.min(
    100,
    accounts.reduce((s, a, i) => owners[i] === creatorAddress ? s + a.amount : s, 0) / supply * 100
  );
  return {
    holderCount: null,
    // plain RPC has no cheap holder count; GMGN fills this in when live
    top5Pct: pct(realHolders.slice(0, 5)),
    top10Pct: pct(realHolders.slice(0, 10)),
    largestNonLpWalletPct: realHolders.length > 0 ? pct(realHolders.slice(0, 1)) : null,
    bundledLaunchPct: null,
    // needs block-0..2 funding-graph analysis; honest "unknown" for now
    smartMoneyPct,
    devHoldsPct
  };
}
async function fetchHolderInfoLite(address, excludeTokenAccounts) {
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), "getTokenSupply", [address, { commitment: "confirmed" }]),
    rpcCall(rpcUrlPool(), "getTokenLargestAccounts", [address, { commitment: "confirmed" }])
  ]);
  const supply = asNumber(supplyRes?.value?.uiAmount);
  const excluded = new Set(excludeTokenAccounts);
  const accounts = (largestRes?.value ?? []).map((a) => ({ address: a.address ?? "", amount: asNumber(a.uiAmount) ?? 0 })).filter((a) => a.address && a.amount > 0 && !excluded.has(a.address));
  if (supply === null || supply <= 0 || accounts.length === 0) return null;
  const pct = (slice) => Math.min(100, slice.reduce((s, a) => s + a.amount, 0) / supply * 100);
  return {
    holderCount: null,
    top5Pct: pct(accounts.slice(0, 5)),
    top10Pct: pct(accounts.slice(0, 10)),
    largestNonLpWalletPct: pct(accounts.slice(0, 1)),
    bundledLaunchPct: null,
    smartMoneyPct: null,
    // needs owner resolution — full scans only
    devHoldsPct: null
    // needs owner resolution — full scans only
  };
}
async function fetchOwners(tokenAccounts) {
  const result = await rpcCall(rpcUrlPool(), "getMultipleAccounts", [
    tokenAccounts,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const values = result?.value ?? [];
  return tokenAccounts.map((_, i) => values[i]?.data?.parsed?.info?.owner ?? null);
}

// background/service-worker.ts
var RECENT_KEY = "ck:recent";
var BASE58_RE3 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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
    case "RESOLVE_PAIRS": {
      const valid = msg.pairAddresses.filter((p) => BASE58_RE3.test(p)).slice(0, 90);
      return { ok: true, tokens: await fetchPairBaseTokens(valid) };
    }
    case "WATCH_TOKEN":
      return watchToken(msg.address, msg.symbol);
    case "UNWATCH_TOKEN":
      return unwatchToken(msg.address);
    case "GET_WATCHLIST":
      return { ok: true, watchlist: await loadWatchlist() };
    case "GET_SETTINGS": {
      await loadSettings();
      const s = getSettings();
      return { ok: true, hasHelius: hasHelius(), heliusKeySet: Boolean(s.heliusKey), hasX: hasX(), xTokenSet: Boolean(s.xBearerToken) };
    }
    case "SET_SETTINGS": {
      const patch = {};
      if ("heliusKey" in msg) patch.heliusKey = msg.heliusKey ?? null;
      if ("xBearerToken" in msg) patch.xBearerToken = msg.xBearerToken ?? null;
      await setSettings(patch);
      if ("heliusKey" in msg) cache.clear();
      const s = getSettings();
      return { ok: true, hasHelius: hasHelius(), heliusKeySet: Boolean(s.heliusKey), hasX: hasX(), xTokenSet: Boolean(s.xBearerToken) };
    }
    case "CHECK_X": {
      const buzz = await fetchXBuzz(msg.symbol, msg.address, xBearerToken());
      return { ok: true, buzz, hasToken: hasX() };
    }
    case "GET_ACCURACY":
      return { ok: true, accuracy: computeAccuracy(await loadLedger()) };
    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}
var feed = /* @__PURE__ */ new Map();
var notified = /* @__PURE__ */ new Set();
var feedInFlight = null;
function getLiveFeed() {
  if (!LIVE_FEED.enabled) return Promise.resolve({ ok: false, error: "Live feed disabled in config." });
  if (feedInFlight) return feedInFlight;
  feedInFlight = doLiveFeedSweep().finally(() => {
    feedInFlight = null;
  });
  return feedInFlight;
}
async function doLiveFeedSweep() {
  const [pumpCoins, dexAddrs] = await Promise.all([
    fetchPumpfunNewCoins(LIVE_FEED.fetchCount),
    fetchDexscreenerNewSolana(LIVE_FEED.fetchCount)
  ]);
  const seen = /* @__PURE__ */ new Set();
  const coins = [];
  for (const c of pumpCoins) {
    if (seen.has(c.mint)) continue;
    seen.add(c.mint);
    coins.push(c);
  }
  for (const mint of dexAddrs) {
    if (seen.has(mint)) continue;
    seen.add(mint);
    coins.push({ mint, symbol: null, name: null, createdMs: null });
  }
  if (coins.length === 0 && feed.size === 0) {
    return {
      ok: false,
      error: MOCK_MODE ? "Live feed needs live mode (MOCK_MODE=false)." : "Live launch source unavailable right now."
    };
  }
  for (const [mint, row] of feed) {
    if (row.ageMinutes !== null) {
      row.ageMinutes += (Date.now() - row.scannedAt) / 6e4;
      row.scannedAt = Date.now();
      if (row.ageMinutes > LIVE_FEED.maxAgeMinutes) feed.delete(mint);
    }
  }
  const toScan = coins.filter((c) => {
    const cached = cache.get(c.mint);
    return !(cached && Date.now() - cached.at < CACHE_TTL_MS);
  }).sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0)).slice(0, effectiveScanBudget());
  let scannedThisPoll = toScan.length;
  let next = 0;
  const worker = async () => {
    while (next < toScan.length) {
      const c = toScan[next++];
      await analyzeToken(
        c.mint,
        false,
        void 0,
        /*lite*/
        true
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(effectiveConcurrency(), toScan.length) }, worker));
  let fullUpgradesThisPoll = 0;
  for (const c of coins) {
    let entry = cache.get(c.mint);
    if (!entry) continue;
    if (entry.lite && fullUpgradesThisPoll < 3 && !entry.risk.insufficientData && entry.risk.riskScore <= LIVE_FEED.notifyMaxScore && entry.analysis.launch?.bondingCurveComplete !== false) {
      fullUpgradesThisPoll++;
      await analyzeToken(
        c.mint,
        false,
        void 0,
        /*lite*/
        false
      );
      entry = cache.get(c.mint) ?? entry;
    }
    const verdict = entry.lite ? { gem: false, blockers: ["Full background check pending."] } : gemBackgroundCheck(entry.analysis, entry.risk, entry.quality);
    const kingGrade = computeKingGrade(entry.analysis, entry.risk, entry.quality);
    const rug = assessRugPotential(entry.analysis, entry.risk);
    const row = {
      address: c.mint,
      symbol: entry.analysis.identity.symbol ?? c.symbol,
      name: entry.analysis.identity.name ?? c.name,
      ageMinutes: entry.analysis.identity.ageMinutes ?? (c.createdMs ? Math.max(0, (Date.now() - c.createdMs) / 6e4) : null),
      marketCapEur: entry.analysis.market?.marketCapEur ?? null,
      priceUsd: entry.analysis.market?.priceEur != null ? entry.analysis.market.priceEur / EUR_PER_USD : null,
      riskScore: entry.risk.riskScore,
      signal: entry.risk.signal,
      topReason: entry.risk.reasons[0]?.text ?? null,
      qualityScore: entry.quality.insufficientData ? null : entry.quality.qualityScore,
      grade: kingGrade.grade,
      gem: verdict.gem,
      rugVerdict: rug.verdict,
      liveState: assessLiveState(entry.analysis.market).state,
      graduated: entry.analysis.launch?.bondingCurveComplete ?? null,
      narratives: entry.analysis.narratives,
      twitter: entry.analysis.socials?.twitter ?? null,
      insufficientData: entry.risk.insufficientData,
      unverified: entry.analysis.holders === null || !entry.analysis.market || entry.analysis.market.lpStatus === "unknown",
      scannedAt: Date.now()
    };
    feed.set(c.mint, row);
    maybeNotifyLowRisk(row, entry.risk);
  }
  const rows = [...feed.values()].sort((a, b) => (a.ageMinutes ?? 1e9) - (b.ageMinutes ?? 1e9)).slice(0, LIVE_FEED.maxRows);
  if (feed.size > LIVE_FEED.maxRows * 2) {
    const keep = new Set(rows.map((r) => r.address));
    for (const k of feed.keys()) if (!keep.has(k)) feed.delete(k);
  }
  return { ok: true, feed: rows, source: MOCK_MODE ? "mock" : "ok", scannedThisPoll };
}
function maybeNotifyLowRisk(row, risk) {
  if (!LIVE_FEED.notifyLowRisk || MOCK_MODE) return;
  if (!row.gem) return;
  if (notified.has(row.address)) return;
  notified.add(row.address);
  if (notified.size > 500) notified.clear();
  const sym = row.symbol ?? `${row.address.slice(0, 4)}\u2026${row.address.slice(-4)}`;
  chrome.notifications.create(`ck-${row.address}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `\u{1F48E} ${sym} \u2014 King Grade ${row.grade ?? "?"}% (risk ${risk.riskScore}, quality ${row.qualityScore ?? "?"})`,
    message: "Graduated, LP secured, no whale wallet, creator screened. Still speculative \u2014 research it yourself. Click to open on GMGN."
  });
}
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith("ck-") || id.startsWith("ck-watch-")) return;
  const address = id.slice(3);
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});
async function analyzeToken(address, force, rawGmgn, lite = false) {
  if (!BASE58_RE3.test(address)) {
    return { ok: false, error: "Not a valid Solana address." };
  }
  const cached = cache.get(address);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS && (!cached.lite || lite)) {
    return { ok: true, analysis: cached.analysis, risk: cached.risk, quality: cached.quality, mock: MOCK_MODE };
  }
  const pending = inFlight.get(address);
  if (pending) return pending;
  const job = doAnalyze(address, rawGmgn, lite).finally(() => inFlight.delete(address));
  inFlight.set(address, job);
  return job;
}
async function doAnalyze(address, rawGmgn, lite = false) {
  try {
    const gmgnPromise = !MOCK_MODE && rawGmgn ? Promise.resolve(parseGmgn(rawGmgn)) : lite && !MOCK_MODE ? Promise.resolve(emptyGmgnData()) : fetchGmgnData(address);
    const pumpfun = await fetchPumpfunData(address);
    const [gmgn, solana, audit, dexMarket] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address, lite, pumpfun.bondingCurveAccounts, pumpfun.creator),
      rugcheckAdapter.fetchAudit(address),
      lite ? Promise.resolve(null) : fetchDexscreenerToken(address)
    ]);
    let deployerHist = lite ? await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator) : await pumpfunDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);
    deployerHist = await applyCreatorMemory(pumpfun.creator, deployerHist);
    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, dexMarket, {
      gmgn: gmgn.status,
      solana: solana.status,
      pumpfun: pumpfun.status,
      rugcheck: audit.status,
      deployer: deployerHist.status
    });
    if (DEBUG) {
      console.log("[CRYPTO-KING] merged analysis", address, {
        market: analysis.market,
        pumpfunMcap: pumpfun.marketCapEur,
        dexMarket,
        mint: analysis.mint,
        holders: analysis.holders
      });
    }
    const risk = scoreToken(analysis);
    const quality = scoreQuality(analysis);
    cache.set(address, { analysis, risk, quality, at: Date.now(), lite });
    if (!lite) {
      await saveRecent(analysis, risk, quality);
      await recordPrediction(analysis, computeKingGrade(analysis, risk, quality).grade, assessRugPotential(analysis, risk).verdict);
    }
    return { ok: true, analysis, risk, quality, mock: MOCK_MODE };
  } catch (err) {
    console.error("[CRYPTO-KING] analysis failed:", err);
    return { ok: false, error: "Analysis failed \u2014 data unavailable." };
  }
}
function mergeSources(address, gmgn, solana, pumpfun, auditLpStatus, deployer, dexMarket, sources) {
  let mint = solana.mint;
  if (!mint && (gmgn.mintRenounced !== null || gmgn.freezeRenounced !== null || gmgn.taxBps !== null)) {
    mint = {
      mintAuthorityActive: gmgn.mintRenounced === null ? null : !gmgn.mintRenounced,
      freezeAuthorityActive: gmgn.freezeRenounced !== null ? !gmgn.freezeRenounced : gmgn.isBlacklist === true ? true : null,
      metadataMutable: null,
      isToken2022: pumpfun.isToken2022,
      transferFeeBps: gmgn.taxBps,
      feeAuthorityActive: gmgn.feeAuthorityActive,
      // Extension traps need the on-chain mint account; unknown via GMGN alone.
      permanentDelegateActive: null,
      transferHookActive: null,
      defaultAccountFrozen: null,
      nonTransferable: null
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
    bundledLaunchPct: solana.holders?.bundledLaunchPct ?? gmgn.sniperHoldPct,
    smartMoneyPct: solana.holders?.smartMoneyPct ?? null,
    devHoldsPct: solana.holders?.devHoldsPct ?? null
  } : null;
  const lpStatus = gmgn.lpStatus && gmgn.lpStatus !== "unknown" ? gmgn.lpStatus : auditLpStatus ?? gmgn.lpStatus ?? "unknown";
  const sellSimulation = gmgn.isHoneypot === true ? { ok: false, slippagePct: gmgn.sellSlippagePct } : gmgn.sellSlippagePct !== null ? { ok: true, slippagePct: gmgn.sellSlippagePct } : gmgn.isHoneypot === false ? { ok: true, slippagePct: null } : null;
  const hasMarket = dexMarket !== null || gmgn.marketCapEur !== null || gmgn.liquidityEur !== null || pumpfun.marketCapEur !== null || lpStatus !== "unknown";
  const market = hasMarket ? {
    priceEur: dexMarket?.priceUsd ?? gmgn.priceEur ?? pumpfun.priceEur,
    marketCapEur: dexMarket?.marketCapUsd ?? gmgn.marketCapEur ?? pumpfun.marketCapEur,
    liquidityEur: dexMarket?.liquidityUsd ?? gmgn.liquidityEur,
    volume24hEur: dexMarket?.volume24hUsd ?? gmgn.volume24hEur,
    lpStatus,
    sellSimulation,
    priceChange1h: dexMarket?.priceChange1h ?? null,
    priceChange6h: dexMarket?.priceChange6h ?? null,
    priceChange24h: dexMarket?.priceChange24h ?? null,
    buys1h: dexMarket?.buys1h ?? null,
    sells1h: dexMarket?.sells1h ?? null
  } : null;
  const behavior = gmgn.behavior ?? (pumpfun.isBanned === true ? {
    volumeSpikeFlatPrice: null,
    manySmallBuysOneHugeSell: null,
    mcapSpikeNoOrganicVolume: null,
    deployerLinkedSelling: null,
    abnormalEarlyVolume: null
  } : null);
  const symbol = gmgn.symbol ?? pumpfun.symbol;
  const name = gmgn.name ?? pumpfun.name;
  return {
    identity: {
      address,
      symbol,
      name,
      chain: "sol",
      ageMinutes: gmgn.ageMinutes ?? pumpfun.ageMinutes,
      logoUri: null
    },
    narratives: matchNarratives(name, symbol),
    mint,
    holders,
    market,
    behavior,
    deployer,
    socials: gmgn.socials ?? pumpfun.socials,
    smartMoney: gmgn.smartMoney,
    // Only attest launch-platform facts from a live pump.fun response — the
    // mock path stays null so the fixture walkthrough arithmetic holds exactly.
    launch: pumpfun.status === "ok" ? {
      platform: "pumpfun",
      bondingCurveComplete: pumpfun.bondingCurveComplete,
      bannedOnPlatform: pumpfun.isBanned,
      replyCount: pumpfun.replyCount
    } : null,
    sources,
    fetchedAt: Date.now()
  };
}
var CREATORS_KEY = "ck:creators";
async function applyCreatorMemory(creator, hist) {
  if (!creator) return hist;
  const data = await chrome.storage.local.get(CREATORS_KEY);
  const memory = data[CREATORS_KEY] ?? {};
  const d = hist.deployer;
  if (hist.status === "ok" && d && d.priorLaunches !== null) {
    memory[creator] = {
      launches: d.priorLaunches,
      dead: d.priorDeadLaunches ?? 0,
      graduated: d.graduatedLaunches ?? 0,
      lastSeen: Date.now()
    };
    const keys = Object.keys(memory);
    if (keys.length > 500) {
      keys.sort((a, b) => memory[a].lastSeen - memory[b].lastSeen).slice(0, keys.length - 500).forEach((k) => delete memory[k]);
    }
    await chrome.storage.local.set({ [CREATORS_KEY]: memory });
    return hist;
  }
  const known2 = memory[creator];
  if (known2) {
    return {
      status: "partial",
      deployer: {
        priorRugs: null,
        fundingSource: "unknown",
        priorLaunches: known2.launches,
        priorDeadLaunches: known2.dead,
        graduatedLaunches: known2.graduated
      }
    };
  }
  return hist;
}
var WATCHLIST_KEY = "ck:watchlist";
async function loadWatchlist() {
  const data = await chrome.storage.local.get(WATCHLIST_KEY);
  return Array.isArray(data[WATCHLIST_KEY]) ? data[WATCHLIST_KEY] : [];
}
async function saveWatchlist(list) {
  await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
}
function snapshotOf(entry) {
  return {
    at: Date.now(),
    grade: computeKingGrade(entry.analysis, entry.risk, entry.quality).grade,
    liquidityEur: entry.analysis.market?.liquidityEur ?? null,
    marketCapEur: entry.analysis.market?.marketCapEur ?? null,
    lpStatus: entry.analysis.market?.lpStatus ?? "unknown",
    devHoldsPct: entry.analysis.holders?.devHoldsPct ?? null,
    largestNonLpWalletPct: entry.analysis.holders?.largestNonLpWalletPct ?? null
  };
}
async function watchToken(address, symbol) {
  if (!BASE58_RE3.test(address)) return { ok: false, error: "Not a valid Solana address." };
  const list = await loadWatchlist();
  if (list.some((w) => w.address === address)) return { ok: true, watchlist: list };
  if (list.length >= WATCHLIST.maxCoins) {
    return { ok: false, error: `Watchlist is full (${WATCHLIST.maxCoins} coins) \u2014 unwatch one first.` };
  }
  const res = await analyzeToken(address, false);
  if (!res.ok) return { ok: false, error: res.error };
  const entry = cache.get(address);
  if (!entry) return { ok: false, error: "Scan failed \u2014 cannot watch." };
  const snap = snapshotOf(entry);
  const coin = {
    address,
    symbol: entry.analysis.identity.symbol ?? symbol,
    addedAt: Date.now(),
    baseline: snap,
    last: snap,
    alerted: []
  };
  const next = [...list, coin];
  await saveWatchlist(next);
  ensureWatchAlarm();
  return { ok: true, watchlist: next };
}
async function unwatchToken(address) {
  const next = (await loadWatchlist()).filter((w) => w.address !== address);
  await saveWatchlist(next);
  return { ok: true, watchlist: next };
}
async function sweepWatchlist() {
  const list = await loadWatchlist();
  if (list.length === 0) return;
  for (const coin of list) {
    const res = await analyzeToken(
      coin.address,
      /*force*/
      true
    );
    if (!res.ok) continue;
    const entry = cache.get(coin.address);
    if (!entry) continue;
    coin.last = snapshotOf(entry);
    for (const alert of computeWatchAlerts(coin.baseline, coin.last)) {
      if (coin.alerted.includes(alert.kind)) continue;
      coin.alerted.push(alert.kind);
      const sym = coin.symbol ?? `${coin.address.slice(0, 4)}\u2026${coin.address.slice(-4)}`;
      chrome.notifications.create(`ck-watch-${coin.address}-${alert.kind}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `\u{1F6A8} ${sym} \u2014 watched coin alert`,
        message: `${alert.message} Click to open on GMGN.`,
        priority: 2
      });
    }
  }
  await saveWatchlist(list);
}
function ensureWatchAlarm() {
  chrome.alarms.create("ck-watch", { periodInMinutes: WATCHLIST.pollMinutes });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ck-watch") {
    void sweepWatchlist();
    void recheckLedger();
  }
});
chrome.runtime.onInstalled.addListener(ensureWatchAlarm);
chrome.runtime.onStartup.addListener(ensureWatchAlarm);
void loadSettings();
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith("ck-watch-")) return;
  const address = id.slice("ck-watch-".length).split("-")[0];
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});
var LEDGER_KEY = "ck:ledger";
async function loadLedger() {
  const d = await chrome.storage.local.get(LEDGER_KEY);
  return Array.isArray(d[LEDGER_KEY]) ? d[LEDGER_KEY] : [];
}
async function recordPrediction(analysis, grade, rugVerdict) {
  if (!OUTCOME_LEDGER.enabled || MOCK_MODE || grade === null) return;
  const ledger = await loadLedger();
  if (ledger.some((e) => e.address === analysis.identity.address)) return;
  ledger.unshift({
    address: analysis.identity.address,
    symbol: analysis.identity.symbol,
    gradedAt: Date.now(),
    grade,
    rugVerdict,
    baselineMcap: analysis.market?.marketCapEur ?? null
  });
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger.slice(0, OUTCOME_LEDGER.maxEntries) });
}
async function recheckLedger() {
  if (!OUTCOME_LEDGER.enabled || MOCK_MODE) return;
  const ledger = await loadLedger();
  const dueAt = Date.now() - OUTCOME_LEDGER.recheckAfterHours * 36e5;
  const due = ledger.filter((e) => !e.outcome && e.gradedAt <= dueAt).slice(0, 5);
  if (due.length === 0) return;
  for (const entry of due) {
    const dex = await fetchDexscreenerToken(entry.address);
    const nowMcap = dex?.marketCapUsd ?? null;
    const isDead = dex === null ? true : assessLiveState({
      priceEur: dex.priceUsd,
      marketCapEur: dex.marketCapUsd,
      liquidityEur: dex.liquidityUsd,
      volume24hEur: dex.volume24hUsd,
      lpStatus: "unknown",
      sellSimulation: null,
      priceChange1h: dex.priceChange1h,
      priceChange6h: dex.priceChange6h,
      priceChange24h: dex.priceChange24h,
      buys1h: dex.buys1h,
      sells1h: dex.sells1h
    }).state === "DEAD";
    entry.checkedAt = Date.now();
    entry.finalMcap = nowMcap;
    entry.outcome = classifyOutcome(entry.baselineMcap, nowMcap, isDead);
  }
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
}
async function loadRecent() {
  const data = await chrome.storage.local.get(RECENT_KEY);
  const list = data[RECENT_KEY];
  return Array.isArray(list) ? list : [];
}
async function saveRecent(analysis, risk, quality) {
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
    grade: computeKingGrade(analysis, risk, quality).grade,
    insufficientData: risk.insufficientData,
    updatedAt: Date.now()
  };
  const recent = await loadRecent();
  const rest = recent.filter((r) => r.address !== row.address);
  await chrome.storage.local.set({ [RECENT_KEY]: [row, ...rest].slice(0, RECENT_MAX) });
}
