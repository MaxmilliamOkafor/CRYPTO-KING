/**
 * lib/jupiterClient.ts — "can I actually SELL this right now, and what does it
 * cost?" via Jupiter's keyless quote API. Read-only: a QUOTE, never a swap —
 * no wallet, no signing, no transaction is ever built.
 *
 * Before this, the sell simulation came only from GMGN, and only when the user
 * was on gmgn.ai (its API is same-origin). On pump.fun, DEXTools and the whole
 * live feed the honeypot check was permanently "not checked". Jupiter routes
 * across every Solana venue (incl. pump.fun curves, PumpSwap, Raydium, Meteora,
 * Orca), so a quote for selling the user's reference position → SOL answers
 * both "is there an exit?" and "what does my own sell do to the price?".
 *
 * Deliberately conservative: only POSITIVE evidence is reported. "No route"
 * comes back as an HTTP error → null → unknown, never "honeypot" — a pool
 * Jupiter hasn't indexed yet must not be branded a scam.
 */

import { JUPITER, MOCK_MODE } from '../config.ts';
import { asNumber, fetchJson } from './http.ts';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SellQuote {
  /** Price impact of selling `sizeUsd` worth, in percent (0–100). */
  priceImpactPct: number;
  sizeUsd: number;
}

/**
 * Quote a sell of `sizeUsd` worth of `mint` into SOL. Needs the token's price
 * (to size the order) and decimals (to express it in base units). null on any
 * missing input, no route, or failure.
 */
export async function fetchSellQuote(
  mint: string,
  priceUsd: number | null,
  decimals: number | null,
  sizeUsd: number,
): Promise<SellQuote | null> {
  if (MOCK_MODE || !JUPITER.enabled) return null;
  if (priceUsd === null || !(priceUsd > 0) || decimals === null || decimals < 0 || decimals > 18) return null;

  const raw = rawAmountFor(sizeUsd, priceUsd, decimals);
  if (raw === null) return null;

  const url =
    `${JUPITER.quoteUrl}?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${raw}` +
    `&slippageBps=${JUPITER.slippageBps}&swapMode=ExactIn`;
  const json = await fetchJson(url);
  return parseSellQuote(json, sizeUsd);
}

/** Order size in base units as an integer string (BigInt-safe), or null. */
export function rawAmountFor(sizeUsd: number, priceUsd: number, decimals: number): string | null {
  const tokens = sizeUsd / priceUsd;
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  // Scale via string math so 18-decimal tokens don't overflow a double.
  const [whole, frac = ''] = tokens.toFixed(Math.min(decimals, 12)).split('.');
  const digits = (whole + frac.padEnd(decimals, '0').slice(0, decimals)).replace(/^0+/, '');
  return digits.length > 0 ? digits : null;
}

/**
 * Jupiter v1 quote → our shape. `priceImpactPct` is a decimal FRACTION as a
 * string ("0.0123" = 1.23%). A body without `outAmount`/`routePlan` is not a
 * route; nothing is inferred from it.
 */
export function parseSellQuote(json: unknown, sizeUsd: number): SellQuote | null {
  if (!json || typeof json !== 'object') return null;
  const q = json as { outAmount?: unknown; priceImpactPct?: unknown; routePlan?: unknown };
  const out = asNumber(q.outAmount);
  if (out === null || out <= 0 || !Array.isArray(q.routePlan) || q.routePlan.length === 0) return null;
  const frac = asNumber(q.priceImpactPct);
  if (frac === null || frac < 0) return null;
  return { priceImpactPct: Math.min(100, Math.round(frac * 1000) / 10), sizeUsd };
}
