/**
 * lib/solanaClient.ts — on-chain facts straight from a Solana RPC.
 *
 * This is the source of truth for the HIGH-WEIGHT checks — never trust an
 * aggregator's cached audit tag when the chain can be asked directly:
 *  - mint authority / freeze authority (jsonParsed mint account)
 *  - Token-2022 transfer-fee extension (fee bps + whether fee authorities live)
 *  - holder concentration from getTokenLargestAccounts, counting only REAL
 *    wallets: pool vaults / curves / escrows are recognised structurally by
 *    the program that owns them (lib/holderMath.ts), burns excluded
 *  - metadata mutability via DAS getAsset (Helius-style RPCs only; plain RPC
 *    cannot answer this without heavy PDA/borsh work → reported as unknown)
 *
 * MOCK_MODE returns fixture slices; no network calls.
 */

import { MOCK_MODE, SMART_MONEY_WALLETS, SOLANA } from '../config.ts';
import { fixtureForAddress } from '../mock/fixtures.ts';
import { computeConcentration, effectiveTransferFeeBps, uiAmountOf, type TopAccount } from './holderMath.ts';
import { asNumber, rpcCall } from './http.ts';
import { activeSupportsDas, rpcUrlPool } from './settings.ts';
import type { HolderInfo, MintInfo } from './types.ts';

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export interface SolanaData {
  mint: MintInfo | null;
  holders: HolderInfo | null;
  /** Token decimals from the mint account (sizes the Jupiter sell quote). */
  decimals: number | null;
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
  /** pump.fun bonding-curve state: false = still on the curve (only then can a
   *  lite scan trust its concentration numbers — see fetchHolderInfoLite). */
  curveComplete: boolean | null = null,
): Promise<SolanaData> {
  if (MOCK_MODE) {
    const f = fixtureForAddress(address);
    return { mint: f.mint, holders: f.holders, decimals: null, status: 'mock' };
  }

  if (lite) {
    const [mi, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfoLite(address, excludeTokenAccounts, curveComplete)]);
    return { mint: mi?.mint ?? null, holders, decimals: mi?.decimals ?? null, status: mi ? 'partial' : 'unavailable' };
  }

  const [mi, holders] = await Promise.all([fetchMintInfo(address), fetchHolderInfo(address, creatorAddress)]);
  const mint = mi?.mint ?? null;
  const status = mint && holders ? 'ok' : mint || holders ? 'partial' : 'unavailable';
  return { mint, holders, decimals: mi?.decimals ?? null, status };
}

/* ── Mint account: authorities + Token-2022 extensions ─────────────────── */

async function fetchMintInfo(address: string): Promise<{ mint: MintInfo; decimals: number | null } | null> {
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
        // Both sides count: a 0% fee today with 50% scheduled for a later epoch
        // is a classic trap, and reading only `newer` (or only `older`) misses it.
        const older = (state.olderTransferFee ?? {}) as Record<string, unknown>;
        const newer = (state.newerTransferFee ?? {}) as Record<string, unknown>;
        transferFeeBps =
          effectiveTransferFeeBps(asNumber(older.transferFeeBasisPoints), asNumber(newer.transferFeeBasisPoints)) ?? 0;
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
    mint: {
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
    },
    decimals: asNumber(info.decimals),
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

  const supply = uiAmountOf((supplyRes as { value?: { uiAmountString?: unknown; uiAmount?: unknown } } | null)?.value);
  const raw = parseLargest(largestRes);
  if (supply === null || supply <= 0 || raw.length === 0) return null;

  // Who owns each top token account, and which PROGRAM owns that owner?
  // System Program → a person's wallet. Anything else → pool vault, bonding
  // curve, escrow or lock (see lib/holderMath.ts for why a static list failed).
  const owners = await fetchOwners(raw.map((a) => a.address));
  const ownerPrograms = await fetchOwnerPrograms(owners);
  const accounts: TopAccount[] = raw.map((a, i) => ({
    address: a.address,
    amount: a.amount,
    owner: owners[i],
    ownerProgram: owners[i] ? (ownerPrograms.get(owners[i] as string) ?? null) : null,
  }));

  const conc = computeConcentration(
    accounts,
    supply,
    new Set(SOLANA.burnAddresses),
    new Set(SOLANA.knownPoolAuthorities),
  );
  if (!conc) return null;

  const pctOf = (pred: (a: TopAccount) => boolean) =>
    Math.min(100, (accounts.reduce((s, a) => (pred(a) ? s + a.amount : s), 0) / supply) * 100);

  // The user's tracked smart-money wallets among the top-20 — an honest floor.
  const smartSet = new Set(SMART_MONEY_WALLETS);
  const smartMoneyPct = smartSet.size === 0 ? null : pctOf((a) => a.owner !== null && smartSet.has(a.owner));

  // Creator (dev) holdings among the top accounts. 0 = nothing visible in the
  // top 20 — an honest floor, not a full-supply audit.
  const devHoldsPct = creatorAddress === null ? null : pctOf((a) => a.owner === creatorAddress);

  return {
    holderCount: null, // plain RPC has no cheap holder count; GMGN fills this in when live
    top5Pct: conc.top5Pct,
    top10Pct: conc.top10Pct,
    largestNonLpWalletPct: conc.largestWalletPct,
    bundledLaunchPct: null, // needs block-0..2 funding-graph analysis; honest "unknown" for now
    smartMoneyPct,
    devHoldsPct,
  };
}

