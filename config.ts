/**
 * config.ts — single place to flip modes, adjust endpoints, and tune the risk model.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ QUICK START                                                              │
 * │ 1. Leave MOCK_MODE = true → extension works immediately with fixtures.  │
 * │ 2. To go live: set MOCK_MODE = false. The verified GMGN endpoint paths  │
 * │    (captured from DevTools → Network on gmgn.ai) are already below —    │
 * │    update GMGN.commonParams with the query-string values from YOUR      │
 * │    capture if requests start failing, and (recommended) put a free      │
 * │    Helius API key into SOLANA.rpcUrl.                                   │
 * │ 3. All scoring weights/thresholds are tunable — the scorer reads them   │
 * │    at call time; no other code changes needed.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { Signal } from './lib/types.ts';

/**
 * LIVE by default — real GMGN/pump.fun/Solana-RPC data, no keys or setup needed.
 * Set to true to demo with deterministic fixtures (mock/fixtures.ts) instead.
 */
export const MOCK_MODE = false;

/**
 * true = log every source's raw response + the merged analysis to the SERVICE
 * WORKER console (chrome://extensions → CRYPTO-KING → "service worker"). Turn
 * this on to see exactly what each API returned and pin any value that doesn't
 * match the site — then correct the field mapping in the matching lib/*Client.
 */
export const DEBUG = false;

/** Display currency. Meme markets (pump.fun/GMGN/DexScreener) quote in USD, so
 *  we display native USD to MATCH the sites exactly — no conversion drift. */
export const DISPLAY_CURRENCY = 'USD' as const;

/**
 * Currency multiplier applied to source (USD) values. Kept at 1.0 so displayed
 * numbers equal what you see on the sites. (Field names use an `Eur` suffix for
 * historical reasons but the values are USD.) Change only if you deliberately
 * want a different display currency — it never affects risk scores.
 */
export const EUR_PER_USD = 1;

/* ────────────────────────────── Data sources ────────────────────────────── */

/**
 * GMGN internal endpoints — verified live (2026-07) via DevTools → Network.
 * All same-origin GET under gmgn.ai, all wrapped in a {code, message, data}
 * envelope, all sharing the common query string in `commonParams`.
 * These are UNDOCUMENTED and may change without notice: if a call starts
 * failing, re-capture from DevTools and update the path / params here.
 * Set any entry to '' to disable it — the aggregator degrades gracefully.
 */
export const GMGN = {
  baseUrl: 'https://gmgn.ai',
  endpoints: {
    /** Core security object: renounced_mint, renounced_freeze_account, burn_ratio/burn_status,
     *  top_10_holder_rate, is_honeypot, is_blacklist, buy_tax/sell_tax/average_tax, lock_summary. */
    security: '/api/v1/mutil_window_token_security_launchpad/sol/{address}',
    /** decimals, holder_count, total_supply, circulating_supply, liquidity, creation_timestamp, biggest_pool_address. */
    tokenInfo: '/api/v1/token_info/sol/{address}',
    /** mc, symbol, name, socials (twitter/website/telegram), price_24_change. */
    tokenPreview: '/api/v1/live/token_preview/sol/{address}',
    /** launchpad, fee_authority, is_locked, royalty bps (Token-2022 fee data). */
    feeDistribution: '/api/v1/token_fee_distribution/sol/{address}',
    /** recommend_sell_slippage, has_tax — honeypot / high-slippage signal. */
    recommendSlippage: '/api/v1/recommend_slippage/sol/{address}',
    /** Holder concentration: top_10_holder_rate, top70_sniper_hold_rate, per-wallet maker_token_tags, smart-money counts. */
    topBuyers: '/defi/quotation/v1/tokens/top_buyers/sol/{address}',
  },
  /**
   * Common query string GMGN attaches to every call. Values below are neutral
   * defaults; replace with the ones from your own DevTools capture if GMGN
   * starts rejecting requests (they are tracking params, not auth).
   */
  commonParams: {
    device_id: 'crypto-king-ext',
    client_id: 'gmgn_web',
    from_app: 'gmgn',
    app_ver: '1.0.0',
    tz_name: 'Europe/Berlin',
    tz_offset: '3600',
    app_lang: 'en',
    os: 'web',
  } as Record<string, string>,
  /** Extra headers if GMGN requires them (keep empty unless needed). */
  headers: {} as Record<string, string>,
};

