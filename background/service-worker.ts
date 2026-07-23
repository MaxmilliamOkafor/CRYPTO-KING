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

import { CACHE_TTL_MS, EUR_PER_USD, LIVE_FEED, MOCK_MODE, RECENT_MAX, WATCHLIST } from '../config.ts';
import { nullDeployerAdapter, pumpfunDeployerAdapter } from '../lib/deployerClient.ts';
import { fetchDexscreenerNewSolana, fetchPairBaseTokens } from '../lib/dexscreenerClient.ts';
import { gemBackgroundCheck } from '../lib/gemCriteria.ts';
import { computeKingGrade } from '../lib/kingGrade.ts';
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
  AnalyzeResponse,
  BgRequest,
  FeedRow,
  LiveFeedResponse,
  MarketInfo,
  MintInfo,
  QualityResult,
  RecentResponse,
  RecentToken,
  ResolvePairsResponse,
  RiskResult,
  SettingsResponse,
  TokenAnalysis,
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
    default:
      return { ok: false, error: `Unknown message type: ${(msg as { type?: string }).type}` };
  }
}

/* ── Live feed: real-time auto-scan of the newest launches ─────────────── */

const feed = new Map<string, FeedRow>();
const notified = new Set<string>(); // mints already desktop-notified
let feedInFlight: Promise<LiveFeedResponse> | null = null;

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
  for (const c of coins) {
    let entry = cache.get(c.mint);
    if (!entry) continue;

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
      graduated: entry.analysis.launch?.bondingCurveComplete ?? null,
      narratives: entry.analysis.narratives,
      twitter: entry.analysis.socials?.twitter ?? null,
      insufficientData: entry.risk.insufficientData,
      unverified:
        entry.analysis.holders === null ||
        !entry.analysis.market ||
        entry.analysis.market.lpStatus === 'unknown',
      scannedAt: Date.now(),
    };
    feed.set(c.mint, row);
    maybeNotifyLowRisk(row, entry.risk);
  }

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
function maybeNotifyLowRisk(row: FeedRow, risk: RiskResult): void {
  if (!LIVE_FEED.notifyLowRisk || MOCK_MODE) return;
  if (!row.gem) return;
  if (notified.has(row.address)) return;
  notified.add(row.address);
  if (notified.size > 500) notified.clear(); // bounded memory; duplicate ping is harmless

  const sym = row.symbol ?? `${row.address.slice(0, 4)}…${row.address.slice(-4)}`;
  chrome.notifications.create(`ck-${row.address}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `💎 ${sym} — King Grade ${row.grade ?? '?'}% (risk ${risk.riskScore}, quality ${row.qualityScore ?? '?'})`,
    message:
      'Graduated, LP secured, no whale wallet, creator screened. Still speculative — research it yourself. Click to open on GMGN.',
  });
}

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-') || id.startsWith('ck-watch-')) return; // watch alerts have their own handler
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

  const job = doAnalyze(address, rawGmgn, lite).finally(() => inFlight.delete(address));
  inFlight.set(address, job);
  return job;
}

async function doAnalyze(address: string, rawGmgn?: unknown, lite = false): Promise<AnalyzeResponse> {
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
    const [gmgn, solana, audit] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address, lite, pumpfun.bondingCurveAccounts, pumpfun.creator),
      rugcheckAdapter.fetchAudit(address),
    ]);
    // Full scans check the creator's launch history (serial-deployer signal);
    // lite feed sweeps skip it to stay within the per-poll budget. Either way,
    // the persistent creator memory backfills when the endpoint fails.
    let deployerHist = lite
      ? await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator)
      : await pumpfunDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);
    deployerHist = await applyCreatorMemory(pumpfun.creator, deployerHist);

    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, {
      gmgn: gmgn.status,
      solana: solana.status,
      pumpfun: pumpfun.status,
      rugcheck: audit.status,
      deployer: deployerHist.status,
    });

    const risk = scoreToken(analysis);
    const quality = scoreQuality(analysis);
    cache.set(address, { analysis, risk, quality, at: Date.now(), lite });
    // Lite feed sweeps would flush the user's own browsing history out of the
    // dashboard's capped recent list — only full scans are recorded there.
    if (!lite) await saveRecent(analysis, risk, quality);
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
  const lpStatus = gmgn.lpStatus && gmgn.lpStatus !== 'unknown' ? gmgn.lpStatus : (auditLpStatus ?? gmgn.lpStatus ?? 'unknown');
  const sellSimulation: MarketInfo['sellSimulation'] =
    gmgn.isHoneypot === true
      ? { ok: false, slippagePct: gmgn.sellSlippagePct }
      : gmgn.sellSlippagePct !== null
        ? { ok: true, slippagePct: gmgn.sellSlippagePct }
        : gmgn.isHoneypot === false
          ? { ok: true, slippagePct: null }
          : null;
  const hasMarket =
    gmgn.marketCapEur !== null || gmgn.liquidityEur !== null || pumpfun.marketCapEur !== null || lpStatus !== 'unknown';
  const market: MarketInfo | null = hasMarket
    ? {
        priceEur: gmgn.priceEur ?? pumpfun.priceEur,
        marketCapEur: gmgn.marketCapEur ?? pumpfun.marketCapEur,
        liquidityEur: gmgn.liquidityEur,
        volume24hEur: gmgn.volume24hEur,
        lpStatus,
        sellSimulation,
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
  const next = [...list, coin];
  await saveWatchlist(next);
  ensureWatchAlarm();
  return { ok: true, watchlist: next };
}

async function unwatchToken(address: string): Promise<WatchlistResponse> {
  const next = (await loadWatchlist()).filter((w) => w.address !== address);
  await saveWatchlist(next);
  return { ok: true, watchlist: next };
}

async function sweepWatchlist(): Promise<void> {
  const list = await loadWatchlist();
  if (list.length === 0) return;

  for (const coin of list) {
    const res = await analyzeToken(coin.address, /*force*/ true); // fresh full scan
    if (!res.ok) continue; // transient failure → try again next sweep, never alert on missing data
    const entry = cache.get(coin.address);
    if (!entry) continue;
    coin.last = snapshotOf(entry);

    for (const alert of computeWatchAlerts(coin.baseline, coin.last)) {
      if (coin.alerted.includes(alert.kind)) continue;
      coin.alerted.push(alert.kind);
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
  await saveWatchlist(list);
}

function ensureWatchAlarm(): void {
  chrome.alarms.create('ck-watch', { periodInMinutes: WATCHLIST.pollMinutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ck-watch') void sweepWatchlist();
});
chrome.runtime.onInstalled.addListener(ensureWatchAlarm);
chrome.runtime.onStartup.addListener(ensureWatchAlarm);
// Load user settings (Helius key) as soon as the service worker wakes.
void loadSettings();

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-watch-')) return;
  const address = id.slice('ck-watch-'.length).split('-')[0];
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
