/**
 * lib/pumpfunClient.ts — pump.fun adapter (secondary source).
 *
 * pump.fun's data lives on a separate public API host,
 * https://frontend-api-v3.pump.fun (v1/v2 are dead). GET /coins/<MINT>
 * returns a flat coin object exposing the bonding-curve mechanics — the
 * Pump-native risk surface: creator, created_timestamp, complete (graduated?),
 * virtual/real reserves, market_cap/usd_market_cap, socials, is_banned,
 * token_program (Token-2022 vs SPL).
 *
 * Non-pump.fun mints simply 404 here → status 'unavailable', which is fine:
 * this adapter only ENRICHES; GMGN + Solana RPC remain the primary sources.
 */

import { EUR_PER_USD, MOCK_MODE, PUMPFUN } from '../config.ts';
import { fixtureForAddress } from '../mock/fixtures.ts';
import { asNumber, asString, fetchJson, pick } from './http.ts';
import type { SocialInfo, SourceStatus } from './types.ts';

export interface PumpfunData {
  status: SourceStatus;
  symbol: string | null;
  name: string | null;
  ageMinutes: number | null;
  marketCapEur: number | null;
  /** true = bonding curve graduated (token migrated to an AMM pool). */
  bondingCurveComplete: boolean | null;
  /** Coin banned on pump.fun — strong negative context, surfaced via behavior. */
  isBanned: boolean | null;
  isToken2022: boolean | null;
  creator: string | null;
  socials: SocialInfo | null;
  /** Bonding-curve accounts — excluded from holder-concentration math in lite scans. */
  bondingCurveAccounts: string[];
}

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export async function fetchPumpfunData(address: string): Promise<PumpfunData> {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return {
      status: 'mock',
      symbol: f.identity.symbol,
      name: f.identity.name,
      ageMinutes: f.identity.ageMinutes,
      marketCapEur: f.market?.marketCapEur ?? null,
      bondingCurveComplete: true,
      isBanned: false,
      isToken2022: f.mint?.isToken2022 ?? null,
      creator: null,
      socials: f.socials,
      bondingCurveAccounts: [],
    };
  }

  if (!PUMPFUN.enabled) return { ...EMPTY, status: 'disabled' };

  const url = `${PUMPFUN.baseUrl}${PUMPFUN.coinEndpoint.replace('{address}', address)}`;
  const json = await fetchJson(url);
  if (json === null) return { ...EMPTY, status: 'unavailable' }; // includes 404 for non-pump mints

  const createdMs = asNumber(pick(json, ['created_timestamp']));
  const tokenProgram = asString(pick(json, ['token_program']));
  const website = asString(pick(json, ['website']));
  const twitter = asString(pick(json, ['twitter']));
  const telegram = asString(pick(json, ['telegram']));

  return {
    status: 'ok',
    symbol: asString(pick(json, ['symbol'])),
    name: asString(pick(json, ['name'])),
    ageMinutes: createdMs !== null ? Math.max(0, (Date.now() - createdMs) / 60_000) : null,
    marketCapEur: usdToEur(asNumber(pick(json, ['usd_market_cap', 'market_cap']))),
    bondingCurveComplete: asBoolLoose(pick(json, ['complete'])),
    isBanned: asBoolLoose(pick(json, ['is_banned'])),
    isToken2022: tokenProgram !== null ? tokenProgram === TOKEN_2022_PROGRAM : null,
    creator: asString(pick(json, ['creator'])),
    socials:
      website || twitter || telegram
        ? { website, twitter, telegram, verified: null }
        : null,
    bondingCurveAccounts: [
      asString(pick(json, ['bonding_curve'])),
      asString(pick(json, ['associated_bonding_curve'])),
      asString(pick(json, ['pool_address'])),
    ].filter((s): s is string => s !== null),
  };
}

/** A freshly-created coin from the pump.fun list feed (used by the Live scanner). */
export interface PumpfunListItem {
  mint: string;
  symbol: string | null;
  name: string | null;
  createdMs: number | null;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Newest launches from pump.fun (keyless). Returns [] on failure / mock mode. */
export async function fetchPumpfunNewCoins(limit: number, offset = 0): Promise<PumpfunListItem[]> {
  if (MOCK_MODE || !PUMPFUN.enabled) return [];
  const path = PUMPFUN.listEndpoint.replace('{offset}', String(offset)).replace('{limit}', String(limit));
  const json = await fetchJson(`${PUMPFUN.baseUrl}${path}`);
  const arr = Array.isArray(json) ? json : Array.isArray((json as { coins?: unknown })?.coins) ? (json as { coins: unknown[] }).coins : [];
  const out: PumpfunListItem[] = [];
  for (const c of arr) {
    const mint = asString(pick(c, ['mint', 'address', 'coin_mint']));
    if (!mint || !BASE58_RE.test(mint)) continue;
    out.push({
      mint,
      symbol: asString(pick(c, ['symbol'])),
      name: asString(pick(c, ['name'])),
      createdMs: asNumber(pick(c, ['created_timestamp'])),
    });
  }
  return out;
}

/** Slim record of a creator's prior coin, for the serial-deployer heuristic. */
export interface CreatorCoin {
  mint: string;
  createdMs: number | null;
  usdMarketCap: number | null;
  complete: boolean | null;
}

/**
 * Coins previously created by this wallet (pump.fun records — platform data,
 * not wallet deanonymization). null = endpoint unavailable/changed → the
 * serial-deployer check simply reports a data gap.
 */
export async function fetchCreatorCoins(creator: string): Promise<CreatorCoin[] | null> {
  if (MOCK_MODE || !PUMPFUN.enabled) return null;
  const path = PUMPFUN.creatorCoinsEndpoint.replace('{creator}', creator);
  const json = await fetchJson(`${PUMPFUN.baseUrl}${path}`);
  const arr = Array.isArray(json)
    ? json
    : Array.isArray((json as { coins?: unknown })?.coins)
      ? (json as { coins: unknown[] }).coins
      : null;
  if (!arr) return null;
  const out: CreatorCoin[] = [];
  for (const c of arr) {
    const mint = asString(pick(c, ['mint', 'address']));
    if (!mint) continue;
    out.push({
      mint,
      createdMs: asNumber(pick(c, ['created_timestamp'])),
      usdMarketCap: asNumber(pick(c, ['usd_market_cap', 'market_cap'])),
      complete: asBoolLoose(pick(c, ['complete'])),
    });
  }
  return out;
}

const usdToEur = (v: number | null) => (v === null ? null : v * EUR_PER_USD);

function asBoolLoose(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  return null;
}

const EMPTY: PumpfunData = {
  status: 'unavailable',
  symbol: null,
  name: null,
  ageMinutes: null,
  marketCapEur: null,
  bondingCurveComplete: null,
  isBanned: null,
  isToken2022: null,
  creator: null,
  socials: null,
  bondingCurveAccounts: [],
};