/**
 * pump.fun public frontend API — secondary source for freshly-created coins
 * and bonding-curve state (v3 host verified live; v1/v2 are dead).
 */
export const PUMPFUN = {
  enabled: true,
  baseUrl: 'https://frontend-api-v3.pump.fun',
  /** Single-coin object: creator, created_timestamp, complete, reserves, market_cap, socials, is_banned, token_program. */
  coinEndpoint: '/coins/{address}',
  /** Newest-coins list for the Live feed. sort=created_timestamp gives fresh launches first. */
  listEndpoint: '/coins?offset={offset}&limit={limit}&sort=created_timestamp&order=DESC&includeNsfw=false',
  /** Coins previously created by a wallet — powers the serial-deployer check. Unverified path; degrades to null. */
  creatorCoinsEndpoint: '/coins/user-created-coins/{creator}?offset=0&limit=20&includeNsfw=true',
};

/**
 * Live feed (real-time auto-scanner). Polls the newest launches and risk-scores
 * each so you can spot lower-risk fresh coins fast. Tunables:
 */
export const LIVE_FEED = {
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
  pollIntervalMs: 6_000,
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
  notifyMaxScore: 39, // CONSIDER / NEUTRAL territory
  /** "Low caps only" feed filter threshold (early-stage hunting ground).
   *  💎 gem-grade coins stay visible even above this cap. */
  lowCapMaxEur: 100_000,
  /**
   * 💎 gem-alert threshold: a feed coin pulses gold when risk ≤ notifyMaxScore
   * AND quality ≥ gemMinQuality. An attention aid for candidates worth YOUR
   * research — emphatically not a buy signal.
   */
  gemMinQuality: 30,
};

/**
 * DexScreener — keyless, CORS-friendly public API. Used as a FALLBACK source of
 * fresh Solana token addresses for the Live feed, and to resolve DEXTools pair
 * addresses → base token mints for inline badges.
 */
export const DEXSCREENER = {
  enabled: true,
  /** Recently-updated token profiles across chains; we filter chainId === 'solana'. */
  latestProfilesUrl: 'https://api.dexscreener.com/token-profiles/latest/v1',
  /** Pair lookup — up to ~30 comma-joined pair addresses per call. */
  pairsUrl: 'https://api.dexscreener.com/latest/dex/pairs/solana/{pairs}',
};

/**
 * Inline badges: inject a small risk chip next to every Solana token link on
 * the page itself (gmgn lists, pump.fun boards, dextools pair tables), scanned
 * automatically as rows appear — see it in place while browsing.
 */
export const INLINE_BADGES = {
  enabled: true,
  /** Max distinct mints badged per page (protects the RPC budget). */
  maxPerPage: 120,
  /** Parallel lite scans for inline badges (per tab; per-host rate limits still apply). */
  scanConcurrency: 4,
};

export const SOLANA = {
  /**
   * Authoritative fallback for mint/freeze authority, Token-2022 fees, and
   * top-holder accounts. Public mainnet RPC works but is heavily rate-limited.
   * For reliable data (and metadata-mutability via DAS getAsset) use a free
   * Helius key: https://www.helius.dev
   *   → 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'
   */
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  /**
   * Extra FREE, no-signup RPC endpoints to spread load across (failover order).
   * The scanner tries the primary first, then these — so one endpoint being
   * rate-limited doesn't stall a scan. Empty by default (the tool works fine on
   * the single public endpoint); paste any keyless Solana RPCs you trust here
   * to speed up without ever creating an account. A Helius key, if set, takes
   * priority over this whole list.
   */
  fallbackRpcUrls: [] as string[],
  /** DAS (getAsset) is only available on Helius-style RPCs. Auto-detected from the URL. */
  get supportsDas(): boolean {
    return this.rpcUrl.includes('helius');
  },
  /**
   * Token accounts owned by these authorities are treated as pool/LP accounts
   * and EXCLUDED from holder-concentration math. Extend as needed.
   */
  knownPoolAuthorities: [
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium AMM v4 authority
    'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', // Raydium CPMM vault authority
  ],
  burnAddresses: [
    '1nc1nerator11111111111111111111111111111111', // Solana incinerator
    '11111111111111111111111111111111', // system program (used as burn dest by some tools)
  ],
};

