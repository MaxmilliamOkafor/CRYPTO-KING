/**
 * lib/gmgnClient.ts — GMGN.AI adapter, built against GMGN's REAL internal
 * endpoints (verified live 2026-07 via DevTools → Network; see config.GMGN).
 *
 * Every response arrives in a {code, message, data} envelope. The endpoints
 * are UNDOCUMENTED and may drift, so parsing stays DEFENSIVE:
 *  - unwrap() only trusts responses whose envelope looks right,
 *  - every field is read via pick() with several candidate key paths,
 *  - anything missing becomes null → the scorer reports a data gap instead
 *    of guessing (never fake a score).
 *
 * MOCK_MODE (default) returns deterministic fixture slices — zero network.
 * Monetary values are converted USD→EUR with config.EUR_PER_USD.
 */

import { EUR_PER_USD, GMGN, MOCK_MODE } from '../config.ts';
import { fixtureForAddress } from '../mock/fixtures.ts';
import { asNumber, asString, fetchJson, pick } from './http.ts';
import type { BehaviorInfo, LpStatus, SmartMoneyInfo, SocialInfo, SourceStatus, TokenAnalysis } from './types.ts';

/** The slice of TokenAnalysis that GMGN can contribute. */
export interface GmgnData {
  status: SourceStatus;
  // identity / market
  symbol: string | null;
  name: string | null;
  ageMinutes: number | null;
  priceEur: number | null;
  marketCapEur: number | null;
  liquidityEur: number | null;
  volume24hEur: number | null;
  // security (mutil_window_token_security_launchpad)
  mintRenounced: boolean | null;
  freezeRenounced: boolean | null;
  isHoneypot: boolean | null;
  isBlacklist: boolean | null;
  taxBps: number | null; // max(buy, sell, average) tax, normalized to basis points
  lpStatus: LpStatus | null;
  // fee distribution (Token-2022 fee surface)
  feeAuthorityActive: boolean | null;
  // slippage
  sellSlippagePct: number | null;
  hasTax: boolean | null;
  // holders (top_buyers + security)
  holderCount: number | null;
  top10Pct: number | null;
  sniperHoldPct: number | null; // top70_sniper_hold_rate → bundled/sniped supply proxy
  // soft signals
  socials: SocialInfo | null;
  smartMoney: SmartMoneyInfo | null;
  behavior: BehaviorInfo | null;
}

/**
 * The six raw GMGN envelope `data` objects, unwrapped but unparsed. This is
 * the payload the content script fetches SAME-ORIGIN (carrying the page's
 * Cloudflare/session cookies) and forwards to the background worker, which
 * then calls parseGmgn(). Any endpoint that failed is null.
 */
export interface GmgnRaw {
  security: unknown | null;
  tokenInfo: unknown | null;
  preview: unknown | null;
  feeDist: unknown | null;
  slippage: unknown | null;
  topBuyers: unknown | null;
}

/**
 * Fetch GMGN endpoints. Works same-origin (content script) or cross-origin with
 * credentials (background/popup). Each entry degrades to null on failure.
 *
 * `lite` = only the security endpoint (1 call instead of 6) — used when scanning
 * many coins at once on a list page. The security object alone yields mint/freeze
 * renounce status, honeypot flag, top-10 concentration, taxes and burn status,
 * which is enough for a meaningful risk badge; the rest become honest data gaps.
 */
export async function fetchGmgnRaw(address: string, lite = false): Promise<GmgnRaw> {
  if (lite) {
    return { security: await call('security', address), tokenInfo: null, preview: null, feeDist: null, slippage: null, topBuyers: null };
  }
  const [security, tokenInfo, preview, feeDist, slippage, topBuyers] = await Promise.all([
    call('security', address),
    call('tokenInfo', address),
    call('tokenPreview', address),
    call('feeDistribution', address),
    call('recommendSlippage', address),
    call('topBuyers', address),
  ]);
  return { security, tokenInfo, preview, feeDist, slippage, topBuyers };
}

export async function fetchGmgnData(address: string): Promise<GmgnData> {
  if (MOCK_MODE) return mockGmgnData(address);
  return parseGmgn(await fetchGmgnRaw(address));
}

