/**
 * background/service-worker.ts — the ONLY place network calls happen.
 *
 * Responsibilities:
 *  - answer ANALYZE_TOKEN messages from the content script & popup,
 *  - aggregate GMGN (primary) + Solana RPC (authoritative on-chain) +
 *    pump.fun (secondary) + RugCheck (optional) + deployer stub,
 *  - merge with clear precedence: on-chain RPC beats GMGN for authority
 *    facts; GMGN beats pump.fun for market facts; nulls stay null,
 *  - score via the pure riskScorer,
 *  - cache per address (config.CACHE_TTL_MS) + dedupe in-flight requests,
 *  - persist a RecentToken row for the dashboard (chrome.storage.local).
 *
 * Read-only by design: no keys, no wallets, no signing, no trading.
 */

import {
  CACHE_TTL_MS,
  DEBUG,
  EARLY_GEM,
  EUR_PER_USD,
  EXIT_REALITY,
  LIVE_FEED,
  LONG_HOLD,
  MOCK_MODE,
  OUTCOME_LEDGER,
  RECENT_MAX,
  WATCHLIST,
} from '../config.ts';
import { classifyOutcome, computeAccuracy, computeLongHoldAccuracy, type LedgerEntry, type Outcome } from '../lib/outcomeLedger.ts';
import {
  fetchDailyCandles,
  fetchPool,
  fetchRadarPools,
  fetchTokenInfo,
  type Candle,
  type GeckoTokenInfo,
  type RadarPool,
} from '../lib/geckoClient.ts';
import { assessEarlyGem, computeGemPortfolio } from '../lib/earlyGem.ts';
import { assessLongHold } from '../lib/longHold.ts';
import { resolveLpStatus } from '../lib/lpStatus.ts';
import { nullDeployerAdapter, pumpfunDeployerAdapter } from '../lib/deployerClient.ts';
import {
  fetchDexscreenerNewSolana,
  fetchDexscreenerToken,
  fetchPairBaseTokens,
  lookupDexscreenerToken,
  peekDexscreenerToken,
  primeDexscreenerTokens,
  type DexTokenMarket,
} from '../lib/dexscreenerClient.ts';
import { gemBackgroundCheck } from '../lib/gemCriteria.ts';
import { fetchSellQuote, type SellQuote } from '../lib/jupiterClient.ts';
import { computeKingGrade, gradeLabel } from '../lib/kingGrade.ts';
import { assessLiveState } from '../lib/liveState.ts';
import { matchNarratives } from '../lib/narratives.ts';
import { emptyGmgnData, fetchGmgnData, parseGmgn, type GmgnData, type GmgnRaw } from '../lib/gmgnClient.ts';
import { fetchPumpfunData, fetchPumpfunNewCoins, type PumpfunData } from '../lib/pumpfunClient.ts';
import { scoreQuality } from '../lib/qualityScorer.ts';
import { scoreToken } from '../lib/riskScorer.ts';
import { assessRugPotential } from '../lib/rugPotential.ts';
import {
  effectiveConcurrency,
  effectiveScanBudget,
  getSettings,
  hasHelius,
  hasX,
  loadSettings,
  setSettings,
  xBearerToken,
} from '../lib/settings.ts';
import { fetchXBuzz } from '../lib/twitterClient.ts';
import { computeWatchAlerts } from '../lib/watchAlerts.ts';
import { rugcheckAdapter } from '../lib/rugcheckClient.ts';
import { fetchSolanaData, type SolanaData } from '../lib/solanaClient.ts';
import type {
  AccuracyResponse,
  AnalyzeResponse,
  BgRequest,
  EarlyGemResult,
  FeedRow,
  GemSnapshot,
  GemsResponse,
  LiveFeedResponse,
  LongHoldAccuracyResponse,
  LongHoldLedgerEntry,
  LongHoldResponse,
  LongHoldResult,
  LongHoldTier,
  MarketInfo,
  MintInfo,
  QualityResult,
  RadarResponse,
  RadarRow,
  RecentResponse,
  RecentToken,
  ResolvePairsResponse,
  RiskResult,
  SettingsResponse,
  TokenAnalysis,
  TrackedGem,
  WatchedCoin,
  WatchlistResponse,
  WatchSnapshot,
  XBuzzResponse,
} from '../lib/types.ts';

const RECENT_KEY = 'ck:recent';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface CacheEntry {
  analysis: TokenAnalysis;
  risk: RiskResult;
  quality: QualityResult;
  at: number;
  /** true = produced by a lite feed scan (mint-only); a full request re-scans. */
  lite: boolean;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AnalyzeResponse>>();

/**
 * Overlay the latest DexScreener market data onto a cached analysis and
 * re-score it (the scorers are pure and cheap). The structural scan (mint,
 * holders, LP) is good for minutes; the MARKET can collapse in seconds — so a
 * coin that rugs after it was first scanned must not keep its old grade.
 */
function refreshMarket(entry: CacheEntry): CacheEntry {
  const dex = peekDexscreenerToken(entry.analysis.identity.address); // primed by the sweep; no network
  if (!dex) return entry;
  const prev = entry.analysis.market;
  const market: MarketInfo = {
    priceEur: dex.priceUsd ?? prev?.priceEur ?? null,
    marketCapEur: dex.marketCapUsd ?? prev?.marketCapEur ?? null,
    liquidityEur: dex.liquidityUsd ?? prev?.liquidityEur ?? null,
    volume24hEur: dex.volume24hUsd ?? prev?.volume24hEur ?? null,
    lpStatus: prev?.lpStatus ?? 'unknown',
    sellSimulation: prev?.sellSimulation ?? null,
    priceChange1h: dex.priceChange1h,
    priceChange6h: dex.priceChange6h,
    priceChange24h: dex.priceChange24h,
    buys1h: dex.buys1h,
    sells1h: dex.sells1h,
  };
  const analysis: TokenAnalysis = { ...entry.analysis, market };
  const next: CacheEntry = { ...entry, analysis, risk: scoreToken(analysis), quality: scoreQuality(analysis) };
  cache.set(analysis.identity.address, next);
  return next;
}

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true; // async sendResponse
});

async function handle(
  msg: BgRequest,
): Promise<
  | AnalyzeResponse
  | RecentResponse
  | LiveFeedResponse
  | ResolvePairsResponse
  | WatchlistResponse
  | SettingsResponse
  | XBuzzResponse
  | AccuracyResponse
  | RadarResponse
  | LongHoldResponse
  | LongHoldAccuracyResponse
  | GemsResponse
> {
  switch (msg.type) {
    case 'ANALYZE_TOKEN':
      return analyzeToken(msg.address, msg.force === true, msg.rawGmgn);
    case 'GET_RECENT': {
      const recent = await loadRecent();
      return { ok: true, recent };
    }
    case 'CLEAR_RECENT':
      await chrome.storage.local.set({ [RECENT_KEY]: [] });
      return { ok: true, recent: [] };
    case 'GET_LIVE_FEED':
      return getLiveFeed();
    case 'RESOLVE_PAIRS': {
      const valid = msg.pairAddresses.filter((p) => BASE58_RE.test(p)).slice(0, 90);
      return { ok: true, tokens: await fetchPairBaseTokens(valid) };
    }
    case 'WATCH_TOKEN':
      return watchToken(msg.address, msg.symbol);
    case 'UNWATCH_TOKEN':
      return unwatchToken(msg.address);
    case 'GET_WATCHLIST':
      return { ok: true, watchlist: await loadWatchlist() };
    case 'GET_SETTINGS': {
      await loadSettings();
      const s = getSettings();
      return { ok: true, hasHelius: hasHelius(), heliusKeySet: Boolean(s.heliusKey), hasX: hasX(), xTokenSet: Boolean(s.xBearerToken) };
    }
    case 'SET_SETTINGS': {
      const patch: { heliusKey?: string | null; xBearerToken?: string | null } = {};
      if ('heliusKey' in msg) patch.heliusKey = msg.heliusKey ?? null;
      if ('xBearerToken' in msg) patch.xBearerToken = msg.xBearerToken ?? null;
      await setSettings(patch);
      if ('heliusKey' in msg) cache.clear(); // RPC changed → re-scan everything
      const s = getSettings();
      return { ok: true, hasHelius: hasHelius(), heliusKeySet: Boolean(s.heliusKey), hasX: hasX(), xTokenSet: Boolean(s.xBearerToken) };
    }
    case 'CHECK_X': {
      const buzz = await fetchXBuzz(msg.symbol, msg.address, xBearerToken());
      return { ok: true, buzz, hasToken: hasX() };
    }
    case 'GET_ACCURACY':
      return { ok: true, accuracy: computeAccuracy(await loadLedger()) };
    case 'GET_RADAR':
      return getRadar(false);
    case 'RUN_RADAR':
      return getRadar(true);
    case 'GET_LONGHOLD': {
      if (!BASE58_RE.test(msg.address)) return { ok: false, error: 'Not a valid Solana address.' };
      const res = await assessLongHoldFor(msg.address);
      if (!res) return { ok: false, error: 'Long-hold check unavailable.' };
      const tracked = (await loadGems()).gems.some((g) => g.address === msg.address && g.status === 'ACTIVE');
      return { ok: true, result: res.result, early: res.early, symbol: res.symbol, tracked };
    }
    case 'GET_GEMS':
      return getGems();
    case 'TRACK_GEM':
      if (!BASE58_RE.test(msg.address)) return { ok: false, error: 'Not a valid Solana address.' };
      return trackGemManually(msg.address);
    case 'UNTRACK_GEM':
      return untrackGem(msg.address);
    case 'GET_LH_ACCURACY': {
      const entries = await loadLhLedger();
      return { ok: true, rows: computeLongHoldAccuracy(entries, LONG_HOLD.ledgerCheckDays), tracked: entries.length };
    }
    default:
      return { ok: false, error: `Unknown message type: ${(msg as { type?: string }).type}` };
  }
}