/**
 * Smart-money wallets YOU track (KOLs, proven snipers…). Full scans compute
 * what % of supply the top holders owned by these wallets control, feeding the
 * quality score. Edit freely — addresses only, base58.
 */
export const SMART_MONEY_WALLETS: string[] = [];

/**
 * Narrative keyword table — matched against token name/symbol, shown as an
 * INFORMATIONAL tag only (e.g. "Narrative: AI"). Deliberately worth ZERO
 * points: naming a coin after a trend is free, and copycat scammers do exactly
 * that. Edit the lists to track what's currently running.
 */
export const TRENDING_NARRATIVES: Record<string, string[]> = {
  AI: ['ai', 'gpt', 'agent', 'neural', 'grok'],
  Dog: ['dog', 'doge', 'shib', 'inu', 'wif', 'pup'],
  Cat: ['cat', 'kitty', 'meow'],
  Political: ['trump', 'maga', 'biden', 'election', 'president'],
  Celebrity: ['elon', 'musk', 'kanye', 'drake'],
  Frog: ['pepe', 'frog', 'toad'],
};

export const RUGCHECK = {
  /** Optional pluggable adapter — OFF by default; the API spec may drift. */
  enabled: false,
  /** Public report endpoint as of 2025; verify against rugcheck.xyz docs before enabling. */
  endpoint: 'https://api.rugcheck.xyz/v1/tokens/{address}/report',
};

/* ─────────────────────────── Networking behavior ─────────────────────────── */

/**
 * Minimum ms between calls to the same host. gmgn.ai gets a tighter interval
 * because a single analysis fans out to up to 6 same-origin endpoints.
 */
export const RATE_LIMITS_MS: Record<string, number> = {
  default: 1100,
  'gmgn.ai': 400,
};
/** Per-request timeout. */
export const FETCH_TIMEOUT_MS = 10_000;
/** Cache a finished analysis this long before re-fetching. */
export const CACHE_TTL_MS = 5 * 60_000;
/** Max rows kept in the dashboard's "recently analyzed" table. */
export const RECENT_MAX = 100;

/* ───────────────────────────── Scoring model ─────────────────────────────
 * Additive points, clamped 0–100. Every triggered factor pushes a
 * human-readable reason. Mitigations are negative and capped (MITIGATION_CAP).
 */