/** Pure parse of raw GMGN data into the scorer's GmgnData slice. No I/O. */
export function parseGmgn(raw: GmgnRaw): GmgnData {
  const { security, tokenInfo, preview, feeDist, slippage, topBuyers } = raw;
  const out: GmgnData = { ...EMPTY };

  /* ── security: the core Solana risk object ── */
  if (security !== null) {
    out.mintRenounced = asBool(pick(security, ['renounced_mint', 'security.renounced_mint']));
    out.freezeRenounced = asBool(pick(security, ['renounced_freeze_account', 'security.renounced_freeze_account']));
    out.isHoneypot = asBool(pick(security, ['is_honeypot', 'security.is_honeypot']));
    out.isBlacklist = asBool(pick(security, ['is_blacklist', 'security.is_blacklist']));
    out.top10Pct = ratioToPct(asNumber(pick(security, ['top_10_holder_rate', 'security.top_10_holder_rate'])));

    const buyTax = asNumber(pick(security, ['buy_tax', 'security.buy_tax']));
    const sellTax = asNumber(pick(security, ['sell_tax', 'security.sell_tax']));
    const avgTax = asNumber(pick(security, ['average_tax', 'security.average_tax']));
    const maxTax = [buyTax, sellTax, avgTax].reduce<number | null>(
      (m, t) => (t === null ? m : m === null ? t : Math.max(m, t)),
      null,
    );
    out.taxBps = taxToBps(maxTax);

    out.lpStatus = deriveLpStatus(security);
  }

  /* ── token_info: liquidity, holder count, age ── */
  if (tokenInfo !== null) {
    out.holderCount = out.holderCount ?? asNumber(pick(tokenInfo, ['holder_count']));
    out.liquidityEur = usdToEur(asNumber(pick(tokenInfo, ['liquidity'])));
    const createdSec = asNumber(pick(tokenInfo, ['creation_timestamp', 'open_timestamp']));
    if (createdSec !== null) out.ageMinutes = Math.max(0, (Date.now() / 1000 - createdSec) / 60);
  }

  /* ── token_preview: identity, mcap, socials ── */
  if (preview !== null) {
    out.symbol = asString(pick(preview, ['symbol', 'token.symbol']));
    out.name = asString(pick(preview, ['name', 'token.name']));
    out.marketCapEur = usdToEur(asNumber(pick(preview, ['mc', 'market_cap', 'usd_market_cap'])));
    out.priceEur = usdToEur(asNumber(pick(preview, ['price', 'usd_price'])));
    out.volume24hEur = usdToEur(asNumber(pick(preview, ['volume_24h', 'volume24h', 'v24h'])));
    const twitter = asString(pick(preview, ['twitter', 'socials.twitter', 'twitter_username', 'link.twitter_username']));
    const website = asString(pick(preview, ['website', 'socials.website', 'link.website']));
    const telegram = asString(pick(preview, ['telegram', 'socials.telegram', 'link.telegram']));
    out.socials = { website, twitter, telegram, verified: null }; // GMGN does not attest verification
  }

  /* ── token_fee_distribution: Token-2022 fee authority ── */
  if (feeDist !== null) {
    const feeAuth = pick(feeDist, ['fee_authority']);
    out.feeAuthorityActive = feeAuth === undefined ? null : feeAuth !== null && feeAuth !== '';
    const royaltyBps = asNumber(pick(feeDist, ['royalty', 'royalty_bps']));
    if (out.taxBps === null && royaltyBps !== null) out.taxBps = royaltyBps;
  }

  /* ── recommend_slippage: honeypot / exit-cost proxy ── */
  if (slippage !== null) {
    out.sellSlippagePct = ratioToPct(asNumber(pick(slippage, ['recommend_sell_slippage', 'sell_slippage'])));
    out.hasTax = asBool(pick(slippage, ['has_tax']));
  }

  /* ── top_buyers: concentration + sniper/bundle + smart money ── */
  if (topBuyers !== null) {
    out.top10Pct =
      out.top10Pct ?? ratioToPct(asNumber(pick(topBuyers, ['top_10_holder_rate', 'holders.top_10_holder_rate'])));
    out.sniperHoldPct = ratioToPct(
      asNumber(pick(topBuyers, ['top70_sniper_hold_rate', 'holders.top70_sniper_hold_rate', 'sniper_hold_rate'])),
    );
    const smartCount = asNumber(
      pick(topBuyers, ['smart_degen_count', 'holders.smart_degen_count', 'smart_wallets', 'smart_money_count']),
    );
    const smartSells = asNumber(pick(topBuyers, ['smart_sell_count', 'holders.smart_sell_count']));
    if (smartCount !== null || smartSells !== null) {
      out.smartMoney = {
        accumulating: smartCount !== null && smartCount > 0,
        exiting: smartSells !== null && smartSells > Math.max(1, smartCount ?? 0),
        walletCount: smartCount,
      };
    }
  }

  const anyData =
    out.mintRenounced !== null || out.marketCapEur !== null || out.liquidityEur !== null || out.holderCount !== null;
  const allCore = security !== null && tokenInfo !== null && preview !== null;
  out.status = anyData ? (allCore ? 'ok' : 'partial') : 'unavailable';
  return out;
}