/* ── Live feed: real-time auto-scan of the newest launches ─────────────── */

const feed = new Map<string, FeedRow>();
const notified = new Set<string>(); // mints already desktop-notified
let feedInFlight: Promise<LiveFeedResponse> | null = null;
/** When the last feed sweep ran — the gem alarm runs one if nothing else has. */
let lastFeedSweepAt = 0;

/** Concurrent polls (multiple tabs) share one sweep instead of doubling the scans. */
function getLiveFeed(): Promise<LiveFeedResponse> {
  if (!LIVE_FEED.enabled) return Promise.resolve({ ok: false, error: 'Live feed disabled in config.' });
  if (feedInFlight) return feedInFlight;
  feedInFlight = doLiveFeedSweep().finally(() => {
    feedInFlight = null;
  });
  return feedInFlight;
}

async function doLiveFeedSweep(): Promise<LiveFeedResponse> {
  lastFeedSweepAt = Date.now();
  // Pull fresh launches (pump.fun, newest-created) AND established/migrated
  // Solana tokens (DexScreener) so the feed covers both brand-new coins and
  // graduated ones — merged, de-duplicated, pump.fun entries first.
  const [pumpCoins, dexAddrs] = await Promise.all([
    fetchPumpfunNewCoins(LIVE_FEED.fetchCount),
    fetchDexscreenerNewSolana(LIVE_FEED.fetchCount),
  ]);
  const seen = new Set<string>();
  const coins: Array<{ mint: string; symbol: string | null; name: string | null; createdMs: number | null }> = [];
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
      error: MOCK_MODE ? 'Live feed needs live mode (MOCK_MODE=false).' : 'Live launch source unavailable right now.',
    };
  }

  // Age existing rows by the time elapsed since their scan, then prune stale ones.
  for (const [mint, row] of feed) {
    if (row.ageMinutes !== null) {
      row.ageMinutes += (Date.now() - row.scannedAt) / 60_000;
      row.scannedAt = Date.now();
      if (row.ageMinutes > LIVE_FEED.maxAgeMinutes) feed.delete(mint);
    }
  }

  // Phase 1 — scan not-yet-cached coins LITE, up to the per-poll budget, using
  // a concurrency pool (the per-host RPC rate limiter still paces the actual
  // calls, so this parallelizes waiting, not hammering). NEWEST coins win the
  // budget first — a launch seconds old gets scanned within one poll, so you
  // catch it while it's still fresh instead of after a backlog of older coins.
  const toScan = coins
    .filter((c) => {
      const cached = cache.get(c.mint);
      return !(cached && Date.now() - cached.at < CACHE_TTL_MS);
    })
    .sort((a, b) => (b.createdMs ?? 0) - (a.createdMs ?? 0))
    .slice(0, effectiveScanBudget()); // 3× more coins per poll when a Helius key is set

  // Market data for the WHOLE sweep in a couple of batched DexScreener calls
  // (30 mints each). Without this, lite scans had no liquidity / price change /
  // buy-sell flow, so "already rugged" and "dumping right now" could never be
  // detected in the feed — the exact way coins that had already rugged were
  // being surfaced. Rows already in the feed are refreshed too, so a coin that
  // rugs AFTER it was scanned drops out instead of lingering with a stale grade.
  await primeDexscreenerTokens([...coins.map((c) => c.mint), ...feed.keys()]);
  let scannedThisPoll = toScan.length;
  let next = 0;
  const worker = async () => {
    while (next < toScan.length) {
      const c = toScan[next++];
      await analyzeToken(c.mint, false, undefined, /*lite*/ true);
    }
  };
  await Promise.all(Array.from({ length: Math.min(effectiveConcurrency(), toScan.length) }, worker));

  // Phase 2 — build rows; auto-upgrade a bounded number of promising lite
  // results to FULL background checks so real gems can surface.
  let fullUpgradesThisPoll = 0;
  const seedPool: Array<{ mint: string; entry: CacheEntry }> = [];
  for (const c of coins) {
    let entry = cache.get(c.mint);
    if (!entry) continue;
    entry = refreshMarket(entry); // re-check DEAD / DUMPING every sweep

    // Auto-upgrade: graduated + low-risk + some quality on the lite pass →
    // run the full background check now so a real gem can actually surface.
    if (
      entry.lite &&
      fullUpgradesThisPoll < 3 &&
      !entry.risk.insufficientData &&
      entry.risk.riskScore <= LIVE_FEED.notifyMaxScore &&
      entry.analysis.launch?.bondingCurveComplete !== false
    ) {
      fullUpgradesThisPoll++;
      await analyzeToken(c.mint, false, undefined, /*lite*/ false);
      entry = cache.get(c.mint) ?? entry;
    }

    // Gem verdict strictly requires full-scan data (never lite).
    const verdict = entry.lite
      ? { gem: false, blockers: ['Full background check pending.'] }
      : gemBackgroundCheck(entry.analysis, entry.risk, entry.quality);
    const kingGrade = computeKingGrade(entry.analysis, entry.risk, entry.quality);
    const rug = assessRugPotential(entry.analysis, entry.risk);

    const row: FeedRow = {
      address: c.mint,
      symbol: entry.analysis.identity.symbol ?? c.symbol,
      name: entry.analysis.identity.name ?? c.name,
      ageMinutes:
        entry.analysis.identity.ageMinutes ?? (c.createdMs ? Math.max(0, (Date.now() - c.createdMs) / 60_000) : null),
      marketCapEur: entry.analysis.market?.marketCapEur ?? null,
      priceUsd:
        entry.analysis.market?.priceEur != null ? entry.analysis.market.priceEur / EUR_PER_USD : null,
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
      insufficientData: entry.risk.insufficientData,
      unverified:
        entry.analysis.holders === null ||
        !entry.analysis.market ||
        entry.analysis.market.lpStatus === 'unknown',
      scannedAt: Date.now(),
    };
    feed.set(c.mint, row);
    maybeNotifyLowRisk(row);
    seedPool.push({ mint: c.mint, entry });
  }
  // 🌱 Spot early gems among this sweep's launches (full checks run in the
  // background so the feed response isn't held up).
  queueSeedCandidates(seedPool);

  // Newest first, capped.
  const rows = [...feed.values()]
    .sort((a, b) => (a.ageMinutes ?? 1e9) - (b.ageMinutes ?? 1e9))
    .slice(0, LIVE_FEED.maxRows);
  // Keep the map bounded too.
  if (feed.size > LIVE_FEED.maxRows * 2) {
    const keep = new Set(rows.map((r) => r.address));
    for (const k of feed.keys()) if (!keep.has(k)) feed.delete(k);
  }

  return { ok: true, feed: rows, source: MOCK_MODE ? 'mock' : 'ok', scannedThisPoll };
}

/**
 * Desktop notification ONLY for coins that passed the FULL 💎 background check
 * (graduated, LP secured, no whale wallet, creator history screened). Fires
 * once per mint; copy stays risk-framed — "passed checks", never "buy".
 */
