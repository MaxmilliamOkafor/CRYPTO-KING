/**
 * lib/types.ts — shared domain model for CRYPTO-KING.
 *
 * Design notes:
 *  - Every data field that comes from the network is `T | null`. `null` ALWAYS
 *    means "we could not determine this" — it never means "safe". The scorer
 *    turns nulls into human-readable entries in `RiskResult.dataGaps` and
 *    awards ZERO points for them (we never fake a score, ground rule #6).
 *  - The model is Solana-native: mint/freeze authority, Token-2022 transfer
 *    fees, metadata mutability and LP status — NOT EVM concepts like
 *    "ownable contract" or "renounced ownership".
 */

/** Risk signal buckets. NOTE: CONSIDER/NEUTRAL mean "lower observed risk", never "buy". */
import type { Outcome } from './outcomeLedger.ts';

export type Signal = 'AVOID' | 'HIGH_RISK' | 'WATCH' | 'CONSIDER' | 'NEUTRAL';

export type LpStatus =
  | 'burned' // LP tokens sent to the incinerator — strongest signal
  | 'locked' // LP tokens in a third-party locker (still trust-the-locker)
  | 'deployer_held' // deployer wallet holds LP — can rug at any moment
  | 'unlocked' // LP held by an ordinary wallet (not deployer, not locked)
  | 'unknown'; // could not be determined → data gap, no points either way

export type DeployerFunding =
  | 'cex' // funded from a known exchange hot wallet — weak positive
  | 'fresh_unknown' // fresh wallet, unclear funding — mild caution
  | 'known_rugger' // funded from a wallet linked to prior rugs — strong negative
  | 'unknown';

export interface TokenIdentity {
  /** Base58 mint address on Solana. */
  address: string;
  symbol: string | null;
  name: string | null;
  chain: 'sol';
  /** Age since first liquidity / mint, in minutes. null = unknown. */
  ageMinutes: number | null;
  logoUri?: string | null;
}

/** On-chain mint account facts (SPL Token / Token-2022). */
export interface MintInfo {
  /** true = mint authority NOT revoked → supply can be inflated at any time. */
  mintAuthorityActive: boolean | null;
  /** true = freeze authority NOT revoked → dev can freeze holder wallets (Solana's honeypot equivalent). */
  freezeAuthorityActive: boolean | null;
  /** true = Metaplex metadata is mutable → name/symbol/socials can be swapped after launch. */
  metadataMutable: boolean | null;
  /** true if the mint is owned by the Token-2022 program. */
  isToken2022: boolean | null;
  /** Token-2022 transfer fee, in basis points (100 bps = 1%). null = no fee extension / unknown. */
  transferFeeBps: number | null;
  /** true = fee-config or withdraw-withheld authority still set → fees can change after you buy. */
  feeAuthorityActive: boolean | null;
  /* Token-2022 trap extensions — the current generation of rug tricks: */
  /** permanentDelegate set → the delegate can SEIZE tokens from any wallet. */
  permanentDelegateActive: boolean | null;
  /** transferHook set → transfers run dev code that can block sells (programmable honeypot). */
  transferHookActive: boolean | null;
  /** defaultAccountState = frozen → new holder accounts start frozen. */
  defaultAccountFrozen: boolean | null;
  /** nonTransferable → soulbound; you cannot sell at all. */
  nonTransferable: boolean | null;
}

/** Holder distribution, LP/burn addresses excluded where possible. */
export interface HolderInfo {
  holderCount: number | null;
  /** % of supply held by top 5 non-LP, non-burn wallets (0–100). */
  top5Pct: number | null;
  /** % of supply held by top 10 non-LP, non-burn wallets (0–100). */
  top10Pct: number | null;
  /** Largest single non-LP wallet's % of supply. */
  largestNonLpWalletPct: number | null;
  /** % of supply bought in blocks 0–2 by wallets funded from a single source ("bundled"/sniped launch). */
  bundledLaunchPct: number | null;
  /** % of supply held by the user's configured SMART_MONEY_WALLETS (full scans only). */
  smartMoneyPct: number | null;
  /** % of supply the CREATOR wallet holds among top accounts (full scans only). 0 = dev sold/holds nothing visible. */
  devHoldsPct: number | null;
}

export interface SellSimulation {
  /** false = simulated sell failed outright (honeypot-like). */
  ok: boolean;
  /** Effective slippage/loss of the simulated sell, percent. */
  slippagePct: number | null;
}

