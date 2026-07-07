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
import { fetchDexscreenerNewSolana } from '../lib/dexscreenerClient.ts';
import { fetchGmgnData, parseGmgn, type GmgnData, type GmgnRaw } from '../lib/gmgnClient.ts';
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
  RiskResult,
  TokenAnalysis,
} from '../lib/types.ts';

const RECENT_KEY = 'ck:recent';
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface CacheEntry {
  analysis: TokenAnalysis;
  risk: RiskResult;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AnalyzeResponse>>();

chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true; // async sendResponse
});

async function handle(msg: BgRequest): Promise<AnalyzeResponse | RecentResponse | LiveFeedResponse> {
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
    default:
      return { ok: false, error: `Unknown message type: ${(msg as { type?: string }).type}` };
  }
}

/* ── Live feed: real-time auto-scan of the newest launches ─────────────── */

const feed = new Map<string, FeedRow>();

async function getLiveFeed(): Promise<LiveFeedResponse> {
  if (!LIVE_FEED.enabled) return { ok: false, error: 'Live feed disabled in config.' };

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

  // Prune anything too old to still count as a fresh launch.
  const cutoff = Date.now() - LIVE_FEED.maxAgeMinutes * 60_000;
  for (const [mint, row] of feed) {
    if (row.ageMinutes !== null && row.scannedAt < cutoff && row.ageMinutes > LIVE_FEED.maxAgeMinutes) feed.delete(mint);
  }

  // Scan newest-first, but only a budget of NOT-yet-scanned coins per poll
  // (each scan costs several RPC calls). Cached coins refresh for free.
  let scannedThisPoll = 0;
  for (const c of coins) {
    const cached = cache.get(c.mint);
    const fresh = cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (!fresh) {
      if (scannedThisPoll >= LIVE_FEED.scanBudgetPerPoll) continue;
      await analyzeToken(c.mint, false); // populates cache
      scannedThisPoll++;
    }
    const entry = cache.get(c.mint);
    if (!entry) continue;
    feed.set(c.mint, {
      address: c.mint,
      symbol: entry.analysis.identity.symbol ?? c.symbol,
      name: entry.analysis.identity.name ?? c.name,
      ageMinutes: entry.analysis.identity.ageMinutes ?? (c.createdMs ? Math.max(0, (Date.now() - c.createdMs) / 60_000) : null),
      marketCapEur: entry.analysis.market?.marketCapEur ?? null,
      riskScore: entry.risk.riskScore,
      signal: entry.risk.signal,
      topReason: entry.risk.reasons[0]?.text ?? null,
      insufficientData: entry.risk.insufficientData,
      scannedAt: Date.now(),
    });
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

async function analyzeToken(address: string, force: boolean, rawGmgn?: unknown): Promise<AnalyzeResponse> {
  if (!BASE58_RE.test(address)) {
    return { ok: false, error: 'Not a valid Solana address.' };
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

async function doAnalyze(address: string, rawGmgn?: unknown): Promise<AnalyzeResponse> {
  try {
    // GMGN: prefer the raw payload the content script fetched same-origin (cookies
    // apply, dodges Cloudflare); otherwise fetch it here (mock mode, or the popup
    // which isn't running on gmgn.ai).
    const gmgnPromise =
      !MOCK_MODE && rawGmgn ? Promise.resolve(parseGmgn(rawGmgn as GmgnRaw)) : fetchGmgnData(address);
    // All adapters degrade to honest "unavailable" internally; Promise.all is safe.
    const [gmgn, solana, pumpfun, audit] = await Promise.all([
      gmgnPromise,
      fetchSolanaData(address),
      fetchPumpfunData(address),
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
    cache.set(address, { analysis, risk, at: Date.now() });
    await saveRecent(analysis, risk);
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
