/**
 * lib/http.ts — rate-limited fetch used by ALL data clients.
 *
 * Ground rules enforced here:
 *  - Every external call runs in the background service worker (the clients
 *    are only imported there), never in content scripts.
 *  - Per-host minimum spacing (config.RATE_LIMITS_MS) so we never hammer
 *    GMGN, an RPC, pump.fun or RugCheck.
 *  - Hard timeout per request; failures return null so the aggregator can
 *    degrade gracefully ("data unavailable"), never throw into the UI.
 */

import { FETCH_TIMEOUT_MS, RATE_LIMITS_MS } from '../config.ts';

function rateLimitFor(host: string): number {
  const bare = host.replace(/^www\./, '');
  return RATE_LIMITS_MS[bare] ?? RATE_LIMITS_MS.default;
}

/** Last-call timestamp and pending chain per host — a minimal serial queue. */
const hostQueues = new Map<string, { lastAt: number; chain: Promise<unknown> }>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rate-limited JSON fetch. Returns the parsed body, or null on ANY failure
 * (network, timeout, non-2xx, invalid JSON). Callers treat null as
 * "data unavailable".
 */
export async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  const host = hostOf(url);
  const q = hostQueues.get(host) ?? { lastAt: 0, chain: Promise.resolve() };

  const run = q.chain.then(async () => {
    const wait = q.lastAt + rateLimitFor(host) - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        console.warn(`[CRYPTO-KING] ${host} responded ${res.status} for ${url}`);
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      console.warn(`[CRYPTO-KING] fetch failed for ${url}:`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  // Keep the chain alive even if this request failed.
  hostQueues.set(host, { lastAt: q.lastAt, chain: run.catch(() => undefined) });
  const result = await run;
  const entry = hostQueues.get(host);
  if (entry) entry.lastAt = Math.max(entry.lastAt, Date.now() - 1);
  return result;
}

/** Rate-limited JSON-RPC POST helper (Solana RPC / Helius DAS). */
export async function rpcCall(rpcUrl: string, method: string, params: unknown): Promise<unknown | null> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'crypto-king', method, params });
  const json = await fetchJson(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (json && typeof json === 'object' && 'result' in (json as Record<string, unknown>)) {
    return (json as Record<string, unknown>).result ?? null;
  }
  return null;
}

/**
 * Defensive value picker for undocumented/drifting JSON shapes (GMGN).
 * Tries each dot-path in order, returns the first defined value.
 */
export function pick(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj;
    let ok = true;
    for (const key of path.split('.')) {
      if (cur !== null && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