export const WEIGHTS = {
  // Token structure (high weight — the actual Solana rug surface)
  mintAuthorityActive: 25,
  freezeAuthorityActive: 20,
  transferFeeHigh: 10, // fee > LIMITS.transferFeeHighBps
  transferFeeVeryHigh: 15, // fee > LIMITS.transferFeeVeryHighBps (replaces, not additive)
  feeAuthorityActive: 15,
  metadataMutable: 5,
  lpNotSecured: 20, // LP neither burned nor locked
  sellSimulationFailed: 30, // sell fails / honeypot flag / slippage > LIMITS.sellSlippageMaxPct

  // Live state — the rug already happened / is happening (lib/liveState.ts)
  alreadyDead: 60, // liquidity pulled or price collapsed: do not enter
  activelyDumping: 30, // falling hard / sells dominating right now

  // Token-2022 trap extensions — the current generation of rug tricks
  permanentDelegate: 30, // delegate can SEIZE tokens from any holder wallet
  nonTransferable: 30, // soulbound — you cannot sell at all
  defaultAccountFrozen: 25, // new holder accounts start frozen
  transferHook: 20, // transfers run dev code that can block sells

  // Holder concentration (medium-high)
  top10Concentrated: 15, // top 10 > LIMITS.top10Pct (LP/burn excluded)
  singleWalletDominant: 10, // one non-LP wallet > LIMITS.singleWalletPct
  top5EffectiveConcentration: 15, // top 5 > LIMITS.top5Pct despite ≥ LIMITS.top5MinHolders holders
  bundledLaunch: 15, // bundled/sniped supply > LIMITS.bundledPct

  // Liquidity & market cap (medium)
  thinLiquidityVsMcap: 10, // liq < LIMITS.thinLiquidityEur while mcap > LIMITS.thinLiqMcapEur
  microMcapUnlockedLp: 15, // mcap < LIMITS.microMcapEur AND LP not secured
  mcapSpikeNoOrganicVolume: 10,

  // Launch-platform reality (applies when the launchpad is identified)
  platformBanned: 30, // banned/flagged on its own launch platform
  bondingCurveActive: 10, // still on the bonding curve — ultra-early, pre-AMM
  brandNewLaunch: 10, // launchpad coin younger than LIMITS.youngAgeMinutes — peak failure window
  // Early-stage concentration: for coins STILL ON THE CURVE, whale thresholds
  // are much lower — a wallet holding 5%+ of total supply minutes after launch
  // is the dev/snipers, and they can dump at any second.
  earlyWhaleWallet: 15, // one non-curve wallet ≥ LIMITS.earlyWhalePct this early
  earlyTopConcentration: 10, // top-10 non-curve wallets ≥ LIMITS.earlyTop10Pct this early

  // Age & behavior (medium)
  youngTokenAbnormalVolume: 10, // age < LIMITS.youngAgeMinutes with abnormal volume
  serialDeployer: 15, // creator launched many coins, most dead (see LIMITS.serial*)
  devHoldingsHigh: 10, // creator wallet holds ≥ LIMITS.devHoldsPct of supply — can dump on you
  deployerLinkedSelling: 15,
  deployerPriorRugs: 20, // deployer wallet linked to ≥1 prior rug
  deployerFundedByRugger: 15, // deployer funded from a known rugger wallet
  noSocials: 10,
  unverifiedSocials: 5,
  volumeSpikeFlatPrice: 10,
  manySmallBuysOneHugeSell: 10,
  smartMoneyExiting: 10,

  // Mitigating signals (negative; total capped at -MITIGATION_CAP)
  smartMoneyAccumulatingStrong: -10, // ≥ LIMITS.smartMoneyStrongWallets wallets
  smartMoneyAccumulatingLight: -5,
  verifiedSocials: -5,
} as const;

export const LIMITS = {
  transferFeeHighBps: 1000, // 10%
  transferFeeVeryHighBps: 2000, // 20%
  sellSlippageMaxPct: 40,
  top10Pct: 60,
  singleWalletPct: 30,
  top5Pct: 80,
  top5MinHolders: 500, // "looks distributed but is effectively concentrated"
  bundledPct: 20,
  thinLiquidityEur: 50_000,
  thinLiqMcapEur: 500_000,
  microMcapEur: 50_000,
  youngAgeMinutes: 30,
  smartMoneyStrongWallets: 3,
  serialMinLaunches: 3, // serial-deployer factor needs at least this many prior coins…
  serialDeadRatio: 0.7, // …with at least this share dead/abandoned
  earlyWhalePct: 5, // % of TOTAL supply in one non-curve wallet while still on the curve
  earlyTop10Pct: 15, // % of TOTAL supply in top-10 non-curve wallets while on the curve
  devHoldsPct: 5, // creator holdings at/above this % → devHoldingsHigh risk
} as const;

/* ─────────────────────── 👁 Watchlist (rug alerts) ────────────────────────
 * Coins you're holding get re-scanned on a timer; you're alerted the moment
 * rug conditions DEVELOP (post-entry protection — the pre-buy scan can't see
 * a dev who dumps tomorrow). All thresholds tunable.
 */
