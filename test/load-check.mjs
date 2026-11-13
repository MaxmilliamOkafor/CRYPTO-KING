/**
 * test/load-check.mjs — does Chrome actually LOAD the extension from the
 * folders people pick? Loads the project folder AND dist/ in real Chromium and
 * checks: the background worker starts, the on-page panel appears, the popup
 * renders, and its dashboard link and notification icon resolve to real files.
 *
 *   npm run build && node test/load-check.mjs
 *
 * Exists because "Load unpacked" on the project folder used to fail with
 * "Could not load javascript 'content/content.js' for script".
 */
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
for (const [label, dir] of [['project folder', ROOT], ['dist/', path.join(ROOT, 'dist')]]) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-load-'));
  const errors = [];
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await ctx.route('https://gmgn.ai/**', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body>gmgn</body></html>' }));
  await ctx.route(/^https:\/\/(?!gmgn\.ai)/, (r) => r.fulfill({ status: 404, body: '' })); // stay offline
  let sw;
  try {
    sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  } catch {
    console.log(`✗ ${label}: background worker never started — Chrome rejected the folder`);
    failed++;
    await ctx.close();
    continue;
  }
  const extId = sw.url().split('/')[2];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://gmgn.ai/trend');
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const panel = JSON.stringify(root).includes('CRYPTO-KING');

  const pop = await ctx.newPage();
  pop.on('pageerror', (e) => errors.push(e.message));
  const popupPath = sw.url().includes('/dist/') ? 'dist/popup/popup.html' : 'popup/popup.html';
  await pop.goto(`chrome-extension://${extId}/${popupPath}`);
  await pop.waitForTimeout(800);
  const popupOk = (await pop.textContent('body'))?.includes('Risk plan') ?? false;
  // Resolve exactly as the code does (relative to the page / worker) and
  // fetch from INSIDE the extension — the only place these URLs are served.
  const dash = new URL('../dashboard/dashboard.html', pop.url()).href;
  const icon = new URL('../icons/icon128.png', sw.url()).href;
  const fetchOk = (u) => pop.evaluate((x) => fetch(x).then((r) => r.ok).catch(() => false), u);
  const dashOk = await fetchOk(dash);
  const iconOk = await fetchOk(icon);

  const ok = panel && popupOk && dashOk && iconOk && errors.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? '✓' : '✗'} ${label}: worker ✓ · panel ${panel ? '✓' : '✗'} · popup ${popupOk ? '✓' : '✗'} · dashboard link ${dashOk ? '✓' : '✗'} · icon ${iconOk ? '✓' : '✗'}` +
      (errors.length ? ` · errors: ${errors.join(' | ')}` : ''),
  );
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
