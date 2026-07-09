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

import { fetchCreatorCoins } from './pumpfunClient.ts';
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
      deployer: {
        priorRugs: null,
        fundingSource: 'unknown',
        priorLaunches: null,
        priorDeadLaunches: null,
        graduatedLaunches: null,
      },
    };
  },
};

/**
 * Launchpad-records adapter: counts the creator's PRIOR pump.fun coins and how
 * many are dead/abandoned (never graduated, negligible mcap, older than a day).
 * This is platform data about launches — still no funding-graph profiling.
 * priorRugs stays null: a dead launch is not proof of a rug, and we don't
 * overclaim; the scorer has a separate, honestly-worded serial-deployer factor.
 */
export const pumpfunDeployerAdapter: DeployerAdapter = {
  async fetchDeployerHistory(tokenAddress: string, creatorAddress: string | null): Promise<DeployerHistory> {
    if (!creatorAddress) return nullDeployerAdapter.fetchDeployerHistory(tokenAddress, creatorAddress);
    const coins = await fetchCreatorCoins(creatorAddress);
    if (coins === null) return nullDeployerAdapter.fetchDeployerHistory(tokenAddress, creatorAddress);

    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const prior = coins.filter((c) => c.mint !== tokenAddress);
    const dead = prior.filter(
      (c) =>
        c.complete === false &&
        (c.usdMarketCap ?? 0) < 10_000 &&
        c.createdMs !== null &&
        c.createdMs < dayAgo,
    );
    const graduated = prior.filter((c) => c.complete === true);

    return {
      status: 'ok',
      deployer: {
        priorRugs: null, // we never claim "rug" from launch records alone
        fundingSource: 'unknown',
        priorLaunches: prior.length,
        priorDeadLaunches: dead.length,
        graduatedLaunches: graduated.length,
      },
    };
  },
};