export const WATCHLIST = {
  maxCoins: 10, // full re-scans are RPC-heavy; keep the list focused
  pollMinutes: 5,
  alerts: {
    liquidityDropPct: 50, // liquidity fell ≥ this % from your baseline
    marketCapDropPct: 60, // mcap fell ≥ this % from your baseline
    devSoldPointsDrop: 2, // dev holdings fell ≥ this many percentage points
    gradeDrop: 20, // King Grade fell ≥ this many points
  },
} as const;

/* ─────────────────────── Quality/momentum model ───────────────────────────
 * The positive axis: additive points for OBSERVABLE good signals, clamp 0–100.
 * Explicitly NOT a profit prediction — meme coins with perfect signals still
 * go to zero. Used to rank candidates worth researching (🏆 sort in the feed).
 */

export const QUALITY_WEIGHTS = {
  smartMoneyStrong: 20, // ≥ LIMITS.smartMoneyStrongWallets smart wallets accumulating
  smartMoneyLight: 10,
  verifiedSocials: 10,
  fullSocialPresence: 5, // website + twitter + telegram all present
  lpBurned: 15,
  lpLocked: 10,
  authoritiesRevoked: 10, // BOTH mint and freeze authority revoked
  healthyDistribution: 10, // top-10 holders ≤ QUALITY_LIMITS.healthyTop10Pct
  holderBaseLarge: 10, // ≥ QUALITY_LIMITS.largeHolderCount holders
  holderBase: 5, // ≥ QUALITY_LIMITS.minHolderCount holders
  liquidityDepth: 10, // liq ≥ minLiquidityEur AND liq/mcap ≥ minLiqMcapRatio
  organicVolume: 5, // vol24h/mcap inside a sane band
  graduated: 10, // bonding curve completed — survived the launchpad
  survived7d: 10,
  survived24h: 5,
  curveTraction: 10, // still on the curve but real buyers pushed mcap ≥ curveTractionMinEur
  communityActivity: 5, // launchpad comment count ≥ minReplies
  smartWalletStrong: 20, // YOUR tracked wallets hold ≥ smartWalletStrongPct of supply
  smartWalletLight: 10, // …or ≥ smartWalletLightPct
  provenDeployer: 10, // creator's prior launches mostly graduated (track record)
} as const;

export const QUALITY_LIMITS = {
  healthyTop10Pct: 30,
  minHolderCount: 1000,
  largeHolderCount: 10_000,
  minLiquidityEur: 30_000,
  minLiqMcapRatio: 0.08,
  volMcapMin: 0.2,
  volMcapMax: 8,
  curveTractionMinEur: 20_000,
  minReplies: 20,
  smartWalletStrongPct: 15,
  smartWalletLightPct: 5,
  minGraduationRate: 0.5, // provenDeployer needs ≥ this share of prior launches graduated…
  minLaunchesForProven: 2, // …across at least this many prior launches
} as const;

/* ─────────────────────── 💎 gem background check ──────────────────────────
 * A coin only earns the gold gem highlight after a FULL background check
 * passes every gate below. Rationale: the gem must never point at a coin
 * whose dev can still nuke it in one transaction.
 */
/* ──────────────── Live state: already-rugged / dumping detection ──────────
 * Thresholds for lib/liveState.ts. These answer "what is happening NOW",
 * separate from the structural audit. Tuned to catch corpses and active exits.
 */
export const LIVE_STATE = {
  /** Liquidity below this (USD) on a listed coin = effectively pulled. */
  deadLiquidityUsd: 1_500,
  /** Price change ≤ this % (6h or 24h) = the collapse already happened. */
  deadDropPct: -70,
  /** Price change ≤ this % (1h or 6h) = actively dumping. */
  dumpingDropPct: -30,
  /** Sells > buys × this (1h) = holders exiting. */
  sellDominanceRatio: 1.8,
  /** Minimum 1h transactions before buy/sell flow is meaningful. */
  minTxnsForFlow: 15,
} as const;