/** Market/liquidity facts. All monetary values in EUR (converted via config.EUR_PER_USD). */
export interface MarketInfo {
  priceEur: number | null;
  marketCapEur: number | null;
  liquidityEur: number | null;
  volume24hEur: number | null;
  lpStatus: LpStatus;
  sellSimulation: SellSimulation | null;
  /* Live momentum — how an ALREADY-rugged / actively-dumping coin is detected.
     null = unknown (never treated as healthy). */
  priceChange1h: number | null;
  priceChange6h: number | null;
  priceChange24h: number | null;
  buys1h: number | null;
  sells1h: number | null;
}

/** Live state of a coin's market RIGHT NOW — separate from structural risk. */
export type LiveState = 'HEALTHY' | 'DUMPING' | 'DEAD' | 'UNKNOWN';

/** Behavioral pattern flags (from trade-history heuristics / GMGN tags). */
export interface BehaviorInfo {
  /** Volume spiked while price stayed flat (wash-trading pattern). */
  volumeSpikeFlatPrice: boolean | null;
  /** Many small buys followed by one huge sell (exit-scam pattern). */
  manySmallBuysOneHugeSell: boolean | null;
  /** Market cap spiked with no matching organic volume. */
  mcapSpikeNoOrganicVolume: boolean | null;
  /** Deployer-linked wallets started selling shortly after launch. */
  deployerLinkedSelling: boolean | null;
  /** Abnormal volume for a token this young. */
  abnormalEarlyVolume: boolean | null;
}

export interface DeployerInfo {
  /** Number of prior tokens from this deployer that rugged. null = unknown. */
  priorRugs: number | null;
  fundingSource: DeployerFunding;
  /** Coins this creator launched before this one (launchpad records). null = unknown. */
  priorLaunches: number | null;
  /** Of those, how many are dead/abandoned (never graduated, negligible mcap). */
  priorDeadLaunches: number | null;
  /** Of those, how many graduated their bonding curve (creator track record). */
  graduatedLaunches: number | null;
}

export interface SocialInfo {
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  /** true only when GMGN/an auditor marks the socials verified. */
  verified: boolean | null;
}

/** Launch-platform facts (pump.fun today; other launchpads pluggable). */
export interface LaunchInfo {
  platform: 'pumpfun' | null;
  /** false = still on the bonding curve — ultra-early, pre-AMM. */
  bondingCurveComplete: boolean | null;
  /** true = banned/flagged on its own launch platform. */
  bannedOnPlatform: boolean | null;
  /** Platform comment count — crude community-traction signal. */
  replyCount: number | null;
  /** Bonding-curve progress 0–100 (SOL in the curve ÷ the 85 SOL graduation
   *  target). 100 once graduated. Optional: fixtures predate it. */
  curveProgressPct?: number | null;
  /** Current market cap ÷ its all-time high (0–1). Low = the pump-and-dump
   *  already happened. Ratio only, so pump.fun's SOL units cancel out. */
  athRatio?: number | null;
  /** Reached pump.fun's "king of the hill" (top of the board) at some point. */
  kingOfTheHill?: boolean | null;
}

export interface SmartMoneyInfo {
  /** Known smart-money/KOL wallets currently accumulating (GMGN data). */
  accumulating: boolean | null;
  /** Smart money exiting the token. */
  exiting: boolean | null;
  /** How many distinct smart-money wallets are involved. */
  walletCount: number | null;
}

export type SourceStatus = 'ok' | 'partial' | 'unavailable' | 'mock' | 'disabled';

/** Everything the scorer needs, aggregated by the background worker. */
export interface TokenAnalysis {
  identity: TokenIdentity;
  mint: MintInfo | null;
  holders: HolderInfo | null;
  market: MarketInfo | null;
  behavior: BehaviorInfo | null;
  deployer: DeployerInfo | null;
  socials: SocialInfo | null;
  smartMoney: SmartMoneyInfo | null;
  launch: LaunchInfo | null;
  /** Matched narrative tags (informational only — never scored; see config.TRENDING_NARRATIVES). */
  narratives: string[];
  sources: {
    gmgn: SourceStatus;
    solana: SourceStatus;
    pumpfun: SourceStatus;
    rugcheck: SourceStatus;
    deployer: SourceStatus;
  };
  fetchedAt: number; // epoch ms
}

