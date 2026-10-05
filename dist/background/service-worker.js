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
  gemMinQuality: 30,
  /**
   * "Hide risky coins" cut-off, expressed in King Grade (higher = better) so the
   * toggle, the ⚠ counter and the % on each row all read the same direction.
   * 40 = the bottom of the MIXED band; WEAK/AVOID are hidden.
   */
  safeMinGrade: 40
};
var GECKO = {
  enabled: true,
  baseUrl: "https://api.geckoterminal.com/api/v2",
  /** Daily candles to request per coin (max useful window for the pillars). */
  historyDays: 90,
  /** Discovery lists for the radar. Short trending windows on purpose: the
   *  24h-only list and the "most traded" list are dominated by coins that
   *  already ran ($100M+, months old) — not what an early holder needs. */
  discoveryPaths: [
    "/networks/solana/trending_pools?duration=1h&page=1",
    "/networks/solana/trending_pools?duration=6h&page=1",
    "/networks/solana/trending_pools?duration=6h&page=2",
    "/networks/solana/trending_pools?duration=24h&page=1",
    "/networks/solana/trending_pools?duration=24h&page=2"
  ]
};
var EARLY_GEM = {
  enabled: true,
  /** Only coins at or below this market cap are spotted — "early" means early. */
  maxSpotMcapUsd: 3e5,
  /** Lite (feed) score needed before spending a full background check. */
  prelimMinScore: 40,
  /** Full-scan score needed to be added to the tracker. */
  spotMinScore: 55,
  /** Verdict cut-offs. */
  strongScore: 65,
  promisingScore: 45,
  /** Full checks of new launches per feed sweep (run in the background). */
  fullChecksPerSweep: 2,
  /** Max coins followed at once (oldest dropped ones fall off first). */
  maxTracked: 40,
  /** Re-check cadence by stage (minutes). */
  recheckMinutes: { SEED: 5, SPROUT: 20, ROOTED: 60, DROPPED: 360 },
  /** Coins re-checked per tick (keeps the shared RPC budget sane). */
  checksPerTick: 6,
  /** Disqualifiers at launch. */
  maxDevPct: 5,
  maxLargestWalletPct: 8,
  maxTop10Pct: 30,
  /** Current cap below this share of its all-time high = the pump-and-dump
   *  already happened. */
  minAthRatio: 0.3,
  /** Holder growth benchmarks (new holders per hour) from early-winner data. */
  strongHoldersPerHour: 50,
  okHoldersPerHour: 15,
  /** Multiples since first sight that trigger a milestone alert. */
  multipleMilestones: [2, 5, 10, 25, 100],
  /** "If you'd bought every pick at first sight" horizons (days). */
  reportHorizonsDays: [1, 7, 30],
  /** Keep following DROPPED coins (price only) this long, so the report
   *  includes the losers too — otherwise it would be survivorship bias. */
  followDroppedDays: 31
};
var LONG_HOLD = {
  enabled: true,
  /** Younger than this = inside the rug/abandon window — can't judge durability. */
  minAgeDays: 3,
  /** Above this market cap the coin is already "discovered" — tier LATE. */
  lateMcapUsd: 25e7,
  /** "Still early" strength shown below this cap. */
  earlyMcapUsd: 1e7,
  /** Score thresholds for tiers. */
  candidateScore: 70,
  watchScore: 50,
  /** Hard disqualifiers (any one → NOT A HOLD). */
  maxLargestWalletPct: 5,
  maxDevPct: 5,
  maxTop10Pct: 40,
  /** Daily volume ÷ liquidity above this is almost certainly wash trading. */
  washVolLiqRatio: 10,
  /** …above this it's suspicious (scored, not disqualified). */
  suspiciousVolLiqRatio: 5,
  /** Close below this share of the all-time high WITH lower lows = death spiral. */
  deathSpiralAthShare: 0.1,
  /** Radar sweep: how often, and how many candidates get a full deep check
   *  (full scan + price history + holders) per sweep. Everything else gets a
   *  cheap quick screen (DexScreener, 30 coins per request). */
  radarEveryMinutes: 1,
  // CONSTANT: a tick every minute, panel open or not
  radarDeepChecksPerSweep: 4,
  // ×60/h = 240 deep checks/hour within free API limits
  /** Radar = YOUNG survivors at LOW caps: old/big coins already did their run.
   *  1 day = past the first-48h kill zone's worst; coins < 3 days are judged
   *  by early conviction, 3+ days by the long-hold screen. */
  radarMinAgeDays: 1,
  radarMaxAgeDays: 21,
  radarMinLiquidityUsd: 25e3,
  radarMinMcapUsd: 1e5,
  radarMaxMcapUsd: 5e6,
  /** Keep this many coins in the radar list (deep-checked + quick-screened). */
  radarMaxRows: 80,
  /** Launches the live feed has seen are remembered (newest N) and revisited
   *  once they're old enough — the best source of young survivors. */
  seenLaunchesMax: 4e3,
  /** Re-assess a radar coin after this long. */
  reassessHours: 6,
  /** Outcome checks for the long-hold report card. */
  ledgerCheckDays: [7, 30]
};
var JUPITER = {
  enabled: true,
  quoteUrl: "https://lite-api.jup.ag/swap/v1/quote",
  /** Wide tolerance: we want the route and its price impact, not a tight fill. */
  slippageBps: 5e3
};
var DEXSCREENER = {
  enabled: true,
  /** Recently-updated token profiles across chains; we filter chainId === 'solana'. */
  latestProfilesUrl: "https://api.dexscreener.com/token-profiles/latest/v1",
  /** Paid boosts (latest + most boosted). A team paying for promotion is still
   *  active — a radar SOURCE only, never a score input (boosts can be bought). */
  boostsUrls: ["https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-boosts/top/v1"],
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
   * Belt-and-braces only. Pools are recognised STRUCTURALLY (any token-account
   * owner that is itself owned by a program rather than the System Program —
   * see lib/holderMath.ts), which covers PumpSwap, Meteora, Orca and bonding
   * curves that no static list can enumerate. These entries just guarantee
   * the two big Raydium authorities are excluded even if that lookup fails.
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
  /** ON: the keyless summary is the only source of LP lock status off gmgn.ai
   *  (see lib/lpStatus.ts). Full scans only — never the lite feed sweep. */
  enabled: true,
  /** Public, keyless summary endpoint (lighter than the full report). */
  endpoint: "https://api.rugcheck.xyz/v1/tokens/{address}/report/summary"
};
var RATE_LIMITS_MS = {
  default: 1100,
  "gmgn.ai": 400,
  /** DexScreener publishes 300 req/min for its token/pair endpoints (=200ms);
   *  250ms stays under it. It drives the rug/dump checks, so it must not crawl
   *  at the 1.1s default. */
  "api.dexscreener.com": 250,
  /** GeckoTerminal's public limit is 30 calls/min → 2s; 2.1s keeps a margin. */
  "api.geckoterminal.com": 2100
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
var EXIT_REALITY = {
  /** Your typical position size (USD) — the card reports its real exit cost. */
  referencePositionUsd: 100,
  /** "Gentle" exit: price impact you'd barely notice. */
  gentleImpactPct: 2,
  /** Most you'd tolerate losing to slippage on the way out. */
  toleratedImpactPct: 5,
  /** If even a gentle exit is under this, the pool is unusably thin. */
  dangerouslyThinUsd: 50
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
  {
    min: 80,
    label: "GEM GRADE",
    color: "#d4a017",
    textColor: "#1b1b18",
    blurb: 'Passed every check we can run \u2014 still speculative, never "safe".'
  },
  {
    min: 60,
    label: "STRONG",
    color: "#46a758",
    textColor: "#ffffff",
    blurb: "Most checks passed \u2014 read the remaining flags before anything."
  },
  {
    min: 40,
    label: "MIXED",
    color: "#ffb224",
    textColor: "#1b1b18",
    blurb: "Real flags or unverified checks \u2014 not an opportunity signal."
  },
  {
    min: 20,
    label: "WEAK",
    color: "#f76b15",
    textColor: "#ffffff",
    blurb: "Serious problems found \u2014 the odds are against you here."
  },
  {
    min: 0,
    label: "AVOID",
    color: "#e5484d",
    textColor: "#ffffff",
    blurb: "Severe red flags \u2014 this looks like a scam/rug setup."
  }
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
function computeLongHoldAccuracy(entries, days) {
  const tiers = ["CANDIDATE", "WATCH", "WEAK", "NOT_A_HOLD"];
  const rows = [];
  for (const tier of tiers) {
    for (const day of days) {
      const done = entries.filter((e) => e.tier === tier).map((e) => ({ e, o: e.outcomes[String(day)] })).filter((x) => x.o && x.o.outcome !== "PENDING");
      const multiples = done.map((x) => x.o.mcap !== null && x.e.baselineMcap > 0 ? x.o.mcap / x.e.baselineMcap : x.o.outcome === "RUGGED" ? 0 : null).filter((m) => m !== null).sort((a, b) => a - b);
      rows.push({
        tier,
        day,
        checked: done.length,
        survived: done.filter((x) => x.o.outcome === "SURVIVED" || x.o.outcome === "WINNER").length,
        winners: done.filter((x) => x.o.outcome === "WINNER").length,
        medianMultiple: multiples.length ? median(multiples) : null
      });
    }
  }
  return rows;
}
function median(sorted) {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
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

// lib/geckoClient.ts
var BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function fetchDailyCandles(poolAddress, days = GECKO.historyDays) {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(poolAddress)) return null;
  const url = `${GECKO.baseUrl}/networks/solana/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=${days}&currency=usd`;
  return parseCandles(await fetchJson(url));
}
function parseCandles(json) {
  const list = pick(json, ["data.attributes.ohlcv_list"]);
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map((x) => asNumber(x));
    if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
    if (h <= 0 || l <= 0 || c <= 0) continue;
    out.push({ t, o, h, l, c, v });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.t - b.t);
  const byDay = /* @__PURE__ */ new Map();
  for (const k of out) byDay.set(k.t, k);
  return [...byDay.values()];
}
async function fetchTokenInfo(mint) {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(mint)) return null;
  return parseTokenInfo(await fetchJson(`${GECKO.baseUrl}/networks/solana/tokens/${mint}/info`));
}
function parseTokenInfo(json) {
  const attrs = pick(json, ["data.attributes"]);
  if (!attrs || typeof attrs !== "object") return null;
  const websites = pick(attrs, ["websites"]);
  const handle2 = asString(pick(attrs, ["twitter_handle"]));
  const tg = asString(pick(attrs, ["telegram_handle"]));
  return {
    holderCount: asNumber(pick(attrs, ["holders.count"])),
    twitter: handle2 ? `https://x.com/${handle2.replace(/^@/, "")}` : null,
    telegram: tg ? `https://t.me/${tg.replace(/^@/, "")}` : null,
    website: Array.isArray(websites) ? asString(websites[0]) : null
  };
}
async function fetchPool(poolAddress) {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(poolAddress)) return null;
  const json = await fetchJson(`${GECKO.baseUrl}/networks/solana/pools/${poolAddress}`);
  const data = pick(json, ["data"]);
  return data ? parsePools({ data: [data] })[0] ?? null : null;
}
async function fetchRadarPools() {
  if (MOCK_MODE || !GECKO.enabled) return [];
  const pools = [];
  for (const path of GECKO.discoveryPaths) {
    pools.push(...parsePools(await fetchJson(`${GECKO.baseUrl}${path}`)));
  }
  const byMint = /* @__PURE__ */ new Map();
  for (const p of pools) {
    const prev = byMint.get(p.mint);
    if (!prev || (p.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0)) byMint.set(p.mint, p);
  }
  return [...byMint.values()];
}
async function fetchNewPools(pages = 2) {
  if (MOCK_MODE || !GECKO.enabled) return [];
  const out = [];
  for (let page = 1; page <= pages; page++) {
    out.push(...parsePools(await fetchJson(`${GECKO.baseUrl}/networks/solana/new_pools?page=${page}`)));
  }
  return out;
}
var NOT_MEMES = /* @__PURE__ */ new Set([
  "So11111111111111111111111111111111111111112",
  // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  // USDT
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  // JUP
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  // RAY
  "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  // JTO
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  // PYTH
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  // mSOL
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  // jitoSOL
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"
  // bSOL
]);
function parsePools(json) {
  const data = pick(json, ["data"]);
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const p of data) {
    const baseId = asString(pick(p, ["relationships.base_token.data.id"]));
    const mint = baseId?.startsWith("solana_") ? baseId.slice("solana_".length) : null;
    const pool = asString(pick(p, ["attributes.address"]));
    if (!mint || !pool || !BASE58_RE.test(mint) || NOT_MEMES.has(mint)) continue;
    const created = asString(pick(p, ["attributes.pool_created_at"]));
    const createdMs = created ? Date.parse(created) : NaN;
    out.push({
      mint,
      pool,
      name: asString(pick(p, ["attributes.name"])),
      createdMs: Number.isFinite(createdMs) ? createdMs : null,
      liquidityUsd: asNumber(pick(p, ["attributes.reserve_in_usd"])),
      // Prefer real market cap; FDV equals it for fixed-supply memes.
      marketCapUsd: asNumber(pick(p, ["attributes.market_cap_usd", "attributes.fdv_usd"])),
      volume24hUsd: asNumber(pick(p, ["attributes.volume_usd.h24"])),
      buyers24h: asNumber(pick(p, ["attributes.transactions.h24.buyers"])),
      sellers24h: asNumber(pick(p, ["attributes.transactions.h24.sellers"]))
    });
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

// lib/earlyGem.ts
var acc = (max) => ({ score: 0, max, good: [], bad: [], unknown: [] });
function stageForAge(ageHours) {
  if (ageHours === null || ageHours < 24) return "SEED";
  return ageHours < 72 ? "SPROUT" : "ROOTED";
}
function assessEarlyGem(a, risk, x, t = EARLY_GEM) {
  const dq = [];
  let softOnly = true;
  const hard = (msg) => {
    dq.push(msg);
    softOnly = false;
  };
  const m = a.mint;
  const L = a.launch;
  const onCurve = L?.bondingCurveComplete === false;
  const mcap = a.market?.marketCapEur ?? null;
  const liq = a.market?.liquidityEur ?? null;
  if (m?.mintAuthorityActive === true) hard("Mint authority active \u2014 supply can be inflated.");
  if (m?.freezeAuthorityActive === true) hard("Freeze authority active \u2014 wallets can be frozen.");
  if (m?.permanentDelegateActive || m?.nonTransferable || m?.defaultAccountFrozen || m?.transferHookActive) {
    hard("Token-2022 trap extension present.");
  }
  if (a.market?.sellSimulation?.ok === false) hard("Simulated sell fails \u2014 honeypot.");
  const lp = a.market?.lpStatus ?? "unknown";
  if (!onCurve && (lp === "unlocked" || lp === "deployer_held")) hard("Liquidity can be pulled (LP not burned/locked).");
  if (L?.bannedOnPlatform === true) hard("Banned on its own launchpad.");
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) hard("Creator is a serial launcher of dead coins.");
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev > t.maxDevPct) hard(`Dev holds ${dev.toFixed(1)}% \u2014 they'd be selling into your hold.`);
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > t.maxLargestWalletPct) hard(`One wallet already holds ${whale.toFixed(1)}%.`);
  const top10 = a.holders?.top10Pct ?? null;
  if (top10 !== null && top10 > t.maxTop10Pct) hard(`Top 10 wallets hold ${top10.toFixed(0)}% \u2014 snipers/insiders own it.`);
  const athR = L?.athRatio ?? null;
  if (athR !== null && athR < t.minAthRatio) {
    hard(`Already ${Math.round((1 - athR) * 100)}% below its peak \u2014 the pump-and-dump happened.`);
  }
  const volLiq = a.market?.volume24hEur != null && liq ? a.market.volume24hEur / liq : null;
  if (volLiq !== null && volLiq > 10) hard(`Volume ${volLiq.toFixed(0)}\xD7 liquidity \u2014 wash trading.`);
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") hard(`Already rugged/dead \u2014 ${live.reasons[0] ?? "market collapsed."}`);
  if (live.state === "DUMPING") dq.push(`Dumping right now \u2014 ${live.reasons[0] ?? "falling hard."}`);
  const cm = acc(30);
  const so = x.socials;
  if (so.telegram) cm.score += 10;
  if (so.twitter) cm.score += 8;
  if (so.website) cm.score += 5;
  const n = Number(so.telegram) + Number(so.twitter) + Number(so.website);
  if (n === 3) cm.good.push("Telegram + X + website \u2014 launches like this graduate ~17\xD7 more often.");
  else if (so.telegram) cm.good.push("Has a Telegram \u2014 the strongest single launch signal (8.9\xD7).");
  if (n < 3) cm.bad.push(`Missing ${[!so.telegram && "Telegram", !so.twitter && "X", !so.website && "website"].filter(Boolean).join(", ")}.`);
  const replies = L?.replyCount ?? null;
  if (replies === null) cm.unknown.push("launchpad replies");
  else if (replies >= 50) {
    cm.score += 4;
    cm.good.push(`${replies} replies on pump.fun \u2014 people are talking.`);
  } else if (replies >= 15) cm.score += 2;
  if (x.holderCount !== null) {
    if (x.holderCount >= 500) {
      cm.score += 3;
      cm.good.push(`${x.holderCount.toLocaleString("en-US")} holders already.`);
    } else if (x.holderCount >= 200) cm.score += 1;
  }
  const fl = acc(30);
  if (top10 === null) fl.unknown.push("top-10 concentration");
  else {
    fl.score += top10 <= 10 ? 12 : top10 <= 15 ? 8 : top10 <= 20 ? 4 : 0;
    (top10 <= 15 ? fl.good : fl.bad).push(`Top 10 wallets hold ${top10.toFixed(1)}% (curve/pool excluded).`);
  }
  if (whale === null) fl.unknown.push("largest wallet");
  else fl.score += whale <= 2 ? 8 : whale <= 3 ? 6 : whale <= 5 ? 3 : 0;
  if (dev === null) fl.unknown.push("dev holdings");
  else {
    fl.score += dev <= 1 ? 6 : dev <= 3 ? 4 : dev <= 5 ? 2 : 0;
    if (dev <= 1) fl.good.push("Dev holds ~nothing \u2014 no team bag over your head.");
  }
  const d = a.deployer;
  if (d?.priorLaunches != null && d.graduatedLaunches != null && d.priorLaunches >= 2 && d.graduatedLaunches / d.priorLaunches >= 0.5) {
    fl.score += 4;
    fl.good.push(`Creator has a track record \u2014 ${d.graduatedLaunches}/${d.priorLaunches} past coins graduated.`);
  } else if (d?.priorLaunches == null) fl.unknown.push("creator history");
  const mo = acc(25);
  const prog = L?.curveProgressPct ?? null;
  if (L?.bondingCurveComplete === true) {
    mo.score += 10;
    mo.good.push("Graduated off the bonding curve \u2014 real buyers carried it.");
  } else if (prog === null || x.ageHours === null) mo.unknown.push("curve progress");
  else {
    const perHour = prog / Math.max(x.ageHours, 0.25);
    mo.score += perHour >= 25 ? 10 : perHour >= 10 ? 6 : perHour >= 3 ? 3 : 0;
    if (perHour >= 10) mo.good.push(`Filling its curve fast \u2014 ${prog.toFixed(0)}% in ${fmtAge(x.ageHours)}.`);
    else if (perHour < 3) mo.bad.push(`Stalling \u2014 only ${prog.toFixed(0)}% of the curve after ${fmtAge(x.ageHours)}.`);
  }
  if (x.buyers24h !== null) {
    mo.score += x.buyers24h >= 300 ? 8 : x.buyers24h >= 100 ? 5 : x.buyers24h >= 40 ? 2 : 0;
    if (x.buyers24h >= 100) mo.good.push(`${x.buyers24h} different wallets buying \u2014 broad demand.`);
  } else if (L?.kingOfTheHill === true) {
    mo.score += 6;
    mo.good.push("Reached king of the hill on pump.fun.");
  } else mo.unknown.push("buyer breadth");
  const buys = x.buyers24h ?? a.market?.buys1h ?? null;
  const sells = x.sellers24h ?? a.market?.sells1h ?? null;
  if (buys !== null && sells !== null && buys + sells > 0) {
    if (buys >= sells) mo.score += 4;
    else mo.bad.push(`More selling than buying (${sells} vs ${buys}).`);
  }
  if (athR !== null) {
    if (athR >= 0.6) mo.score += 3;
    else if (athR >= 0.4) mo.score += 1;
    if (athR < 0.6) mo.bad.push(`${Math.round((1 - athR) * 100)}% below its peak.`);
  }
  const ch1h = a.market?.priceChange1h ?? null;
  if (ch1h !== null && ch1h >= 300 && volLiq !== null && volLiq < 0.2) {
    mo.score = Math.max(0, mo.score - 6);
    mo.bad.push(`+${ch1h.toFixed(0)}% in an hour on thin volume \u2014 artificial pump pattern.`);
  }
  const cv = acc(15);
  const hph = holdersPerHour(x.history, x.holderCount);
  if (hph === null) cv.unknown.push("holder growth (builds up while tracked)");
  else if (hph >= t.strongHoldersPerHour) {
    cv.score += 6;
    cv.good.push(`+${Math.round(hph)} holders/hour \u2014 the pace early winners show.`);
  } else if (hph >= t.okHoldersPerHour) cv.score += 3;
  else if (hph < 0) cv.bad.push("Holders are leaving.");
  const held = heldThroughDip(x.history);
  if (held === null) cv.unknown.push("reaction to its first dip");
  else if (held) {
    cv.score += 5;
    cv.good.push("Community held through a 25%+ dip \u2014 holders didn't panic.");
  } else cv.bad.push("Holders sold out on the first dip.");
  const first = x.history.find((h) => h.mcap !== null);
  if (first?.mcap && mcap !== null) {
    if (mcap >= first.mcap) cv.score += 4;
  } else cv.unknown.push("trend since first sight");
  const parts = [
    ["community", "Community signals", cm],
    ["fairLaunch", "Fair launch", fl],
    ["momentum", "Organic momentum", mo],
    ["conviction", "Holder conviction", cv]
  ];
  const pillars = parts.map(([key, label, p]) => ({
    key,
    label,
    score: Math.min(p.max, Math.max(0, p.score)),
    max: p.max,
    good: p.good,
    bad: p.bad,
    unknown: p.unknown
  }));
  const score = pillars.reduce((s, p) => s + p.score, 0);
  const coreVerified = m?.mintAuthorityActive === false && m?.freezeAuthorityActive === false && top10 !== null && whale !== null;
  let verdict;
  if (risk.insufficientData) verdict = "NO_DATA";
  else if (dq.length > 0) verdict = "REJECT";
  else if (score >= t.strongScore && coreVerified) verdict = "STRONG";
  else if (score >= t.promisingScore) verdict = "PROMISING";
  else verdict = "WEAK";
  return {
    stage: stageForAge(x.ageHours),
    verdict,
    score: verdict === "NO_DATA" ? null : score,
    pillars,
    disqualifiers: dq,
    hardBreak: dq.length > 0 && !softOnly,
    strengths: pillars.flatMap((p) => p.good),
    concerns: pillars.flatMap((p) => p.bad),
    unverified: pillars.flatMap((p) => p.unknown),
    ageHours: x.ageHours,
    curveProgressPct: prog
  };
}
function holdersPerHour(h, current2) {
  const pts = h.filter((s) => s.holders !== null).map((s) => ({ at: s.at, n: s.holders }));
  if (current2 !== null) pts.push({ at: Date.now(), n: current2 });
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const hours = (b.at - a.at) / 36e5;
  if (hours < 1) return null;
  return (b.n - a.n) / hours;
}
function heldThroughDip(h) {
  let peakMcap = 0;
  let peakHolders = null;
  for (const s of h) {
    if (s.mcap === null) continue;
    if (s.mcap > peakMcap) {
      peakMcap = s.mcap;
      peakHolders = s.holders;
      continue;
    }
    if (s.mcap <= peakMcap * 0.75 && peakHolders !== null && s.holders !== null) {
      return s.holders >= peakHolders * 0.97;
    }
  }
  return null;
}
function computeGemPortfolio(gems, horizonsDays, now2 = Date.now()) {
  return horizonsDays.map((days) => {
    const ms = days * 864e5;
    const eligible = gems.filter((g) => now2 - g.spottedAt >= ms && g.spottedMcap > 0);
    const results = [];
    for (const g of eligible) {
      const target = g.spottedAt + ms;
      const tol = Math.max(6 * 36e5, ms / 4);
      let best = null;
      for (const s of g.snapshots) {
        if (Math.abs(s.at - target) <= tol && (!best || Math.abs(s.at - target) < Math.abs(best.at - target))) best = s;
      }
      if (!best) continue;
      if (best.dead) results.push({ mult: 0, dead: true, sym: g.symbol });
      else if (best.mcap !== null) results.push({ mult: best.mcap / g.spottedMcap, dead: false, sym: g.symbol });
    }
    const mults = results.map((r) => r.mult).sort((a, b) => a - b);
    const top = results.reduce((b, r) => !b || r.mult > b.mult ? r : b, null);
    return {
      horizonDays: days,
      eligible: eligible.length,
      measured: results.length,
      alive: results.filter((r) => !r.dead && r.mult >= 0.1).length,
      portfolioMultiple: mults.length ? mults.reduce((s, v) => s + v, 0) / mults.length : null,
      medianMultiple: mults.length ? median2(mults) : null,
      bestMultiple: top ? top.mult : null,
      bestSymbol: top ? top.sym : null
    };
  });
}
function median2(sorted) {
  const k = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;
}
function fmtAge(h) {
  return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)}h` : `${Math.floor(h / 24)} days`;
}

// lib/radarScreen.ts
function quickScreen(m, ageDays, t = LONG_HOLD) {
  const liq = m.liquidityUsd;
  const mcap = m.marketCapUsd;
  const fail = (reason, dead = false) => ({ pass: false, dead, reason, rank: 0, headline: reason });
  const live = assessLiveState({
    priceEur: m.priceUsd,
    marketCapEur: mcap,
    liquidityEur: liq,
    volume24hEur: m.volume24hUsd,
    lpStatus: "unknown",
    sellSimulation: null,
    priceChange1h: m.priceChange1h,
    priceChange6h: m.priceChange6h,
    priceChange24h: m.priceChange24h,
    buys1h: m.buys1h,
    sells1h: m.sells1h
  });
  if (liq === null || liq < 5e3 || live.state === "DEAD") return fail("Dead \u2014 liquidity gone or price collapsed.", true);
  if (ageDays === null) return fail("Age unknown.");
  if (ageDays < t.radarMinAgeDays) return fail("Under a day old \u2014 the gem tracker covers launches.");
  if (ageDays > t.radarMaxAgeDays) return fail(`${Math.floor(ageDays)} days old \u2014 past the early window.`);
  if (mcap === null || mcap < t.radarMinMcapUsd) return fail("Market cap too small to trade safely.");
  if (mcap > t.radarMaxMcapUsd) return fail("Already big \u2014 the early run is done.");
  if (liq < t.radarMinLiquidityUsd) return fail("Liquidity too thin.");
  if (liq / mcap < 0.03) return fail("Liquidity under 3% of cap \u2014 fragile.");
  const vol = m.volume24hUsd;
  if (vol !== null && vol / liq > t.washVolLiqRatio) return fail("Volume over 10\xD7 liquidity \u2014 wash trading.");
  if (live.state === "DUMPING") return fail(`Dumping \u2014 ${live.reasons[0] ?? "falling hard."}`);
  if (m.priceChange24h !== null && m.priceChange24h <= -50) return fail("Down 50%+ in 24h.");
  const buys = m.buys1h ?? 0;
  const sells = m.sells1h ?? 0;
  const tx = buys + sells;
  let rank = Math.min(30, Math.log10(1 + tx) * 12);
  const buyShare = tx > 0 ? buys / tx : 0;
  rank += buyShare >= 0.6 ? 20 : buyShare >= 0.5 ? 12 : buyShare >= 0.4 ? 5 : 0;
  const depth = liq / mcap;
  rank += depth >= 0.15 ? 20 : depth >= 0.1 ? 15 : depth >= 0.05 ? 8 : 0;
  const h6 = m.priceChange6h ?? 0;
  const h24 = m.priceChange24h ?? 0;
  rank += h6 > 0 && h24 > 0 ? 15 : h24 > 0 ? 8 : 0;
  rank += ageDays <= 7 ? 15 : ageDays <= 14 ? 10 : 5;
  const headline = `${fmtAge2(ageDays)} \xB7 ${usd(mcap)} cap \xB7 ${usd(liq)} liq` + (tx > 0 ? ` \xB7 ${buys}/${sells} buys/sells 1h` : "") + (m.priceChange24h !== null ? ` \xB7 ${m.priceChange24h >= 0 ? "+" : ""}${m.priceChange24h.toFixed(0)}% 24h` : "");
  return { pass: true, dead: false, reason: null, rank: Math.round(rank), headline };
}
function usd(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}
function fmtAge2(d) {
  return d < 2 ? `${Math.round(d * 24)}h old` : `${Math.floor(d)}d old`;
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
    if (mint.transferFeeBps !== null && mint.transferFeeBps > LIMITS.transferFeeVeryHighBps) {
      hard.push(`Every sell pays a ${(mint.transferFeeBps / 100).toFixed(1)}% transfer tax \u2014 exit is taxed away.`);
    }
    if (mint.isToken2022 === true && mint.feeAuthorityActive === true) {
      soft.push("Fee authority is live \u2014 the transfer tax can be raised after you buy.");
    }
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

// lib/longHold.ts
var acc2 = (max) => ({ score: 0, max, good: [], bad: [], unknown: [] });
function assessLongHold(a, risk, x, t = LONG_HOLD) {
  const disqualifiers = [];
  const mcap = a.market?.marketCapEur ?? null;
  const liq = a.market?.liquidityEur ?? null;
  const k = x.candles && x.candles.length > 0 ? x.candles : null;
  const rug = assessRugPotential(a, risk);
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") disqualifiers.push(`Already rugged/dead \u2014 ${live.reasons[0] ?? "market collapsed."}`);
  if (live.state === "DUMPING") disqualifiers.push(`Dumping right now \u2014 ${live.reasons[0] ?? "price falling hard."}`);
  if (a.mint?.mintAuthorityActive === true) disqualifiers.push("Mint authority active \u2014 supply can be inflated forever.");
  if (a.mint?.freezeAuthorityActive === true) disqualifiers.push("Freeze authority active \u2014 your wallet can be frozen.");
  if (rug.verdict === "HIGH") disqualifiers.push(`Rug vector open: ${rug.vectors[0] ?? "see rug check."}`);
  const lp = a.market?.lpStatus ?? "unknown";
  if (lp === "unlocked" || lp === "deployer_held") disqualifiers.push("Liquidity is not burned or locked \u2014 it can be pulled.");
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > t.maxLargestWalletPct) {
    disqualifiers.push(`One wallet holds ${whale.toFixed(1)}% \u2014 a long hold means waiting on their exit.`);
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev > t.maxDevPct) disqualifiers.push(`Dev still holds ${dev.toFixed(1)}% of supply.`);
  const top10 = a.holders?.top10Pct ?? null;
  if (top10 !== null && top10 > t.maxTop10Pct) disqualifiers.push(`Top 10 wallets hold ${top10.toFixed(0)}% \u2014 too concentrated to survive.`);
  const volLiq = a.market?.volume24hEur != null && liq ? a.market.volume24hEur / liq : null;
  if (volLiq !== null && volLiq > t.washVolLiqRatio) {
    disqualifiers.push(`24h volume is ${volLiq.toFixed(0)}\xD7 its liquidity \u2014 almost certainly wash-traded.`);
  }
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) disqualifiers.push("Creator is a serial launcher of dead coins.");
  const sv = acc2(20);
  const age = x.ageDays;
  if (age === null) sv.unknown.push("coin age");
  else {
    const pts = age >= 90 ? 16 : age >= 30 ? 14 : age >= 14 ? 12 : age >= 7 ? 9 : age >= t.minAgeDays ? 6 : 0;
    sv.score += pts;
    if (age >= t.minAgeDays) sv.good.push(`Survived ${fmtDays(age)} \u2014 past the window where ~95% of launches die.`);
    else sv.bad.push(`Only ${fmtDays(age)} old \u2014 inside the rug/abandon window.`);
  }
  if (k && age !== null && age >= t.minAgeDays) {
    const span = Math.max(1, Math.round((k[k.length - 1].t - k[0].t) / 86400) + 1);
    const active = k.filter((c) => c.v > 0).length;
    const ratio = Math.min(1, active / span);
    if (ratio >= 0.9) {
      sv.score += 4;
      sv.good.push("Traded every day \u2014 never went quiet.");
    } else if (ratio < 0.7) sv.bad.push("Went quiet for stretches \u2014 interest is not continuous.");
    else sv.score += 2;
  }
  const cm = acc2(15);
  if (x.socials.telegram) cm.score += 4;
  if (x.socials.twitter) cm.score += 3;
  if (x.socials.website) cm.score += 2;
  const nSocial = Number(x.socials.telegram) + Number(x.socials.twitter) + Number(x.socials.website);
  if (nSocial === 3) cm.good.push("X + Telegram + website \u2014 the pattern with a 17\xD7 higher survival rate.");
  else if (nSocial === 0) cm.bad.push("No socials \u2014 coins without them almost never last.");
  else cm.bad.push(`Missing ${[!x.socials.telegram && "Telegram", !x.socials.twitter && "X", !x.socials.website && "website"].filter(Boolean).join(", ")}.`);
  if (x.holderCount === null) cm.unknown.push("holder count");
  else if (x.holderCount >= 5e3) {
    cm.score += 3;
    cm.good.push(`${fmtInt(x.holderCount)} holders.`);
  } else if (x.holderCount >= 1e3) {
    cm.score += 1;
    cm.good.push(`${fmtInt(x.holderCount)} holders \u2014 a growing community.`);
  } else cm.bad.push(`Only ${fmtInt(x.holderCount)} holders.`);
  const growth = holderGrowthPerDay(x.holderHistory);
  if (growth === null) cm.unknown.push("holder growth (tracked over time \u2014 needs 1+ day of history)");
  else if (growth >= 1) {
    cm.score += 3;
    cm.good.push(`Holders growing ~${growth.toFixed(1)}%/day.`);
  } else if (growth >= 0) cm.score += 1;
  else cm.bad.push(`Holders shrinking (${growth.toFixed(1)}%/day) \u2014 people are leaving.`);
  const ds = acc2(20);
  if (top10 === null) ds.unknown.push("top-10 concentration");
  else {
    ds.score += top10 <= 15 ? 10 : top10 <= 25 ? 7 : top10 <= 35 ? 4 : 0;
    (top10 <= 25 ? ds.good : ds.bad).push(`Top 10 real wallets hold ${top10.toFixed(0)}%.`);
  }
  if (whale === null) ds.unknown.push("largest wallet");
  else {
    ds.score += whale <= 2 ? 6 : whale <= 4 ? 4 : whale <= t.maxLargestWalletPct ? 2 : 0;
    if (whale <= 2) ds.good.push(`No whale \u2014 largest wallet ${whale.toFixed(1)}%.`);
  }
  if (dev === null) ds.unknown.push("dev holdings");
  else {
    ds.score += dev <= 1 ? 4 : dev <= 3 ? 2 : 0;
    if (dev <= 1) ds.good.push("Dev holds ~nothing \u2014 no team bag waiting to sell.");
  }
  const lq = acc2(15);
  if (lp === "burned") {
    lq.score += 5;
    lq.good.push("LP burned \u2014 liquidity can never be pulled.");
  } else if (lp === "locked") {
    lq.score += 3;
    lq.bad.push("LP \u226590% locked or burned \u2014 if it is a time-lock, check when it expires.");
  } else if (lp === "unknown") lq.unknown.push("LP burn/lock");
  if (liq === null || mcap === null || mcap <= 0) lq.unknown.push("liquidity depth");
  else {
    const r = liq / mcap;
    lq.score += r >= 0.1 ? 5 : r >= 0.05 ? 3 : r >= 0.03 ? 1 : 0;
    lq.score += liq >= 25e4 ? 5 : liq >= 1e5 ? 3 : liq >= 5e4 ? 1 : 0;
    if (r < 0.03) lq.bad.push(`Liquidity only ${(r * 100).toFixed(1)}% of cap \u2014 price is fragile.`);
    else if (liq >= 1e5) lq.good.push(`Deep liquidity ($${fmtK(liq)}, ${(r * 100).toFixed(0)}% of cap).`);
  }
  const dm = acc2(15);
  if (volLiq === null) dm.unknown.push("volume vs liquidity");
  else if (volLiq >= 0.1 && volLiq <= 1) {
    dm.score += 5;
    dm.good.push("Healthy trading volume for its liquidity.");
  } else if (volLiq > 1 && volLiq <= 3) dm.score += 2;
  else if (volLiq > t.suspiciousVolLiqRatio) dm.bad.push(`Volume ${volLiq.toFixed(1)}\xD7 liquidity \u2014 suspicious, possibly wash-traded.`);
  else if (volLiq < 0.1) dm.bad.push("Barely trading \u2014 interest has faded.");
  if (x.buyers24h === null) dm.unknown.push("unique buyers");
  else {
    dm.score += x.buyers24h >= 300 ? 4 : x.buyers24h >= 100 ? 2 : 0;
    if (x.buyers24h >= 300) dm.good.push(`${fmtInt(x.buyers24h)} different wallets bought in 24h \u2014 real demand.`);
    else if (x.buyers24h < 50) dm.bad.push(`Only ${x.buyers24h} unique buyers in 24h.`);
    if (x.sellers24h !== null && x.sellers24h > 0) {
      if (x.buyers24h >= x.sellers24h * 0.8) dm.score += 3;
      else dm.bad.push(`More wallets selling (${x.sellers24h}) than buying (${x.buyers24h}).`);
    }
  }
  const ch24 = a.market?.priceChange24h ?? null;
  if (ch24 !== null && ch24 >= 100 && volLiq !== null && volLiq < 0.2) {
    dm.score = Math.max(0, dm.score - 5);
    dm.bad.push(`Up ${ch24.toFixed(0)}% on thin volume \u2014 the signature of artificial price inflation.`);
  }
  if (k && k.length >= 14) {
    const recent = avg(k.slice(-7).map((c) => c.v));
    const prior = avg(k.slice(-14, -7).map((c) => c.v));
    if (prior > 0 && recent >= prior * 0.4) {
      dm.score += 3;
      if (recent >= prior) dm.good.push("Volume holding up week over week \u2014 not a one-off spike.");
    } else if (prior > 0) dm.bad.push("Volume collapsed vs the week before \u2014 hype is fading.");
  } else dm.unknown.push("volume persistence (needs 14 days of history)");
  const rs = acc2(15);
  let deathSpiral = false;
  if (!k || k.length < 7) rs.unknown.push("price history (needs 7+ days)");
  else {
    const p = pricePath(k);
    if (k.length >= 14) {
      const lowRecent = Math.min(...k.slice(-7).map((c) => c.l));
      const lowPrior = Math.min(...k.slice(-14, -7).map((c) => c.l));
      if (lowRecent > lowPrior) {
        rs.score += 5;
        rs.good.push("Making higher lows \u2014 buyers are stepping in earlier each dip.");
      } else rs.bad.push("Still making lower lows.");
      deathSpiral = p.closeVsAth < t.deathSpiralAthShare && lowRecent <= lowPrior;
      const volRecent = stdevLogReturns(k.slice(-8));
      const volPrior = stdevLogReturns(k.slice(-15, -7));
      if (volRecent !== null && volPrior !== null && volRecent < volPrior) {
        rs.score += 3;
        rs.good.push("Volatility calming \u2014 the market is maturing.");
      }
    }
    if (p.maxDrawdown >= 0.4 && p.recoveryFromLow >= 1.6) {
      rs.score += 4;
      rs.good.push(`Survived a ${(p.maxDrawdown * 100).toFixed(0)}% shakeout and bounced ${p.recoveryFromLow.toFixed(1)}\xD7 off the low \u2014 holders didn't give up.`);
    } else if (p.maxDrawdown < 0.4 && k.length >= 14) {
      rs.score += 4;
      rs.good.push("No major crash in its history so far.");
    } else if (p.maxDrawdown >= 0.6 && p.recoveryFromLow < 1.15) {
      rs.bad.push(`Down ${(p.maxDrawdown * 100).toFixed(0)}% and still sitting at its lows.`);
    }
    if (p.closeVsAth >= 0.25) rs.score += 3;
    else rs.bad.push(`${((1 - p.closeVsAth) * 100).toFixed(0)}% below its all-time high.`);
  }
  if (deathSpiral) disqualifiers.push("Death spiral \u2014 under 10% of its high and still making lower lows.");
  const parts = [
    ["survival", "Survival", sv],
    ["community", "Community", cm],
    ["distribution", "Fair distribution", ds],
    ["liquidity", "Liquidity", lq],
    ["demand", "Organic demand", dm],
    ["resilience", "Price resilience", rs]
  ];
  const pillars = parts.map(([key, label, p]) => ({
    key,
    label,
    score: Math.min(p.max, Math.max(0, p.score)),
    max: p.max,
    good: p.good,
    bad: p.bad,
    unknown: p.unknown
  }));
  const score = Math.round(pillars.reduce((s, p) => s + p.score, 0));
  const unverified = pillars.flatMap((p) => p.unknown);
  const coreVerified = a.mint?.mintAuthorityActive === false && a.mint?.freezeAuthorityActive === false && (lp === "burned" || lp === "locked") && top10 !== null && whale !== null && k !== null && k.length >= 7;
  let tier;
  if (risk.insufficientData) tier = "NO_DATA";
  else if (disqualifiers.length > 0) tier = "NOT_A_HOLD";
  else if (age !== null && age < t.minAgeDays) tier = "TOO_EARLY";
  else if (mcap !== null && mcap > t.lateMcapUsd) tier = "LATE";
  else if (score >= t.candidateScore && coreVerified) tier = "CANDIDATE";
  else if (score >= t.watchScore) tier = "WATCH";
  else tier = "WEAK";
  const strengths = pillars.flatMap((p) => p.good);
  if (mcap !== null && mcap < t.earlyMcapUsd && tier !== "NOT_A_HOLD") {
    strengths.push(`Still early \u2014 $${fmtK(mcap)} market cap.`);
  }
  return {
    tier,
    score: tier === "NO_DATA" ? null : score,
    pillars,
    disqualifiers,
    strengths,
    concerns: pillars.flatMap((p) => p.bad),
    unverified,
    coreVerified,
    ageDays: age,
    historyDays: k ? k.length : 0
  };
}
function pricePath(k) {
  let peak = k[0].h;
  let maxDd = 0;
  let ddLow = k[0].l;
  for (const c of k) {
    if (c.h > peak) peak = c.h;
    const dd = 1 - c.l / peak;
    if (dd > maxDd) {
      maxDd = dd;
      ddLow = c.l;
    }
  }
  const ath = Math.max(...k.map((c) => c.h));
  const close = k[k.length - 1].c;
  return { maxDrawdown: maxDd, recoveryFromLow: ddLow > 0 ? close / ddLow : 1, closeVsAth: ath > 0 ? close / ath : 0 };
}
function stdevLogReturns(k) {
  if (k.length < 3) return null;
  const r = [];
  for (let i = 1; i < k.length; i++) if (k[i - 1].c > 0 && k[i].c > 0) r.push(Math.log(k[i].c / k[i - 1].c));
  if (r.length < 2) return null;
  const m = avg(r);
  return Math.sqrt(avg(r.map((v) => (v - m) ** 2)));
}
function holderGrowthPerDay(h) {
  if (h.length < 2) return null;
  const first = h[0];
  const last = h[h.length - 1];
  const days = (last.at - first.at) / 864e5;
  if (days < 0.8 || first.holderCount <= 0) return null;
  return (last.holderCount / first.holderCount - 1) * 100 / days;
}
var avg = (xs) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
var fmtInt = (n) => Math.round(n).toLocaleString("en-US");
function fmtK(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}
function fmtDays(d) {
  return d < 1 ? `${Math.round(d * 24)}h` : `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}`;
}

