# CRYPTO-KING — Accuracy Fix Prompt

Paste this into a coding session that has **live internet + a browser with DevTools**
(or where you can paste real API responses). This is the work needed to make every
displayed value match the source sites exactly.

---

## Context

CRYPTO-KING is a Manifest V3 Chrome extension (TypeScript, esbuild) that scans Solana
meme coins on GMGN.AI / pump.fun / DexScreener and shows a risk grade, rug verdict,
price, market cap, liquidity, and holder data.

**The core accuracy problem:** the data-source parsers (field names, endpoint paths,
number scaling) were written from assumptions and were NEVER verified against real API
responses. So values can be wrong, missing, or mis-scaled versus what the sites show.
The scoring/grade logic is unit-tested and sound; the **data ingestion** is what needs
verification and correction.

**Do NOT change the scoring model or UI framing.** Only fix data accuracy.

---

## Method (do this for EACH source)

1. **Capture a real response.** Open the site, open DevTools → Network → filter Fetch/XHR,
   find the JSON call for a known coin, and copy the actual response body. (Or hit the API
   directly with `curl`.)
2. **Compare field-by-field** against the parser and fix the exact key paths + scaling.
3. **Verify the displayed number equals the site's number** for 3–5 real coins across the
   range (fresh <$10k, mid ~$100k, graduated >$1M).

Add a debug switch first so you can see what each source actually returned:

- In `config.ts` add `export const DEBUG = true;`
- In `lib/http.ts` `fetchJson`, when `DEBUG`, `console.log` the URL + parsed JSON.
- In `background/service-worker.ts` `doAnalyze`, when `DEBUG`, `console.log` the merged
  `TokenAnalysis` before scoring.
- Read these logs in the **service-worker console** (`chrome://extensions` → CRYPTO-KING →
  "service worker") while scanning real coins. This is how you pin every mismatch.

---

## Source 1 — pump.fun  (`lib/pumpfunClient.ts`)  ← most important for fresh coins

Endpoint: `GET https://frontend-api-v3.pump.fun/coins/{mint}` and
`/coins?offset=…&limit=…&sort=created_timestamp&order=DESC&includeNsfw=false`

Verify against a real coin object:
- `usd_market_cap` vs `market_cap` — which is USD? Use the USD one for `marketCapEur`
  (now USD). Confirm it matches the site's "MC".
- `total_supply` scaling in `derivePriceEur()` — the `>1e12 ? /1e6` heuristic is a GUESS.
  Check the real `total_supply` and `decimals` and compute
  `price = usd_market_cap / (total_supply / 10**decimals)`. Confirm price matches the site.
- `created_timestamp` — ms or seconds? (age must be correct).
- `complete` (graduated?), `is_banned`, `token_program`, `creator`,
  `bonding_curve` / `associated_bonding_curve` / `pool_address`, `reply_count`,
  socials (`twitter`/`telegram`/`website`).

## Source 2 — Solana RPC  (`lib/solanaClient.ts`)  ← authoritative on-chain

Endpoint: JSON-RPC at `SOLANA.rpcUrl` (+ failover pool).
- `getAccountInfo` jsonParsed → `mintAuthority`/`freezeAuthority` (null = revoked),
  Token-2022 `extensions` (transferFeeConfig, permanentDelegate, transferHook,
  defaultAccountState, nonTransferable). Verify against a Token-2022 coin.
- **Holder concentration for MIGRATED coins:** `getTokenLargestAccounts` returns token
  ACCOUNTS; owners are resolved and pool/burn authorities excluded via
  `SOLANA.knownPoolAuthorities` + `burnAddresses`. Post-graduation LP sits in a
  Raydium/PumpSwap vault whose authority is likely NOT in the list → it reads as a
  fake "whale". **Add the current Raydium AMM v4 + PumpSwap pool authorities** so migrated
  coins' LP is excluded. Verify top-10 % matches GMGN's "Top 10".
- `getTokenSupply` uiAmount for supply.

## Source 3 — GMGN  (`lib/gmgnClient.ts`)  ← only works on gmgn.ai (same-origin cookies)

Endpoints in `config.GMGN.endpoints` (security_launchpad, token_info, token_preview,
fee_distribution, recommend_slippage, top_buyers). These are UNVERIFIED.
- On gmgn.ai, capture each real response and fix the `pick()` key-path lists in
  `parseGmgn()` (field names drift often).
- Verify `renounced_mint`/`renounced_freeze_account`, `burn_status`/`burn_ratio`/
  `lock_summary` → LP status, `top_10_holder_rate` scaling (0–1 vs 0–100),
  `is_honeypot`, taxes, `mc`, `price`, `holder_count`, `creation_timestamp`.
- If an endpoint path 404s, re-capture the current path from Network.

## Source 4 — DexScreener  (`lib/dexscreenerClient.ts`)  ← established/migrated coins

- `token-profiles/latest/v1` → fresh Solana addresses.
- `latest/dex/pairs/solana/{pairs}` → confirm `baseToken.address` and that price/mcap/
  liquidity fields exist; consider using DexScreener's `priceUsd`, `marketCap`,
  `liquidity.usd` directly for graduated coins (more reliable than deriving).

---

## Currency

Already switched to native USD (`EUR_PER_USD = 1`, `$` symbols). The `…Eur` field-name
suffix is now historical — optionally rename `marketCapEur`→`marketCapUsd`, `priceEur`→
`priceUsd`, `liquidityEur`→`liquidityUsd` across `lib/types.ts` + usages for clarity.

---

## Acceptance criteria

For 5 real coins spanning fresh→graduated, scanned live:
1. Market cap, price, and liquidity shown in the card/feed **match the site's numbers**
   (within rounding).
2. Mint/freeze authority, LP status, and top-10 % **match GMGN's audit panel**.
3. A known honeypot/rug reads **🚩 RUG POTENTIAL: HIGH**; a known clean graduated coin
   reads a plausible mid/high grade — not "40% MIXED / NO DATA".
4. No coin shows "NO DATA" when the sites clearly have data (means a parser/endpoint is
   broken — fix via the DEBUG logs).
5. `npm run typecheck` clean and `npm test` green after changes.

Fix data mappings only; keep the risk model, King Grade ceilings, gem gate, and honest
framing ("not a buy signal", "unknown ≠ safe") intact.
