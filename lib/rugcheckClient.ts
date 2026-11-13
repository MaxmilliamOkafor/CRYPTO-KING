/**
 * lib/rugcheckClient.ts — RugCheck.xyz adapter: the keyless SECOND SOURCE for
 * on-chain facts.
 *
 * Why it matters: the free public Solana RPC refuses getTokenLargestAccounts
 * (HTTP 429, often on the very first call). Without a second source, holder
 * concentration — whale, top-10, dev bag — is "not verified" for every coin,
 * which caps every grade and makes a gem / long-hold candidate impossible on
 * a keyless install. RugCheck's public token report carries the same facts
 * (top holders with insider flags, known AMM accounts, LP lock %, authorities,
 * metadata mutability, total holders) plus its own "rugged" verdict.
 *
 * Policy (see mergeSources in the background worker): the RPC wins whenever
 * it answers; RugCheck fills what the RPC couldn't, and always contributes
 * what only it has (insider-held %, holder count, LP lock, rugged flag).
 *
 * The response shape is undocumented and may drift, so parsing is strictly
 * defensive: anything missing or implausible becomes null ("unknown"), never
 * a guessed number.
 */

import { MOCK_MODE, RUGCHECK, SOLANA } from '../config.ts';
import { asNumber, asString, fetchJson, pick } from './http.ts';
import { lpStatusFromLockedPct } from './lpStatus.ts';
import type { HolderInfo, LpStatus, SourceStatus } from './types.ts';

export interface AuditData {
  status: SourceStatus;
  /** LP status as attested by the auditor. */
  lpStatus: LpStatus | null;
  /** Auditor's own risk annotations, verbatim. */
  externalFlags: string[];
  /** Holder concentration from the auditor's top-holder list (pools excluded). */
  holders: HolderInfo | null;
  /** Authorities / metadata as the auditor read them; null = not attested. */
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  metadataMutable: boolean | null;
  /** The auditor has marked this token as rugged. */
  rugged: boolean | null;
}

export interface AuditAdapter {
  fetchAudit(address: string, excludeTokenAccounts?: string[], creator?: string | null): Promise<AuditData>;
}

export const EMPTY_AUDIT: AuditData = {
  status: 'unavailable',
  lpStatus: null,
  externalFlags: [],
  holders: null,
  mintAuthorityActive: null,
  freezeAuthorityActive: null,
  metadataMutable: null,
  rugged: null,
};

export const rugcheckAdapter: AuditAdapter = {
  async fetchAudit(address, excludeTokenAccounts = [], creator = null): Promise<AuditData> {
    if (MOCK_MODE) return { ...EMPTY_AUDIT, status: 'mock' };
    if (!RUGCHECK.enabled) return { ...EMPTY_AUDIT, status: 'disabled' };
    const json = await fetchJson(RUGCHECK.endpoint.replace('{address}', address));
    if (json === null) return { ...EMPTY_AUDIT };
    return parseRugcheckReport(json, excludeTokenAccounts, creator);
  },
};

