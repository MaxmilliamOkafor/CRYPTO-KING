/**
 * lib/holderMath.ts — who actually holds a token? Pure, unit-testable.
 *
 * The bug this replaces: holder concentration excluded pools by matching the
 * token account's owner against a hard-coded list of TWO Raydium authorities.
 * Every other venue — PumpSwap (where nearly all graduated pump.fun coins
 * trade), Meteora, Orca, the pump.fun bonding curve itself — keeps its tokens
 * in a vault owned by a per-pool PDA that no static list can enumerate. So the
 * biggest "holder" of most coins was the liquidity pool, reported as "a single
 * wallet holds 70%": risk inflated, gem grade blocked, King Grade capped, for
 * coins that were actually well distributed.
 *
 * The structural rule instead: a real person's wallet is an account owned by
 * the System Program. A pool vault, bonding curve, or escrow is owned by the
 * AMM / launchpad / lock PROGRAM. So we look at the program that owns each
 * token-account owner, and only System-Program-owned owners count as holders.
 */

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export interface TopAccount {
  /** SPL token account address. */
  address: string;
  /** Token amount (UI units). */
  amount: number;
  /** Wallet/PDA that owns the token account; null = couldn't resolve. */
  owner: string | null;
  /** Program that owns `owner`'s account; null = account doesn't exist / unresolved. */
  ownerProgram: string | null;
}

export type HolderKind = 'wallet' | 'program' | 'burn';

/**
 * Classify one top account.
 *  - burn address → 'burn' (tokens destroyed; not a holder)
 *  - owner owned by a non-System program → 'program' (pool, curve, escrow, lock)
 *  - otherwise → 'wallet'. Unresolvable owners count as WALLETS on purpose:
 *    when unsure, never hide concentration.
 */
export function classifyHolder(acc: TopAccount, burnAddresses: Set<string>, knownPoolOwners: Set<string>): HolderKind {
  if (acc.owner !== null && burnAddresses.has(acc.owner)) return 'burn';
  if (acc.owner !== null && knownPoolOwners.has(acc.owner)) return 'program';
  if (acc.ownerProgram !== null && acc.ownerProgram !== SYSTEM_PROGRAM) return 'program';
  return 'wallet';
}

export interface Concentration {
  top5Pct: number;
  top10Pct: number;
  largestWalletPct: number | null;
  /** % of supply sitting in pools / curves / escrows among the top accounts. */
  programHeldPct: number;
  /** % of supply burned (among the top accounts). */
  burnedPct: number;
}

/** Concentration over REAL wallets only. `accounts` must be sorted largest-first. */
export function computeConcentration(
  accounts: TopAccount[],
  supply: number,
  burnAddresses: Set<string>,
  knownPoolOwners: Set<string> = new Set(),
): Concentration | null {
  if (!(supply > 0)) return null;
  const pct = (xs: Array<{ amount: number }>) => Math.min(100, (xs.reduce((s, a) => s + a.amount, 0) / supply) * 100);

  const wallets: TopAccount[] = [];
  const programs: TopAccount[] = [];
  const burns: TopAccount[] = [];
  for (const a of accounts) {
    const kind = classifyHolder(a, burnAddresses, knownPoolOwners);
    (kind === 'wallet' ? wallets : kind === 'program' ? programs : burns).push(a);
  }

  // One person can hold through several token accounts — sum by owner so a
  // whale splitting across accounts can't hide from the largest-wallet check.
  const byOwner = new Map<string, number>();
  for (const w of wallets) {
    const k = w.owner ?? `acct:${w.address}`;
    byOwner.set(k, (byOwner.get(k) ?? 0) + w.amount);
  }
  const ranked = [...byOwner.values()].sort((a, b) => b - a).map((amount) => ({ amount }));

  return {
    top5Pct: pct(ranked.slice(0, 5)),
    top10Pct: pct(ranked.slice(0, 10)),
    largestWalletPct: ranked.length > 0 ? pct(ranked.slice(0, 1)) : null,
    programHeldPct: pct(programs),
    burnedPct: pct(burns),
  };
}

/**
 * Token-2022 transfer fee that can actually bite you. The extension stores an
 * OLDER and a NEWER fee; the newer one takes over at a future epoch. A scam can
 * sit at 0% today with 50% scheduled — reading only one side misses that.
 */
export function effectiveTransferFeeBps(olderBps: number | null, newerBps: number | null): number | null {
  if (olderBps === null && newerBps === null) return null;
  return Math.max(olderBps ?? 0, newerBps ?? 0);
}

/** Prefer the exact string amount: `uiAmount` is a lossy float and can be null. */
export function uiAmountOf(v: { uiAmountString?: unknown; uiAmount?: unknown } | null | undefined): number | null {
  if (!v) return null;
  for (const raw of [v.uiAmountString, v.uiAmount]) {
    const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}