// lib/lpStatus.ts
var PUMP_MIGRATION_DEXES = /* @__PURE__ */ new Set(["pumpswap", "raydium"]);
var CURVE_DEXES = /* @__PURE__ */ new Set(["pumpfun", "moonshot", "launchlab"]);
function onLaunchCurve(pumpGraduated, deepestDexId) {
  if (pumpGraduated !== null) return !pumpGraduated;
  return deepestDexId !== null && CURVE_DEXES.has(deepestDexId);
}
function resolveLpStatus(i) {
  if (onLaunchCurve(i.pumpGraduated, i.deepestDexId)) return "unknown";
  if (i.gmgn && i.gmgn !== "unknown") return i.gmgn;
  if (i.pumpGraduated === true) {
    if (i.deepestDexId !== null && PUMP_MIGRATION_DEXES.has(i.deepestDexId)) return "burned";
    if (i.deepestDexId === null) return i.audit === "unlocked" ? "unknown" : i.audit ?? "unknown";
  }
  return i.audit ?? "unknown";
}
function lpStatusFromLockedPct(pct) {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct >= 90) return "locked";
  if (pct <= 50) return "unlocked";
  return null;
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
      bondingCurveAccounts: [],
      curveProgressPct: null,
      athRatio: null,
      kingOfTheHill: null
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
    ].filter((s) => s !== null),
    curveProgressPct: curveProgress(asBoolLoose(pick(json, ["complete"])), asNumber(pick(json, ["real_sol_reserves"]))),
    athRatio: athRatio(asNumber(pick(json, ["market_cap"])), asNumber(pick(json, ["ath_market_cap"]))),
    // Present-but-null = never reached it; key missing entirely = unknown.
    kingOfTheHill: typeof json === "object" && json !== null && "king_of_the_hill_timestamp" in json ? pick(json, ["king_of_the_hill_timestamp"]) != null : null
  };
}
function curveProgress(complete, realSolLamports) {
  if (complete === true) return 100;
  if (realSolLamports === null || realSolLamports < 0) return null;
  const sol = realSolLamports / 1e9;
  if (sol > 120) return null;
  return Math.min(100, sol / 85 * 100);
}
function athRatio(mcap, athMcap) {
  if (mcap === null || athMcap === null || athMcap <= 0 || mcap <= 0) return null;
  const r = mcap / athMcap;
  return r > 1.05 ? null : Math.min(1, r);
}
var BASE58_RE2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function fetchPumpfunNewCoins(limit, offset = 0) {
  if (MOCK_MODE || !PUMPFUN.enabled) return [];
  const path = PUMPFUN.listEndpoint.replace("{offset}", String(offset)).replace("{limit}", String(limit));
  const json = await fetchJson(`${PUMPFUN.baseUrl}${path}`);
  const arr = Array.isArray(json) ? json : Array.isArray(json?.coins) ? json.coins : [];
  const out = [];
  for (const c of arr) {
    const mint = asString(pick(c, ["mint", "address", "coin_mint"]));
    if (!mint || !BASE58_RE2.test(mint)) continue;
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
  bondingCurveAccounts: [],
  curveProgressPct: null,
  athRatio: null,
  kingOfTheHill: null
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
var BASE58_RE3 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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
      if (pairAddr && base && BASE58_RE3.test(base)) {
        out[pairAddr] = { address: base, symbol: asString(pick(p, ["baseToken.symbol"])) };
      }
    }
  }
  return out;
}
function toMarket(best) {
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
    pairCreatedMs: asNumber(pick(best, ["pairCreatedAt"])),
    pairAddress: asString(pick(best, ["pairAddress"])),
    dexId: asString(pick(best, ["dexId"]))
  };
}
function deepestByMint(pairs) {
  const best = /* @__PURE__ */ new Map();
  const bestLiq = /* @__PURE__ */ new Map();
  for (const p of pairs) {
    if (asString(pick(p, ["chainId"])) !== "solana") continue;
    const base = asString(pick(p, ["baseToken.address"]));
    if (!base) continue;
    const liq = asNumber(pick(p, ["liquidity.usd"])) ?? 0;
    if (liq > (bestLiq.get(base) ?? -1)) {
      bestLiq.set(base, liq);
      best.set(base, p);
    }
  }
  return best;
}
var marketCache = /* @__PURE__ */ new Map();
var MARKET_TTL_MS = 6e4;
var MARKET_CACHE_MAX = 600;
function cacheMarket(mint, m) {
  if (marketCache.size > MARKET_CACHE_MAX) marketCache.clear();
  marketCache.set(mint, { m, at: Date.now() });
}
async function primeDexscreenerTokens(mints) {
  if (MOCK_MODE || !DEXSCREENER.enabled) return;
  const now2 = Date.now();
  const need = [
    ...new Set(
      mints.filter((m) => {
        if (!BASE58_RE3.test(m)) return false;
        const hit = marketCache.get(m);
        return !hit || now2 - hit.at > MARKET_TTL_MS;
      })
    )
  ];
  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30);
    const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
    if (json === null) continue;
    const pairs = json.pairs;
    const best = deepestByMint(Array.isArray(pairs) ? pairs : []);
    for (const mint of chunk) {
      const p = best.get(mint);
      cacheMarket(mint, p ? toMarket(p) : null);
    }
  }
}
function peekDexscreenerToken(mint) {
  const hit = marketCache.get(mint);
  return hit && Date.now() - hit.at < MARKET_TTL_MS ? hit.m : void 0;
}
async function fetchDexscreenerToken(mint, fresh = false) {
  const r = await lookupDexscreenerToken(mint, fresh);
  return r.status === "ok" ? r.market : null;
}
async function lookupDexscreenerToken(mint, fresh = false) {
  if (MOCK_MODE || !DEXSCREENER.enabled || !BASE58_RE3.test(mint)) return { status: "error" };
  const hit = marketCache.get(mint);
  if (!fresh && hit && Date.now() - hit.at < MARKET_TTL_MS) return { status: "ok", market: hit.m };
  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const pairs = json?.pairs;
  if (json === null) return { status: "error" };
  if (!Array.isArray(pairs)) {
    cacheMarket(mint, null);
    return { status: "ok", market: null };
  }
  const best = deepestByMint(pairs).get(mint) ?? null;
  const market = best ? toMarket(best) : null;
  cacheMarket(mint, market);
  return { status: "ok", market };
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
    if (!addr || !BASE58_RE3.test(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
    if (out.length >= limit) break;
  }
  return out;
}
async function fetchDexscreenerBoostedSolana() {
  if (MOCK_MODE || !DEXSCREENER.enabled) return [];
  const out = /* @__PURE__ */ new Set();
  for (const url of DEXSCREENER.boostsUrls) {
    const json = await fetchJson(url);
    const arr = Array.isArray(json) ? json : [];
    for (const item of arr) {
      if (asString(pick(item, ["chainId"])) !== "solana") continue;
      const addr = asString(pick(item, ["tokenAddress"]));
      if (addr && BASE58_RE3.test(addr)) out.add(addr);
    }
  }
  return [...out];
}

// lib/gemCriteria.ts
function gemBackgroundCheck(a, risk, quality) {
  const blockers = [];
  if (risk.insufficientData || quality.insufficientData) {
    blockers.push("Not enough data for a background check.");
    return { gem: false, blockers };
  }
  if (risk.riskScore > LIVE_FEED.notifyMaxScore) {
    blockers.push(`Too many weighted red flags to clear the gem gate (${risk.reasons.length} flag${risk.reasons.length === 1 ? "" : "s"}).`);
  }
  if (quality.qualityScore < LIVE_FEED.gemMinQuality) {
    blockers.push("Not enough positive signals yet (liquidity depth, holder spread, socials, age).");
  }
  const m = a.mint;
  if (!m) {
    blockers.push("Mint account not verified \u2014 cannot rule out mint/freeze authority.");
  } else {
    if (m.mintAuthorityActive !== false) {
      blockers.push(m.mintAuthorityActive ? "Mint authority is ACTIVE \u2014 dev can print unlimited supply." : "Mint authority not verified.");
    }
    if (m.freezeAuthorityActive !== false) {
      blockers.push(m.freezeAuthorityActive ? "Freeze authority is ACTIVE \u2014 your wallet can be frozen." : "Freeze authority not verified.");
    }
    if (m.permanentDelegateActive === true) blockers.push("Permanent delegate \u2014 dev can take tokens out of your wallet.");
    if (m.nonTransferable === true) blockers.push("Non-transferable token \u2014 you cannot sell.");
    if (m.defaultAccountFrozen === true) blockers.push("New holder accounts start frozen.");
    if (m.transferHookActive === true) blockers.push("Transfer hook \u2014 dev code runs on every transfer and can block sells.");
    if (m.isToken2022 === true && m.feeAuthorityActive === true) {
      blockers.push("Fee authority live \u2014 the transfer tax can be raised after you buy.");
    }
    if (m.transferFeeBps !== null && m.transferFeeBps > LIMITS.transferFeeHighBps) {
      blockers.push(`Transfer tax ${(m.transferFeeBps / 100).toFixed(1)}% on every sell.`);
    }
  }
  if (a.market?.sellSimulation?.ok === false) blockers.push("Simulated sell FAILS \u2014 honeypot.");
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

// lib/jupiterClient.ts
var SOL_MINT = "So11111111111111111111111111111111111111112";
async function fetchSellQuote(mint, priceUsd, decimals, sizeUsd) {
  if (MOCK_MODE || !JUPITER.enabled) return null;
  if (priceUsd === null || !(priceUsd > 0) || decimals === null || decimals < 0 || decimals > 18) return null;
  const raw = rawAmountFor(sizeUsd, priceUsd, decimals);
  if (raw === null) return null;
  const url = `${JUPITER.quoteUrl}?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${raw}&slippageBps=${JUPITER.slippageBps}&swapMode=ExactIn`;
  const json = await fetchJson(url);
  return parseSellQuote(json, sizeUsd);
}
function rawAmountFor(sizeUsd, priceUsd, decimals) {
  const tokens = sizeUsd / priceUsd;
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  const [whole, frac = ""] = tokens.toFixed(Math.min(decimals, 12)).split(".");
  const digits = (whole + frac.padEnd(decimals, "0").slice(0, decimals)).replace(/^0+/, "");
  return digits.length > 0 ? digits : null;
}
function parseSellQuote(json, sizeUsd) {
  if (!json || typeof json !== "object") return null;
  const q = json;
  const out = asNumber(q.outAmount);
  if (out === null || out <= 0 || !Array.isArray(q.routePlan) || q.routePlan.length === 0) return null;
  const frac = asNumber(q.priceImpactPct);
  if (frac === null || frac < 0) return null;
  return { priceImpactPct: Math.min(100, Math.round(frac * 1e3) / 10), sizeUsd };
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
    if (raw > limit * 0.7) caps.push(`Ceiling ${limit}%: ${why}`);
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
  const grade = Math.round(Math.max(0, capCurve(raw, ceiling)));
  return { grade, label: gradeLabel(grade), caps, parts: { safety, quality: quality.qualityScore, coveragePct } };
}
function capCurve(raw, ceiling) {
  if (ceiling >= 100) return raw;
  const knee = ceiling * 0.7;
  if (raw <= knee) return raw;
  return knee + (ceiling - knee) * ((Math.min(raw, 100) - knee) / (100 - knee));
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
function fmtK2(n) {
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
      hit(w.liquidityDepth, `Real liquidity depth ($${Math.round(m.liquidityEur / 1e3)}k, ${(m.liquidityEur / m.marketCapEur * 100).toFixed(0)}% of cap).`);
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
      hit(pts, `Curve traction: $${fmtK2(a.market.marketCapEur)} cap (~${Math.round(progress * 100)}% to graduation).`);
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
          `Thin liquidity ($${fmtK3(market.liquidityEur)}) vs. cap ($${fmtK3(market.marketCapEur)}) \u2014 easy to manipulate.`
        );
      }
      if (market.marketCapEur < l.microMcapEur && lpSecured === false) {
        hit(w.microMcapUnlockedLp, `Micro cap ($${fmtK3(market.marketCapEur)}) with unsecured LP \u2014 high rug exposure.`);
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
function fmtK3(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
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
  if (current2.liveState === "DEAD" && baseline.liveState !== "DEAD") {
    alerts.push({ kind: "dead", message: "Liquidity pulled / price collapsed \u2014 this coin looks rugged. Exit if you still can." });
  } else if (current2.liveState === "DUMPING" && baseline.liveState !== "DUMPING" && baseline.liveState !== "DEAD") {
    alerts.push({ kind: "dumping", message: "Dumping right now \u2014 sharp drop and/or sells dominating in the last hour." });
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
    const lpStatus = lpStatusFromLockedPct(asNumber(pick(json, ["lpLockedPct", "markets.0.lp.lpLockedPct"])));
    return { status: "ok", lpStatus, externalFlags };
  }
};

// lib/holderMath.ts
var SYSTEM_PROGRAM = "11111111111111111111111111111111";
function classifyHolder(acc3, burnAddresses, knownPoolOwners) {
  if (acc3.owner !== null && burnAddresses.has(acc3.owner)) return "burn";
  if (acc3.owner !== null && knownPoolOwners.has(acc3.owner)) return "program";
  if (acc3.ownerProgram !== null && acc3.ownerProgram !== SYSTEM_PROGRAM) return "program";
  return "wallet";
}
function computeConcentration(accounts, supply, burnAddresses, knownPoolOwners = /* @__PURE__ */ new Set()) {
  if (!(supply > 0)) return null;
  const pct = (xs) => Math.min(100, xs.reduce((s, a) => s + a.amount, 0) / supply * 100);
  const wallets = [];
  const programs = [];
  const burns = [];
  for (const a of accounts) {
    const kind = classifyHolder(a, burnAddresses, knownPoolOwners);
    (kind === "wallet" ? wallets : kind === "program" ? programs : burns).push(a);
  }
  const byOwner = /* @__PURE__ */ new Map();
  for (const w of wallets) {
    const k = w.owner ?? `acct:${w.address}`;
    byOwner.set(k, (byOwner.get(k) ?? 0) + w.amount);
  }
  const ranked = [...byOwner.values()].sort((a, b) => b - a).map((amount) => ({ amount }));
  return {
    top5Pct: pct(ranked.slice(0, 5)),
    top10Pct: pct(ranked.slice(0, 10)),
    largestWalletPct: ranked.length > 0 ? pct(ranked.slice(0, 1)) : null,
    programHeldPct: pct(programs),
    burnedPct: pct(burns)
  };
}
function effectiveTransferFeeBps(olderBps, newerBps) {
  if (olderBps === null && newerBps === null) return null;
  return Math.max(olderBps ?? 0, newerBps ?? 0);
}
function uiAmountOf(v) {
  if (!v) return null;
  for (const raw of [v.uiAmountString, v.uiAmount]) {
    const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// lib/solanaClient.ts
var TOKEN_2022_PROGRAM2 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
async function fetchSolanaData(address, lite = false, excludeTokenAccounts = [], creatorAddress = null, curveComplete = null) {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return { mint: f.mint, holders: f.holders, decimals: null, status: "mock" };
  }
  if (lite) {
    const [mi2, holders2] = await Promise.all([fetchMintInfo(address), fetchHolderInfoLite(address, excludeTokenAccounts, curveComplete)]);
    return { mint: mi2?.mint ?? null, holders: holders2, decimals: mi2?.decimals ?? null, status: mi2 ? "partial" : "unavailable" };
  }
  const [mi, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfo(address, creatorAddress)]);
  const mint = mi?.mint ?? null;
  const status = mint && holders ? "ok" : mint || holders ? "partial" : "unavailable";
  return { mint, holders, decimals: mi?.decimals ?? null, status };
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
        const older = state.olderTransferFee ?? {};
        const newer = state.newerTransferFee ?? {};
        transferFeeBps = effectiveTransferFeeBps(asNumber(older.transferFeeBasisPoints), asNumber(newer.transferFeeBasisPoints)) ?? 0;
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
    mint: {
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
    },
    decimals: asNumber(info.decimals)
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
  const supply = uiAmountOf(supplyRes?.value);
  const raw = parseLargest(largestRes);
  if (supply === null || supply <= 0 || raw.length === 0) return null;
  const owners = await fetchOwners(raw.map((a) => a.address));
  const ownerPrograms = await fetchOwnerPrograms(owners);
  const accounts = raw.map((a, i) => ({
    address: a.address,
    amount: a.amount,
    owner: owners[i],
    ownerProgram: owners[i] ? ownerPrograms.get(owners[i]) ?? null : null
  }));
  const conc = computeConcentration(
    accounts,
    supply,
    new Set(SOLANA.burnAddresses),
    new Set(SOLANA.knownPoolAuthorities)
  );
  if (!conc) return null;
  const pctOf = (pred) => Math.min(100, accounts.reduce((s, a) => pred(a) ? s + a.amount : s, 0) / supply * 100);
  const smartSet = new Set(SMART_MONEY_WALLETS);
  const smartMoneyPct = smartSet.size === 0 ? null : pctOf((a) => a.owner !== null && smartSet.has(a.owner));
  const devHoldsPct = creatorAddress === null ? null : pctOf((a) => a.owner === creatorAddress);
  return {
    holderCount: null,
    // plain RPC has no cheap holder count; GMGN fills this in when live
    top5Pct: conc.top5Pct,
    top10Pct: conc.top10Pct,
    largestNonLpWalletPct: conc.largestWalletPct,
    bundledLaunchPct: null,
    // needs block-0..2 funding-graph analysis; honest "unknown" for now
    smartMoneyPct,
    devHoldsPct
  };
}
function parseLargest(largestRes) {
  const value = largestRes?.value;
  return (value ?? []).map((a) => ({ address: a.address ?? "", amount: uiAmountOf(a) ?? 0 })).filter((a) => a.address && a.amount > 0);
}
async function fetchHolderInfoLite(address, excludeTokenAccounts, curveComplete) {
  if (curveComplete !== false) return null;
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), "getTokenSupply", [address, { commitment: "confirmed" }]),
    rpcCall(rpcUrlPool(), "getTokenLargestAccounts", [address, { commitment: "confirmed" }])
  ]);
  const supply = uiAmountOf(supplyRes?.value);
  const excluded = new Set(excludeTokenAccounts);
  const accounts = parseLargest(largestRes).filter((a) => !excluded.has(a.address));
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
async function fetchOwnerPrograms(owners) {
  const unique = [...new Set(owners.filter((o) => o !== null))];
  const out = /* @__PURE__ */ new Map();
  if (unique.length === 0) return out;
  const result = await rpcCall(rpcUrlPool(), "getMultipleAccounts", [
    unique,
    { encoding: "base64", dataSlice: { offset: 0, length: 0 }, commitment: "confirmed" }
  ]);
  const values = result?.value ?? [];
  unique.forEach((o, i) => {
    const prog = values[i]?.owner;
    if (typeof prog === "string") out.set(o, prog);
  });
  return out;
}

