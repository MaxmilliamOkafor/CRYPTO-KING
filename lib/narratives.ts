/**
 * lib/narratives.ts — narrative/trend tag matcher, pure and unit-testable.
 *
 * Matches token name/symbol against config.TRENDING_NARRATIVES and returns the
 * matched narrative names. INFORMATIONAL ONLY — deliberately worth zero score
 * points: naming a coin "AI-TRUMP-DOGE" is free, and copycat scammers do
 * exactly that to ride trends. The tag tells the user what wave a coin is
 * riding; it never makes the coin look safer or better.
 */

import { TRENDING_NARRATIVES } from '../config.ts';

export function matchNarratives(
  name: string | null,
  symbol: string | null,
  table: Record<string, string[]> = TRENDING_NARRATIVES,
): string[] {
  const haystack = `${name ?? ''} ${symbol ?? ''}`.toLowerCase();
  if (haystack.trim() === '') return [];
  const out: string[] = [];
  for (const [narrative, keywords] of Object.entries(table)) {
    if (keywords.some((kw) => haystack.includes(kw.toLowerCase()))) out.push(narrative);
  }
  return out;
}