/* ───────────────────────── King Grade (0–100%) ────────────────────────────
 * One strict percentage per coin: 100% = passed every audit we can run,
 * 0% = confirmed danger. Composite of safety (inverted risk), quality and
 * AUDIT COVERAGE — unknowns actively hurt the grade, so a coin cannot score
 * high on a shallow scan; it must prove itself on a full background check.
 * Hard caps below keep it strict. Still not a profit prediction.
 */
export const KING_GRADE = {
  safetyWeight: 0.5, // (100 - riskScore) share
  qualityWeight: 0.3, // qualityScore share
  coverageWeight: 0.2, // % of the 10 audit checks actually verified
  caps: {
    confirmedTrap: 10, // active mint/freeze auth, trap extension, honeypot, deployer-held LP
    highRisk: 15, // riskScore ≥ 60
    onBondingCurve: 40, // dev/insiders can dump any second
    partialData: 50, // holders or LP not verified yet
    noGemPass: 79, // 80%+ is reserved for coins that passed the full background check
  },
} as const;

/** Grade buckets for display. */
export const GRADE_META: Array<{ min: number; label: string; color: string; textColor: string }> = [
  { min: 80, label: 'GEM GRADE', color: '#d4a017', textColor: '#1b1b18' },
  { min: 60, label: 'STRONG', color: '#46a758', textColor: '#ffffff' },
  { min: 40, label: 'MIXED', color: '#ffb224', textColor: '#1b1b18' },
  { min: 20, label: 'WEAK', color: '#f76b15', textColor: '#ffffff' },
  { min: 0, label: 'AVOID', color: '#e5484d', textColor: '#ffffff' },
];

export const GEM_CRITERIA = {
  /** Must be OFF the bonding curve (graduated) — on-curve devs can dump any second. */
  requireGraduated: true,
  /** LP must be burned or locked. */
  requireLpSecured: true,
  /** No single non-LP wallet may hold more than this % of supply. */
  maxLargestWalletPct: 10,
  /** Risk score must be at or below LIVE_FEED.notifyMaxScore, quality at or above LIVE_FEED.gemMinQuality. */
} as const;

/** Total mitigation is capped at this many points (applied as a floor of -15). */
export const MITIGATION_CAP = 15;

/** Score → signal thresholds (inclusive lower bounds, checked top-down). */
export const SIGNAL_THRESHOLDS: Array<{ min: number; signal: Signal }> = [
  { min: 80, signal: 'AVOID' },
  { min: 60, signal: 'HIGH_RISK' },
  { min: 40, signal: 'WATCH' },
  { min: 20, signal: 'CONSIDER' },
  { min: 0, signal: 'NEUTRAL' },
];

/**
 * UI metadata per signal — labels are plain English about DANGER LEVEL only.
 * (Internal Signal ids are unchanged; only display text differs.)
 * IMPORTANT: lower observed risk ≠ safe — keep that framing everywhere.
 */
export const SIGNAL_META: Record<Signal, { color: string; textColor: string; label: string; blurb: string }> = {
  AVOID: { color: '#e5484d', textColor: '#ffffff', label: 'AVOID', blurb: 'Severe red flags — likely scam/rug setup.' },
  HIGH_RISK: { color: '#f76b15', textColor: '#ffffff', label: 'HIGH RISK', blurb: 'Multiple serious red flags.' },
  WATCH: { color: '#ffb224', textColor: '#1b1b18', label: 'RISKY', blurb: 'Notable red flags — read them first.' },
  CONSIDER: { color: '#46a758', textColor: '#ffffff', label: 'MILD RISK', blurb: 'Some red flags found — not danger-free, not a buy call.' },
  NEUTRAL: { color: '#64748b', textColor: '#ffffff', label: 'LOW RISK', blurb: 'Few red flags found — still speculative, not safe.' },
};

/** Mandatory disclaimer — rendered in overlay details, popup footer, dashboard, README. */
export const DISCLAIMER =
  'Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; ' +
  'it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. ' +
  'Not financial advice.';