function maybeNotifyLowRisk(row: FeedRow): void {
  if (!LIVE_FEED.notifyLowRisk || MOCK_MODE) return;
  if (!row.gem) return;
  if (notified.has(row.address)) return;
  notified.add(row.address);
  if (notified.size > 500) notified.clear(); // bounded memory; duplicate ping is harmless

  const sym = row.symbol ?? `${row.address.slice(0, 4)}…${row.address.slice(-4)}`;
  chrome.notifications.create(`ck-${row.address}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    // King Grade only — one number, higher = better. (This used to append the
    // raw risk score, which runs the OPPOSITE direction.)
    title: `💎 ${sym} — King Grade ${row.grade ?? '?'}% ${gradeLabel(row.grade)}`,
    message:
      'Graduated, LP secured, no whale wallet, creator screened. Still speculative — research it yourself. Click to open on GMGN.',
  });
}

chrome.notifications?.onClicked.addListener((id) => {
  // Watch alerts and long-hold alerts have their own handlers.
  if (!id.startsWith('ck-') || id.startsWith('ck-watch-') || id.startsWith('ck-lh-') || id.startsWith('ck-gem-')) return;
  const address = id.slice(3);
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});

async function analyzeToken(address: string, force: boolean, rawGmgn?: unknown, lite = false): Promise<AnalyzeResponse> {
  if (!BASE58_RE.test(address)) {
    return { ok: false, error: 'Not a valid Solana address.' };
  }

  // A cached lite (mint-only) result satisfies lite requests, but a full
  // request upgrades it with the complete scan.
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

async function doAnalyze(address: string, rawGmgn?: unknown, lite = false, force = false): Promise<AnalyzeResponse> {
  try {
    // GMGN: prefer the raw payload the content script fetched same-origin (cookies
    // apply, dodges Cloudflare); otherwise fetch it here (mock mode, or the popup
    // which isn't running on gmgn.ai). Lite feed scans skip GMGN entirely — the
    // cross-origin fetch would be Cloudflare-challenged anyway and each attempt
    // burns ~2.4s of the gmgn.ai rate-limit budget.
    const gmgnPromise =
      !MOCK_MODE && rawGmgn
        ? Promise.resolve(parseGmgn(rawGmgn as GmgnRaw))
        : lite && !MOCK_MODE
          ? Promise.resolve(emptyGmgnData())
          : fetchGmgnData(address);
    // pump.fun goes first: its bonding-curve accounts feed the lite holder scan
    // (excluded from concentration math so the curve doesn't read as a whale).
    const pumpfun = await fetchPumpfunData(address);
    // Remaining adapters degrade to honest "unavailable" internally; Promise.all is safe.
    // DexScreener gives authoritative USD price/mcap/liquidity for LISTED coins
    // (fresh on-curve coins aren't listed yet → null, cached as a real answer).
    const [gmgn, solana, audit, dexMarket] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address, lite, pumpfun.bondingCurveAccounts, pumpfun.creator, pumpfun.bondingCurveComplete),
      // RugCheck = LP lock status off gmgn.ai. Full scans only: one more
      // rate-limited call per coin would stall the lite feed sweep.
      lite ? Promise.resolve({ status: 'disabled' as const, lpStatus: null, externalFlags: [] }) : rugcheckAdapter.fetchAudit(address),
      // Always fetched: served from the sweep's batch cache for lite scans, so
      // rug/dump detection runs on EVERY coin, not just the ones you open.
      fetchDexscreenerToken(address, force), // forced scans bypass the 60s market cache
    ]);
    // Full scans check the creator's launch history (serial-deployer signal);
    // lite feed sweeps skip it to stay within the per-poll budget. Either way,
    // the persistent creator memory backfills when the endpoint fails.
    let deployerHist = lite
      ? await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator)
      : await pumpfunDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);
    deployerHist = await applyCreatorMemory(pumpfun.creator, deployerHist);

    // "Can I actually sell?" — a Jupiter sell QUOTE for the user's reference
    // position (read-only; never a swap). Full scans only, and only when GMGN
    // didn't already answer: it's one more rate-limited call.
    const sellQuote =
      lite || gmgn.isHoneypot !== null || gmgn.sellSlippagePct !== null
        ? null
        : await fetchSellQuote(
            address,
            dexMarket?.priceUsd ?? gmgn.priceEur ?? pumpfun.priceEur,
            solana.decimals,
            EXIT_REALITY.referencePositionUsd,
          );

    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, dexMarket, sellQuote, {
      gmgn: gmgn.status,
      solana: solana.status,
      pumpfun: pumpfun.status,
      rugcheck: audit.status,
      deployer: deployerHist.status,
    });

    if (DEBUG) {
      console.log('[CRYPTO-KING] merged analysis', address, {
        market: analysis.market,
        pumpfunMcap: pumpfun.marketCapEur,
        dexMarket,
        mint: analysis.mint,
        holders: analysis.holders,
      });
    }
    const risk = scoreToken(analysis);
    const quality = scoreQuality(analysis);
    cache.set(address, { analysis, risk, quality, at: Date.now(), lite });
    // Lite feed sweeps would flush the user's own browsing history out of the
    // dashboard's capped recent list — only full scans are recorded there.
    if (!lite) {
      await saveRecent(analysis, risk, quality);
      // Every full grade is a prediction — log it so it can be scored later.
      await recordPrediction(analysis, computeKingGrade(analysis, risk, quality).grade, assessRugPotential(analysis, risk).verdict);
    }
    return { ok: true, analysis, risk, quality, mock: MOCK_MODE };
  } catch (err) {
    console.error('[CRYPTO-KING] analysis failed:', err);
    return { ok: false, error: 'Analysis failed — data unavailable.' };
  }
}

/* ── Merge with explicit precedence ───────────────────────────────────── */

function mergeSources(
  address: string,
  gmgn: GmgnData,
  solana: SolanaData,
  pumpfun: PumpfunData,
  auditLpStatus: MarketInfo['lpStatus'] | null,
  deployer: TokenAnalysis['deployer'],
  dexMarket: DexTokenMarket | null,
  sellQuote: SellQuote | null,
  sources: TokenAnalysis['sources'],
): TokenAnalysis {
  // In mock mode the fixture IS the truth — the mock adapters all slice the
  // same fixture, so merging them reconstructs it faithfully.

  /* mint: on-chain RPC is authoritative; GMGN fills gaps. */
  let mint: MintInfo | null = solana.mint;
  if (!mint && (gmgn.mintRenounced !== null || gmgn.freezeRenounced !== null || gmgn.taxBps !== null)) {
    mint = {
      mintAuthorityActive: gmgn.mintRenounced === null ? null : !gmgn.mintRenounced,
      freezeAuthorityActive:
        gmgn.freezeRenounced !== null ? !gmgn.freezeRenounced : gmgn.isBlacklist === true ? true : null,
      metadataMutable: null,
      isToken2022: pumpfun.isToken2022,
      transferFeeBps: gmgn.taxBps,
      feeAuthorityActive: gmgn.feeAuthorityActive,
      // Extension traps need the on-chain mint account; unknown via GMGN alone.
      permanentDelegateActive: null,
      transferHookActive: null,
      defaultAccountFrozen: null,
      nonTransferable: null,
    };
  } else if (mint) {
    // RPC verdicts stand; GMGN only fills fields the RPC couldn't produce.
    mint = {
      ...mint,
      transferFeeBps: mint.transferFeeBps ?? gmgn.taxBps,
      feeAuthorityActive: mint.feeAuthorityActive ?? gmgn.feeAuthorityActive,
      isToken2022: mint.isToken2022 ?? pumpfun.isToken2022,
    };
  }

  /* holders: RPC concentration math wins (LP/burn excluded); GMGN fills counts & sniper rate. */
  const holders =
    solana.holders || gmgn.top10Pct !== null || gmgn.holderCount !== null
      ? {
          holderCount: gmgn.holderCount ?? solana.holders?.holderCount ?? null,
          top5Pct: solana.holders?.top5Pct ?? null,
          top10Pct: solana.holders?.top10Pct ?? gmgn.top10Pct,
          largestNonLpWalletPct: solana.holders?.largestNonLpWalletPct ?? null,
          bundledLaunchPct: solana.holders?.bundledLaunchPct ?? gmgn.sniperHoldPct,
          smartMoneyPct: solana.holders?.smartMoneyPct ?? null,
          devHoldsPct: solana.holders?.devHoldsPct ?? null,
        }
      : null;

  /* market: GMGN primary; pump.fun fills mcap; RugCheck may settle LP status. */
  // GMGN → pump.fun protocol burn (graduated + migration venue) → RugCheck.
  const lpStatus = resolveLpStatus({
    gmgn: gmgn.lpStatus,
    pumpGraduated: pumpfun.status === 'ok' ? pumpfun.bondingCurveComplete : null,
    deepestDexId: dexMarket?.dexId ?? null,
    audit: auditLpStatus,
  });
  // Sell simulation precedence: GMGN's honeypot verdict (it simulates the
  // actual sell tx) → GMGN slippage → a real Jupiter route with its price
  // impact → GMGN "not a honeypot" alone → unknown. Jupiter only ever adds
  // POSITIVE evidence (a route exists); "no route" stays unknown, never "fail".
  const sellSimulation: MarketInfo['sellSimulation'] =
    gmgn.isHoneypot === true
      ? { ok: false, slippagePct: gmgn.sellSlippagePct }
      : gmgn.sellSlippagePct !== null
        ? { ok: true, slippagePct: gmgn.sellSlippagePct }
        : sellQuote !== null
          ? { ok: true, slippagePct: sellQuote.priceImpactPct }
          : gmgn.isHoneypot === false
            ? { ok: true, slippagePct: null }
            : null;
  // Market data precedence for price/mcap/liquidity: DexScreener first — it
  // returns authoritative USD values that MATCH the sites (no derivation) — then
  // GMGN (same-origin), then pump.fun (derived). Values are USD (EUR_PER_USD=1).
  const hasMarket =
    dexMarket !== null ||
    gmgn.marketCapEur !== null ||
    gmgn.liquidityEur !== null ||
    pumpfun.marketCapEur !== null ||
    lpStatus !== 'unknown';
  const market: MarketInfo | null = hasMarket
    ? {
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
        sells1h: dexMarket?.sells1h ?? null,
      }
    : null;

  /* behavior: pump.fun ban is the only live flag we can attest today. */
  const behavior =
    gmgn.behavior ??
    (pumpfun.isBanned === true
      ? {
          volumeSpikeFlatPrice: null,
          manySmallBuysOneHugeSell: null,
          mcapSpikeNoOrganicVolume: null,
          deployerLinkedSelling: null,
          abnormalEarlyVolume: null,
        }
      : null);

  const symbol = gmgn.symbol ?? pumpfun.symbol;
  const name = gmgn.name ?? pumpfun.name;
  return {
    identity: {
      address,
      symbol,
      name,
      chain: 'sol',
      ageMinutes: gmgn.ageMinutes ?? pumpfun.ageMinutes,
      logoUri: null,
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
    launch:
      pumpfun.status === 'ok'
        ? {
            platform: 'pumpfun',
            bondingCurveComplete: pumpfun.bondingCurveComplete,
            bannedOnPlatform: pumpfun.isBanned,
            replyCount: pumpfun.replyCount,
            curveProgressPct: pumpfun.curveProgressPct,
            athRatio: pumpfun.athRatio,
            kingOfTheHill: pumpfun.kingOfTheHill,
          }
        : null,
    sources,
    fetchedAt: Date.now(),
  };
}

/* ── Persistent creator memory (Dexter-style track record) ──────────────
 * Every successful deployer-history fetch is remembered in storage, so a
 * serial rugger (or a proven creator) is recognised INSTANTLY on their next
 * launch, even when the launchpad endpoint is down or the scan was lite.
 */

const CREATORS_KEY = 'ck:creators';
interface CreatorRecord {
  launches: number;
  dead: number;
  graduated: number;
  lastSeen: number;
}

async function applyCreatorMemory(
  creator: string | null,
  hist: Awaited<ReturnType<typeof pumpfunDeployerAdapter.fetchDeployerHistory>>,
): Promise<typeof hist> {
  if (!creator) return hist;
  const data = await chrome.storage.local.get(CREATORS_KEY);
  const memory: Record<string, CreatorRecord> = (data[CREATORS_KEY] as Record<string, CreatorRecord>) ?? {};

  const d = hist.deployer;
  if (hist.status === 'ok' && d && d.priorLaunches !== null) {
    // Fresh data → update memory (bounded: keep the 500 most recently seen).
    memory[creator] = {
      launches: d.priorLaunches,
      dead: d.priorDeadLaunches ?? 0,
      graduated: d.graduatedLaunches ?? 0,
      lastSeen: Date.now(),
    };
    const keys = Object.keys(memory);
    if (keys.length > 500) {
      keys
        .sort((a, b) => memory[a].lastSeen - memory[b].lastSeen)
        .slice(0, keys.length - 500)
        .forEach((k) => delete memory[k]);
    }
    await chrome.storage.local.set({ [CREATORS_KEY]: memory });
    return hist;
  }

  // Endpoint unavailable / lite scan → backfill from memory if we know them.
  const known = memory[creator];
  if (known) {
    return {
      status: 'partial',
      deployer: {
        priorRugs: null,
        fundingSource: 'unknown',
        priorLaunches: known.launches,
        priorDeadLaunches: known.dead,
        graduatedLaunches: known.graduated,
      },
    };
  }
  return hist;
}

/* ── Storage lock ────────────────────────────────────────────────────────
 * chrome.storage has no transactions. Every read-modify-write below used to
 * be load → (await network for seconds) → save, so a concurrent writer's
 * change was silently overwritten: clicking Watch/Unwatch during a watchlist
 * sweep was lost, and parallel full scans dropped ledger predictions.
 * withLock() serialises writers per key; slow network work happens OUTSIDE
 * the lock and results are merged into a FRESH read inside it.
 */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

/* ── 👁 Watchlist: post-entry rug alerts ─────────────────────────────────
 * The pre-buy scan can't see a dev who dumps tomorrow. Watched coins are
 * re-scanned on a chrome.alarms timer; lib/watchAlerts.ts diffs each fresh
 * snapshot against the baseline and fires a desktop notification ONCE per
 * alert kind per coin.
 */

const WATCHLIST_KEY = 'ck:watchlist';

async function loadWatchlist(): Promise<WatchedCoin[]> {
  const data = await chrome.storage.local.get(WATCHLIST_KEY);
  return Array.isArray(data[WATCHLIST_KEY]) ? (data[WATCHLIST_KEY] as WatchedCoin[]) : [];
}

async function saveWatchlist(list: WatchedCoin[]): Promise<void> {
  await chrome.storage.local.set({ [WATCHLIST_KEY]: list });
}

function snapshotOf(entry: CacheEntry): WatchSnapshot {
  return {
    at: Date.now(),
    grade: computeKingGrade(entry.analysis, entry.risk, entry.quality).grade,
    liquidityEur: entry.analysis.market?.liquidityEur ?? null,
    marketCapEur: entry.analysis.market?.marketCapEur ?? null,
    lpStatus: entry.analysis.market?.lpStatus ?? 'unknown',
    devHoldsPct: entry.analysis.holders?.devHoldsPct ?? null,
    largestNonLpWalletPct: entry.analysis.holders?.largestNonLpWalletPct ?? null,
    liveState: assessLiveState(entry.analysis.market).state,
  };
}

async function watchToken(address: string, symbol: string | null): Promise<WatchlistResponse> {
  if (!BASE58_RE.test(address)) return { ok: false, error: 'Not a valid Solana address.' };
  const list = await loadWatchlist();
  if (list.some((w) => w.address === address)) return { ok: true, watchlist: list };
  if (list.length >= WATCHLIST.maxCoins) {
    return { ok: false, error: `Watchlist is full (${WATCHLIST.maxCoins} coins) — unwatch one first.` };
  }

  const res = await analyzeToken(address, false); // full scan for a solid baseline
  if (!res.ok) return { ok: false, error: res.error };
  const entry = cache.get(address);
  if (!entry) return { ok: false, error: 'Scan failed — cannot watch.' };

  const snap = snapshotOf(entry);
  const coin: WatchedCoin = {
    address,
    symbol: entry.analysis.identity.symbol ?? symbol,
    addedAt: Date.now(),
    baseline: snap,
    last: snap,
    alerted: [],
  };
  // Re-read under the lock: the scan above took seconds and the list may have
  // changed meanwhile (another tab, or a sweep finishing).
  const next = await withLock(WATCHLIST_KEY, async () => {
    const fresh = await loadWatchlist();
    if (fresh.some((w) => w.address === address)) return fresh;
    if (fresh.length >= WATCHLIST.maxCoins) return null;
    const out = [...fresh, coin];
    await saveWatchlist(out);
    return out;
  });
  if (!next) return { ok: false, error: `Watchlist is full (${WATCHLIST.maxCoins} coins) — unwatch one first.` };
  ensureWatchAlarm();
  return { ok: true, watchlist: next };
}

async function unwatchToken(address: string): Promise<WatchlistResponse> {
  const next = await withLock(WATCHLIST_KEY, async () => {
    const out = (await loadWatchlist()).filter((w) => w.address !== address);
    await saveWatchlist(out);
    return out;
  });
  return { ok: true, watchlist: next };
}

async function sweepWatchlist(): Promise<void> {
  const list = await loadWatchlist();
  if (list.length === 0) return;

  // Scan OUTSIDE the lock (this takes a while), collect fresh snapshots…
  const fresh = new Map<string, WatchSnapshot>();
  for (const coin of list) {
    const res = await analyzeToken(coin.address, /*force*/ true); // fresh full scan
    if (!res.ok) continue; // transient failure → try again next sweep, never alert on missing data
    const entry = cache.get(coin.address);
    if (entry) fresh.set(coin.address, snapshotOf(entry));
  }
  if (fresh.size === 0) return;

  // …then merge into the CURRENT list under the lock, so a Watch/Unwatch that
  // happened during the scans survives, and alerts fire exactly once.
  const toNotify: Array<{ coin: WatchedCoin; alert: { kind: string; message: string } }> = [];
  await withLock(WATCHLIST_KEY, async () => {
    const current = await loadWatchlist();
    for (const coin of current) {
      const snap = fresh.get(coin.address);
      if (!snap) continue; // unwatched mid-sweep, or scan failed
      coin.last = snap;
      for (const alert of computeWatchAlerts(coin.baseline, snap)) {
        if (coin.alerted.includes(alert.kind)) continue;
        coin.alerted.push(alert.kind);
        toNotify.push({ coin, alert });
      }
    }
    await saveWatchlist(current);
  });

  for (const { coin, alert } of toNotify) {
    const sym = coin.symbol ?? `${coin.address.slice(0, 4)}…${coin.address.slice(-4)}`;
    chrome.notifications.create(`ck-watch-${coin.address}-${alert.kind}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🚨 ${sym} — watched coin alert`,
      message: `${alert.message} Click to open on GMGN.`,
      priority: 2,
    });
  }
}

function ensureWatchAlarm(): void {
  chrome.alarms.create('ck-watch', { periodInMinutes: WATCHLIST.pollMinutes });
  if (LONG_HOLD.enabled && !MOCK_MODE) {
    chrome.alarms.create('ck-radar', { periodInMinutes: LONG_HOLD.radarEveryMinutes, delayInMinutes: 1 });
  }
  if (EARLY_GEM.enabled && !MOCK_MODE) {
    chrome.alarms.create('ck-gems', { periodInMinutes: Math.min(...Object.values(EARLY_GEM.recheckMinutes)) });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ck-watch') {
    void sweepWatchlist();
    void recheckLedger(); // score past predictions on the same tick
    void recheckLhLedger();
  } else if (alarm.name === 'ck-radar') {
    void runRadarSweep();
  } else if (alarm.name === 'ck-gems') {
    void runGemTick();
    // Keep spotting seeds even when no panel is open: the feed sweep is what
    // feeds the spotter, so run one if nothing has polled it recently.
    if (Date.now() - lastFeedSweepAt > 5 * 60_000) void getLiveFeed();
  }
});
chrome.runtime.onInstalled.addListener(ensureWatchAlarm);
chrome.runtime.onStartup.addListener(ensureWatchAlarm);
// Load user settings (Helius key) as soon as the service worker wakes, and
// the tracked-gem list so feed rows are tagged 🌱 from the first sweep.
void loadSettings();
void loadGems();

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-watch-')) return;
  const address = id.slice('ck-watch-'.length).split('-')[0];
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});

/* ── Outcome ledger: grade every prediction, then check if it was right ──
 * Recorded on full scans; re-checked on the watch alarm after
 * OUTCOME_LEDGER.recheckAfterHours. computeAccuracy() turns it into a report
 * card so "is this accurate?" becomes a measured number.
 */

const LEDGER_KEY = 'ck:ledger';

async function loadLedger(): Promise<LedgerEntry[]> {
  const d = await chrome.storage.local.get(LEDGER_KEY);
  return Array.isArray(d[LEDGER_KEY]) ? (d[LEDGER_KEY] as LedgerEntry[]) : [];
}

async function recordPrediction(analysis: TokenAnalysis, grade: number | null, rugVerdict: string): Promise<void> {
  if (!OUTCOME_LEDGER.enabled || MOCK_MODE || grade === null) return;
  // No baseline market cap → the outcome can never be measured; don't log a
  // prediction that would sit as PENDING forever and skew the report card.
  const baselineMcap = analysis.market?.marketCapEur ?? null;
  if (baselineMcap === null || baselineMcap <= 0) return;
  await withLock(LEDGER_KEY, async () => {
    const ledger = await loadLedger();
    if (ledger.some((e) => e.address === analysis.identity.address)) return; // first grade only
    ledger.unshift({
      address: analysis.identity.address,
      symbol: analysis.identity.symbol,
      gradedAt: Date.now(),
      grade,
      rugVerdict,
      baselineMcap,
    });
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger.slice(0, OUTCOME_LEDGER.maxEntries) });
  });
}

/** Re-check due predictions and score them. Bounded per sweep to stay cheap. */
async function recheckLedger(): Promise<void> {
  if (!OUTCOME_LEDGER.enabled || MOCK_MODE) return;
  const dueAt = Date.now() - OUTCOME_LEDGER.recheckAfterHours * 3_600_000;
  const due = (await loadLedger()).filter((e) => !e.outcome && e.gradedAt <= dueAt).slice(0, 5);
  if (due.length === 0) return;

  // Network OUTSIDE the lock; results applied to a fresh read inside it.
  const results = new Map<string, Pick<LedgerEntry, 'checkedAt' | 'finalMcap' | 'outcome'>>();
  for (const entry of due) {
    const r = await lookupDexscreenerToken(entry.address);
    // A failed request is NOT evidence of a rug — skip and retry next tick.
    if (r.status === 'error') continue;

    let nowMcap: number | null;
    let isDead: boolean;
    if (r.market) {
      nowMcap = r.market.marketCapUsd;
      isDead = assessLiveState(marketFromDex(r.market)).state === 'DEAD';
    } else {
      // Not on any DEX. For a coin graded on the bonding curve that's normal —
      // it may still be trading there, so ask pump.fun before calling it dead.
      const pump = await fetchPumpfunData(entry.address);
      if (pump.marketCapEur !== null) {
        nowMcap = pump.marketCapEur;
        isDead = false;
      } else {
        // Listed nowhere. pump.fun keeps records of dead coins, so this is
        // usually a vanished token — but it can also be pump.fun being down.
        // Only conclude "dead" once it has stayed that way well past the
        // normal re-check window; until then, retry.
        if (entry.gradedAt > Date.now() - OUTCOME_LEDGER.recheckAfterHours * 3 * 3_600_000) continue;
        isDead = true;
        nowMcap = null;
      }
    }
    results.set(entry.address, {
      checkedAt: Date.now(),
      finalMcap: nowMcap,
      outcome: classifyOutcome(entry.baselineMcap, nowMcap, isDead),
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

/** DexScreener market → the MarketInfo shape the pure assessors take. */
function marketFromDex(dex: DexTokenMarket): MarketInfo {
  return {
    priceEur: dex.priceUsd,
    marketCapEur: dex.marketCapUsd,
    liquidityEur: dex.liquidityUsd,
    volume24hEur: dex.volume24hUsd,
    lpStatus: 'unknown',
    sellSimulation: null,
    priceChange1h: dex.priceChange1h,
    priceChange6h: dex.priceChange6h,
    priceChange24h: dex.priceChange24h,
    buys1h: dex.buys1h,
    sells1h: dex.sells1h,
  };
}

/* ── 🏔 Long-hold radar ───────────────────────────────────────────────────
 * Finds coins that are days-to-months old (past the window where ~95% of
 * launches die) and scores their STAYING POWER (lib/longHold.ts). Sources:
 * GeckoTerminal trending + most-traded Solana pools, plus any coin the user
 * opens. Each assessment = full scan + daily price history + unique buyers +
 * holder count. GeckoTerminal allows ~30 calls/min, so sweeps are small and
 * spread out (LONG_HOLD.radarDeepChecksPerSweep every radarEveryMinutes).
 */

const RADAR_KEY = 'ck:radar';
const LH_HIST_KEY = 'ck:lh-hist';
const LH_LEDGER_KEY = 'ck:lh-ledger';

interface RadarStore {
  rows: RadarRow[];
  sweptAt: number | null;
  checked: number;
  /** Mints already announced as CANDIDATE (never notify twice). */
  notified: string[];
}

const LH_CACHE_MS = 30 * 60_000;
const candleCache = new Map<string, { k: Candle[] | null; at: number }>();
let radarSweep: Promise<void> | null = null;

async function loadRadar(): Promise<RadarStore> {
  const d = await chrome.storage.local.get(RADAR_KEY);
  const v = d[RADAR_KEY] as Partial<RadarStore> | undefined;
  return { rows: v?.rows ?? [], sweptAt: v?.sweptAt ?? null, checked: v?.checked ?? 0, notified: v?.notified ?? [] };
}

async function getRadar(force: boolean): Promise<RadarResponse> {
  if (!LONG_HOLD.enabled) return { ok: false, error: 'Long-hold radar disabled in config.' };
  if (MOCK_MODE) return { ok: false, error: 'Long-hold radar needs live mode (MOCK_MODE=false).' };
  const store = await loadRadar();
  const stale = !store.sweptAt || Date.now() - store.sweptAt > LONG_HOLD.radarEveryMinutes * 60_000;
  if ((force || stale) && !radarSweep) void runRadarSweep(); // don't block the UI on a slow sweep
  return { ok: true, rows: store.rows, sweptAt: store.sweptAt, sweeping: radarSweep !== null, checked: store.checked };
}

function runRadarSweep(): Promise<void> {
  if (radarSweep) return radarSweep;
  radarSweep = doRadarSweep()
    .catch((err: unknown) => console.warn('[CRYPTO-KING] radar sweep failed:', err))
    .finally(() => {
      radarSweep = null;
    });
  return radarSweep;
}

async function doRadarSweep(): Promise<void> {
  if (!LONG_HOLD.enabled || MOCK_MODE) return;
  const pools = await fetchRadarPools();
  const store = await loadRadar();
  const recent = new Map(store.rows.map((r) => [r.address, r.checkedAt]));
  const now = Date.now();

  // Cheap pre-filter on the discovery data, BEFORE any expensive deep check.
  const candidates = pools
    .filter((p) => {
      const ageDays = p.createdMs ? (now - p.createdMs) / 86_400_000 : null;
      if (ageDays === null || ageDays < LONG_HOLD.minAgeDays || ageDays > LONG_HOLD.radarMaxAgeDays) return false;
      if ((p.liquidityUsd ?? 0) < LONG_HOLD.radarMinLiquidityUsd) return false;
      const mc = p.marketCapUsd ?? 0;
      if (mc < LONG_HOLD.radarMinMcapUsd || mc > LONG_HOLD.lateMcapUsd) return false;
      // Wash-trading pre-screen — don't spend a deep check on obvious fakes.
      if (p.volume24hUsd !== null && p.liquidityUsd && p.volume24hUsd / p.liquidityUsd > LONG_HOLD.washVolLiqRatio) return false;
      const last = recent.get(p.mint);
      return !last || now - last > LONG_HOLD.reassessHours * 3_600_000;
    })
    // Most unique buyers first: real participation is the scarcest signal.
    .sort((a, b) => (b.buyers24h ?? 0) - (a.buyers24h ?? 0))
    .slice(0, LONG_HOLD.radarDeepChecksPerSweep);

  const fresh: RadarRow[] = [];
  for (const p of candidates) {
    const res = await assessLongHoldFor(p.mint, p);
    if (!res) continue;
    fresh.push(radarRowOf(p.mint, res.symbol ?? p.name, res.result, res.mcap, res.liq));
  }

  const toNotify: RadarRow[] = [];
  await withLock(RADAR_KEY, async () => {
    const cur = await loadRadar();
    const byMint = new Map(cur.rows.map((r) => [r.address, r]));
    for (const r of fresh) byMint.set(r.address, r);
    // Drop rows nobody re-checked in 2 days — stale verdicts are misleading.
    const rows = [...byMint.values()]
      .filter((r) => now - r.checkedAt < 48 * 3_600_000)
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (b.score ?? -1) - (a.score ?? -1))
      .slice(0, LONG_HOLD.radarMaxRows);
    const notified = new Set(cur.notified);
    for (const r of fresh) {
      if (r.tier === 'CANDIDATE' && !notified.has(r.address)) {
        notified.add(r.address);
        toNotify.push(r);
      }
    }
    await chrome.storage.local.set({
      [RADAR_KEY]: {
        rows,
        sweptAt: now,
        checked: cur.checked + fresh.length,
        notified: [...notified].slice(-500),
      } satisfies RadarStore,
    });
  });

  for (const r of toNotify) {
    const sym = r.symbol ?? `${r.address.slice(0, 4)}…${r.address.slice(-4)}`;
    chrome.notifications.create(`ck-lh-${r.address}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🏔 Long-hold candidate: ${sym} — Staying Power ${r.score ?? '?'}%`,
      message: `${r.headline ?? 'Passed the long-hold screen.'} Has the traits survivors had — not a buy signal; size it to lose. Click to open.`,
    });
  }
}

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-lh-')) return;
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${id.slice('ck-lh-'.length)}` });
  chrome.notifications.clear(id);
});

