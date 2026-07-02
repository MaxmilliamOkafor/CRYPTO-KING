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

import { CACHE_TTL_MS, MOCK_MODE, RECENT_MAX } from '../config.ts';
import { nullDeployerAdapter } from '../lib/deployerClient.ts';
import { fetchGmgnData, type GmgnData } from '../lib/gmgnClient.ts';
import { fetchPumpfunData, type PumpfunData } from '../lib/pumpfunClient.ts';
import { scoreToken } from '../lib/riskScorer.ts';
import { rugcheckAdapter } from '../lib/rugcheckClient.ts';
import { fetchSolanaData, type SolanaData } from '../lib/solanaClient.ts';
import type {
  AnalyzeResponse,
  BgRequest,
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

async function handle(msg: BgRequest): Promise<AnalyzeResponse | RecentResponse> {
  switch (msg.type) {
    case 'ANALYZE_TOKEN':
      return analyzeToken(msg.address, msg.force === true);
    case 'GET_RECENT': {
      const recent = await loadRecent();
      return { ok: true, recent };
    }
    case 'CLEAR_RECENT':
      await chrome.storage.local.set({ [RECENT_KEY]: [] });
      return { ok: true, recent: [] };
    default:
      return { ok: false, error: `Unknown message type: ${(msg as { type?: string }).type}` };
  }
}

async function analyzeToken(address: string, force: boolean): Promise<AnalyzeResponse> {
  if (!BASE58_RE.test(address)) {
    return { ok: false, error: 'Not a valid Solana address.' };
  }

  const cached = cache.get(address);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, analysis: cached.analysis, risk: cached.risk, mock: MOCK_MODE };
  }

  const pending = inFlight.get(address);
  if (pending) return pending;

  const job = doAnalyze(address).finally(() => inFlight.delete(address));
  inFlight.set(address, job);
  return job;
}

async function doAnalyze(address: string): Promise<AnalyzeResponse> {
  try {
    // All adapters degrade to honest "unavailable" internally; Promise.all is safe.
    const [gmgn, solana, pumpfun, audit] = await Promise.all([
      fetchGmgnData(address),
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
