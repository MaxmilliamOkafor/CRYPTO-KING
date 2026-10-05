# CRYPTO-KING 👑

**Read-only Solana meme-coin risk scanner** — a Chrome extension (Manifest V3, TypeScript) that overlays a color-coded risk score directly on [GMGN.AI](https://gmgn.ai) token pages (and pump.fun coin pages).

> ⚠️ **Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice.**

## What it is (and is not)

- ✅ Risk **information**: on-chain authority checks, LP status, holder concentration, honeypot signals, behavioral red flags — distilled into one **King Grade (0–100%, higher = better)** with human-readable reasons.
- ✅ **Read-only**: no private keys, no wallet connections, no transaction signing, no auto-trading. Ever.
- ❌ Not a signal service. A high King Grade means *"passed every audit we can run"*, never "buy". **Passing the audit ≠ safe.**

## Quick start (live data, no build, no keys, no setup)

The repo ships with a pre-built **`dist/`** folder running in **live mode** — real GMGN / pump.fun / Solana-RPC data out of the box:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the **`dist/`** folder — ⚠️ **NOT the repo root**. The root contains the TypeScript sources; Chrome can only run the bundled JavaScript in `dist/`. (Loading the root gives *"Could not load javascript 'content/content.js'"*.)
4. Go to **gmgn.ai**, **pump.fun**, or **dextools.io** (Solana pages). Two things happen:

   **Two scores, both higher = better:** 🌱 **launch score** for coins that haven't been fully scanned yet (socials, fair launch, curve speed — what's actually knowable in a coin's first minutes) and 👑 **King Grade** once the full audit has run. (Showing an audit grade on unaudited coins made every fresh launch read "50% MIXED" — and, through a non-monotonic cap, graded coins with *more* positive signals *lower*. Both fixed.)

   **⭐ Inline badges — the main experience.** Every Solana coin listed on the page gets a small colored **`👑 score SIGNAL`** chip injected right next to it, scanned automatically as rows appear (infinite scroll included). You see risk *in place* while browsing — no panel needed. `*` on a chip = holders/LP not verified yet; hover for the top reason; **click a chip** for the full breakdown. On DEXTools, pair links are batch-resolved to token mints via DexScreener first. Badges fill in progressively (the free public RPC bounds the scan rate — a Helius key speeds this up a lot). Tunables: `config.ts → INLINE_BADGES`.

   **👑 The panel** (bottom-right crown button) adds the deep-dive views:
   - **🔴 Live new launches (real-time, automatic):** the top of the panel runs a self-refreshing feed — the background worker pulls the newest coin launches (pump.fun API, DexScreener fallback) and risk-scores each one every ~15s, no clicking. Feed scans are *lite* (mint/freeze authority — the #1 rug check — plus pump.fun data) so the sweep keeps up on the free public RPC; **clicking a coin upgrades it to the full scan** (holders, LP, taxes…). Tick **"hide risky"** to surface only fresh launches grading **MIXED or better** (King Grade ≥ `LIVE_FEED.safeMinGrade`) that aren't already dead/dumping. Works on **any** page (gmgn, pump.fun, dextools) because it pulls from an API, not the page's DOM. Tunables live in `config.ts → LIVE_FEED`; with a free Helius key you can raise `scanBudgetPerPoll` for a faster sweep.
   - **🔔 Desktop notifications:** when a fresh launch clears the internal risk gate (`LIVE_FEED.notifyMaxScore`, with the on-chain authority checks completed), you get a desktop notification — click it to open the coin on GMGN. So you don't have to watch the panel. Toggle via `LIVE_FEED.notifyLowRisk`; the copy always says "lower observed risk ≠ safe", never "buy".
   - **👑 King Grade (0–100%)** — the one number on every coin: **100% = passed every audit we can run, 0% = confirmed danger.** Composite of safety (50%), quality (30%) and **audit coverage (20%)** — unknowns actively lower the grade, so a coin cannot look good just because it wasn't scanned deeply. Strict hard caps: confirmed trap mechanics → **≤10%**, risk 60+ → **≤15%**, still on bonding curve → **≤40%**, holders/LP unverified → **≤50%**, background check not passed → **≤79%** (so **80%+ = verified gem-grade only**). Buckets: GEM GRADE ≥80 · STRONG ≥60 · MIXED ≥40 · WEAK ≥20 · AVOID <20. Shown on feed rows, inline chips (`👑 56%`), the card (with "why the grade is capped"), popup and notifications. A high grade means "survived the audit" — still not a profit promise.
   - **💎 Gem alerts (two-axis screening):** every coin gets a second score — **Quality (0–100)**: observed positive signals (smart money accumulating, LP burned/locked, both authorities revoked, healthy distribution, real holder base, genuine liquidity depth, organic volume, bonding-curve graduation, survival milestones; `lib/qualityScorer.ts`, weights in `QUALITY_WEIGHTS`). Feed coins that pass the **full 💎 background check** (`lib/gemCriteria.ts` — mint & freeze authority *proven* revoked, no Token-2022 traps or live fee authority, not a honeypot, graduated off the bonding curve, LP burned/locked, no whale or dev bag over the cap, holders/LP/creator-history actually verified, and **not already dead or dumping**) pulse **gold with a 💎** so you can't miss them; if the panel is collapsed, the crown button pulses with an unseen-count bubble. Feed filters: **low caps only** (≤ $100k, tunable — early-stage hunting), **hide risky**, and a **🏆 sort** by best grade. *Quality is a research-ranking aid, not a profit prediction — coins with perfect signals still go to zero.*
   - **👁 Watchlist — post-entry rug alerts:** the pre-buy scan can't see a dev who dumps tomorrow. Open any coin and hit **"👁 Watch"** — the background re-scans it every ~5 minutes (chrome alarm, survives browser restarts) and fires a **🚨 desktop alert the moment rug conditions develop**: LP loses its burn/lock, liquidity down ≥50%, market cap down ≥60%, **dev wallet selling**, or King Grade collapsing ≥20 points. Each alert fires once; the panel's "Watching" list shows live grade + liquidity drift per coin. Max 10 coins (full scans are RPC-heavy); thresholds in `config.ts → WATCHLIST`.
   - **💀 Already-rugged detection on every coin, every sweep:** the live feed batch-loads DexScreener market data (30 coins per request) so liquidity, price change and buy/sell flow are checked for *every* feed coin — and re-checked each sweep, so a coin that rugs after it was first scanned drops to DEAD/DUMPING instead of keeping its old grade.
   - **↩ Live sell check (keyless):** full scans ask Jupiter for a sell *quote* (read-only — never a swap) of your reference position, so "is there an exit, and what does selling cost right now?" is answered on every site, not only gmgn.ai. "No route" is reported as *unknown*, never as a honeypot.
   - **🏊 Pools aren't whales:** holder concentration counts only real wallets. Pool vaults, bonding curves and escrows are recognised by the *program* that owns them, so PumpSwap/Meteora/Orca liquidity no longer shows up as "a single wallet holds 70%".
   - **🌱 Gem tracker — get in at launch, then hold with protection:** for the "buy it early at a low cap, hold it while the community grows" strategy. Every live-feed launch gets a cheap prelim score; the best few get a full background check; launches with strong early evidence **at ≤ $300k market cap** are tracked automatically from that moment (or hit **🌱 Track** on any coin). Then it keeps watching for you:
     - **Early Conviction (0–100%)** — *community signals* (Telegram/X/website: the strongest launch predictor, 8.9–17.4× graduation; replies; holders), *fair launch* (no dev bag, whale or sniper cluster; creator's track record), *organic momentum* (bonding-curve speed or graduation, breadth of buyers, not already dumped from its peak — 82.6% of fast pumps are artificial), *holder conviction* (new holders per hour vs. the 50–100/h early winners show; did the community hold through its first dip?).
     - **Stages:** 🌱 SEED (< 24h) → 🌿 SPROUT (1–3 days) → 🌳 ROOTED (3+ days, judged by the long-hold screen).
     - **Alerts:** spotted · 🎓 graduated · survived day 1 · 🌳 rooted · 🚀 2×/5×/10×/25×/100× since spotted · holders doubled — and the ones that protect a holder: **✂ thesis broken** (dev/whale/sniper bag, rug mechanics, dead) · 📉 dumping now · 👋 holders leaving · ⚠ −60% from peak.
     - **The honest wallet number:** the dashboard's *"If you'd bought every gem at first sight"* table — the same amount into every pick, measured at 1, 7 and 30 days, **losers included** (dropped coins keep being priced). If that number stays below 1×, the picks aren't working.
     - *At launch there's little evidence: ~80% of coins die within 48h and even launches with all three socials graduate only ~1.9% of the time. The tracker narrows the field and protects the hold — it can't pick winners. Small, equal sizes across several picks.*
   - **🏔 Young-gem radar — continuous, 1–21 days old, under $5M, best first:** scans **every minute, panel open or not**. Every new pool on Solana (each graduation/listing) is captured as it happens and revisited once it has survived a day; GeckoTerminal's short-window trending (1h/6h/24h) and DexScreener's paid profiles/boosts add more. Every watched coin gets a cheap quick screen (30 per request: age, cap, liquidity depth, wash volume, dumping), the best-ranked get a full deep check (4/minute ≈ 240/hour), and **only coins that pass are shown** — rejected ones sit behind a toggle. Old/big coins that already ran (e.g. 54 days, $167M) are excluded by design. Coins under 3 days are judged by early conviction, 3+ days by "Staying Power" below; the best finds are tracked automatically.
   - **🏔 "Staying Power" (research-based):** for coins you might HOLD for weeks/months, the way early PEPE/BONK/WIF holders did. On every coin's card: a 🏔 verdict with a 6-pillar breakdown. Scored 0–100% (higher = better) from what the research shows separates survivors from the ~95% that die:
     - **Survival (20):** 68.7% of pump.fun coins die on launch day, 80% within 48h, only 4.55% reach 90 days ([CoinGecko, 18.6M tokens](https://www.coingecko.com/research/publications/average-lifespan-of-pumpfun-tokens)). Under 3 days old → ⏳ TOO EARLY.
     - **Community (15):** Telegram = 8.9× graduation rate; X + Telegram + website = 17.4× ([survival analysis of 832,941 launches](https://arxiv.org/abs/2607.02823)). Plus holder count and holder GROWTH (tracked by the extension itself over time).
     - **Fair distribution (20):** whale dominance is a core measured fragility dimension ([ME2F](https://arxiv.org/html/2512.00377v1)). Pools are excluded structurally.
     - **Liquidity (15):** burned LP, depth vs market cap.
     - **Organic demand (15):** 82.6% of 100%+ gainers showed *artificial* growth — wash trading or LP-based price inflation ([USENIX Security '26](https://arxiv.org/abs/2507.01963)). So: unique buyers (not raw volume), volume ÷ liquidity in a sane band, volume persisting week over week, and "big pump on thin volume" is penalised.
     - **Price resilience (15):** from 90 days of daily candles — higher lows, recovered from a crash (BONK fell 96% and came back; the crash isn't the problem, staying down is), volatility calming, not a death spiral.
     - **Hard disqualifiers** (⛔ NOT A HOLD, whatever the score): already dead/dumping, live mint/freeze authority, open rug vector, pullable LP, a wallet > 5% or dev > 5%, top-10 > 40%, volume > 10× liquidity (wash trading), death spiral, serial deployer. Over $250M → 📈 ALREADY BIG.
     - **Its own report card** (dashboard): every verdict is re-checked at 7 and 30 days. If 🏔 CANDIDATE coins don't outlive WEAK ones, don't trust the radar.
     - Data: [GeckoTerminal](https://www.geckoterminal.com) public API (keyless; daily OHLCV, holders, unique buyers/sellers, trending pools). *This improves the odds of durability; it cannot pick the next PEPE — thousands of coins had PEPE's early traits and still died.*
   - **🔥 LP status everywhere (not just gmgn.ai):** graduated pump.fun coins are marked LP-burned (pump.fun burns migration LP — PumpSwap since March 2025, Raydium before), and RugCheck's keyless summary fills the rest. Previously LP was "unknown" off gmgn.ai, which capped every grade at 50%.
   - **👨‍💻 Dev-wallet holdings:** full scans match the creator's wallet against the top holders — "Dev holds 12%" is a risk factor (+10 at ≥5%), blocks gem grade above 10%, and its *decrease* over time is the watchlist's dev-selling alert.
   - **🧠 Persistent creator memory:** every deployer-history lookup is remembered (`chrome.storage`, last 500 creators), so a serial rugger — or a proven creator — is recognized instantly on their next launch even when the launchpad endpoint is down.
   - **🛡 Modern rug-trick detection (Token-2022 traps):** the on-chain scan reads the current generation of scam mechanics from the mint account itself — **permanent delegate** (dev can seize tokens out of your wallet, +30), **non-transferable/soulbound** (you can't sell, +30), **default-frozen accounts** (+25), **transfer hooks** (programmable sell-blocking, +20) — plus **serial-deployer detection** via pump.fun launch records (creator with many dead prior launches, +15).
   - **On a token page** (e.g. `gmgn.ai/sol/token/<ADDRESS>`) it auto-scans and shows the grade, an **already-rugged / can-it-still-rug-me** banner, the top risk reason and a **Details** breakdown.
   - **On trending / new-pairs / any list page** it **auto-scans every coin linked on the page** and lists them **best-first** under "Coins linked on this page" — each with its King Grade % and band badge (GEM GRADE / STRONG / MIXED / WEAK / AVOID) and top warning. A status line summarises `⚠ N high-risk` and `👥 N possible copycats`. Click any row for the full breakdown, or paste an address into the **Scan** box.
   - **Copycat / replica detection:** when two or more coins on the page share the same ticker/symbol on different mints (a classic rug pattern — e.g. a swarm of identical `W26`/`boing` tokens), each is tagged **COPYCAT?** so you can steer clear of impostors of a trending coin.
   - The **–** button collapses it back to the crown; click the crown to reopen.

   > This is a **risk / scam detector, not a buy-signal service.** It warns you about dangerous coins and copycats; it never says a coin is a "good buy." Even a 100% King Grade coin can go to zero — the grade measures *audits passed*, not *odds of profit*.

The toolbar icon and the dashboard (history + manual P&L journal) are optional extras — the main experience is the on-page panel. Any check that can't be answered live shows under "Not checked (data unavailable)" rather than being guessed (e.g. metadata mutability needs a free Helius RPC key — see below). To demo with fixtures instead, set `MOCK_MODE = true` in `config.ts` and rebuild.

> **Note on coverage:** on **gmgn.ai** you get the full picture (GMGN's own security data + on-chain RPC + pump.fun). On **pump.fun** and **dextools.io**, GMGN's Cloudflare-protected API only answers requests from gmgn.ai itself, so those pages fall back to the **authoritative on-chain checks via Solana RPC** (mint authority, freeze authority, Token-2022 fees, holder concentration) plus pump.fun data — the core Solana rug surface — and mark GMGN-only fields as unavailable.

If you edit any source file (including `config.ts`), rebuild `dist/` and hit ↻ reload on the extension card:

```bash
npm install
npm run build     # bundles into dist/
npm test          # unit tests (scoring, rug checks, long-hold model, parsers)
npm run test:e2e  # real extension in Chromium + fake market: radar, and a launch spotted → graduates 5× → dev dumps → dropped
```

Mock mode (opt-in) ships three fixture tokens — **RUGKING** (90 → AVOID), **WIFCAT** (45 → WATCH), **QUOKKA** (0 → NEUTRAL) — and deterministically maps any real address you browse onto one of them. See `mock/fixtures.ts` for the worked point-by-point walkthroughs.

## Data sources (all configured in `config.ts`)

### 1. GMGN endpoints (already pre-filled)

The six internal GMGN paths in `config.GMGN.endpoints` were captured live from DevTools → Network and are pre-filled:

| Endpoint | Provides |
|---|---|
| `mutil_window_token_security_launchpad` | `renounced_mint`, `renounced_freeze_account`, `burn_ratio`/`burn_status`, `top_10_holder_rate`, `is_honeypot`, `is_blacklist`, buy/sell/average tax, `lock_summary` |
| `token_info` | `holder_count`, `liquidity`, `creation_timestamp`, supply |
| `live/token_preview` | `mc`, `symbol`, `name`, socials |
| `token_fee_distribution` | `fee_authority`, royalty bps (Token-2022 fees) |
| `recommend_slippage` | `recommend_sell_slippage`, `has_tax` |
| `top_buyers` | `top_10_holder_rate`, `top70_sniper_hold_rate`, smart-money counts |

These are **undocumented and can change without notice**. If calls start failing:
open gmgn.ai → DevTools → **Network** (filter Fetch/XHR) → open a token page → copy the failing endpoint's new path/params into `config.GMGN.endpoints` / `commonParams` (they're tracking params, not auth). Field-name drift is handled in one place: the `pick()` path lists in `lib/gmgnClient.ts`.

### 3. Solana RPC / Helius key (recommended)

The public RPC works but is rate-limited, and **metadata mutability requires a DAS-capable RPC** (otherwise it's honestly reported as "unknown"):

```ts
rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=YOUR_FREE_KEY',
```

Get a free key at [helius.dev](https://www.helius.dev). On-chain RPC data is **authoritative** — it overrides GMGN for mint/freeze authority and Token-2022 fees.

### 4. Optional adapters

- **pump.fun** (`config.PUMPFUN`, on by default in live mode): enriches fresh launches via `frontend-api-v3.pump.fun/coins/<mint>` — age, bonding-curve state, Token-2022 detection, socials. Non-pump mints 404 harmlessly.
- **RugCheck** (`config.RUGCHECK`, **off** by default): implement/verify against their current API spec, then set `enabled: true`. The `AuditAdapter` interface in `lib/rugcheckClient.ts` is the contract for plugging in any auditor.
- **Deployer history** (`lib/deployerClient.ts`): intentionally a stub returning honest unknowns — see the file header for why and how to plug in a reputational data source.

If you change any endpoint host, also add it to `host_permissions` in `manifest.json`.

## Tuning the risk model

All weights and thresholds are in `config.ts` (`WEIGHTS`, `LIMITS`, `SIGNAL_THRESHOLDS`, `MITIGATION_CAP`) and are read at call time — edit, `npm run build`, reload the extension. The scorer (`lib/riskScorer.ts`) is a pure function; `npm test` pins the fixture walkthroughs, so a weight change that shifts a fixture across a signal boundary fails loudly.

Internal risk bands (`Signal`): **≥80 AVOID** · **60–79 HIGH_RISK** · **40–59 WATCH** · **20–39 CONSIDER** · **<20 NEUTRAL**.

> ⚠️ `Signal` and `riskScore` run the **opposite** direction to everything the user sees (higher = worse). They are **internal only** — deliberately not exported with any display metadata. Every user-facing label, colour and percentage comes from the King Grade helpers in `lib/kingGrade.ts` (`gradeLabel` / `gradeColors` / `gradeBlurb`, bands in `GRADE_META`), where **higher = better**. Mixing the two directions in one screen is the single worst UX bug this project has had; `npm test` now guards against it.

Key principles baked into the scorer:

- **Solana-correct risk surface**: mint authority (supply inflation), freeze authority (Solana's honeypot/blacklist equivalent), Token-2022 transfer fees + live fee authority, metadata mutability, LP burned/locked/deployer-held — not EVM concepts.
- **Nulls never score.** Anything unfetchable becomes a "Not checked" data gap in the UI. If mint + market + holders are *all* missing, no score is shown at all ("data unavailable") — the tool never fakes confidence.
- **Mitigations are capped at −15** so no amount of smart-money hype can whitewash an active mint authority.

## Architecture

```
CRYPTO-KING/
├── manifest.json               MV3 manifest (dist/ mirrors these paths)
├── config.ts                   MOCK_MODE, endpoints, weights, thresholds, EUR display
├── build.mjs                   esbuild bundle → dist/ (+ generated icons)
├── background/service-worker.ts  the ONLY place network calls happen; aggregates,
│                                 merges (RPC > GMGN > pump.fun), scores, caches,
│                                 persists recent tokens
├── content/content.ts          address detection (URL → DOM fallback), SPA watcher,
│                               shadow-DOM overlay (style-isolated, dismissible)
├── popup/                      full breakdown: badge, score bar, reasons, metrics
│                               grid, data gaps, links, permanent disclaimer
├── dashboard/                  recent-tokens table w/ filters + manual P&L journal
├── lib/
│   ├── riskScorer.ts           pure scoring function (unit-tested)
│   ├── gmgnClient.ts           GMGN adapter — real endpoints, defensive parsing
│   ├── solanaClient.ts         RPC/Helius: authorities, Token-2022, top holders
│   ├── pumpfunClient.ts        pump.fun v3 API adapter (secondary source)
│   ├── rugcheckClient.ts       optional auditor adapter (stub, off by default)
│   ├── deployerClient.ts       deployer-history adapter (intentional stub)
│   ├── http.ts                 rate-limited fetch (per-host), JSON-RPC, pick()
│   └── types.ts                shared domain model
├── mock/fixtures.ts            AVOID / WATCH / NEUTRAL fixtures + walkthroughs
└── test/riskScorer.test.ts     plain-assert unit tests (npm test)
```

Rules the code enforces: all network I/O in the background worker (never content scripts); per-host rate limiting; graceful degradation to "data unavailable"; overlay in a closed shadow root on a fixed-position host so GMGN's layout can't break.

## Pushing to GitHub

From the project root:

```bash
git init
git add .
git commit -m "CRYPTO-KING: Solana meme-coin risk scanner extension"
git remote add origin https://github.com/MaxmilliamOkafor/CRYPTO-KING.git
git push -u origin main
```

(If the remote already has commits, `git pull --rebase origin main` first.)

## Development

```bash
npm run watch      # rebuild bundles on change (reload extension to pick up)
npm run typecheck  # tsc --noEmit
npm test           # riskScorer unit tests
```

## Disclaimer

Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice. Use of GMGN/pump.fun data must comply with those sites' terms of service; this extension only reads data the sites already serve to your browser, rate-limited, for your personal analysis.
