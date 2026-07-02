/**
 * lib/deployerClient.ts — deployer-history adapter (INTENTIONALLY a stub).
 *
 * The risk model wants "prior rugs from the same deployer" and "funding
 * source" (CEX vs. fresh vs. known-rugger). Deriving that means building a
 * wallet-clustering / funding-graph pipeline — i.e. profiling individual
 * wallets. That is deliberately NOT implemented here:
 *  - the stub returns honest unknowns, which the scorer reports as data gaps
 *    (zero points — never fake a score),
 *  - GMGN's top_buyers sniper/bundler tagging already covers the legitimate
 *    launch-manipulation signals (bundled supply, early deployer selling)
 *    through the GMGN adapter,
 *  - if you have access to a reputational API that attests deployer history,
 *    implement DeployerAdapter below and swap it in service-worker.ts —
 *    that is the whole integration surface.
 */

import type { DeployerInfo, SourceStatus } from './types.ts';

export interface DeployerHistory {
  status: SourceStatus;
  deployer: DeployerInfo | null;
}

export interface DeployerAdapter {
  fetchDeployerHistory(tokenAddress: string, creatorAddress: string | null): Promise<DeployerHistory>;
}

/** Default adapter: everything unknown → scorer reports "deployer history unavailable". */
export const nullDeployerAdapter: DeployerAdapter = {
  async fetchDeployerHistory(): Promise<DeployerHistory> {
    return {
      status: 'disabled',
      deployer: { priorRugs: null, fundingSource: 'unknown' },
    };
  },
};