/** A single triggered risk factor, points included, ready for UI display. */
export interface RiskReason {
  points: number; // positive = risk, negative = mitigation
  text: string;
}

/**
 * The positive axis: observable quality/momentum signals (0–100). Explicitly
 * NOT a profit prediction — it counts good signs (smart money, burned LP,
 * healthy distribution, real liquidity, survival) the way the risk score
 * counts bad ones.
 */
export interface QualityResult {
  qualityScore: number;
  /** Triggered positive signals, sorted by points descending. */
  reasons: RiskReason[];
  insufficientData: boolean;
}

export interface RiskResult {
  /** 0–100, clamped. Higher = more observed risk. */
  riskScore: number;
  signal: Signal;
  /** Triggered risk factors, sorted by points descending. UI shows the top 3–6. */
  reasons: RiskReason[];
  /** Applied mitigating signals (negative points, total capped in config). */
  mitigations: RiskReason[];
  /** Human-readable list of checks we could NOT perform. Never scored. */
  dataGaps: string[];
  /** true when so little data was available that showing a score would be misleading. */
  insufficientData: boolean;
}

/** Row persisted in chrome.storage.local for the dashboard's "recently analyzed" table. */
export interface RecentToken {
  address: string;
  symbol: string | null;
  name: string | null;
  ageMinutes: number | null;
  marketCapEur: number | null;
  liquidityEur: number | null;
  priceEur: number | null;
  riskScore: number;
  signal: Signal;
  /** King Grade 0–100% (higher = better) — the consistent headline metric. */
  grade: number | null;
  insufficientData: boolean;
  updatedAt: number; // epoch ms
}

/** Snapshot of the rug-relevant state of a watched coin at one point in time. */
export interface WatchSnapshot {
  at: number;
  grade: number | null;
  liquidityEur: number | null;
  marketCapEur: number | null;
  lpStatus: LpStatus;
  devHoldsPct: number | null;
  largestNonLpWalletPct: number | null;
  /** Live market state at snapshot time. Optional: snapshots stored before
   *  this field existed load without it. */
  liveState?: LiveState;
}

/** A coin the user is holding/watching — re-scanned periodically for rug alerts. */
export interface WatchedCoin {
  address: string;
  symbol: string | null;
  addedAt: number;
  /** State when watching started — alerts compare against this. */
  baseline: WatchSnapshot;
  /** Most recent scan state. */
  last: WatchSnapshot;
  /** Alert kinds already fired for this coin (each fires once). */
  alerted: string[];
}

/** Manual P&L journal entry (dashboard). Manual entries only — no wallet access, ever. */
export interface JournalEntry {
  id: string;
  address: string;
  symbol: string;
  entryPriceEur: number;
  amountTokens: number;
  exitPriceEur: number | null; // null = still open
  note: string;
  createdAt: number;
}

/** Messages between content script / popup / dashboard and the background worker. */
/* ── 🏔 Long-hold radar ──────────────────────────────────────────────── */

export type LongHoldTier = 'CANDIDATE' | 'WATCH' | 'WEAK' | 'TOO_EARLY' | 'LATE' | 'NOT_A_HOLD' | 'NO_DATA';

export interface LongHoldPillar {
  /** Stable id (long-hold: survival/community/distribution/liquidity/demand/resilience;
   *  early gem: community/fairLaunch/momentum/conviction). */
  key: string;
  label: string;
  score: number;
  max: number;
  good: string[];
  bad: string[];
  /** Inputs that couldn't be verified (scored 0). */
  unknown: string[];
}

/** "Staying Power" — could this be held for weeks/months? (lib/longHold.ts) */
export interface LongHoldResult {
  tier: LongHoldTier;
  /** 0–100, higher = better. null when there is no data at all. */
  score: number | null;
  pillars: LongHoldPillar[];
  /** Any one → NOT_A_HOLD, regardless of score. */
  disqualifiers: string[];
  strengths: string[];
  concerns: string[];
  unverified: string[];
  /** Mint/freeze revoked, LP secured, distribution + 7d history all PROVEN. */
  coreVerified: boolean;
  ageDays: number | null;
  historyDays: number;
}

/* ── 🌱 Early gems: spotted at launch, followed while you hold ─────────── */

/** SEED < 24h · SPROUT 1–3 days · ROOTED 3+ days (long-hold rules take over). */
export type GemStage = 'SEED' | 'SPROUT' | 'ROOTED';
export type EarlyVerdict = 'STRONG' | 'PROMISING' | 'WEAK' | 'REJECT' | 'NO_DATA';

