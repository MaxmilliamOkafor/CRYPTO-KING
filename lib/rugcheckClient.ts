/**
 * lib/rugcheckClient.ts — optional RugCheck.xyz adapter (pluggable, stubbed).
 *
 * OFF by default (config.RUGCHECK.enabled = false) because the public API
 * spec drifts. The interface is the contract: any third-party auditor can be
 * plugged in by implementing AuditAdapter and returning nulls for anything
 * it can't attest. All failures collapse to status 'unavailable' — the
 * aggregator then simply reports the corresponding data gaps.
 */

import { MOCK_MODE, RUGCHECK } from '../config.ts';
import { asNumber, fetchJson, pick } from './http.ts';
import type { LpStatus, SourceStatus } from './types.ts';

export interface AuditData {
  status: SourceStatus;
  /** LP status as attested by the auditor (used only when GMGN/RPC couldn't tell). */
  lpStatus: LpStatus | null;
  /** Auditor's own risk annotations, surfaced verbatim in the popup. */
  externalFlags: string[];
}

export interface AuditAdapter {
  fetchAudit(address: string): Promise<AuditData>;
}

export const rugcheckAdapter: AuditAdapter = {
  async fetchAudit(address: string): Promise<AuditData> {
    if (MOCK_MODE) return { status: 'mock', lpStatus: null, externalFlags: [] };
    if (!RUGCHECK.enabled) return { status: 'disabled', lpStatus: null, externalFlags: [] };

    const json = await fetchJson(RUGCHECK.endpoint.replace('{address}', address));
    if (json === null) return { status: 'unavailable', lpStatus: null, externalFlags: [] };

    // Defensive parse of the v1 report shape (verify against current docs before enabling).
    const externalFlags: string[] = [];
    const risks = pick(json, ['risks']);
    if (Array.isArray(risks)) {
      for (const r of risks) {
        const name = pick(r, ['name', 'description']);
        if (typeof name === 'string') externalFlags.push(`RugCheck: ${name}`);
      }
    }

    let lpStatus: LpStatus | null = null;
    const lockedPct = asNumber(pick(json, ['markets.0.lp.lpLockedPct', 'lpLockedPct']));
    if (lockedPct !== null) lpStatus = lockedPct >= 90 ? 'locked' : 'unlocked';

    return { status: 'ok', lpStatus, externalFlags };
  },
};
