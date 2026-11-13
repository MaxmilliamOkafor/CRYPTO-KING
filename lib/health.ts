/**
 * lib/health.ts — turn raw per-host counters into "is each thing working?".
 * Pure, unit-tested.
 *
 * Every verdict in this extension is only as good as the free APIs behind it,
 * and when one fails the symptom is indirect ("holders not verified",
 * "PARTIAL", an empty radar). The panel shows one dot per capability so the
 * cause is visible — and, for the one failure that matters most (holder
 * lookups, which the free public RPC refuses), what is covering for it.
 */

import type { SourceHealth } from './http.ts';
import type { HealthRow, HealthStatus } from './types.ts';

const RPC_HOST = /solana\.com$|helius-rpc\.com$|magicblock\.app$/;

/** Judge by the LAST few calls — "recent" has to mean now, or a source that
 *  just started failing would keep showing green on its old successes. */
const WINDOW = 8;

function statusOf(all: boolean[]): HealthStatus {
  const recent = all.slice(-WINDOW);
  if (recent.length === 0) return 'idle';
  const ok = recent.filter(Boolean).length;
  if (ok === 0) return recent.length >= 3 ? 'down' : 'degraded';
  return ok / recent.length >= 0.7 ? 'ok' : 'degraded';
}

export function summarizeHealth(raw: SourceHealth[]): HealthRow[] {
  const host = (h: string) => raw.find((r) => r.key === h);
  const recentOf = (keys: SourceHealth[]) => keys.flatMap((k) => k.recent);
  const row = (id: string, label: string, recent: boolean[], note: string | null = null): HealthRow => ({
    id,
    label,
    status: statusOf(recent),
    note,
  });

  const rpcHosts = raw.filter((r) => !r.key.includes(' ') && RPC_HOST.test(r.key));
  const holderRpc = raw.filter((r) => r.key.endsWith(' getTokenLargestAccounts'));
  const rug = host('api.rugcheck.xyz');
  // Per endpoint, best one wins: holders are served if ANY RPC answers. An
  // endpoint currently being skipped for this method counts as down.
  const rank: Record<HealthStatus, number> = { ok: 3, degraded: 2, down: 1, idle: 0 };
  const perEndpoint = holderRpc.map((k) => (k.blocked ? 'down' : statusOf(k.recent)) as HealthStatus);
  const holderRpcStatus: HealthStatus = perEndpoint.length
    ? perEndpoint.reduce((best, cur) => (rank[cur] > rank[best] ? cur : best), 'idle' as HealthStatus)
    : 'idle';
  const rugStatus = statusOf(rug?.recent ?? []);

  // Holders: served if EITHER the RPC or the backup auditor answers.
  let holderStatus: HealthStatus;
  let holderNote: string | null = null;
  if (holderRpcStatus === 'ok') holderStatus = 'ok';
  else if (rugStatus === 'ok' || rugStatus === 'degraded') {
    holderStatus = holderRpcStatus === 'idle' && rugStatus === 'ok' ? 'ok' : rugStatus;
    if (holderRpcStatus === 'down' || holderRpcStatus === 'degraded') {
      holderNote = 'The free Solana RPC is refusing holder lookups — RugCheck is covering (full scans only).';
    }
  } else if (holderRpcStatus === 'idle' && rugStatus === 'idle') holderStatus = 'idle';
  else {
    holderStatus = holderRpcStatus === 'degraded' ? 'degraded' : 'down';
    holderNote =
      'Holder checks are failing, so coins will read as "not verified". A free Helius key (toolbar icon → Turbo) fixes this.';
  }

  return [
    row('launches', 'Launches', host('frontend-api-v3.pump.fun')?.recent ?? []),
    row('prices', 'Prices', host('api.dexscreener.com')?.recent ?? []),
    row('chain', 'Solana RPC', recentOf(rpcHosts)),
    { id: 'holders', label: 'Holders', status: holderStatus, note: holderNote },
    row('history', 'History', host('api.geckoterminal.com')?.recent ?? []),
    row('audit', 'Audit', rug?.recent ?? []),
    row('sell', 'Sell check', host('lite-api.jup.ag')?.recent ?? []),
  ];
}
