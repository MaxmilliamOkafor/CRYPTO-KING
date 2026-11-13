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

/**
 * Per-host serial queue with enforced spacing. ONE persistent state object per
 * host: `chain` serializes requests, `nextAt` is the earliest time the next
 * request may start. (An earlier version stored a fresh object per call, which
 * silently lost the spacing between queued requests.)
 */
const hostState = new Map<string, { nextAt: number; chain: Promise<unknown> }>();

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
  let st = hostState.get(host);
  if (!st) {
    st = { nextAt: 0, chain: Promise.resolve() };
    hostState.set(host, st);
  }

  const run = st.chain.then(async () => {
    const wait = st.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    st.nextAt = Date.now() + rateLimitFor(host);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) {
        // 404 is a real answer for lookups ("not a pump.fun coin"), not an outage.
        record(host, res.status === 404, res.status);
        if (res.status !== 404) console.warn(`[CRYPTO-KING] ${host} responded ${res.status} for ${url}`);
        return null;
      }
      const body = (await res.json()) as unknown;
      record(host, true, res.status);
      return body;
    } catch (err) {
      record(host, false, 0);
      console.warn(`[CRYPTO-KING] fetch failed for ${url}:`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  // Keep the chain alive even if this request failed.
  st.chain = run.catch(() => undefined);
  return run;
}

/**
 * Rate-limited JSON-RPC POST helper (Solana RPC / Helius DAS). Accepts one URL
 * or a FAILOVER POOL: endpoints are tried in order until one returns a result,
 * so a single rate-limited/keyless endpoint doesn't stall the scan.
 */
export async function rpcCall(rpcUrl: string | string[], method: string, params: unknown): Promise<unknown | null> {
  const urls = Array.isArray(rpcUrl) ? rpcUrl : [rpcUrl];
  const body = JSON.stringify({ jsonrpc: '2.0', id: 'crypto-king', method, params });
  for (const url of urls) {
    const key = `${hostOf(url)} ${method}`;
    // An endpoint that keeps refusing ONE method (the public RPC refuses
    // getTokenLargestAccounts outright) is skipped for that method for a
    // while — retrying it on every coin only burned the rate budget that the
    // methods which DO work need.
    const blockedUntil = methodBlock.get(key);
    if (blockedUntil !== undefined && Date.now() < blockedUntil) continue;

    const json = await fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const ok = Boolean(json && typeof json === 'object' && 'result' in (json as Record<string, unknown>));
    recordKey(key, ok);
    if (ok) {
      methodFails.delete(key);
      methodBlock.delete(key);
      return (json as Record<string, unknown>).result ?? null;
    }
    const fails = (methodFails.get(key) ?? 0) + 1;
    methodFails.set(key, fails);
    if (fails >= METHOD_FAILS_BEFORE_BLOCK) methodBlock.set(key, Date.now() + METHOD_BLOCK_MS);
    // else: this endpoint failed/rate-limited → try the next in the pool
  }
  return null;
}

const methodFails = new Map<string, number>();
const methodBlock = new Map<string, number>();
const METHOD_FAILS_BEFORE_BLOCK = 3;
const METHOD_BLOCK_MS = 5 * 60_000;

/* ── Source health: is each data source actually answering? ──────────────
 * Every scan depends on free third-party APIs, and when one silently fails the
 * symptom on screen is vague ("holders not verified", "PARTIAL"). These
 * counters make it visible: the panel shows a dot per source, so "the RPC is
 * refusing holder lookups" is a fact on screen instead of a mystery.
 */
export interface SourceHealth {
  key: string;
  ok: number;
  fail: number;
  lastOkAt: number | null;
  lastFailAt: number | null;
  lastStatus: number | null;
  /** Outcomes of the most recent calls, newest last (true = ok). */
  recent: boolean[];
  /** RPC method keys only: true while the endpoint is being skipped for this
   *  method after repeated refusals. */
  blocked: boolean;
}

const health = new Map<string, SourceHealth>();

function recordKey(key: string, ok: boolean, status: number | null = null): void {
  let h = health.get(key);
  if (!h) {
    h = { key, ok: 0, fail: 0, lastOkAt: null, lastFailAt: null, lastStatus: null, recent: [], blocked: false };
    health.set(key, h);
  }
  if (ok) {
    h.ok++;
    h.lastOkAt = Date.now();
  } else {
    h.fail++;
    h.lastFailAt = Date.now();
  }
  if (status !== null) h.lastStatus = status;
  h.recent.push(ok);
  if (h.recent.length > 20) h.recent.shift();
}

function record(host: string, ok: boolean, status: number): void {
  recordKey(host, ok, status);
}

/** Snapshot of every source's counters (hosts, plus "host method" for RPC). */
export function getSourceHealth(): SourceHealth[] {
  const now = Date.now();
  return [...health.values()].map((h) => ({
    ...h,
    recent: [...h.recent],
    blocked: (methodBlock.get(h.key) ?? 0) > now,
  }));
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