function parseLargest(largestRes: unknown): Array<{ address: string; amount: number }> {
  const value = (largestRes as { value?: Array<{ address?: string; uiAmountString?: unknown; uiAmount?: unknown }> } | null)
    ?.value;
  return (value ?? [])
    .map((a) => ({ address: a.address ?? '', amount: uiAmountOf(a) ?? 0 }))
    .filter((a) => a.address && a.amount > 0);
}

/**
 * Lite holder concentration: supply + largest accounts only (2 RPC calls).
 * Excludes the given token accounts by ADDRESS (bonding-curve vaults) instead
 * of resolving owners. Caveat: unknown AMM vaults are NOT excluded here, so
 * concentration can read high for migrated coins — the full scan refines it.
 */
async function fetchHolderInfoLite(
  address: string,
  excludeTokenAccounts: string[],
  curveComplete: boolean | null,
): Promise<HolderInfo | null> {
  // Without owner resolution we can only exclude pools we know by ADDRESS —
  // the bonding curve, while the coin is still on it. Once it has graduated,
  // its biggest "holder" is an AMM vault we can't identify here, and reporting
  // it as a whale was a false alarm on nearly every migrated coin (it also
  // kept them from ever qualifying for a full scan). So: numbers only when
  // they're trustworthy; otherwise an honest "unknown" until the full scan —
  // and don't spend two rate-limited RPC calls finding that out.
  if (curveComplete !== false) return null;

  const [supplyRes, largestRes] = await Promise.all([
    rpcCall(rpcUrlPool(), 'getTokenSupply', [address, { commitment: 'confirmed' }]),
    rpcCall(rpcUrlPool(), 'getTokenLargestAccounts', [address, { commitment: 'confirmed' }]),
  ]);

  const supply = uiAmountOf((supplyRes as { value?: { uiAmountString?: unknown; uiAmount?: unknown } } | null)?.value);
  const excluded = new Set(excludeTokenAccounts);
  const accounts = parseLargest(largestRes).filter((a) => !excluded.has(a.address));
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

/**
 * For each distinct owner, the program that owns ITS account. One batched call
 * with a zero-length data slice (we only need the `owner` field). Missing
 * accounts map to nothing → treated as wallets (never hide concentration).
 */
async function fetchOwnerPrograms(owners: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(owners.filter((o): o is string => o !== null))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const result = (await rpcCall(rpcUrlPool(), 'getMultipleAccounts', [
    unique,
    { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: 'confirmed' },
  ])) as { value?: Array<{ owner?: string } | null> } | null;
  const values = result?.value ?? [];
  unique.forEach((o, i) => {
    const prog = values[i]?.owner;
    if (typeof prog === 'string') out.set(o, prog);
  });
  return out;
}