/** "Early Conviction" for a coin in its first days (lib/earlyGem.ts). */
export interface EarlyGemResult {
  stage: GemStage;
  verdict: EarlyVerdict;
  /** 0–100, higher = stronger early evidence. null = no data. */
  score: number | null;
  pillars: LongHoldPillar[];
  disqualifiers: string[];
  /** A disqualifier that ends the thesis for a HOLDER (not just "don't enter
   *  right now"): everything except a temporary dump. */
  hardBreak: boolean;
  strengths: string[];
  concerns: string[];
  unverified: string[];
  ageHours: number | null;
  curveProgressPct: number | null;
}

export type TrackedStatus = 'ACTIVE' | 'DROPPED';

export interface GemSnapshot {
  at: number;
  mcap: number | null;
  holders: number | null;
  liquidity: number | null;
  score: number | null;
  dead: boolean;
}

/** A coin the tracker follows from first sight (low cap) through the hold. */
export interface TrackedGem {
  address: string;
  symbol: string | null;
  source: 'auto' | 'manual';
  spottedAt: number;
  /** Market cap when first spotted — every multiple is measured from here. */
  spottedMcap: number;
  status: TrackedStatus;
  dropReason: string | null;
  stage: GemStage;
  verdict: EarlyVerdict | LongHoldTier;
  score: number | null;
  lastMcap: number | null;
  peakMcap: number | null;
  lastCheckedAt: number;
  nextCheckAt: number;
  /** Alert kinds already fired (each fires once). */
  fired: string[];
  /** Latest first, capped. */
  events: Array<{ at: number; text: string; tone: 'good' | 'bad' | 'info' }>;
  /** Oldest first, capped — powers holder growth and the portfolio report. */
  snapshots: GemSnapshot[];
}

/** "If you had bought every 🌱 at first sight" — per horizon. */
export interface GemPortfolioRow {
  horizonDays: number;
  /** Coins spotted at least `horizonDays` ago. */
  eligible: number;
  /** …of which we have a measurement near the horizon. */
  measured: number;
  alive: number;
  /** Equal money in each: average multiple (dead = 0×). The honest wallet number. */
  portfolioMultiple: number | null;
  medianMultiple: number | null;
  bestMultiple: number | null;
  bestSymbol: string | null;
}

export type GemsResponse =
  | { ok: true; gems: TrackedGem[]; portfolio: GemPortfolioRow[] }
  | { ok: false; error: string };

/** One row of the long-hold radar list. */
export interface RadarRow {
  address: string;
  symbol: string | null;
  name: string | null;
  tier: LongHoldTier;
  score: number | null;
  ageDays: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  /** Best strength, or the reason it fails — one line for the list. */
  headline: string | null;
  checkedAt: number;
}

export type RadarResponse =
  | { ok: true; rows: RadarRow[]; sweptAt: number | null; sweeping: boolean; checked: number }
  | { ok: false; error: string };

export type LongHoldResponse =
  | { ok: true; result: LongHoldResult; early: EarlyGemResult | null; symbol: string | null; tracked: boolean }
  | { ok: false; error: string };

/** Long-hold report card: did "candidates" actually hold up at 7d / 30d? */
export interface LongHoldLedgerEntry {
  address: string;
  symbol: string | null;
  at: number;
  tier: LongHoldTier;
  score: number | null;
  baselineMcap: number;
  /** Outcomes keyed by check day ("7", "30"). */
  outcomes: Record<string, { outcome: Outcome; mcap: number | null; checkedAt: number }>;
}

export interface LongHoldAccuracyRow {
  tier: LongHoldTier;
  day: number;
  checked: number;
  survived: number;
  winners: number;
  /** Median market-cap multiple at that check (1 = flat). */
  medianMultiple: number | null;
}

export type LongHoldAccuracyResponse =
  | { ok: true; rows: LongHoldAccuracyRow[]; tracked: number }
  | { ok: false; error: string };