/** RugCheck token report → AuditData. Pure; exported for tests. */
export function parseRugcheckReport(json: unknown, excludeTokenAccounts: string[] = [], creatorHint: string | null = null): AuditData {
  const externalFlags: string[] = [];
  const risks = pick(json, ['risks']);
  if (Array.isArray(risks)) {
    for (const r of risks) {
      const name = pick(r, ['name', 'description']);
      if (typeof name === 'string') externalFlags.push(`RugCheck: ${name}`);
    }
  }

  /* LP lock: the deepest market's figure; the summary's top-level one as fallback. */
  const markets = pick(json, ['markets']);
  let lockedPct: number | null = null;
  const vaults = new Set<string>();
  if (Array.isArray(markets)) {
    let bestLiq = -1;
    for (const m of markets) {
      for (const k of ['liquidityAAccount', 'liquidityBAccount', 'pubkey']) {
        const v = asString(pick(m, [k]));
        if (v) vaults.add(v);
      }
      const pct = asNumber(pick(m, ['lp.lpLockedPct']));
      const liq = asNumber(pick(m, ['lp.lpLockedUSD'])) ?? asNumber(pick(m, ['lp.quoteUSD'])) ?? 0;
      if (pct !== null && liq > bestLiq) {
        bestLiq = liq;
        lockedPct = pct;
      }
    }
  }
  lockedPct ??= asNumber(pick(json, ['lpLockedPct']));

  /* Authorities — only attested when the report actually carries token info. */
  const hasToken = pick(json, ['token']) !== undefined;
  const mintAuth = pick(json, ['mintAuthority', 'token.mintAuthority']);
  const freezeAuth = pick(json, ['freezeAuthority', 'token.freezeAuthority']);
  const mutable = pick(json, ['tokenMeta.mutable']);
  const rugged = pick(json, ['rugged']);

  return {
    status: 'ok',
    lpStatus: lpStatusFromLockedPct(lockedPct),
    externalFlags,
    holders: parseHolders(json, vaults, excludeTokenAccounts, creatorHint),
    mintAuthorityActive: hasToken ? typeof mintAuth === 'string' && mintAuth.length > 0 : null,
    freezeAuthorityActive: hasToken ? typeof freezeAuth === 'string' && freezeAuth.length > 0 : null,
    metadataMutable: typeof mutable === 'boolean' ? mutable : null,
    rugged: typeof rugged === 'boolean' ? rugged : null,
  };
}

function parseHolders(json: unknown, vaults: Set<string>, excludeTokenAccounts: string[], creatorHint: string | null): HolderInfo | null {
  const top = pick(json, ['topHolders']);
  const totalHolders = asNumber(pick(json, ['totalHolders']));
  if (!Array.isArray(top) || top.length === 0) {
    return totalHolders !== null ? { ...NO_CONCENTRATION, holderCount: totalHolders } : null;
  }

  // Accounts the auditor itself labels as pools / lockers.
  const pools = new Set<string>([...vaults, ...excludeTokenAccounts, ...SOLANA.knownPoolAuthorities]);
  const known = pick(json, ['knownAccounts']);
  if (known && typeof known === 'object') {
    for (const [addr, v] of Object.entries(known as Record<string, unknown>)) {
      const type = (asString(pick(v, ['type'])) ?? '').toUpperCase();
      if (type.includes('AMM') || type.includes('LOCK') || type.includes('POOL')) pools.add(addr);
    }
  }
  const burns = new Set<string>(SOLANA.burnAddresses);
  const creator = asString(pick(json, ['creator'])) ?? creatorHint;

  const byOwner = new Map<string, number>();
  let insiderPct = 0;
  let devPct = 0;
  let sawPct = false;
  for (const h of top) {
    const pct = asNumber(pick(h, ['pct']));
    if (pct === null || pct < 0 || pct > 100) continue; // implausible → skip, never guess
    sawPct = true;
    const address = asString(pick(h, ['address'])) ?? '';
    const owner = asString(pick(h, ['owner'])) ?? `acct:${address}`;
    if (pools.has(address) || pools.has(owner) || burns.has(owner)) continue;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + pct);
    if (pick(h, ['insider']) === true) insiderPct += pct;
    if (creator && owner === creator) devPct += pct;
  }
  if (!sawPct) return totalHolders !== null ? { ...NO_CONCENTRATION, holderCount: totalHolders } : null;

  const ranked = [...byOwner.values()].sort((a, b) => b - a);
  const sum = (xs: number[]) => Math.min(100, xs.reduce((s, v) => s + v, 0));
  return {
    holderCount: totalHolders,
    top5Pct: sum(ranked.slice(0, 5)),
    top10Pct: sum(ranked.slice(0, 10)),
    largestNonLpWalletPct: ranked.length > 0 ? Math.min(100, ranked[0]) : 0,
    // Supply held by wallets the auditor's funding-graph analysis flags as
    // insiders — the "bundled launch" signal the plain RPC can't compute.
    bundledLaunchPct: Math.min(100, insiderPct),
    smartMoneyPct: null,
    devHoldsPct: creator ? Math.min(100, devPct) : null,
  };
}

const NO_CONCENTRATION: HolderInfo = {
  holderCount: null,
  top5Pct: null,
  top10Pct: null,
  largestNonLpWalletPct: null,
  bundledLaunchPct: null,
  smartMoneyPct: null,
  devHoldsPct: null,
};
