/**
 * test/e2e.mjs — END-TO-END test of the real extension in Chromium.
 *
 *   npm run build && npm run test:e2e
 *
 * Loads dist/ as an unpacked extension, replaces `fetch` INSIDE the background
 * worker with realistic fake responses for every API (Solana RPC, DexScreener,
 * GeckoTerminal, pump.fun, RugCheck, Jupiter), opens a token page and runs the
 * long-hold radar — so every layer (data clients → merge → scoring → shadow-DOM
 * UI → storage → alarms) runs exactly as on a real machine, offline.
 *
 * The fake market: one 30-day survivor (pool holds 30% of supply, LP burned
 * by pump.fun graduation, survived a 67% crash), one wash-traded coin and one
 * 1-day-old coin. Fails (exit 1) on any page/worker error or a wrong verdict.
 * Needs Playwright + Chromium (preinstalled in Claude Code cloud sessions).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-e2e-'));
const errors = [];
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
await ctx.route('https://gmgn.ai/**', (r) => {
  const u = r.request().url();
  if (/\/api\/|\/defi\//.test(u)) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  return r.fulfill({ contentType: 'text/html', body: '<html><body><h1>fake gmgn token page</h1></body></html>' });
});
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
sw.on('console', (m) => { if (m.type() === 'error') errors.push('SW: ' + m.text()); });

// ── Install a fake network INSIDE the extension's background worker ──────────
await sw.evaluate(() => {
  const now = Date.now();
  const DAY = 86_400_000;
  const M = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const P = '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj';
  const W = 'WashCoin1111111111111111111111111111111111';
  const WP = 'WashPoo1111111111111111111111111111111111';
  const Y = 'YoungCoin111111111111111111111111111111111';
  const YP = 'YoungPoo111111111111111111111111111111111';
  const PDA = 'PoolPdaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, 'z');
  const SYS = '11111111111111111111111111111111';
  const PUMPSWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
  // ── 🌱 Seed scenario (mutable from the test via globalThis.__sc) ──
  const S = 'SeedCoin111111111111111111111111111111111';
  const SP = 'SeedPoo1111111111111111111111111111111111';
  const CURVE_ATA = 'CurveAtazzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA';
  const CURVE_PDA = 'CurvePdazzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA';
  const SEED_VAULT = 'SeedVauzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA';
  const DEV_ATA = 'DevAtazzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA';
  const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  const sc = (globalThis.__sc = { graduated: false, devPct: 0.5 });
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const wallet = (i) => `Hodr${'z'.repeat(36)}${alpha[i]}`;
  const tokAcct = (i) => `Tacc${'z'.repeat(36)}${alpha[i]}`;
  const VAULT = `Vau${'z'.repeat(37)}A`;
  const walletPcts = [1.8, 1.5, 1.2, 1.0, 0.9, 0.8, 0.8, 0.7, 0.6, 0.6, 0.5, 0.5, 0.4, 0.4, 0.4, 0.3, 0.3, 0.3, 0.3];
  const closes = [1,1.5,2.2,3,4,5,4.8,4,3,2.2,1.8,1.9,2.1,2.3,2.4,2.6,2.8,3.0,3.1,3.3,3.4,3.5,3.7,3.8,3.9,4.0,4.1,4.2,4.3,4.4].map((c) => c * 0.001);
  const candles = closes.map((c, i) => [Math.floor((now - (29 - i) * DAY) / 1000), i ? closes[i - 1] : c, c * 1.05, c * 0.95, c, 120000]).reverse();
  const pair = (mint, pool, sym, liq, mcap, vol, dexId, ageDays) => ({ chainId: 'solana', dexId, pairAddress: pool,
    baseToken: { address: mint, symbol: sym, name: sym }, priceUsd: '0.0044', marketCap: mcap, fdv: mcap,
    liquidity: { usd: liq }, volume: { h24: vol }, priceChange: { m5: 0.1, h1: 1.2, h6: 3, h24: 5 },
    txns: { h1: { buys: 120, sells: 90 } }, pairCreatedAt: now - ageDays * DAY });
  const PAIRS = { [M]: pair(M, P, 'SURV', 600000, 4400000, 420000, 'pumpswap', 30),
                  [W]: pair(W, WP, 'WASH', 50000, 900000, 1500000, 'raydium', 10),
                  [Y]: pair(Y, YP, 'YNG', 80000, 700000, 60000, 'pumpswap', 1) };
  const gtPool = (mint, pool, name, ageDays, liq, mcap, vol, buyers, sellers) => ({ id: `solana_${pool}`, type: 'pool',
    attributes: { address: pool, name, pool_created_at: new Date(now - ageDays * DAY).toISOString(), reserve_in_usd: String(liq),
      market_cap_usd: String(mcap), fdv_usd: String(mcap), volume_usd: { h24: String(vol) },
      transactions: { h24: { buys: buyers * 2, sells: sellers * 2, buyers, sellers } } },
    relationships: { base_token: { data: { id: `solana_${mint}`, type: 'token' } } } });
  const GT_POOLS = [gtPool(M, P, 'SURV / SOL', 30, 600000, 4400000, 420000, 600, 400),
                    gtPool(W, WP, 'WASH / SOL', 10, 50000, 900000, 1500000, 12, 11),
                    gtPool(Y, YP, 'YNG / SOL', 1, 80000, 700000, 60000, 300, 100)];

  const rpc = (method, params) => {
    const a0 = Array.isArray(params) ? params[0] : null;
    switch (method) {
      case 'getAccountInfo':
        return { value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: { parsed: { type: 'mint', info: { mintAuthority: null, freezeAuthority: null, decimals: 6, supply: '1000000000000000' } } } } };
      case 'getTokenSupply':
        return { value: { amount: '1000000000000000', decimals: 6, uiAmount: 1e9, uiAmountString: '1000000000' } };
      case 'getTokenLargestAccounts': {
        if (a0 === S) {
          // On the curve the curve's ATA holds the unsold supply; after graduation a PumpSwap vault does.
          const pool = sc.graduated ? { address: SEED_VAULT, uiAmountString: String(200_000_000) } : { address: CURVE_ATA, uiAmountString: String(400_000_000) };
          const dev = { address: DEV_ATA, uiAmountString: String(sc.devPct * 10_000_000) };
          return { value: [pool, dev, ...walletPcts.slice(3).map((p, i) => ({ address: tokAcct(i), uiAmountString: String(p * 10_000_000) }))].sort((x, y) => Number(y.uiAmountString) - Number(x.uiAmountString)) };
        }
        return { value: [{ address: VAULT, uiAmountString: String(300_000_000) }, ...walletPcts.map((p, i) => ({ address: tokAcct(i), uiAmountString: String(p * 10_000_000) }))] };
      }
      case 'getMultipleAccounts': {
        const enc = params[1]?.encoding;
        const ownerOf = (acc) =>
          acc === VAULT ? PDA : acc === CURVE_ATA ? CURVE_PDA : acc === SEED_VAULT ? PDA : acc === DEV_ATA ? wallet(21) : wallet(alpha.indexOf(acc.slice(-1)));
        if (enc === 'jsonParsed') return { value: a0.map((acc) => ({ data: { parsed: { info: { owner: ownerOf(acc) } } } })) };
        return { value: a0.map((o) => ({ owner: o === PDA ? PUMPSWAP : o === CURVE_PDA ? PUMP_PROGRAM : SYS, lamports: 1 })) };
      }
      default: return null;
    }
  };
  const route = (url, init) => {
    const u = new URL(url);
    if (u.host === 'api.mainnet-beta.solana.com') {
      const b = JSON.parse(init.body);
      return [200, { jsonrpc: '2.0', id: b.id, result: rpc(b.method, b.params) }];
    }
    if (u.host === 'api.dexscreener.com') {
      if (u.pathname.startsWith('/latest/dex/tokens/')) {
        const mints = decodeURIComponent(u.pathname.split('/').pop()).split(',');
        const live = { ...PAIRS, ...(sc.graduated ? { [S]: pair(S, SP, 'SEED', 60000, 250000, 30000, 'pumpswap', 0.1) } : {}) };
        const ps = mints.map((m) => live[m]).filter(Boolean);
        return [200, { schemaVersion: '1.0.0', pairs: ps.length ? ps : null }];
      }
      if (u.pathname.startsWith('/token-profiles')) return [200, []];
      return [200, { pairs: null }];
    }
    if (u.host === 'api.geckoterminal.com') {
      const p = u.pathname.replace('/api/v2', '');
      if (p.endsWith('/ohlcv/day')) return p.includes(P) ? [200, { data: { attributes: { ohlcv_list: candles } } }] : [404, {}];
      if (p === `/networks/solana/tokens/${S}/info`) return sc.graduated ? [200, { data: { attributes: { holders: { count: 900 }, telegram_handle: 'seed', twitter_handle: 'seed', websites: ['https://seed.example'] } } }] : [404, {}];
      if (p === `/networks/solana/pools/${SP}`) return [200, { data: { attributes: { address: SP, reserve_in_usd: '60000', market_cap_usd: '250000', transactions: { h24: { buyers: 400, sellers: 250 } } }, relationships: { base_token: { data: { id: `solana_${S}` } } } } }];
      if (p.startsWith('/networks/solana/tokens/') && p.endsWith('/info')) {
        return p.includes(M) ? [200, { data: { attributes: { holders: { count: 18200 }, twitter_handle: 'surv', telegram_handle: 'surv', websites: ['https://surv.example'] } } }] : [200, { data: { attributes: { holders: { count: 900 } } } }];
      }
      if (p === '/networks/solana/trending_pools' || p === '/networks/solana/pools') return [200, { data: GT_POOLS }];
      if (p.startsWith('/networks/solana/pools/')) { const pl = GT_POOLS.find((x) => p.endsWith(x.attributes.address)); return pl ? [200, { data: pl }] : [404, {}]; }
      return [404, {}];
    }
    if (u.host === 'frontend-api-v3.pump.fun') {
      if (u.pathname === `/coins/${M}`) return [200, { mint: M, symbol: 'SURV', name: 'Survivor', created_timestamp: now - 30 * DAY, complete: true,
        usd_market_cap: 4400000, total_supply: 1e15, creator: wallet(20), twitter: 'https://x.com/surv', telegram: 'https://t.me/surv',
        website: 'https://surv.example', reply_count: 140, token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', bonding_curve: 'BCurvezzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA' }];
      if (u.pathname === `/coins/${S}`) return [200, { mint: S, symbol: 'SEED', name: 'Seedling', created_timestamp: now - 2 * 3_600_000,
        complete: sc.graduated, real_sol_reserves: sc.graduated ? 0 : 51e9, market_cap: sc.graduated ? 1700 : 300, ath_market_cap: sc.graduated ? 1700 : 320,
        usd_market_cap: sc.graduated ? 250000 : 45000, total_supply: 1e15, creator: wallet(21), king_of_the_hill_timestamp: now - 1_800_000,
        reply_count: 85, twitter: 'https://x.com/seed', telegram: 'https://t.me/seed', website: 'https://seed.example',
        token_program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', bonding_curve: CURVE_PDA, associated_bonding_curve: CURVE_ATA }];
      if (u.pathname === `/coins/user-created-coins/${wallet(21)}`) return [200, [1, 2, 3, 4].map((i) => ({ mint: `Old${i}${'z'.repeat(37)}`, created_timestamp: now - i * 30 * DAY, usd_market_cap: i < 4 ? 900000 : 3000, complete: i < 4 }))];
      if (u.pathname.startsWith('/coins/user-created-coins/')) return [200, []];
      if (u.pathname === '/coins') return [200, [{ mint: S, symbol: 'SEED', name: 'Seedling', created_timestamp: now - 2 * 3_600_000 }]];
      return [404, {}];
    }
    // On the curve RugCheck reports 0% LP locked (there's no pool yet) — the scanner must ignore that.
    if (u.host === 'api.rugcheck.xyz') return [200, { score: 1, risks: [], lpLockedPct: u.pathname.includes(S) ? 0 : 100 }];
    if (u.host === 'lite-api.jup.ag') return [200, { outAmount: '999000', priceImpactPct: '0.0031', routePlan: [{ swapInfo: {} }] }];
    return [404, {}];
  };
  globalThis.__hits = [];
  globalThis.fetch = async (url, init = {}) => {
    const [status, body] = route(String(url), init);
    globalThis.__hits.push(`${status} ${new URL(String(url)).host}${new URL(String(url)).pathname.slice(0, 50)}${init.body ? ' ' + JSON.parse(init.body).method : ''}`);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return 'fake network installed';
}).then(console.log);

// ── 1. Open the token page: full scan → card → long-hold check ────────────────
const M = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('PAGE: ' + e.message));
await page.goto(`https://gmgn.ai/sol/token/${M}`);
const cdp = await ctx.newCDPSession(page);
const shadowText = async () => {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const out = [];
  const walk = (n, sh) => { const inS = sh || !!n.shadowRootType; if (inS && n.nodeType === 3 && n.nodeValue.trim() && !/[{}]/.test(n.nodeValue)) out.push(n.nodeValue.trim()); (n.children ?? []).forEach((c) => walk(c, inS)); (n.shadowRoots ?? []).forEach((c) => walk(c, true)); };
  walk(root, false); return out.join(' | ');
};
let txt = '';
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1000); txt = await shadowText(); if (/Staying Power ·/.test(txt)) break; }
console.log('\n=== TOKEN CARD (shadow DOM text) ===\n' + txt.slice(0, 1500));

// ── 2. Radar sweep, driven exactly like the ↻ button ─────────────────────────
const extId = sw.url().split('/')[2];
const pop = await ctx.newPage();
pop.on('pageerror', (e) => errors.push('POPUP: ' + e.message));
await pop.goto(`chrome-extension://${extId}/dashboard/dashboard.html`);
await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'RUN_RADAR' }));
let radar;
for (let i = 0; i < 90; i++) {
  await pop.waitForTimeout(1000);
  radar = await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_RADAR' }));
  if (radar.ok && !radar.sweeping && radar.rows.length) break;
}
console.log('\n=== RADAR ===');
for (const r of radar.rows) console.log(`  ${String(r.score).padStart(3)}% ${r.tier.padEnd(11)} ${r.symbol}  ${r.ageDays?.toFixed(1)}d  mcap ${r.marketCapUsd}  — ${r.headline}`);
const lh = await pop.evaluate((m) => chrome.runtime.sendMessage({ type: 'GET_LONGHOLD', address: m }), M);
if (lh.ok) { console.log(`\n=== LONG-HOLD DETAIL: ${lh.result.tier} ${lh.result.score}% coreVerified=${lh.result.coreVerified}`);
  for (const p of lh.result.pillars) console.log(`  ${p.label.padEnd(18)} ${p.score}/${p.max} ${p.unknown.length ? '(unverified: ' + p.unknown.join(', ') + ')' : ''}`); }
const an = await pop.evaluate((m) => chrome.runtime.sendMessage({ type: 'ANALYZE_TOKEN', address: m }), M);
console.log('\n=== FULL SCAN FACTS ===');
console.log('  lpStatus:', an.analysis.market.lpStatus, '| largest wallet %:', an.analysis.holders.largestNonLpWalletPct?.toFixed(2), '| top10 %:', an.analysis.holders.top10Pct?.toFixed(2), '| dev %:', an.analysis.holders.devHoldsPct);
console.log('  sellSimulation:', JSON.stringify(an.analysis.market.sellSimulation), '| liquidity:', an.analysis.market.liquidityEur, '| risk reasons:', an.risk.reasons.map((r) => r.text).join(' / ') || 'none');
// ── 3. 🌱 Seed lifecycle: spotted at launch → graduates 5× → dev dumps ────────
const S = 'SeedCoin111111111111111111111111111111111';
const gems = () => pop.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_GEMS' }));
const seedOf = (r) => (r.ok ? r.gems.find((g) => g.address === S) : undefined);
const forceTick = () =>
  sw.evaluate(async () => {
    const d = await chrome.storage.local.get('ck:gems');
    for (const g of d['ck:gems'].gems) g.nextCheckAt = 0;
    await chrome.storage.local.set(d);
    chrome.alarms.create('ck-gems', { when: Date.now() + 50 });
  });
await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_LIVE_FEED' })); // the sweep feeds the spotter
let seed;
for (let i = 0; i < 90 && !seed; i++) { await pop.waitForTimeout(1000); seed = seedOf(await gems()); }
console.log('\n=== 🌱 SEED SPOTTED ===', seed ? `${seed.symbol} stage=${seed.stage} verdict=${seed.verdict} conviction=${seed.score}% spotted at $${seed.spottedMcap}` : 'NOT SPOTTED');
const early = await pop.evaluate((m) => chrome.runtime.sendMessage({ type: 'GET_LONGHOLD', address: m }), S);
if (early.ok) for (const p of early.early.pillars) console.log(`  ${p.label.padEnd(18)} ${p.score}/${p.max}`);
const seedScan = await pop.evaluate((m) => chrome.runtime.sendMessage({ type: 'ANALYZE_TOKEN', address: m }), S);
console.log('  on-curve LP status:', seedScan.analysis.market.lpStatus, '| top10:', seedScan.analysis.holders.top10Pct?.toFixed(1), '| dev:', seedScan.analysis.holders.devHoldsPct);

await sw.evaluate(() => { globalThis.__sc.graduated = true; });
await forceTick();
let grown;
for (let i = 0; i < 90; i++) { await pop.waitForTimeout(1000); grown = seedOf(await gems()); if (grown?.lastMcap === 250000) break; }
console.log('\n=== 🎓 AFTER GRADUATION ===', grown ? `${(grown.lastMcap / grown.spottedMcap).toFixed(1)}× · fired: ${grown.fired.join(', ')}` : '—');

await sw.evaluate(() => { globalThis.__sc.devPct = 12; });
await forceTick();
let dropped;
for (let i = 0; i < 90; i++) { await pop.waitForTimeout(1000); dropped = seedOf(await gems()); if (dropped?.status === 'DROPPED') break; }
console.log('=== ✂ AFTER DEV BUYS/HOLDS 12% ===', dropped ? `${dropped.status} — ${dropped.dropReason}` : '—');
// Headless Chrome has no notification centre (getAll() is always empty), so the
// alert trail is verified through the events the tracker records instead.
console.log('=== TRACKER EVENTS ===\n' + (dropped?.events ?? []).map((e) => `  [${e.tone}] ${e.text}`).join('\n'));

// Panel shows the tracker section (re-open home on the gmgn page).
await page.goto('https://gmgn.ai/trend');
let homeTxt = '';
for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); homeTxt = await shadowText(); if (/SEED|DROPPED/.test(homeTxt) && /Gem tracker/.test(homeTxt)) break; }
console.log('panel gem tracker row:', (homeTxt.match(/Gem tracker[^|]*\|[\s\S]{0,400}/) ?? ['(missing)'])[0].replace(/\s*\|\s*/g, ' | ').slice(0, 400));