const TIER_ORDER: LongHoldTier[] = ['CANDIDATE', 'WATCH', 'LATE', 'TOO_EARLY', 'WEAK', 'NOT_A_HOLD', 'NO_DATA'];
const tierRank = (t: LongHoldTier) => TIER_ORDER.indexOf(t);

function radarRowOf(
  address: string,
  symbol: string | null,
  r: LongHoldResult,
  mcap: number | null,
  liq: number | null,
): RadarRow {
  return {
    address,
    symbol,
    name: null,
    tier: r.tier,
    score: r.score,
    ageDays: r.ageDays,
    marketCapUsd: mcap,
    liquidityUsd: liq,
    headline: r.disqualifiers[0] ?? r.strengths[0] ?? r.concerns[0] ?? null,
    checkedAt: Date.now(),
  };
}

/**
 * Full staying-power assessment for one coin. `hint` = discovery data from the
 * radar (saves calls); without it, the pool is found via DexScreener.
 */
type LhOut = {
  result: LongHoldResult;
  /** Early-conviction view (always computed; the UI shows it for coins < 3 days). */
  early: EarlyGemResult;
  symbol: string | null;
  mcap: number | null;
  liq: number | null;
  holderCount: number | null;
  analysis: TokenAnalysis;
} | null;
const lhInFlight = new Map<string, Promise<LhOut>>();
const lhOutCache = new Map<string, { out: NonNullable<LhOut>; at: number }>();

