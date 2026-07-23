/**
 * lib/solanaClient.ts — on-chain facts straight from a Solana RPC.
 *
 * This is the source of truth for the HIGH-WEIGHT checks — never trust an
 * aggregator's cached audit tag when the chain can be asked directly:
 *  - mint authority / freeze authority (jsonParsed mint account)
 *  - Token-2022 transfer-fee extension (fee bps + whether fee authorities live)
 *  - holder concentration from getTokenLargestAccounts (+ owner lookup so LP
 *    vaults and burn addresses are excluded)
 *  - metadata mutability via DAS getAsset (Helius-style RPCs only; plain RPC
 *    cannot answer this without heavy PDA/borsh work → reported as unknown)
 *
 * MOCK_MODE returns fixture slices; no network calls.
 */

import { MOCK_MODE, SMART_MONEY_WALLETS, SOLANA } from '../config.ts';
import { fixtureForAddress } from '../mock/fixtures.ts';
import { asNumber, rpcCall } from './http.ts';
import { activeSupportsDas, rpcUrlPool } from './settings.ts';
import type { HolderInfo, MintInfo } from './types.ts';

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface SolanaData {
  mint: MintInfo | null;
  holders: HolderInfo | null;
  status: 'ok' | 'partial' | 'unavailable' | 'mock';
}

/**
 * `lite` = 3 RPC calls instead of 4+: mint account (mint/freeze authority — the
 * top rug check) plus supply + largest accounts for holder concentration. The
 * owner-resolution call is skipped; instead `excludeTokenAccounts` (the
 * launchpad's bonding-curve accounts, known from pump.fun) are excluded by
 * address. Used by the Live feed's bulk scans; opening a coin runs the full
 * scan, which upgrades the cached result.
 */
export async function fetchSolanaData(
  address: string,
  lite = false,
  excludeTokenAccounts: string[] = [],
  creatorAddress: string | null = null,
): Promise<SolanaData> {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return { mint: f.mint, holders: f.holders, status: 'mock' };
  }

  if (lite) {
    const [mint, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfoLite(address, excludeTokenAccounts)]);
    return { mint, holders, status: mint ? 'partial' : 'unavailable' };
  }

  const [mint, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfo(address, creatorAddress)]);
  const status = mint && holders ? 'ok' : mint || holders ? 'partial' : 'unavailable';
  return { mint, holders, status };
}

/* ── Mint account: authorities + Token-2022 extensions ─────────────────── */

async function fetchMintInfo(address: string): Promise<MintInfo | null> {
  const result = (await rpcCall(rpcUrlPool(), 'getAccountInfo', [
    address,
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])) as { value?: { owner?: string; data?: { parsed?: { type?: string; info?: Record<string, unknown> } } } } | null;

  const value = result?.value;
  const parsed = value?.data?.parsed;
  if (!value || !parsed || parsed.type !== 'mint' || !parsed.info) return null;

  const info = parsed.info;
  const isToken2022 = value.owner === TOKEN_2022_PROGRAM;

  // jsonParsed encodes a revoked authority as absent/null.
  const mintAuthorityActive = info.mintAuthority != null;
  const freezeAuthorityActive = info.freezeAuthority != null;

  let transferFeeBps: number | null = null;
  let feeAuthorityActive: boolean | null = isToken2022 ? false : null; // legacy SPL: concept doesn't exist
  // Token-2022 trap extensions — the current generation of rug tricks. Legacy
  // SPL mints CANNOT carry these, so false is accurate there (not unknown).
  let permanentDelegateActive = false;
  let transferHookActive = false;
  let defaultAccountFrozen = false;
  let nonTransferable = false;
  const extensions = Array.isArray(info.extensions) ? (info.extensions as Array<Record<string, unknown>>) : [];
  for (const ext of extensions) {
    const state = (ext.state ?? {}) as Record<string, unknown>;
    switch (ext.extension) {
      case 'transferFeeConfig': {
        const newer = (state.newerTransferFee ?? {}) as Record<string, unknown>;
        transferFeeBps = asNumber(newer.transferFeeBasisPoints) ?? 0;
        feeAuthorityActive = state.transferFeeConfigAuthority != null || state.withdrawWithheldAuthority != null;
        break;
      }
      case 'permanentDelegate':
        permanentDelegateActive = state.delegate != null;
        break;
      case 'transferHook':
        transferHookActive = state.programId != null;
        break;
      case 'defaultAccountState':
        defaultAccountFrozen = state.accountState === 'frozen';
        break;
      case 'nonTransferable':
      case 'nonTransferableAccount':
        nonTransferable = true;
        break;
    }
  }

  return {
    mintAuthorityActive,
    freezeAuthorityActive,
    metadataMutable: await fetchMetadataMutable(address),
    isToken2022,
    transferFeeBps,
    feeAuthorityActive,
    permanentDelegateActive,
    transferHookActive,
    defaultAccountFrozen,
    nonTransferable,
  };
}

/** Metadata mutability via DAS getAsset — Helius-style RPCs only. */
async function fetchMetadataMutable(address: string): Promise<boolean | null> {
  if (!activeSupportsDas()) return null; // honest "unknown" on plain RPC
  const asset = (await rpcCall(rpcUrlPool(), 'getAsset', { id: address })) as { mutable?: boolean } | null;
  return typeof asset?.mutable === 'boolean' ? asset.mutable : null;
}