const hits = await sw.evaluate(() => globalThis.__hits);
const tally = {}; for (const h of hits) { const k = h.split(' ').slice(0, 2).join(' ').replace(/\/[1-9A-HJ-NP-Za-km-z]{32,44}.*/, '/…'); tally[k] = (tally[k] ?? 0) + 1; }
console.log('\n=== NETWORK CALLS (' + hits.length + ') ===');
for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${String(v).padStart(3)}× ${k}`);
console.log('\nERRORS (' + errors.length + '):'); for (const e of errors) console.log(' -', e.slice(0, 300));
await ctx.close();
fs.rmSync(PROFILE, { recursive: true, force: true });

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
check(errors.length === 0, 'no page/worker errors');
check(/LONG-HOLD CANDIDATE/.test(txt) && /Staying Power ·/.test(txt), 'card shows the long-hold verdict');
check(an.analysis.market.lpStatus === 'burned', 'graduated pump.fun coin → LP burned');
check(an.analysis.holders.largestNonLpWalletPct < 2, 'the pool vault (30%) is NOT counted as a whale');
check(an.analysis.market.sellSimulation?.ok === true, 'Jupiter sell quote fills the sell check');
check(radar.ok && radar.rows.length === 1 && radar.rows[0].symbol === 'SURV', 'radar screens out the wash-traded and 1-day-old coins');
check(lh.ok && lh.result.tier === 'CANDIDATE', 'survivor is a long-hold CANDIDATE');
check(seed && seed.stage === 'SEED' && seed.spottedMcap === 45000, 'fresh $45k launch is auto-spotted as a SEED from the live feed');
check(seed && seed.verdict === 'STRONG', 'seed has STRONG early signals');
check(seedScan.analysis.market.lpStatus === 'unknown', "on-curve coin isn't branded 'liquidity can be pulled' by RugCheck's 0%");
check(grown && grown.fired.includes('graduated') && grown.fired.includes('x5'), 'graduation + 5× milestones fire');
check(dropped && dropped.status === 'DROPPED' && /Dev holds/.test(dropped.dropReason ?? ''), 'dev bag → thesis broken → dropped');
check(/Gem tracker/.test(homeTxt), 'panel shows the gem tracker');
check(dropped && ['graduated', 'x2', 'x5', 'dropped'].every((k) => dropped.fired.includes(k)) && dropped.events.some((e) => /Spotted at \$45k/.test(e.text)), 'full alert trail: spotted → graduated → 2× → 5× → thesis broken');
console.log(fails.length ? `\n✗ E2E FAILED: ${fails.join('; ')}` : '\n✓ E2E passed — every layer ran end to end.');
process.exit(fails.length ? 1 : 0);
