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

/** true = ship with deterministic fixtures (mock/fixtures.ts). No network calls at all. */
export const MOCK_MODE = true;

/** Display currency. All fixture values and converted live values are EUR. */
export const DISPLAY_CURRENCY = 'EUR' as const;

/**
 * Static USD→EUR conversion for live data (GMGN/pump.fun report USD).
 * Precision here only affects displayed € figures, never risk scores.
 */
export const EUR_PER_USD = 0.92;

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

  // Holder concentration (medium-high)
  top10Concentrated: 15, // top 10 > LIMITS.top10Pct (LP/burn excluded)
  singleWalletDominant: 10, // one non-LP wallet > LIMITS.singleWalletPct
  top5EffectiveConcentration: 15, // top 5 > LIMITS.top5Pct despite ≥ LIMITS.top5MinHolders holders
  bundledLaunch: 15, // bundled/sniped supply > LIMITS.bundledPct

  // Liquidity & market cap (medium)
  thinLiquidityVsMcap: 10, // liq < LIMITS.thinLiquidityEur while mcap > LIMITS.thinLiqMcapEur
  microMcapUnlockedLp: 15, // mcap < LIMITS.microMcapEur AND LP not secured
  mcapSpikeNoOrganicVolume: 10,

  // Age & behavior (medium)
  youngTokenAbnormalVolume: 10, // age < LIMITS.youngAgeMinutes with abnormal volume
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

/** UI metadata per signal. IMPORTANT: lower observed risk ≠ safe — keep that framing. */
export const SIGNAL_META: Record<Signal, { color: string; textColor: string; label: string; blurb: string }> = {
  AVOID: { color: '#e5484d', textColor: '#ffffff', label: 'AVOID', blurb: 'Severe risk factors observed.' },
  HIGH_RISK: { color: '#f76b15', textColor: '#ffffff', label: 'HIGH RISK', blurb: 'Multiple serious risk factors.' },
  WATCH: { color: '#ffb224', textColor: '#1b1b18', label: 'WATCH', blurb: 'Notable risk factors present.' },
  CONSIDER: { color: '#46a758', textColor: '#ffffff', label: 'CONSIDER', blurb: 'Fewer observed risks — NOT a buy signal.' },
  NEUTRAL: { color: '#64748b', textColor: '#ffffff', label: 'NEUTRAL', blurb: 'Low observed risk ≠ safe.' },
};

/** Mandatory disclaimer — rendered in overlay details, popup footer, dashboard, README. */
export const DISCLAIMER =
  'Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; ' +
  'it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. ' +
  'Not financial advice.';