/** De-duplicated: overlapping requests for one coin (card re-render, radar,
 *  tracker, popup) share a single assessment — GeckoTerminal allows ~30/min.
 *  `fresh` = the tracker's re-check: bypass every cache so a dump is seen now. */
function assessLongHoldFor(address: string, hint?: RadarPool, fresh = false): Promise<LhOut> {
  const pending = lhInFlight.get(address);
  if (pending) return pending;
  const job = doAssessLongHold(address, hint, fresh).finally(() => lhInFlight.delete(address));
  lhInFlight.set(address, job);
  return job;
}

const infoCache = new Map<string, { v: GeckoTokenInfo | null; at: number }>();
async function cachedTokenInfo(mint: string, maxAgeMs = LH_CACHE_MS): Promise<GeckoTokenInfo | null> {
  const hit = infoCache.get(mint);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.v;
  const v = await fetchTokenInfo(mint);
  if (v !== null) {
    if (infoCache.size > 300) infoCache.clear();
    infoCache.set(mint, { v, at: Date.now() });
  }
  return v;
}

async function doAssessLongHold(address: string, hint?: RadarPool, fresh = false): Promise<LhOut> {
  const hit = lhOutCache.get(address);
  if (hit && Date.now() - hit.at < LH_CACHE_MS && !hint && !fresh) return hit.out;

  const res = await analyzeToken(address, fresh); // full scan (5-min cache unless fresh)
  if (!res.ok) return null;
  const { analysis, risk } = res;

  const dex = await fetchDexscreenerToken(address); // just refreshed by the forced scan above when `fresh`
  const pool = hint?.pool ?? dex?.pairAddress ?? null;
  const [candles, poolStats, info] = await Promise.all([
    pool ? cachedCandles(pool) : Promise.resolve(null),
    hint ? Promise.resolve(hint) : pool ? fetchPool(pool) : Promise.resolve(null),
    // Holder counts drive "+N holders/hour" for tracked seeds — refresh faster then.
    cachedTokenInfo(address, fresh ? 15 * 60_000 : LH_CACHE_MS),
  ]);

  const holderCount = analysis.holders?.holderCount ?? info?.holderCount ?? null;
  const holderHistory = await recordHolderSnapshot(address, holderCount);

  // Age: the OLDEST credible evidence of trading wins.
  const ages = [
    analysis.identity.ageMinutes !== null ? analysis.identity.ageMinutes / 1440 : null,
    dex?.pairCreatedMs ? (Date.now() - dex.pairCreatedMs) / 86_400_000 : null,
    hint?.createdMs ? (Date.now() - hint.createdMs) / 86_400_000 : null,
    candles && candles.length ? (Date.now() / 1000 - candles[0].t) / 86_400 : null,
  ].filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  const ageDays = ages.length ? Math.max(...ages) : null;

  const so = analysis.socials;
  const socials = {
    twitter: Boolean(so?.twitter || info?.twitter),
    telegram: Boolean(so?.telegram || info?.telegram),
    website: Boolean(so?.website || info?.website),
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
    socials,
  });

  const symbol = analysis.identity.symbol;
  const mcap = analysis.market?.marketCapEur ?? null;
  const out = { result, early, symbol, mcap, liq: analysis.market?.liquidityEur ?? null, holderCount, analysis };
  if (lhOutCache.size > 300) lhOutCache.clear();
  lhOutCache.set(address, { out, at: Date.now() });
  await recordLhPrediction(address, symbol, result, mcap);
  return out;
}

