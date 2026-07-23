/**
 * lib/settings.ts — runtime, user-editable settings (background only).
 *
 * The single biggest lever on scan quality/speed is the RPC endpoint. Editing
 * config.ts + rebuilding is friction the user shouldn't pay, so a free Helius
 * key can be pasted straight into the extension (popup) and is stored here.
 * When a key is present the scanner shifts into "firehose" mode: bigger
 * per-poll budget, DAS metadata checks enabled, faster effective cadence.
 */

import { LIVE_FEED, SOLANA } from '../config.ts';

export interface Settings {
  heliusKey: string | null;
  /** Optional X (Twitter) API v2 bearer token for automated tweet-buzz. */
  xBearerToken: string | null;
}

const KEY = 'ck:settings';
let current: Settings = { heliusKey: null, xBearerToken: null };

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function loadSettings(): Promise<void> {
  const d = await chrome.storage.local.get(KEY);
  const s = d[KEY] as Partial<Settings> | undefined;
  if (s) current = { heliusKey: clean(s.heliusKey), xBearerToken: clean(s.xBearerToken) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  current = {
    heliusKey: 'heliusKey' in patch ? clean(patch.heliusKey) : current.heliusKey,
    xBearerToken: 'xBearerToken' in patch ? clean(patch.xBearerToken) : current.xBearerToken,
  };
  await chrome.storage.local.set({ [KEY]: current });
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function hasHelius(): boolean {
  return Boolean(current.heliusKey);
}

export function xBearerToken(): string | null {
  return current.xBearerToken;
}

export function hasX(): boolean {
  return Boolean(current.xBearerToken);
}

/** Effective RPC URL — user's Helius key if set, else the config default. */
export function activeRpcUrl(): string {
  return current.heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${current.heliusKey}` : SOLANA.rpcUrl;
}

/** DAS getAsset (metadata mutability) works on Helius; auto-enabled with a key. */
export function activeSupportsDas(): boolean {
  return hasHelius() || SOLANA.supportsDas;
}

/** With a Helius key the RPC can take far more load — scan 3× more coins per poll. */
export function effectiveScanBudget(): number {
  return hasHelius() ? LIVE_FEED.scanBudgetPerPoll * 3 : LIVE_FEED.scanBudgetPerPoll;
}

/** Concurrency scales with a key too. */
export function effectiveConcurrency(): number {
  return hasHelius() ? LIVE_FEED.scanConcurrency * 2 : LIVE_FEED.scanConcurrency;
}
