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

import { CACHE_TTL_MS, LIVE_FEED, MOCK_MODE, RECENT_MAX } from '../config.ts';
import { nullDeployerAdapter } from '../lib/deployerClient.ts';
import { fetchDexscreenerNewSolana, fetchPairBaseTokens } from '../lib/dexscreenerClient.ts';
import { emptyGmgnData, fetchGmgnData, parseGmgn, type GmgnData, type GmgnRaw } from '../lib/gmgnClient.ts';
import { fetchPumpfunData, fetchPumpfunNewCoins, type PumpfunData } from '../lib/pumpfunClient.ts';
import { scoreToken } from '../lib/riskScorer.ts';
import { rugcheckAdapter } from '../lib/rugcheckClient.ts';
import { fetchSolanaData, type SolanaData } from '../lib/solanaClient.ts';
import type {
  AnalyzeResponse,
  BgRequest,
  FeedRow,
  LiveFeedResponse,
  MarketInfo,
  MintInfo,
  RecentResponse,
  RecentToken,
  ResolvePairsResponse,
  RiskResult,
  TokenAnalysis,
} from '../lib/types.ts';

const RECENT_KEY = 'ck:recent';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface CacheEntry {
  analysis: TokenAnalysis;
  risk: RiskResult;
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
): Promise<AnalyzeResponse | RecentResponse | LiveFeedResponse | ResolvePairsResponse> {
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
  let coins = await fetchPumpfunNewCoins(LIVE_FEED.fetchCount);
  if (coins.length === 0) {
    // Fallback: DexScreener fresh Solana tokens (address-only; details fill in on scan).
    const addrs = await fetchDexscreenerNewSolana(LIVE_FEED.fetchCount);
    coins = addrs.map((mint) => ({ mint, symbol: null, name: null, createdMs: null }));
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

  // Scan newest-first with a per-poll budget of not-yet-scanned coins. Feed
  // scans are LITE (mint-authority check only, 1 RPC call) so a full budget
  // fits inside the poll interval on the public RPC; opening a coin upgrades
  // it to a full scan. Cached coins refresh for free.
  let scannedThisPoll = 0;
  for (const c of coins) {
    const cached = cache.get(c.mint);
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (!fresh) {
      if (scannedThisPoll >= LIVE_FEED.scanBudgetPerPoll) continue;
      await analyzeToken(c.mint, false, undefined, /*lite*/ true);
      scannedThisPoll++;
    }
    const entry = cache.get(c.mint);
    if (!entry) continue;
    const row: FeedRow = {
      address: c.mint,
      symbol: entry.analysis.identity.symbol ?? c.symbol,
      name: entry.analysis.identity.name ?? c.name,
      ageMinutes:
        entry.analysis.identity.ageMinutes ?? (c.createdMs ? Math.max(0, (Date.now() - c.createdMs) / 60_000) : null),
      marketCapEur: entry.analysis.market?.marketCapEur ?? null,
      riskScore: entry.risk.riskScore,
      signal: entry.risk.signal,
      topReason: entry.risk.reasons[0]?.text ?? null,
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
 * Desktop notification when a fresh launch scans lower-risk — so the user
 * doesn't have to watch the panel. Requires the on-chain authority checks to
 * have actually run (never notify on insufficient data), fires once per mint,
 * and the copy stays risk-framed: "lower observed risk", never "buy".
 */
function maybeNotifyLowRisk(row: FeedRow, risk: RiskResult): void {
  if (!LIVE_FEED.notifyLowRisk || MOCK_MODE) return;
  if (row.insufficientData || risk.riskScore > LIVE_FEED.notifyMaxScore) return;
  if (notified.has(row.address)) return;
  const mintChecked = risk.dataGaps.every((g) => !/mint data unavailable/i.test(g));
  if (!mintChecked) return;
  notified.add(row.address);
  if (notified.size > 500) notified.clear(); // bounded memory; duplicate ping is harmless

  const sym = row.symbol ?? `${row.address.slice(0, 4)}…${row.address.slice(-4)}`;
  chrome.notifications.create(`ck-${row.address}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `👑 ${sym} — score ${risk.riskScore} (${risk.signal})`,
    message:
      `Fresh launch, lower observed risk (≠ safe${row.unverified ? '; holders/LP unverified' : ''}). ` +
      `${row.ageMinutes !== null ? `${Math.round(row.ageMinutes)} min old. ` : ''}Click to open on GMGN.`,
  });
}

chrome.notifications?.onClicked.addListener((id) => {
  if (!id.startsWith('ck-')) return;
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
    return { ok: true, analysis: cached.analysis, risk: cached.risk, mock: MOCK_MODE };
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
      fetchSolanaData(address, lite, pumpfun.bondingCurveAccounts),
      rugcheckAdapter.fetchAudit(address),
    ]);
    const deployerHist = await nullDeployerAdapter.fetchDeployerHistory(address, pumpfun.creator);

    const analysis = mergeSources(address, gmgn, solana, pumpfun, audit.lpStatus, deployerHist.deployer, {
      gmgn: gmgn.status,
      solana: solana.status,
      pumpfun: pumpfun.status,
      rugcheck: audit.status,
      deployer: deployerHist.status,
    });

    const risk = scoreToken(analysis);
    cache.set(address, { analysis, risk, at: Date.now(), lite });
    // Lite feed sweeps would flush the user's own browsing history out of the
    // dashboard's capped recent list — only full scans are recorded there.
    if (!lite) await saveRecent(analysis, risk);
    return { ok: true, analysis, risk, mock: MOCK_MODE };
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
        priceEur: gmgn.priceEur,
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

  return {
    identity: {
      address,
      symbol: gmgn.symbol ?? pumpfun.symbol,
      name: gmgn.name ?? pumpfun.name,
      chain: 'sol',
      ageMinutes: gmgn.ageMinutes ?? pumpfun.ageMinutes,
      logoUri: null,
    },
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
          }
        : null,
    sources,
    fetchedAt: Date.now(),
  };
}

/* ── Recent-tokens persistence (dashboard) ────────────────────────────── */

async function loadRecent(): Promise<RecentToken[]> {
  const data = await chrome.storage.local.get(RECENT_KEY);
  const list = data[RECENT_KEY];
  return Array.isArray(list) ? (list as RecentToken[]) : [];
}

async function saveRecent(analysis: TokenAnalysis, risk: RiskResult): Promise<void> {
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
    insufficientData: risk.insufficientData,
    updatedAt: Date.now(),
  };
  const recent = await loadRecent();
  const rest = recent.filter((r) => r.address !== row.address);
  await chrome.storage.local.set({ [RECENT_KEY]: [row, ...rest].slice(0, RECENT_MAX) });
}