async function cachedCandles(pool: string): Promise<Candle[] | null> {
  const hit = candleCache.get(pool);
  if (hit && Date.now() - hit.at < LONG_HOLD.reassessHours * 3_600_000) return hit.k;
  const k = await fetchDailyCandles(pool);
  if (k !== null) {
    if (candleCache.size > 300) candleCache.clear();
    candleCache.set(pool, { k, at: Date.now() });
  }
  return k;
}

/**
 * Holder GROWTH can't be read from any single API call — so we build our own
 * history: one snapshot per coin per ~6h, last 30 kept. Returns the history.
 */
async function recordHolderSnapshot(
  mint: string,
  holderCount: number | null,
): Promise<Array<{ at: number; holderCount: number }>> {
  return withLock(LH_HIST_KEY, async () => {
    const d = await chrome.storage.local.get(LH_HIST_KEY);
    const all = (d[LH_HIST_KEY] ?? {}) as Record<string, Array<{ at: number; holderCount: number }>>;
    const h = all[mint] ?? [];
    const last = h[h.length - 1];
    if (holderCount !== null && holderCount > 0 && (!last || Date.now() - last.at > 6 * 3_600_000)) {
      h.push({ at: Date.now(), holderCount });
      all[mint] = h.slice(-30);
      // Bound total storage: keep the 400 most recently updated coins.
      const keys = Object.keys(all);
      if (keys.length > 400) {
        keys
          .sort((a, b) => (all[a].at(-1)?.at ?? 0) - (all[b].at(-1)?.at ?? 0))
          .slice(0, keys.length - 400)
          .forEach((k) => delete all[k]);
      }
      await chrome.storage.local.set({ [LH_HIST_KEY]: all });
    }
    return all[mint] ?? h;
  });
}

/* Long-hold report card: record verdicts, check them at 7d and 30d. */

async function loadLhLedger(): Promise<LongHoldLedgerEntry[]> {
  const d = await chrome.storage.local.get(LH_LEDGER_KEY);
  return Array.isArray(d[LH_LEDGER_KEY]) ? (d[LH_LEDGER_KEY] as LongHoldLedgerEntry[]) : [];
}