// background/service-worker.ts
var RECENT_KEY = "ck:recent";
var BASE58_RE4 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
var cache = /* @__PURE__ */ new Map();
var inFlight = /* @__PURE__ */ new Map();
function refreshMarket(entry) {
  const dex = peekDexscreenerToken(entry.analysis.identity.address);
  if (!dex) return entry;
  const prev = entry.analysis.market;
  const market = {
    priceEur: dex.priceUsd ?? prev?.priceEur ?? null,
    marketCapEur: dex.marketCapUsd ?? prev?.marketCapEur ?? null,
    liquidityEur: dex.liquidityUsd ?? prev?.liquidityEur ?? null,
    volume24hEur: dex.volume24hUsd ?? prev?.volume24hEur ?? null,
    lpStatus: prev?.lpStatus ?? "unknown",
    sellSimulation: prev?.sellSimulation ?? null,
    priceChange1h: dex.priceChange1h,
    priceChange6h: dex.priceChange6h,
    priceChange24h: dex.priceChange24h,
    buys1h: dex.buys1h,
    sells1h: dex.sells1h
  };
  const analysis = { ...entry.analysis, market };
  const next = { ...entry, analysis, risk: scoreToken(analysis), quality: scoreQuality(analysis) };
  cache.set(analysis.identity.address, next);
  return next;
}
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
      const valid = msg.pairAddresses.filter((p) => BASE58_RE4.test(p)).slice(0, 90);
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
    case "GET_RADAR":
      return getRadar(false);
    case "RUN_RADAR":
      return getRadar(true);
    case "GET_LONGHOLD": {
      if (!BASE58_RE4.test(msg.address)) return { ok: false, error: "Not a valid Solana address." };
      const res = await assessLongHoldFor(msg.address);
      if (!res) return { ok: false, error: "Long-hold check unavailable." };
      const tracked = (await loadGems()).gems.some((g) => g.address === msg.address && g.status === "ACTIVE");
      return { ok: true, result: res.result, early: res.early, symbol: res.symbol, tracked };
    }
    case "GET_GEMS":
      return getGems();
    case "TRACK_GEM":
      if (!BASE58_RE4.test(msg.address)) return { ok: false, error: "Not a valid Solana address." };
      return trackGemManually(msg.address);
    case "UNTRACK_GEM":
      return untrackGem(msg.address);
    case "GET_LH_ACCURACY": {
      const entries = await loadLhLedger();
      return { ok: true, rows: computeLongHoldAccuracy(entries, LONG_HOLD.ledgerCheckDays), tracked: entries.length };
    }
    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}