/* ── Holder concentration (LP/burn excluded) ───────────────────────────── */

async function fetchHolderInfo(address: string, creatorAddress: string | null = null): Promise<HolderInfo | null> {
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), 'getTokenSupply', [address, { commitment: 'confirmed' }]),
    rpcCall(rpcUrlPool(), 'getTokenLargestAccounts', [address, { commitment: 'confirmed' }]),
  ]);

  const supply = asNumber((supplyRes as { value?: { uiAmount?: unknown } } | null)?.value?.uiAmount);
  const accounts = ((largestRes as { value?: Array<{ address?: string; uiAmount?: unknown }> } | null)?.value ?? [])
    .map((a) => ({ address: a.address ?? '', amount: asNumber(a.uiAmount) ?? 0 }))
    .filter((a) => a.address && a.amount > 0);

  if (supply === null || supply <= 0 || accounts.length === 0) return null;

  // Resolve owners of the top token accounts so LP vaults / burns are excluded.
  const owners = await fetchOwners(accounts.map((a) => a.address));
  const excluded = new Set([...SOLANA.knownPoolAuthorities, ...SOLANA.burnAddresses]);
  const realHolders = accounts.filter((_a, i) => {
    const owner = owners[i];
    // Unknown owner → keep (conservative: don't silently shrink concentration).
    return owner === null || !excluded.has(owner);
  });

  const pct = (slice: Array<{ amount: number }>) =>
    Math.min(100, (slice.reduce((s, a) => s + a.amount, 0) / supply) * 100);

  // The user's tracked smart-money wallets: % of supply they hold among the
  // top accounts. Limited to the top-20 visible accounts — an honest floor.
  const smartSet = new Set(SMART_MONEY_WALLETS);
  const smartMoneyPct =
    smartSet.size === 0
      ? null
      : Math.min(
          100,
          (accounts.reduce((s, a, i) => (owners[i] !== null && smartSet.has(owners[i] as string) ? s + a.amount : s), 0) /
            supply) *
            100,
        );

  // Creator (dev) holdings among the top accounts. 0 = the dev's wallet holds
  // nothing visible in the top 20 — an honest floor, not a full-supply audit.
  const devHoldsPct =
    creatorAddress === null
      ? null
      : Math.min(
          100,
          (accounts.reduce((s, a, i) => (owners[i] === creatorAddress ? s + a.amount : s), 0) / supply) * 100,
        );

  return {
    holderCount: null, // plain RPC has no cheap holder count; GMGN fills this in when live
    top5Pct: pct(realHolders.slice(0, 5)),
    top10Pct: pct(realHolders.slice(0, 10)),
    largestNonLpWalletPct: realHolders.length > 0 ? pct(realHolders.slice(0, 1)) : null,
    bundledLaunchPct: null, // needs block-0..2 funding-graph analysis; honest "unknown" for now
    smartMoneyPct,
    devHoldsPct,
  };
}

/**
 * Lite holder concentration: supply + largest accounts only (2 RPC calls).
 * Excludes the given token accounts by ADDRESS (bonding-curve vaults) instead
 * of resolving owners. Caveat: unknown AMM vaults are NOT excluded here, so
 * concentration can read high for migrated coins — the full scan refines it.
 */
async function fetchHolderInfoLite(address: string, excludeTokenAccounts: string[]): Promise<HolderInfo | null> {
  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), 'getTokenSupply', [address, { commitment: 'confirmed' }]),
    rpcCall(rpcUrlPool(), 'getTokenLargestAccounts', [address, { commitment: 'confirmed' }]),
  ]);

  const supply = asNumber((supplyRes as { value?: { uiAmount?: unknown } } | null)?.value?.uiAmount);
  const excluded = new Set(excludeTokenAccounts);
  const accounts = ((largestRes as { value?: Array<{ address?: string; uiAmount?: unknown }> } | null)?.value ?? [])
    .map((a) => ({ address: a.address ?? '', amount: asNumber(a.uiAmount) ?? 0 }))
    .filter((a) => a.address && a.amount > 0 && !excluded.has(a.address));

  if (supply === null || supply <= 0 || accounts.length === 0) return null;

  const pct = (slice: Array<{ amount: number }>) =>
    Math.min(100, (slice.reduce((s, a) => s + a.amount, 0) / supply) * 100);

  return {
    holderCount: null,
    top5Pct: pct(accounts.slice(0, 5)),
    top10Pct: pct(accounts.slice(0, 10)),
    largestNonLpWalletPct: pct(accounts.slice(0, 1)),
    bundledLaunchPct: null,
    smartMoneyPct: null, // needs owner resolution — full scans only
    devHoldsPct: null, // needs owner resolution — full scans only
  };
}

async function fetchOwners(tokenAccounts: string[]): Promise<Array<string | null>> {
  const result = (await rpcCall(rpcUrlPool(), 'getMultipleAccounts', [
    tokenAccounts,
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])) as { value?: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null> } | null;

  const values = result?.value ?? [];
  return tokenAccounts.map((_, i) => values[i]?.data?.parsed?.info?.owner ?? null);
}