async function recordLhPrediction(address: string, symbol: string | null, r: LongHoldResult, mcap: number | null): Promise<void> {
  // Only tiers that make a claim are worth scoring; TOO_EARLY/LATE/NO_DATA aren't predictions.
  if (!['CANDIDATE', 'WATCH', 'WEAK', 'NOT_A_HOLD'].includes(r.tier) || mcap === null || mcap <= 0) return;
  await withLock(LH_LEDGER_KEY, async () => {
    const ledger = await loadLhLedger();
    if (ledger.some((e) => e.address === address)) return; // first verdict only
    ledger.unshift({ address, symbol, at: Date.now(), tier: r.tier, score: r.score, baselineMcap: mcap, outcomes: {} });
    await chrome.storage.local.set({ [LH_LEDGER_KEY]: ledger.slice(0, 600) });
  });
}

async function recheckLhLedger(): Promise<void> {
  if (!LONG_HOLD.enabled || MOCK_MODE) return;
  const ledger = await loadLhLedger();
  const due: Array<{ e: LongHoldLedgerEntry; day: number }> = [];
  for (const e of ledger) {
    for (const day of LONG_HOLD.ledgerCheckDays) {
      if (!e.outcomes[String(day)] && Date.now() - e.at >= day * 86_400_000) due.push({ e, day });
    }
  }
  if (due.length === 0) return;

  const results: Array<{ address: string; day: number; outcome: Outcome; mcap: number | null }> = [];
  for (const { e, day } of due.slice(0, 5)) {
    const r = await lookupDexscreenerToken(e.address);
    if (r.status === 'error') continue; // a failed request is not evidence
    const isDead = r.market === null || assessLiveState(marketFromDex(r.market)).state === 'DEAD';
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

/* ── 🌱 Gem tracker: spot at launch (low cap), follow while you hold ─────
 * Seeds are spotted from the live feed: a cheap prelim score on the lite scan,
 * then a FULL background check for the best few, then — if the early evidence
 * is strong and the cap still low — the coin is tracked from that moment. The
 * tracker re-checks every coin on a stage-based cadence and alerts on
 * milestones (graduated, day 1, rooted, 2×/5×/10×…) and on broken theses (dev
 * sold, whale/sniper control, rug mechanics, dead). Dropped coins are still
 * price-checked for a month so the "bought every gem" report counts losers.
 */

const GEMS_KEY = 'ck:gems';
interface GemStore {
  gems: TrackedGem[];
}
/** Mirror of tracked ACTIVE mints, for tagging feed rows without storage reads. */
const trackedMints = new Set<string>();

async function loadGems(): Promise<GemStore> {
  const d = await chrome.storage.local.get(GEMS_KEY);
  const v = d[GEMS_KEY] as Partial<GemStore> | undefined;
  const gems = Array.isArray(v?.gems) ? v.gems : [];
  trackedMints.clear();
  for (const g of gems) if (g.status === 'ACTIVE') trackedMints.add(g.address);
  return { gems };
}

async function saveGems(store: GemStore): Promise<void> {
  trackedMints.clear();
  for (const g of store.gems) if (g.status === 'ACTIVE') trackedMints.add(g.address);
  await chrome.storage.local.set({ [GEMS_KEY]: store });
}

async function getGems(): Promise<GemsResponse> {
  if (!EARLY_GEM.enabled) return { ok: false, error: 'Gem tracker disabled in config.' };
  const { gems } = await loadGems();
  const sorted = [...gems].sort(
    (a, b) =>
      Number(a.status === 'DROPPED') - Number(b.status === 'DROPPED') ||
      (b.lastMcap ?? 0) / b.spottedMcap - (a.lastMcap ?? 0) / a.spottedMcap,
  );
  return { ok: true, gems: sorted, portfolio: computeGemPortfolio(gems, EARLY_GEM.reportHorizonsDays) };
}

/* Spotting ─────────────────────────────────────────────────────────────── */

const spotQueue: string[] = [];
const spotConsidered = new Map<string, number>(); // mint → when last full-checked for spotting
let spotDraining = false;

/** Called from the feed sweep with LITE results: pick the best few prelim
 *  seeds and queue them for a full check (runs in the background). */
function queueSeedCandidates(entries: Array<{ mint: string; entry: CacheEntry }>): void {
  if (!EARLY_GEM.enabled || MOCK_MODE) return;
  const now = Date.now();
  const picks = entries
    .filter(({ mint, entry }) => {
      if (trackedMints.has(mint)) return false;
      const seen = spotConsidered.get(mint);
      if (seen && now - seen < 6 * 3_600_000) return false;
      const mc = entry.analysis.market?.marketCapEur ?? null;
      return mc !== null && mc > 0 && mc <= EARLY_GEM.maxSpotMcapUsd;
    })
    .map(({ mint, entry }) => {
      const a = entry.analysis;
      const prelim = assessEarlyGem(a, entry.risk, {
        ageHours: a.identity.ageMinutes !== null ? a.identity.ageMinutes / 60 : null,
        buyers24h: null,
        sellers24h: null,
        holderCount: null,
        history: [],
        socials: { twitter: Boolean(a.socials?.twitter), telegram: Boolean(a.socials?.telegram), website: Boolean(a.socials?.website) },
      });
      return { mint, prelim };
    })
    .filter((x) => x.prelim.verdict !== 'REJECT' && (x.prelim.score ?? 0) >= EARLY_GEM.prelimMinScore)
    .sort((a, b) => (b.prelim.score ?? 0) - (a.prelim.score ?? 0))
    .slice(0, EARLY_GEM.fullChecksPerSweep);
  for (const p of picks) {
    spotConsidered.set(p.mint, now);
    spotQueue.push(p.mint);
  }
  if (spotConsidered.size > 2000) spotConsidered.clear();
  void drainSpotQueue();
}

async function drainSpotQueue(): Promise<void> {
  if (spotDraining) return;
  spotDraining = true;
  try {
    while (spotQueue.length > 0) {
      const mint = spotQueue.shift() as string;
      await considerSpot(mint).catch((e: unknown) => console.warn('[CRYPTO-KING] spot check failed', e));
    }
  } finally {
    spotDraining = false;
  }
}

async function considerSpot(mint: string): Promise<void> {
  const out = await assessLongHoldFor(mint);
  if (!out) return;
  const e = out.early;
  const ok =
    (e.verdict === 'STRONG' || e.verdict === 'PROMISING') &&
    (e.score ?? 0) >= EARLY_GEM.spotMinScore &&
    out.mcap !== null &&
    out.mcap > 0 &&
    out.mcap <= EARLY_GEM.maxSpotMcapUsd;
  if (!ok) return;
  const added = await enlistGem(mint, out, 'auto');
  if (added) {
    const sym = out.symbol ?? short4(mint);
    chrome.notifications.create(`ck-gem-${mint}-spotted`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🌱 Gem spotted early: ${sym} at ${usdK(out.mcap as number)} — conviction ${e.score}%`,
      message: `${e.strengths[0] ?? 'Strong early signals.'} Now tracking it — you'll be alerted on milestones and if the thesis breaks. Most launches still fail: size it to lose.`,
    });
  }
}

/** Add a coin to the tracker. Returns false if it's already tracked or full. */
async function enlistGem(mint: string, out: NonNullable<LhOut>, source: 'auto' | 'manual'): Promise<boolean> {
  if (out.mcap === null || out.mcap <= 0) return false;
  return withLock(GEMS_KEY, async () => {
    const store = await loadGems();
    const existing = store.gems.find((g) => g.address === mint);
    if (existing && existing.status === 'ACTIVE') return false;
    const active = store.gems.filter((g) => g.status === 'ACTIVE').length;
    if (source === 'auto' && active >= EARLY_GEM.maxTracked) return false;
    if (existing) store.gems = store.gems.filter((g) => g.address !== mint); // re-track a dropped coin fresh
    const now = Date.now();
    const stage = out.early.stage;
    store.gems.unshift({
      address: mint,
      symbol: out.symbol,
      source,
      spottedAt: now,
      spottedMcap: out.mcap as number,
      status: 'ACTIVE',
      dropReason: null,
      stage,
      verdict: stage === 'ROOTED' ? out.result.tier : out.early.verdict,
      score: stage === 'ROOTED' ? out.result.score : out.early.score,
      lastMcap: out.mcap,
      peakMcap: out.mcap,
      lastCheckedAt: now,
      nextCheckAt: now + EARLY_GEM.recheckMinutes[stage] * 60_000,
      fired: [],
      events: [{ at: now, text: `Spotted at ${usdK(out.mcap as number)} (${source === 'auto' ? 'auto' : 'you added it'}).`, tone: 'info' }],
      snapshots: [snapOf(out)],
    });
    // Bound storage: drop the oldest DROPPED coins past the follow window first.
    const cutoff = now - EARLY_GEM.followDroppedDays * 86_400_000;
    store.gems = store.gems.filter((g) => g.status === 'ACTIVE' || g.spottedAt > cutoff).slice(0, EARLY_GEM.maxTracked * 3);
    await saveGems(store);
    return true;
  });
}

async function trackGemManually(address: string): Promise<GemsResponse> {
  const out = await assessLongHoldFor(address);
  if (!out) return { ok: false, error: 'Could not scan this coin — try again.' };
  if (out.mcap === null || out.mcap <= 0) return { ok: false, error: 'No market cap yet — cannot measure your multiple.' };
  await enlistGem(address, out, 'manual');
  return getGems();
}

async function untrackGem(address: string): Promise<GemsResponse> {
  await withLock(GEMS_KEY, async () => {
    const store = await loadGems();
    store.gems = store.gems.filter((g) => g.address !== address);
    await saveGems(store);
  });
  return getGems();
}

/* Re-checking ──────────────────────────────────────────────────────────── */

let gemTick: Promise<void> | null = null;
function runGemTick(): Promise<void> {
  if (gemTick) return gemTick;
  gemTick = doGemTick()
    .catch((e: unknown) => console.warn('[CRYPTO-KING] gem tick failed', e))
    .finally(() => {
      gemTick = null;
    });
  return gemTick;
}

async function doGemTick(): Promise<void> {
  if (!EARLY_GEM.enabled || MOCK_MODE) return;
  const now = Date.now();
  const { gems } = await loadGems();
  const due = gems
    .filter((g) => g.nextCheckAt <= now)
    .filter((g) => g.status === 'ACTIVE' || now - g.spottedAt < EARLY_GEM.followDroppedDays * 86_400_000)
    .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
    .slice(0, EARLY_GEM.checksPerTick);

  // Network OUTSIDE the lock; results merged into a fresh read inside it.
  const updates = new Map<string, (g: TrackedGem) => void>();
  const notes: Array<{ id: string; title: string; message: string }> = [];
  for (const g of due) {
    if (g.status === 'DROPPED') {
      const snap = await priceOnlySnapshot(g.address);
      updates.set(g.address, (cur) => {
        if (snap) pushSnap(cur, snap);
        cur.nextCheckAt = Date.now() + EARLY_GEM.recheckMinutes.DROPPED * 60_000;
      });
      continue;
    }
    const out = await assessLongHoldFor(g.address, undefined, /*fresh*/ true);
    if (!out) {
      updates.set(g.address, (cur) => {
        cur.nextCheckAt = Date.now() + 15 * 60_000; // transient failure: retry soon, never alert
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
  for (const n of notes) chrome.notifications.create(n.id, { type: 'basic', iconUrl: 'icons/icon128.png', title: n.title, message: n.message, priority: 2 });
}

/** Fold one fresh assessment into a tracked coin: snapshot, stage, alerts. */
function applyCheck(g: TrackedGem, out: NonNullable<LhOut>, notes: Array<{ id: string; title: string; message: string }>): void {
  const now = Date.now();
  const sym = g.symbol ?? short4(g.address);
  const fire = (kind: string, tone: 'good' | 'bad' | 'info', text: string, alertTitle?: string) => {
    if (g.fired.includes(kind)) return;
    g.fired.push(kind);
    g.events.unshift({ at: now, text, tone });
    if (alertTitle) notes.push({ id: `ck-gem-${g.address}-${kind}`, title: alertTitle, message: `${text} Click to open.` });
  };

  pushSnap(g, snapOf(out));
  const e = out.early;
  g.stage = e.stage;
  g.verdict = e.stage === 'ROOTED' ? out.result.tier : e.verdict;
  g.score = e.stage === 'ROOTED' ? out.result.score : e.score;
  g.lastMcap = out.mcap;
  if (out.mcap !== null) g.peakMcap = Math.max(g.peakMcap ?? 0, out.mcap);
  g.lastCheckedAt = now;
  const mult = out.mcap !== null ? out.mcap / g.spottedMcap : null;

  // Thesis broken → drop (and keep following the price for the report).
  const dead = assessLiveState(out.analysis.market).state === 'DEAD';
  if (e.hardBreak || dead) {
    const why = e.disqualifiers.find((d) => !/^Dumping right now/.test(d)) ?? e.disqualifiers[0] ?? 'market collapsed';
    g.status = 'DROPPED';
    g.dropReason = why;
    fire('dropped', 'bad', `Thesis broken — ${why}`, `✂ ${sym}: thesis broken — consider exiting`);
    g.nextCheckAt = now + EARLY_GEM.recheckMinutes.DROPPED * 60_000;
    trimGem(g);
    return;
  }

  // Milestones.
  if (out.analysis.launch?.bondingCurveComplete === true) {
    fire('graduated', 'good', `🎓 Graduated off the bonding curve at ${usdK(out.mcap ?? 0)}.`, `🎓 ${sym} graduated`);
  }
  if (e.ageHours !== null && e.ageHours >= 24) fire('day1', 'good', 'Survived day 1 — about 80% of launches don’t.');
  if (e.stage === 'ROOTED' && (out.result.tier === 'CANDIDATE' || out.result.tier === 'WATCH')) {
    fire('rooted', 'good', `🌳 Rooted — passed the long-hold screen at day 3 (Staying Power ${out.result.score}%).`, `🌳 ${sym} is rooted — long-hold screen passed`);
  }
  if (mult !== null) {
    for (const m of EARLY_GEM.multipleMilestones) {
      if (mult >= m) {
        fire(`x${m}`, 'good', `🚀 ${m}× since spotted (${usdK(g.spottedMcap)} → ${usdK(out.mcap ?? 0)}).`, `🚀 ${sym} is ${m}× since you spotted it`);
      }
    }
  }
  const firstHolders = g.snapshots.find((s) => s.holders !== null)?.holders ?? null;
  if (firstHolders && out.holderCount !== null && out.holderCount >= firstHolders * 2) {
    fire('holders2x', 'good', `👥 Holders doubled since spotted (${firstHolders} → ${out.holderCount}).`);
  }

  // Warnings that DON'T end the thesis on their own (long holds see dips).
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const dumping = e.disqualifiers.find((d) => /^Dumping right now/.test(d));
  if (dumping) fire(`dump-${dayKey}`, 'bad', `📉 ${dumping}`, `📉 ${sym} is dumping right now`);
  const peakHolders = Math.max(0, ...g.snapshots.map((s) => s.holders ?? 0));
  if (peakHolders > 0 && out.holderCount !== null && out.holderCount < peakHolders * 0.85) {
    fire('holders-leaving', 'bad', `👋 Holders down ${Math.round((1 - out.holderCount / peakHolders) * 100)}% from their peak — the community is thinning.`, `👋 ${sym}: holders are leaving`);
  }
  if (g.peakMcap && out.mcap !== null && out.mcap < g.peakMcap * 0.4) {
    fire('drawdown60', 'bad', `Down ${Math.round((1 - out.mcap / g.peakMcap) * 100)}% from its peak since you spotted it.`, `⚠ ${sym} is down 60%+ from its peak`);
  }

  g.nextCheckAt = now + EARLY_GEM.recheckMinutes[e.stage] * 60_000;
  trimGem(g);
}

function snapOf(out: NonNullable<LhOut>): GemSnapshot {
  return {
    at: Date.now(),
    mcap: out.mcap,
    holders: out.holderCount,
    liquidity: out.liq,
    score: out.early.stage === 'ROOTED' ? out.result.score : out.early.score,
    dead: assessLiveState(out.analysis.market).state === 'DEAD',
  };
}

/** Dropped coins: price only (DexScreener, then pump.fun), cheap. */
async function priceOnlySnapshot(mint: string): Promise<GemSnapshot | null> {
  const r = await lookupDexscreenerToken(mint);
  if (r.status === 'error') return null;
  if (r.market) {
    return {
      at: Date.now(),
      mcap: r.market.marketCapUsd,
      holders: null,
      liquidity: r.market.liquidityUsd,
      score: null,
      dead: assessLiveState(marketFromDex(r.market)).state === 'DEAD',
    };
  }
  const pump = await fetchPumpfunData(mint);
  if (pump.marketCapEur === null) return null; // unknown ≠ dead; try again later
  return { at: Date.now(), mcap: pump.marketCapEur, holders: null, liquidity: null, score: null, dead: false };
}

function pushSnap(g: TrackedGem, s: GemSnapshot): void {
  g.snapshots.push(s);
  // Thin the middle (keep the first point and the latest 100) so day-1/7/30
  // measurements survive while storage stays bounded.
  if (g.snapshots.length > 400) {
    const head = g.snapshots.slice(0, 1);
    const tail = g.snapshots.slice(-100);
    const mid = g.snapshots.slice(1, -100).filter((_, i) => i % 2 === 0);
    g.snapshots = [...head, ...mid, ...tail];
  }
}

function trimGem(g: TrackedGem): void {
  g.events = g.events.slice(0, 20);
}

const short4 = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
function usdK(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-gem-')) return;
  const address = id.slice('ck-gem-'.length).split('-')[0];
  void chrome.tabs.create({ url: `https://gmgn.ai/sol/token/${address}` });
  chrome.notifications.clear(id);
});

/* ── Recent-tokens persistence (dashboard) ────────────────────────────── */

async function loadRecent(): Promise<RecentToken[]> {
  const data = await chrome.storage.local.get(RECENT_KEY);
  const list = data[RECENT_KEY];
  return Array.isArray(list) ? (list as RecentToken[]) : [];
}

async function saveRecent(analysis: TokenAnalysis, risk: RiskResult, quality: QualityResult): Promise<void> {
  const row: RecentToken = {
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
    updatedAt: Date.now(),
  };
  const recent = await loadRecent();
  const rest = recent.filter((r) => r.address !== row.address);
  await chrome.storage.local.set({ [RECENT_KEY]: [row, ...rest].slice(0, RECENT_MAX) });
}