var feed = /* @__PURE__ */ new Map();
var notified = /* @__PURE__ */ new Set();
var feedInFlight = null;
var lastFeedSweepAt = 0;
function getLiveFeed() {
  if (!LIVE_FEED.enabled) return Promise.resolve({ ok: false, error: "Live feed disabled in config." });
  if (feedInFlight) return feedInFlight;
  feedInFlight = doLiveFeedSweep().finally(() => {
    feedInFlight = null;
  });
  return feedInFlight;
}
async function doLiveFeedSweep() {
  lastFeedSweepAt = Date.now();
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
  await primeDexscreenerTokens([...coins.map((c) => c.mint), ...feed.keys()]);
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
  const seedPool = [];
  for (const c of coins) {
    let entry = cache.get(c.mint);
    if (!entry) continue;
    entry = refreshMarket(entry);
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
      tracked: trackedMints.has(c.mint),
      early: earlyForFeed(entry),
      insufficientData: entry.risk.insufficientData,
      unverified: entry.analysis.holders === null || !entry.analysis.market || entry.analysis.market.lpStatus === "unknown",
      scannedAt: Date.now()
    };
    feed.set(c.mint, row);
    maybeNotifyLowRisk(row);
    seedPool.push({ mint: c.mint, entry });
  }
  queueSeedCandidates(seedPool);
  const rows = [...feed.values()].sort((a, b) => (a.ageMinutes ?? 1e9) - (b.ageMinutes ?? 1e9)).slice(0, LIVE_FEED.maxRows);
  if (feed.size > LIVE_FEED.maxRows * 2) {
    const keep = new Set(rows.map((r) => r.address));
    for (const k of feed.keys()) if (!keep.has(k)) feed.delete(k);
  }
  return { ok: true, feed: rows, source: MOCK_MODE ? "mock" : "ok", scannedThisPoll };
}
function maybeNotifyLowRisk(row) {
  if (!LIVE_FEED.notifyLowRisk || MOCK_MODE) return;
  if (!row.gem) return;
  if (notified.has(row.address)) return;
  notified.add(row.address);
  if (notified.size > 500) notified.clear();
  const sym = row.symbol ?? `${row.address.slice(0, 4)}\u2026${row.address.slice(-4)}`;
  chrome.notifications.create(`ck-${row.address}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    // King Grade only — one number, higher = better. (This used to append the
    // raw risk score, which runs the OPPOSITE direction.)
    title: `\u{1F48E} ${sym} \u2014 King Grade ${row.grade ?? "?"}% ${gradeLabel(row.grade)}`,
    message: "Graduated, LP secured, no whale wallet, creator screened. Still speculative \u2014 research it yourself. Click to open on GMGN."
  });
}
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith("ck-") || id.startsWith("ck-watch-") || id.startsWith("ck-lh-") || id.startsWith("ck-gem-")) return;
  const address = id.slice(3);
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});
async function analyzeToken(address, force, rawGmgn, lite = false) {
  if (!BASE58_RE4.test(address)) {
    return { ok: false, error: "Not a valid Solana address." };
  }
  const cached = cache.get(address);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS && (!cached.lite || lite)) {
    return { ok: true, analysis: cached.analysis, risk: cached.risk, quality: cached.quality, mock: MOCK_MODE };
  }
  const pending = inFlight.get(address);
  if (pending) return pending;
  const job = doAnalyze(address, rawGmgn, lite, force).finally(() => inFlight.delete(address));
  inFlight.set(address, job);
  return job;
}
async function doAnalyze(address, rawGmgn, lite = false, force = false) {
  try {
    const gmgnPromise = !MOCK_MODE && rawGmgn ? Promise.resolve(parseGmgn(rawGmgn)) : lite && !MOCK_MODE ? Promise.resolve(emptyGmgnData()) : fetchGmgnData(address);
    const pumpfun = await fetchPumpfunData(address);
    const [gmgn, solana, audit, dexMarket] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address, lite, pumpfun.bondingCurveAccounts, pumpfun.creator, pumpfun.bondingCurveComplete),
      // RugCheck = LP lock status off gmgn.ai. Full scans only: one more
      // rate-limited call per coin would stall the lite feed sweep.
      lite ? Promise.resolve({ status: "disabled", lpStatus: null, externalFlags: [] }) : rugcheckAdapter.fetchAudit(address),
      // Always fetched: served from the sweep's batch cache for lite scans, so
      // rug/dump detection runs on EVERY coin, not just the ones you open.
      fetchDexscreenerToken(address, force)
      // forced scans bypass the 60s market cache
    ]);
    let deployerHist = lite ? await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator) : await pumpfunDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);
    deployerHist = await applyCreatorMemory(pumpfun.creator, deployerHist);
    const sellQuote = lite || gmgn.isHoneypot !== null || gmgn.sellSlippagePct !== null ? null : await fetchSellQuote(
      address,
      dexMarket?.priceUsd ?? gmgn.priceEur ?? pumpfun.priceEur,
      solana.decimals,
      EXIT_REALITY.referencePositionUsd
    );
    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, dexMarket, sellQuote, {
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
function mergeSources(address, gmgn, solana, pumpfun, auditLpStatus, deployer, dexMarket, sellQuote, sources) {
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
  const lpStatus = resolveLpStatus({
    gmgn: gmgn.lpStatus,
    pumpGraduated: pumpfun.status === "ok" ? pumpfun.bondingCurveComplete : null,
    deepestDexId: dexMarket?.dexId ?? null,
    audit: auditLpStatus
  });
  const sellSimulation = gmgn.isHoneypot === true ? { ok: false, slippagePct: gmgn.sellSlippagePct } : gmgn.sellSlippagePct !== null ? { ok: true, slippagePct: gmgn.sellSlippagePct } : sellQuote !== null ? { ok: true, slippagePct: sellQuote.priceImpactPct } : gmgn.isHoneypot === false ? { ok: true, slippagePct: null } : null;
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
  const symbol = gmgn.symbol ?? pumpfun.symbol ?? dexMarket?.symbol ?? null;
  const name = gmgn.name ?? pumpfun.name ?? dexMarket?.name ?? null;
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
    // pump.fun's own data when we have it; otherwise, if DexScreener shows the
    // coin trading ON a launchpad curve, still record that it's on the curve —
    // so the curve rules (grade ceiling, dev-dump window) apply even when the
    // pump.fun lookup failed, instead of the coin passing as an ordinary token.
    launch: pumpfun.status === "ok" ? {
      platform: "pumpfun",
      bondingCurveComplete: pumpfun.bondingCurveComplete,
      bannedOnPlatform: pumpfun.isBanned,
      replyCount: pumpfun.replyCount,
      curveProgressPct: pumpfun.curveProgressPct,
      athRatio: pumpfun.athRatio,
      kingOfTheHill: pumpfun.kingOfTheHill
    } : dexMarket?.dexId && onLaunchCurve(null, dexMarket.dexId) ? { platform: dexMarket.dexId === "pumpfun" ? "pumpfun" : null, bondingCurveComplete: false, bannedOnPlatform: null, replyCount: null } : null,
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
var locks = /* @__PURE__ */ new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.catch(() => void 0)
  );
  return run;
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
    largestNonLpWalletPct: entry.analysis.holders?.largestNonLpWalletPct ?? null,
    liveState: assessLiveState(entry.analysis.market).state
  };
}
async function watchToken(address, symbol) {
  if (!BASE58_RE4.test(address)) return { ok: false, error: "Not a valid Solana address." };
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
  const next = await withLock(WATCHLIST_KEY, async () => {
    const fresh = await loadWatchlist();
    if (fresh.some((w) => w.address === address)) return fresh;
    if (fresh.length >= WATCHLIST.maxCoins) return null;
    const out = [...fresh, coin];
    await saveWatchlist(out);
    return out;
  });
  if (!next) return { ok: false, error: `Watchlist is full (${WATCHLIST.maxCoins} coins) \u2014 unwatch one first.` };
  ensureWatchAlarm();
  return { ok: true, watchlist: next };
}
async function unwatchToken(address) {
  const next = await withLock(WATCHLIST_KEY, async () => {
    const out = (await loadWatchlist()).filter((w) => w.address !== address);
    await saveWatchlist(out);
    return out;
  });
  return { ok: true, watchlist: next };
}
async function sweepWatchlist() {
  const list = await loadWatchlist();
  if (list.length === 0) return;
  const fresh = /* @__PURE__ */ new Map();
  for (const coin of list) {
    const res = await analyzeToken(
      coin.address,
      /*force*/
      true
    );
    if (!res.ok) continue;
    const entry = cache.get(coin.address);
    if (entry) fresh.set(coin.address, snapshotOf(entry));
  }
  if (fresh.size === 0) return;
  const toNotify = [];
  await withLock(WATCHLIST_KEY, async () => {
    const current2 = await loadWatchlist();
    for (const coin of current2) {
      const snap = fresh.get(coin.address);
      if (!snap) continue;
      coin.last = snap;
      for (const alert of computeWatchAlerts(coin.baseline, snap)) {
        if (coin.alerted.includes(alert.kind)) continue;
        coin.alerted.push(alert.kind);
        toNotify.push({ coin, alert });
      }
    }
    await saveWatchlist(current2);
  });
  for (const { coin, alert } of toNotify) {
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
function ensureWatchAlarm() {
  chrome.alarms.create("ck-watch", { periodInMinutes: WATCHLIST.pollMinutes });
  if (LONG_HOLD.enabled && !MOCK_MODE) {
    chrome.alarms.create("ck-radar", { periodInMinutes: LONG_HOLD.radarEveryMinutes, delayInMinutes: 1 });
  }
  if (EARLY_GEM.enabled && !MOCK_MODE) {
    chrome.alarms.create("ck-gems", { periodInMinutes: 1 });
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ck-watch") {
    void sweepWatchlist();
    void recheckLedger();
    void recheckLhLedger();
  } else if (alarm.name === "ck-radar") {
    void runRadarSweep();
  } else if (alarm.name === "ck-gems") {
    void runGemTick();
    if (Date.now() - lastFeedSweepAt > 55e3) void getLiveFeed();
  }
});
chrome.runtime.onInstalled.addListener(ensureWatchAlarm);
chrome.runtime.onStartup.addListener(ensureWatchAlarm);
void loadSettings();
void loadGems();
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
  const baselineMcap = analysis.market?.marketCapEur ?? null;
  if (baselineMcap === null || baselineMcap <= 0) return;
  await withLock(LEDGER_KEY, async () => {
    const ledger = await loadLedger();
    if (ledger.some((e) => e.address === analysis.identity.address)) return;
    ledger.unshift({
      address: analysis.identity.address,
      symbol: analysis.identity.symbol,
      gradedAt: Date.now(),
      grade,
      rugVerdict,
      baselineMcap
    });
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger.slice(0, OUTCOME_LEDGER.maxEntries) });
  });
}
async function recheckLedger() {
  if (!OUTCOME_LEDGER.enabled || MOCK_MODE) return;
  const dueAt = Date.now() - OUTCOME_LEDGER.recheckAfterHours * 36e5;
  const due = (await loadLedger()).filter((e) => !e.outcome && e.gradedAt <= dueAt).slice(0, 5);
  if (due.length === 0) return;
  const results = /* @__PURE__ */ new Map();
  for (const entry of due) {
    const r = await lookupDexscreenerToken(entry.address);
    if (r.status === "error") continue;
    let nowMcap;
    let isDead;
    if (r.market) {
      nowMcap = r.market.marketCapUsd;
      isDead = assessLiveState(marketFromDex(r.market)).state === "DEAD";
    } else {
      const pump = await fetchPumpfunData(entry.address);
      if (pump.marketCapEur !== null) {
        nowMcap = pump.marketCapEur;
        isDead = false;
      } else {
        if (entry.gradedAt > Date.now() - OUTCOME_LEDGER.recheckAfterHours * 3 * 36e5) continue;
        isDead = true;
        nowMcap = null;
      }
    }
    results.set(entry.address, {
      checkedAt: Date.now(),
      finalMcap: nowMcap,
      outcome: classifyOutcome(entry.baselineMcap, nowMcap, isDead)
    });
  }
  if (results.size === 0) return;
  await withLock(LEDGER_KEY, async () => {
    const ledger = await loadLedger();
    for (const e of ledger) {
      const res = results.get(e.address);
      if (res && !e.outcome) Object.assign(e, res);
    }
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
  });
}
function marketFromDex(dex) {
  return {
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
  };
}
var RADAR_KEY = "ck:radar";
var LH_HIST_KEY = "ck:lh-hist";
var LH_LEDGER_KEY = "ck:lh-ledger";
var LH_CACHE_MS = 30 * 6e4;
var candleCache = /* @__PURE__ */ new Map();
var radarSweep = null;
var radarTicks = 0;
async function loadRadar() {
  const d = await chrome.storage.local.get(RADAR_KEY);
  const v = d[RADAR_KEY];
  const rows = (v?.rows ?? []).filter((r) => r.kind !== void 0);
  return { rows, sweptAt: v?.sweptAt ?? null, checked: v?.checked ?? 0, notified: v?.notified ?? [] };
}
async function getRadar(force) {
  if (!LONG_HOLD.enabled) return { ok: false, error: "Radar disabled in config." };
  if (MOCK_MODE) return { ok: false, error: "Radar needs live mode (MOCK_MODE=false)." };
  const store = await loadRadar();
  const stale = !store.sweptAt || Date.now() - store.sweptAt > LONG_HOLD.radarEveryMinutes * 9e4;
  if ((force || stale) && !radarSweep) void runRadarSweep();
  const seen = await loadSeen();
  return { ok: true, rows: store.rows, sweptAt: store.sweptAt, sweeping: radarSweep !== null, watching: seen.size, checked: store.checked };
}
function runRadarSweep() {
  if (radarSweep) return radarSweep;
  radarSweep = doRadarSweep().catch((err) => console.warn("[CRYPTO-KING] radar sweep failed:", err)).finally(() => {
    radarSweep = null;
  });
  return radarSweep;
}
var SEEN_KEY = "ck:seen";
var seenMem = null;
var seenLoading = null;
function loadSeen() {
  if (seenMem) return Promise.resolve(seenMem);
  seenLoading ??= chrome.storage.local.get(SEEN_KEY).then((d) => {
    seenMem ??= new Map(Object.entries(d[SEEN_KEY] ?? {}));
    return seenMem;
  });
  return seenLoading;
}
async function saveSeen() {
  if (!seenMem) return;
  if (seenMem.size > LONG_HOLD.seenLaunchesMax) {
    const drop = [...seenMem.entries()].sort((a, b) => (b[1].t ?? 0) - (a[1].t ?? 0)).slice(LONG_HOLD.seenLaunchesMax);
    for (const [m] of drop) seenMem.delete(m);
  }
  await chrome.storage.local.set({ [SEEN_KEY]: Object.fromEntries(seenMem) });
}
function rememberLaunch(seen, mint, createdMs, symbol) {
  const prev = seen.get(mint);
  if (prev) {
    if (prev.t === null && createdMs !== null) prev.t = createdMs;
    return;
  }
  seen.set(mint, { t: createdMs, s: symbol, q: 0 });
}
async function doRadarSweep() {
  if (!LONG_HOLD.enabled || MOCK_MODE) return;
  const tick = radarTicks++;
  const now2 = Date.now();
  const seen = await loadSeen();
  for (const p of await fetchNewPools(2)) {
    if ((p.liquidityUsd ?? 0) >= 15e3) rememberLaunch(seen, p.mint, p.createdMs, p.name);
  }
  const hints = /* @__PURE__ */ new Map();
  if (tick % 3 === 0) {
    for (const p of await fetchRadarPools()) {
      hints.set(p.mint, p);
      rememberLaunch(seen, p.mint, p.createdMs, p.name);
    }
    for (const m of [...await fetchDexscreenerBoostedSolana(), ...await fetchDexscreenerNewSolana(60)]) {
      rememberLaunch(seen, m, null, null);
    }
  }
  const store = await loadRadar();
  const inWindow = (t) => t === null || (now2 - t) / 864e5 <= LONG_HOLD.radarMaxAgeDays + 1;
  const rotation = [...seen.entries()].filter(([, v]) => inWindow(v.t) && (v.t === null || now2 - v.t >= (LONG_HOLD.radarMinAgeDays - 0.1) * 864e5)).sort((a, b) => a[1].q - b[1].q).slice(0, 300).map(([m]) => m);
  const batch = [.../* @__PURE__ */ new Set([...store.rows.map((r) => r.address), ...rotation])];
  await primeDexscreenerTokens(batch);
  const quick = /* @__PURE__ */ new Map();
  for (const mint of batch) {
    const m = peekDexscreenerToken(mint);
    if (m === void 0) continue;
    const entry = seen.get(mint);
    if (entry) entry.q = now2;
    if (m === null) {
      if (entry && entry.t !== null && now2 - entry.t > 2 * 864e5) seen.delete(mint);
      continue;
    }
    const created = m.pairCreatedMs ?? entry?.t ?? null;
    const ageDays = created !== null ? (now2 - created) / 864e5 : null;
    if (entry && entry.t === null && created !== null) entry.t = created;
    const qs = quickScreen(m, ageDays);
    if (qs.dead || ageDays !== null && ageDays > LONG_HOLD.radarMaxAgeDays) seen.delete(mint);
    if (qs.pass && ageDays !== null) quick.set(mint, { rank: qs.rank, headline: qs.headline, ageDays, m });
  }
  await saveSeen();
  const prevRows = new Map(store.rows.map((r) => [r.address, r]));
  const deepDue = [...quick.entries()].filter(([mint]) => {
    const prev = prevRows.get(mint);
    return !prev?.deepAt || now2 - prev.deepAt > LONG_HOLD.reassessHours * 36e5;
  }).sort((a, b) => b[1].rank - a[1].rank).slice(0, LONG_HOLD.radarDeepChecksPerSweep);
  const deep = /* @__PURE__ */ new Map();
  const autoTrack = [];
  for (const [mint, q] of deepDue) {
    const hint = hints.get(mint) ?? {
      mint,
      pool: q.m.pairAddress ?? "",
      name: q.m.symbol,
      createdMs: now2 - q.ageDays * 864e5,
      liquidityUsd: q.m.liquidityUsd,
      marketCapUsd: q.m.marketCapUsd,
      volume24hUsd: q.m.volume24hUsd,
      buyers24h: null,
      sellers24h: null
    };
    const out = await assessLongHoldFor(mint, hint.pool ? hint : void 0);
    if (!out) continue;
    const row = deepRowOf(mint, out, q.rank, q.ageDays);
    deep.set(mint, row);
    if (row.verdict === "CANDIDATE" || row.verdict === "STRONG") autoTrack.push({ mint, out });
  }
  const toNotify = [];
  await withLock(RADAR_KEY, async () => {
    const cur = await loadRadar();
    const old = new Map(cur.rows.map((r) => [r.address, r]));
    const rows = [];
    for (const [mint, q] of quick) {
      const d = deep.get(mint);
      const prev = old.get(mint);
      if (d) rows.push(d);
      else if (prev && prev.kind === "deep") {
        rows.push({ ...prev, rank: q.rank, ageDays: q.ageDays, marketCapUsd: q.m.marketCapUsd, liquidityUsd: q.m.liquidityUsd, checkedAt: now2 });
      } else {
        rows.push(quickRowOf(mint, q.m, q.rank, q.headline, q.ageDays));
      }
    }
    for (const r of cur.rows) if (!quick.has(r.address) && !batch.includes(r.address) && now2 - r.checkedAt < 20 * 6e4) rows.push(r);
    rows.sort(radarOrder);
    const notified2 = new Set(cur.notified);
    for (const r of deep.values()) {
      if ((r.verdict === "CANDIDATE" || r.verdict === "STRONG") && !notified2.has(r.address)) {
        notified2.add(r.address);
        toNotify.push(r);
      }
    }
    await chrome.storage.local.set({
      [RADAR_KEY]: {
        rows: rows.slice(0, LONG_HOLD.radarMaxRows),
        sweptAt: now2,
        checked: cur.checked + deep.size,
        notified: [...notified2].slice(-1e3)
      }
    });
  });
  for (const { mint, out } of autoTrack) await enlistGem(mint, out, "auto");
  for (const r of toNotify) {
    const sym = r.symbol ?? `${r.address.slice(0, 4)}\u2026${r.address.slice(-4)}`;
    const what = r.verdict === "CANDIDATE" ? "Long-hold candidate" : "Strong young coin";
    chrome.notifications.create(`ck-lh-${r.address}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `\u{1F3D4} ${what}: ${sym} \u2014 ${r.score ?? "?"}% at ${r.marketCapUsd !== null ? usdK(r.marketCapUsd) : "?"}`,
      message: `${r.headline ?? "Passed every check."} Now tracked for you. Not a buy signal \u2014 size it to lose. Click to open.`
    });
  }
}
function radarOrder(a, b) {
  const tierOf = (r) => r.kind === "deep" && r.passed ? r.verdict === "CANDIDATE" || r.verdict === "STRONG" ? 0 : 1 : r.kind === "quick" ? 2 : 3;
  return tierOf(a) - tierOf(b) || (b.score ?? b.rank) - (a.score ?? a.rank);
}
function quickRowOf(mint, m, rank, headline, ageDays) {
  return {
    address: mint,
    symbol: m.symbol,
    name: m.name,
    kind: "quick",
    stage: stageForAge(ageDays * 24),
    verdict: null,
    score: null,
    rank,
    passed: true,
    ageDays,
    marketCapUsd: m.marketCapUsd,
    liquidityUsd: m.liquidityUsd,
    headline,
    checkedAt: Date.now(),
    deepAt: null
  };
}
function deepRowOf(mint, out, rank, ageDays) {
  const e = out.early;
  const rooted = e.stage === "ROOTED";
  const verdict = rooted ? out.result.tier : e.verdict;
  const passed = rooted ? out.result.tier === "CANDIDATE" || out.result.tier === "WATCH" : e.verdict === "STRONG" || e.verdict === "PROMISING";
  const src = rooted ? out.result : e;
  return {
    address: mint,
    symbol: out.symbol,
    name: out.analysis.identity.name,
    kind: "deep",
    stage: e.stage,
    verdict,
    score: rooted ? out.result.score : e.score,
    rank,
    passed,
    ageDays,
    marketCapUsd: out.mcap,
    liquidityUsd: out.liq,
    headline: passed ? src.strengths[0] ?? null : src.disqualifiers[0] ?? src.concerns[0] ?? null,
    checkedAt: Date.now(),
    deepAt: Date.now()
  };
}
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith("ck-lh-")) return;
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${id.slice("ck-lh-".length)}` });
  chrome.notifications.clear(id);
});
var lhInFlight = /* @__PURE__ */ new Map();
var lhOutCache = /* @__PURE__ */ new Map();
function assessLongHoldFor(address, hint, fresh = false) {
  const pending = lhInFlight.get(address);
  if (pending) return pending;
  const job = doAssessLongHold(address, hint, fresh).finally(() => lhInFlight.delete(address));
  lhInFlight.set(address, job);
  return job;
}
var infoCache = /* @__PURE__ */ new Map();
async function cachedTokenInfo(mint, maxAgeMs = LH_CACHE_MS) {
  const hit = infoCache.get(mint);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.v;
  const v = await fetchTokenInfo(mint);
  if (v !== null) {
    if (infoCache.size > 300) infoCache.clear();
    infoCache.set(mint, { v, at: Date.now() });
  }
  return v;
}
async function doAssessLongHold(address, hint, fresh = false) {
  const hit = lhOutCache.get(address);
  if (hit && Date.now() - hit.at < LH_CACHE_MS && !hint && !fresh) return hit.out;
  const res = await analyzeToken(address, fresh);
  if (!res.ok) return null;
  const { analysis, risk } = res;
  const dex = await fetchDexscreenerToken(address);
  const pool = hint?.pool ?? dex?.pairAddress ?? null;
  const [candles, poolStats, info] = await Promise.all([
    pool ? cachedCandles(pool) : Promise.resolve(null),
    // Unique buyers/sellers: from the discovery hint if it has them, else the pool.
    hint && hint.buyers24h !== null ? Promise.resolve(hint) : pool ? fetchPool(pool) : Promise.resolve(null),
    // Holder counts drive "+N holders/hour" for tracked seeds — refresh faster then.
    cachedTokenInfo(address, fresh ? 15 * 6e4 : LH_CACHE_MS)
  ]);
  const holderCount = analysis.holders?.holderCount ?? info?.holderCount ?? null;
  const holderHistory = await recordHolderSnapshot(address, holderCount);
  const ages = [
    analysis.identity.ageMinutes !== null ? analysis.identity.ageMinutes / 1440 : null,
    dex?.pairCreatedMs ? (Date.now() - dex.pairCreatedMs) / 864e5 : null,
    hint?.createdMs ? (Date.now() - hint.createdMs) / 864e5 : null,
    candles && candles.length ? (Date.now() / 1e3 - candles[0].t) / 86400 : null
  ].filter((v) => v !== null && Number.isFinite(v) && v >= 0);
  const ageDays = ages.length ? Math.max(...ages) : null;
  const so = analysis.socials;
  const socials = {
    twitter: Boolean(so?.twitter || info?.twitter),
    telegram: Boolean(so?.telegram || info?.telegram),
    website: Boolean(so?.website || info?.website)
  };
  const buyers24h = poolStats?.buyers24h ?? null;
  const sellers24h = poolStats?.sellers24h ?? null;
  const result = assessLongHold(analysis, risk, { ageDays, candles, buyers24h, sellers24h, holderCount, holderHistory, socials });
  const tracked = (await loadGems()).gems.find((g) => g.address === address);
  const early = assessEarlyGem(analysis, risk, {
    ageHours: ageDays !== null ? ageDays * 24 : null,
    buyers24h,
    sellers24h,
    holderCount,
    history: tracked?.snapshots ?? [],
    socials
  });
  const symbol = analysis.identity.symbol;
  const mcap = analysis.market?.marketCapEur ?? null;
  const out = { result, early, symbol, mcap, liq: analysis.market?.liquidityEur ?? null, holderCount, analysis };
  if (lhOutCache.size > 300) lhOutCache.clear();
  lhOutCache.set(address, { out, at: Date.now() });
  await recordLhPrediction(address, symbol, result, mcap);
  return out;
}
async function cachedCandles(pool) {
  const hit = candleCache.get(pool);
  if (hit && Date.now() - hit.at < LONG_HOLD.reassessHours * 36e5) return hit.k;
  const k = await fetchDailyCandles(pool);
  if (k !== null) {
    if (candleCache.size > 300) candleCache.clear();
    candleCache.set(pool, { k, at: Date.now() });
  }
  return k;
}
async function recordHolderSnapshot(mint, holderCount) {
  return withLock(LH_HIST_KEY, async () => {
    const d = await chrome.storage.local.get(LH_HIST_KEY);
    const all = d[LH_HIST_KEY] ?? {};
    const h = all[mint] ?? [];
    const last = h[h.length - 1];
    if (holderCount !== null && holderCount > 0 && (!last || Date.now() - last.at > 6 * 36e5)) {
      h.push({ at: Date.now(), holderCount });
      all[mint] = h.slice(-30);
      const keys = Object.keys(all);
      if (keys.length > 400) {
        keys.sort((a, b) => (all[a].at(-1)?.at ?? 0) - (all[b].at(-1)?.at ?? 0)).slice(0, keys.length - 400).forEach((k) => delete all[k]);
      }
      await chrome.storage.local.set({ [LH_HIST_KEY]: all });
    }
    return all[mint] ?? h;
  });
}
async function loadLhLedger() {
  const d = await chrome.storage.local.get(LH_LEDGER_KEY);
  return Array.isArray(d[LH_LEDGER_KEY]) ? d[LH_LEDGER_KEY] : [];
}
async function recordLhPrediction(address, symbol, r, mcap) {
  if (!["CANDIDATE", "WATCH", "WEAK", "NOT_A_HOLD"].includes(r.tier) || mcap === null || mcap <= 0) return;
  await withLock(LH_LEDGER_KEY, async () => {
    const ledger = await loadLhLedger();
    if (ledger.some((e) => e.address === address)) return;
    ledger.unshift({ address, symbol, at: Date.now(), tier: r.tier, score: r.score, baselineMcap: mcap, outcomes: {} });
    await chrome.storage.local.set({ [LH_LEDGER_KEY]: ledger.slice(0, 600) });
  });
}
async function recheckLhLedger() {
  if (!LONG_HOLD.enabled || MOCK_MODE) return;
  const ledger = await loadLhLedger();
  const due = [];
  for (const e of ledger) {
    for (const day of LONG_HOLD.ledgerCheckDays) {
      if (!e.outcomes[String(day)] && Date.now() - e.at >= day * 864e5) due.push({ e, day });
    }
  }
  if (due.length === 0) return;
  const results = [];
  for (const { e, day } of due.slice(0, 5)) {
    const r = await lookupDexscreenerToken(e.address);
    if (r.status === "error") continue;
    const isDead = r.market === null || assessLiveState(marketFromDex(r.market)).state === "DEAD";
    const mcap = r.market?.marketCapUsd ?? null;
    results.push({ address: e.address, day, outcome: classifyOutcome(e.baselineMcap, mcap, isDead), mcap });
  }
  if (results.length === 0) return;
  await withLock(LH_LEDGER_KEY, async () => {
    const cur = await loadLhLedger();
    for (const r of results) {
      const e = cur.find((x) => x.address === r.address);
      if (e && !e.outcomes[String(r.day)]) {
        e.outcomes[String(r.day)] = { outcome: r.outcome, mcap: r.mcap, checkedAt: Date.now() };
      }
    }
    await chrome.storage.local.set({ [LH_LEDGER_KEY]: cur });
  });
}
var GEMS_KEY = "ck:gems";
var trackedMints = /* @__PURE__ */ new Set();
async function loadGems() {
  const d = await chrome.storage.local.get(GEMS_KEY);
  const v = d[GEMS_KEY];
  const gems = Array.isArray(v?.gems) ? v.gems : [];
  trackedMints.clear();
  for (const g of gems) if (g.status === "ACTIVE") trackedMints.add(g.address);
  return { gems };
}
async function saveGems(store) {
  trackedMints.clear();
  for (const g of store.gems) if (g.status === "ACTIVE") trackedMints.add(g.address);
  await chrome.storage.local.set({ [GEMS_KEY]: store });
}
async function getGems() {
  if (!EARLY_GEM.enabled) return { ok: false, error: "Gem tracker disabled in config." };
  const { gems } = await loadGems();
  const sorted = [...gems].sort(
    (a, b) => Number(a.status === "DROPPED") - Number(b.status === "DROPPED") || (b.lastMcap ?? 0) / b.spottedMcap - (a.lastMcap ?? 0) / a.spottedMcap
  );
  return { ok: true, gems: sorted, portfolio: computeGemPortfolio(gems, EARLY_GEM.reportHorizonsDays) };
}
function earlyForFeed(entry) {
  const a = entry.analysis;
  const e = assessEarlyGem(a, entry.risk, {
    ageHours: a.identity.ageMinutes !== null ? a.identity.ageMinutes / 60 : null,
    buyers24h: null,
    sellers24h: null,
    holderCount: a.holders?.holderCount ?? null,
    history: [],
    socials: { twitter: Boolean(a.socials?.twitter), telegram: Boolean(a.socials?.telegram), website: Boolean(a.socials?.website) }
  });
  return {
    score: e.score,
    verdict: e.verdict,
    headline: e.disqualifiers[0] ?? e.strengths[0] ?? e.concerns[0] ?? null
  };
}
var spotQueue = [];
var spotConsidered = /* @__PURE__ */ new Map();
var spotDraining = false;
function queueSeedCandidates(entries) {
  if (!EARLY_GEM.enabled || MOCK_MODE) return;
  const now2 = Date.now();
  const picks = entries.filter(({ mint, entry }) => {
    if (trackedMints.has(mint)) return false;
    const seen = spotConsidered.get(mint);
    if (seen && now2 - seen < 6 * 36e5) return false;
    const mc = entry.analysis.market?.marketCapEur ?? null;
    return mc !== null && mc > 0 && mc <= EARLY_GEM.maxSpotMcapUsd;
  }).map(({ mint, entry }) => {
    const a = entry.analysis;
    const prelim = assessEarlyGem(a, entry.risk, {
      ageHours: a.identity.ageMinutes !== null ? a.identity.ageMinutes / 60 : null,
      buyers24h: null,
      sellers24h: null,
      holderCount: null,
      history: [],
      socials: { twitter: Boolean(a.socials?.twitter), telegram: Boolean(a.socials?.telegram), website: Boolean(a.socials?.website) }
    });
    return { mint, prelim };
  }).filter((x) => x.prelim.verdict !== "REJECT" && (x.prelim.score ?? 0) >= EARLY_GEM.prelimMinScore).sort((a, b) => (b.prelim.score ?? 0) - (a.prelim.score ?? 0)).slice(0, EARLY_GEM.fullChecksPerSweep);
  for (const p of picks) {
    spotConsidered.set(p.mint, now2);
    spotQueue.push(p.mint);
  }
  if (spotConsidered.size > 2e3) spotConsidered.clear();
  void drainSpotQueue();
}
async function drainSpotQueue() {
  if (spotDraining) return;
  spotDraining = true;
  try {
    while (spotQueue.length > 0) {
      const mint = spotQueue.shift();
      await considerSpot(mint).catch((e) => console.warn("[CRYPTO-KING] spot check failed", e));
    }
  } finally {
    spotDraining = false;
  }
}
async function considerSpot(mint) {
  const out = await assessLongHoldFor(mint);
  if (!out) return;
  const e = out.early;
  const ok = (e.verdict === "STRONG" || e.verdict === "PROMISING") && (e.score ?? 0) >= EARLY_GEM.spotMinScore && out.mcap !== null && out.mcap > 0 && out.mcap <= EARLY_GEM.maxSpotMcapUsd;
  if (!ok) return;
  const added = await enlistGem(mint, out, "auto");
  if (added) {
    const sym = out.symbol ?? short4(mint);
    chrome.notifications.create(`ck-gem-${mint}-spotted`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `\u{1F331} Gem spotted early: ${sym} at ${usdK(out.mcap)} \u2014 conviction ${e.score}%`,
      message: `${e.strengths[0] ?? "Strong early signals."} Now tracking it \u2014 you'll be alerted on milestones and if the thesis breaks. Most launches still fail: size it to lose.`
    });
  }
}
async function enlistGem(mint, out, source) {
  if (out.mcap === null || out.mcap <= 0) return false;
  return withLock(GEMS_KEY, async () => {
    const store = await loadGems();
    const existing = store.gems.find((g) => g.address === mint);
    if (existing && existing.status === "ACTIVE") return false;
    const active = store.gems.filter((g) => g.status === "ACTIVE").length;
    if (source === "auto" && active >= EARLY_GEM.maxTracked) return false;
    if (existing) store.gems = store.gems.filter((g) => g.address !== mint);
    const now2 = Date.now();
    const stage = out.early.stage;
    store.gems.unshift({
      address: mint,
      symbol: out.symbol,
      source,
      spottedAt: now2,
      spottedMcap: out.mcap,
      status: "ACTIVE",
      dropReason: null,
      stage,
      verdict: stage === "ROOTED" ? out.result.tier : out.early.verdict,
      score: stage === "ROOTED" ? out.result.score : out.early.score,
      lastMcap: out.mcap,
      peakMcap: out.mcap,
      lastCheckedAt: now2,
      nextCheckAt: now2 + EARLY_GEM.recheckMinutes[stage] * 6e4,
      fired: [],
      events: [{ at: now2, text: `Spotted at ${usdK(out.mcap)} (${source === "auto" ? "auto" : "you added it"}).`, tone: "info" }],
      snapshots: [snapOf(out)]
    });
    const cutoff = now2 - EARLY_GEM.followDroppedDays * 864e5;
    store.gems = store.gems.filter((g) => g.status === "ACTIVE" || g.spottedAt > cutoff).slice(0, EARLY_GEM.maxTracked * 3);
    await saveGems(store);
    return true;
  });
}
async function trackGemManually(address) {
  const out = await assessLongHoldFor(address);
  if (!out) return { ok: false, error: "Could not scan this coin \u2014 try again." };
  if (out.mcap === null || out.mcap <= 0) return { ok: false, error: "No market cap yet \u2014 cannot measure your multiple." };
  await enlistGem(address, out, "manual");
  return getGems();
}
async function untrackGem(address) {
  await withLock(GEMS_KEY, async () => {
    const store = await loadGems();
    store.gems = store.gems.filter((g) => g.address !== address);
    await saveGems(store);
  });
  return getGems();
}
var gemTick = null;
function runGemTick() {
  if (gemTick) return gemTick;
  gemTick = doGemTick().catch((e) => console.warn("[CRYPTO-KING] gem tick failed", e)).finally(() => {
    gemTick = null;
  });
  return gemTick;
}
async function doGemTick() {
  if (!EARLY_GEM.enabled || MOCK_MODE) return;
  const now2 = Date.now();
  const { gems } = await loadGems();
  const due = gems.filter((g) => g.nextCheckAt <= now2).filter((g) => g.status === "ACTIVE" || now2 - g.spottedAt < EARLY_GEM.followDroppedDays * 864e5).sort((a, b) => a.nextCheckAt - b.nextCheckAt).slice(0, EARLY_GEM.checksPerTick);
  const updates = /* @__PURE__ */ new Map();
  const notes = [];
  for (const g of due) {
    if (g.status === "DROPPED") {
      const snap = await priceOnlySnapshot(g.address);
      updates.set(g.address, (cur) => {
        if (snap) pushSnap(cur, snap);
        cur.nextCheckAt = Date.now() + EARLY_GEM.recheckMinutes.DROPPED * 6e4;
      });
      continue;
    }
    const out = await assessLongHoldFor(
      g.address,
      void 0,
      /*fresh*/
      true
    );
    if (!out) {
      updates.set(g.address, (cur) => {
        cur.nextCheckAt = Date.now() + 15 * 6e4;
      });
      continue;
    }
    updates.set(g.address, (cur) => applyCheck(cur, out, notes));
  }
  if (updates.size === 0) return;
  await withLock(GEMS_KEY, async () => {
    const store = await loadGems();
    for (const cur of store.gems) updates.get(cur.address)?.(cur);
    await saveGems(store);
  });
  for (const n of notes) chrome.notifications.create(n.id, { type: "basic", iconUrl: "icons/icon128.png", title: n.title, message: n.message, priority: 2 });
}
function applyCheck(g, out, notes) {
  const now2 = Date.now();
  const sym = g.symbol ?? short4(g.address);
  const fire = (kind, tone, text, alertTitle) => {
    if (g.fired.includes(kind)) return;
    g.fired.push(kind);
    g.events.unshift({ at: now2, text, tone });
    if (alertTitle) notes.push({ id: `ck-gem-${g.address}-${kind}`, title: alertTitle, message: `${text} Click to open.` });
  };
  pushSnap(g, snapOf(out));
  const e = out.early;
  g.stage = e.stage;
  g.verdict = e.stage === "ROOTED" ? out.result.tier : e.verdict;
  g.score = e.stage === "ROOTED" ? out.result.score : e.score;
  g.lastMcap = out.mcap;
  if (out.mcap !== null) g.peakMcap = Math.max(g.peakMcap ?? 0, out.mcap);
  g.lastCheckedAt = now2;
  const mult = out.mcap !== null ? out.mcap / g.spottedMcap : null;
  const dead = assessLiveState(out.analysis.market).state === "DEAD";
  if (e.hardBreak || dead) {
    const why = e.disqualifiers.find((d) => !/^Dumping right now/.test(d)) ?? e.disqualifiers[0] ?? "market collapsed";
    g.status = "DROPPED";
    g.dropReason = why;
    fire("dropped", "bad", `Thesis broken \u2014 ${why}`, `\u2702 ${sym}: thesis broken \u2014 consider exiting`);
    g.nextCheckAt = now2 + EARLY_GEM.recheckMinutes.DROPPED * 6e4;
    trimGem(g);
    return;
  }
  if (out.analysis.launch?.bondingCurveComplete === true) {
    fire("graduated", "good", `\u{1F393} Graduated off the bonding curve at ${usdK(out.mcap ?? 0)}.`, `\u{1F393} ${sym} graduated`);
  }
  if (e.ageHours !== null && e.ageHours >= 24) fire("day1", "good", "Survived day 1 \u2014 about 80% of launches don\u2019t.");
  if (e.stage === "ROOTED" && (out.result.tier === "CANDIDATE" || out.result.tier === "WATCH")) {
    fire("rooted", "good", `\u{1F333} Rooted \u2014 passed the long-hold screen at day 3 (Staying Power ${out.result.score}%).`, `\u{1F333} ${sym} is rooted \u2014 long-hold screen passed`);
  }
  if (mult !== null) {
    for (const m of EARLY_GEM.multipleMilestones) {
      if (mult >= m) {
        fire(`x${m}`, "good", `\u{1F680} ${m}\xD7 since spotted (${usdK(g.spottedMcap)} \u2192 ${usdK(out.mcap ?? 0)}).`, `\u{1F680} ${sym} is ${m}\xD7 since you spotted it`);
      }
    }
  }
  const firstHolders = g.snapshots.find((s) => s.holders !== null)?.holders ?? null;
  if (firstHolders && out.holderCount !== null && out.holderCount >= firstHolders * 2) {
    fire("holders2x", "good", `\u{1F465} Holders doubled since spotted (${firstHolders} \u2192 ${out.holderCount}).`);
  }
  const dayKey = new Date(now2).toISOString().slice(0, 10);
  const dumping = e.disqualifiers.find((d) => /^Dumping right now/.test(d));
  if (dumping) fire(`dump-${dayKey}`, "bad", `\u{1F4C9} ${dumping}`, `\u{1F4C9} ${sym} is dumping right now`);
  const peakHolders = Math.max(0, ...g.snapshots.map((s) => s.holders ?? 0));
  if (peakHolders > 0 && out.holderCount !== null && out.holderCount < peakHolders * 0.85) {
    fire("holders-leaving", "bad", `\u{1F44B} Holders down ${Math.round((1 - out.holderCount / peakHolders) * 100)}% from their peak \u2014 the community is thinning.`, `\u{1F44B} ${sym}: holders are leaving`);
  }
  if (g.peakMcap && out.mcap !== null && out.mcap < g.peakMcap * 0.4) {
    fire("drawdown60", "bad", `Down ${Math.round((1 - out.mcap / g.peakMcap) * 100)}% from its peak since you spotted it.`, `\u26A0 ${sym} is down 60%+ from its peak`);
  }
  g.nextCheckAt = now2 + EARLY_GEM.recheckMinutes[e.stage] * 6e4;
  trimGem(g);
}
function snapOf(out) {
  return {
    at: Date.now(),
    mcap: out.mcap,
    holders: out.holderCount,
    liquidity: out.liq,
    score: out.early.stage === "ROOTED" ? out.result.score : out.early.score,
    dead: assessLiveState(out.analysis.market).state === "DEAD"
  };
}
async function priceOnlySnapshot(mint) {
  const r = await lookupDexscreenerToken(mint);
  if (r.status === "error") return null;
  if (r.market) {
    return {
      at: Date.now(),
      mcap: r.market.marketCapUsd,
      holders: null,
      liquidity: r.market.liquidityUsd,
      score: null,
      dead: assessLiveState(marketFromDex(r.market)).state === "DEAD"
    };
  }
  const pump = await fetchPumpfunData(mint);
  if (pump.marketCapEur === null) return null;
  return { at: Date.now(), mcap: pump.marketCapEur, holders: null, liquidity: null, score: null, dead: false };
}
function pushSnap(g, s) {
  g.snapshots.push(s);
  if (g.snapshots.length > 400) {
    const head = g.snapshots.slice(0, 1);
    const tail = g.snapshots.slice(-100);
    const mid = g.snapshots.slice(1, -100).filter((_, i) => i % 2 === 0);
    g.snapshots = [...head, ...mid, ...tail];
  }
}
function trimGem(g) {
  g.events = g.events.slice(0, 20);
}
var short4 = (a) => `${a.slice(0, 4)}\u2026${a.slice(-4)}`;
function usdK(v) {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}
chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith("ck-gem-")) return;
  const address = id.slice("ck-gem-".length).split("-")[0];
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});
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
