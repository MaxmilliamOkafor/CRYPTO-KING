/**
 * lib/geckoClient.ts — GeckoTerminal adapter (keyless, public API v2).
 *
 * Why another source: everything else the scanner reads is a SNAPSHOT (price
 * change over 1h/6h/24h at most). Judging whether a coin can be HELD for weeks
 * needs its history — did it survive its first crashes, is it still making
 * higher lows, is volume persisting or decaying — and a way to find coins
 * that are days-to-months old rather than minutes. GeckoTerminal provides both
 * without a key:
 *   - daily OHLCV per pool                 → lib/longHold.ts price/demand pillars
 *   - token info incl. holder count        → holder-growth tracking
 *   - trending / top-volume Solana pools   → long-hold radar candidates
 *
 * Every parser is defensive and returns null/[] on an unexpected shape: a
 * missing number must read as "unknown", never as a fabricated value.
 * Public limit is ~30 calls/min — paced in config.RATE_LIMITS_MS.
 */

import { GECKO, MOCK_MODE } from '../config.ts';
import { asNumber, asString, fetchJson, pick } from './http.ts';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One daily candle, oldest → newest after normalisation. USD. */
export interface Candle {
  /** Unix seconds (start of the day). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** USD volume traded that day. */
  v: number;
}

/** Daily candles for a pool, oldest first. null = unavailable. */
export async function fetchDailyCandles(poolAddress: string, days = GECKO.historyDays): Promise<Candle[] | null> {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(poolAddress)) return null;
  const url = `${GECKO.baseUrl}/networks/solana/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=${days}&currency=usd`;
  return parseCandles(await fetchJson(url));
}

/** GeckoTerminal OHLCV body → candles. Shape: data.attributes.ohlcv_list = [[t,o,h,l,c,v], …] newest-first. */
export function parseCandles(json: unknown): Candle[] | null {
  const list = pick(json, ['data.attributes.ohlcv_list']);
  if (!Array.isArray(list)) return null;
  const out: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map((x: unknown) => asNumber(x));
    if (t === null || o === null || h === null || l === null || c === null || v === null) continue;
    if (h <= 0 || l <= 0 || c <= 0) continue; // a zero price is a bad row, not a real candle
    out.push({ t, o, h, l, c, v });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.t - b.t);
  // De-duplicate days (keep the last row per timestamp).
  const byDay = new Map<number, Candle>();
  for (const k of out) byDay.set(k.t, k);
  return [...byDay.values()];
}

export interface GeckoTokenInfo {
  holderCount: number | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
}

/** Token profile: holder count + socials. null = unavailable. */
export async function fetchTokenInfo(mint: string): Promise<GeckoTokenInfo | null> {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(mint)) return null;
  return parseTokenInfo(await fetchJson(`${GECKO.baseUrl}/networks/solana/tokens/${mint}/info`));
}

export function parseTokenInfo(json: unknown): GeckoTokenInfo | null {
  const attrs = pick(json, ['data.attributes']);
  if (!attrs || typeof attrs !== 'object') return null;
  const websites = pick(attrs, ['websites']);
  const handle = asString(pick(attrs, ['twitter_handle']));
  const tg = asString(pick(attrs, ['telegram_handle']));
  return {
    holderCount: asNumber(pick(attrs, ['holders.count'])),
    twitter: handle ? `https://x.com/${handle.replace(/^@/, '')}` : null,
    telegram: tg ? `https://t.me/${tg.replace(/^@/, '')}` : null,
    website: Array.isArray(websites) ? asString(websites[0]) : null,
  };
}

/** A pool surfaced by the radar's discovery lists. */
export interface RadarPool {
  mint: string;
  pool: string;
  name: string | null;
  createdMs: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  /** 24h UNIQUE wallets buying / selling — the anti-wash-trading signal: fake
   *  volume is a few wallets trading with themselves, real demand is many. */
  buyers24h: number | null;
  sellers24h: number | null;
}

/** One pool's live stats (same shape as a radar row). null = unavailable. */
export async function fetchPool(poolAddress: string): Promise<RadarPool | null> {
  if (MOCK_MODE || !GECKO.enabled || !BASE58_RE.test(poolAddress)) return null;
  const json = await fetchJson(`${GECKO.baseUrl}/networks/solana/pools/${poolAddress}`);
  const data = pick(json, ['data']);
  return data ? (parsePools({ data: [data] })[0] ?? null) : null;
}

/**
 * Established Solana coins worth a long-hold look: trending + top-volume pools.
 * Deduplicated by mint (deepest pool wins). [] on failure.
 */
export async function fetchRadarPools(): Promise<RadarPool[]> {
  if (MOCK_MODE || !GECKO.enabled) return [];
  const pools: RadarPool[] = [];
  for (const path of GECKO.discoveryPaths) {
    pools.push(...parsePools(await fetchJson(`${GECKO.baseUrl}${path}`)));
  }
  const byMint = new Map<string, RadarPool>();
  for (const p of pools) {
    const prev = byMint.get(p.mint);
    if (!prev || (p.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0)) byMint.set(p.mint, p);
  }
  return [...byMint.values()];
}

/**
 * The newest Solana pools, newest first. Every pump.fun graduation (and every
 * other listing) creates a pool, so polling this every minute captures coins
 * the moment they become tradeable on a DEX — the radar revisits them once
 * they've survived a day. [] on failure.
 */
export async function fetchNewPools(pages = 2): Promise<RadarPool[]> {
  if (MOCK_MODE || !GECKO.enabled) return [];
  const out: RadarPool[] = [];
  for (let page = 1; page <= pages; page++) {
    out.push(...parsePools(await fetchJson(`${GECKO.baseUrl}/networks/solana/new_pools?page=${page}`)));
  }
  return out;
}

/** Base tokens that are infrastructure, not memes — never radar candidates. */
const NOT_MEMES = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
]);

export function parsePools(json: unknown): RadarPool[] {
  const data = pick(json, ['data']);
  if (!Array.isArray(data)) return [];
  const out: RadarPool[] = [];
  for (const p of data) {
    // Token ids look like "solana_<mint>".
    const baseId = asString(pick(p, ['relationships.base_token.data.id']));
    const mint = baseId?.startsWith('solana_') ? baseId.slice('solana_'.length) : null;
    const pool = asString(pick(p, ['attributes.address']));
    if (!mint || !pool || !BASE58_RE.test(mint) || NOT_MEMES.has(mint)) continue;
    const created = asString(pick(p, ['attributes.pool_created_at']));
    const createdMs = created ? Date.parse(created) : NaN;
    out.push({
      mint,
      pool,
      name: asString(pick(p, ['attributes.name'])),
      createdMs: Number.isFinite(createdMs) ? createdMs : null,
      liquidityUsd: asNumber(pick(p, ['attributes.reserve_in_usd'])),
      // Prefer real market cap; FDV equals it for fixed-supply memes.
      marketCapUsd: asNumber(pick(p, ['attributes.market_cap_usd', 'attributes.fdv_usd'])),
      volume24hUsd: asNumber(pick(p, ['attributes.volume_usd.h24'])),
      buyers24h: asNumber(pick(p, ['attributes.transactions.h24.buyers'])),
      sellers24h: asNumber(pick(p, ['attributes.transactions.h24.sellers'])),
    });
  }
  return out;
}