export type BgRequest =
  | {
      type: 'ANALYZE_TOKEN';
      address: string;
      force?: boolean;
      /**
       * Optional raw GMGN endpoint payloads fetched SAME-ORIGIN by the content
       * script (so gmgn.ai's session/anti-bot cookies apply). When present the
       * background parses these instead of fetching GMGN itself. Shape matches
       * lib/gmgnClient.ts GmgnRaw; typed as unknown here to keep types.ts I/O-free.
       */
      rawGmgn?: unknown;
    }
  | { type: 'GET_RECENT' }
  | { type: 'CLEAR_RECENT' }
  | { type: 'GET_LIVE_FEED' }
  /** Resolve DEX pair addresses → base token mints (DEXTools inline badges). */
  | { type: 'RESOLVE_PAIRS'; pairAddresses: string[] }
  | { type: 'WATCH_TOKEN'; address: string; symbol: string | null }
  | { type: 'UNWATCH_TOKEN'; address: string }
  | { type: 'GET_WATCHLIST' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; heliusKey?: string | null; xBearerToken?: string | null }
  | { type: 'CHECK_X'; symbol: string | null; address: string }
  | { type: 'GET_ACCURACY' }
  /** Long-hold radar list (sweeps in the background if stale). */
  | { type: 'GET_RADAR' }
  /** Force a radar sweep now. */
  | { type: 'RUN_RADAR' }
  /** Staying-power assessment for one coin (runs a full scan + history). */
  | { type: 'GET_LONGHOLD'; address: string }
  | { type: 'GET_LH_ACCURACY' }
  /** 🌱 Gem tracker list + "bought every gem at first sight" report. */
  | { type: 'GET_GEMS' }
  | { type: 'TRACK_GEM'; address: string }
  | { type: 'UNTRACK_GEM'; address: string };

export type AnalyzeResponse =
  | { ok: true; analysis: TokenAnalysis; risk: RiskResult; quality: QualityResult; mock: boolean }
  | { ok: false; error: string };

export type RecentResponse = { ok: true; recent: RecentToken[] } | { ok: false; error: string };

/** One coin in the real-time Live feed. */
export interface FeedRow {
  address: string;
  symbol: string | null;
  name: string | null;
  ageMinutes: number | null;
  marketCapEur: number | null;
  /** Live price in USD (meme prices are universally quoted in $). */
  priceUsd: number | null;
  riskScore: number;
  signal: Signal;
  topReason: string | null;
  /** Positive-signal score (0–100), null when too little data to say anything. */
  qualityScore: number | null;
  /** King Grade 0–100% (strict composite incl. audit coverage; lib/kingGrade.ts). */
  grade: number | null;
  /** true = passed the FULL 💎 background check (lib/gemCriteria.ts) on verified data. */
  gem: boolean;
  /** Pre-buy rug verdict (lib/rugPotential.ts), computed in the background for EVERY coin. */
  rugVerdict: 'HIGH' | 'POSSIBLE' | 'LOW' | 'UNVERIFIED';
  /** Live market state — DEAD = already rugged, DUMPING = exiting now. */
  liveState: LiveState;
  /** true = graduated off its bonding curve; null = unknown/not a launchpad coin. */
  graduated: boolean | null;
  /** Informational narrative tags (never scored). */
  narratives: string[];
  /** The coin's linked X/Twitter (handle or URL), auto-detected — null if none. */
  twitter: string | null;
  /** 🌱 Followed by the gem tracker. */
  tracked: boolean;
  insufficientData: boolean;
  /** true = key checks (holders / LP) not yet verified — score is a floor, not a verdict. */
  unverified: boolean;
  scannedAt: number;
}

export type LiveFeedResponse =
  | { ok: true; feed: FeedRow[]; source: SourceStatus; scannedThisPoll: number }
  | { ok: false; error: string };

export type WatchlistResponse = { ok: true; watchlist: WatchedCoin[] } | { ok: false; error: string };

export type SettingsResponse =
  | { ok: true; hasHelius: boolean; heliusKeySet: boolean; hasX: boolean; xTokenSet: boolean }
  | { ok: false; error: string };

export type AccuracyResponse =
  | {
      ok: true;
      accuracy: {
        bands: Array<{
          band: string;
          total: number;
          rugged: number;
          faded: number;
          survived: number;
          winners: number;
          survivalPct: number;
        }>;
        totalChecked: number;
        pending: number;
      };
    }
  | { ok: false; error: string };

export type XBuzzResponse =
  | { ok: true; buzz: { tweetCount: number; notableAuthors: string[]; query: string } | null; hasToken: boolean }
  | { ok: false; error: string };

export type ResolvePairsResponse =
  | { ok: true; tokens: Record<string, { address: string; symbol: string | null }> }
  | { ok: false; error: string };