/* ────────────────────────────── helpers ────────────────────────────── */

/** GET a configured GMGN endpoint; unwrap the {code, message, data} envelope. */
async function call(name: keyof typeof GMGN.endpoints, address: string): Promise<unknown | null> {
  const path = GMGN.endpoints[name];
  if (!path) return null;
  const qs = new URLSearchParams(GMGN.commonParams).toString();
  const url = `${GMGN.baseUrl}${path.replace('{address}', address)}${qs ? `?${qs}` : ''}`;
  // credentials:'include' → carries gmgn.ai session/anti-bot cookies (essential
  // same-origin from the content script; also used by the background fallback).
  const json = await fetchJson(url, {
    headers: { accept: 'application/json', ...GMGN.headers },
    credentials: 'include',
  });
  if (json === null || typeof json !== 'object') return null;
  const env = json as { code?: unknown; data?: unknown };
  if (env.code !== undefined && env.code !== 0 && env.code !== '0') return null; // GMGN error envelope
  return env.data ?? json; // tolerate envelope-less responses
}

/**
 * burn_ratio / burn_status / lock_summary → LpStatus.
 * Blackhole locks count as burned; ≥90% locked counts as locked.
 */
function deriveLpStatus(security: unknown): LpStatus {
  const burnStatus = asString(pick(security, ['burn_status', 'security.burn_status']));
  const burnRatio = ratioToPct(asNumber(pick(security, ['burn_ratio', 'security.burn_ratio'])));
  if (burnStatus === 'burn' || (burnRatio !== null && burnRatio >= 95)) return 'burned';

  const lockSummary = pick(security, ['lock_summary', 'security.lock_summary']);
  if (lockSummary && typeof lockSummary === 'object') {
    const isLocked = asBool(pick(lockSummary, ['is_locked']));
    const lockPct = ratioToPct(asNumber(pick(lockSummary, ['lock_percent'])));
    const details = pick(lockSummary, ['lock_detail']);
    const blackhole =
      Array.isArray(details) && details.some((d) => asBool(pick(d, ['is_blackhole'])) === true);
    if (isLocked === true && (lockPct === null || lockPct >= 90)) return blackhole ? 'burned' : 'locked';
  }

  // We saw the security object but nothing says burned/locked → treat as unlocked.
  if (burnStatus !== null || burnRatio !== null) return 'unlocked';
  return 'unknown';
}

const usdToEur = (v: number | null) => (v === null ? null : v * EUR_PER_USD);

/** GMGN mixes 0–1 ratios and 0–100 percents across endpoints; normalize to percent. */
function ratioToPct(v: number | null): number | null {
  if (v === null) return null;
  return v <= 1 ? v * 100 : v;
}

/** Normalize a tax value (0–1 ratio or percent) to basis points. */
function taxToBps(v: number | null): number | null {
  if (v === null) return null;
  if (v <= 1) return Math.round(v * 10_000);
  if (v <= 100) return Math.round(v * 100);
  return Math.round(v); // already bps
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return null;
}

function mockGmgnData(address: string): GmgnData {
  const f: TokenAnalysis = fixtureForAddress(address);
  return {
    status: 'mock',
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
    behavior: f.behavior,
  };
}

const EMPTY: GmgnData = {
  status: 'unavailable',
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
  behavior: null,
};
