/**
 * build.mjs — esbuild-based build for the MV3 extension.
 *
 *   node build.mjs           one-shot build into dist/  (load THAT dir unpacked)
 *   node build.mjs --watch   rebuild on change
 *   node build.mjs --test    bundle + run the riskScorer unit tests
 *
 * dist/ layout mirrors manifest.json paths exactly:
 *   background/service-worker.js, content/content.js,
 *   popup/{popup.html,popup.css,popup.js}, dashboard/{…}, icons/, manifest.json
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

/* ── Unit tests ─────────────────────────────────────────────────────────── */
async function runTests() {
  rmSync('.test-build', { recursive: true, force: true });
  await esbuild.build({
    entryPoints: ['test/riskScorer.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.test-build/riskScorer.test.mjs',
    logLevel: 'error',
  });
  const run = spawnSync('node', ['.test-build/riskScorer.test.mjs'], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

/* ── Extension build ────────────────────────────────────────────────────── */
const options = {
  entryPoints: {
    'background/service-worker': 'background/service-worker.ts',
    'content/content': 'content/content.ts',
    'popup/popup': 'popup/popup.ts',
    'dashboard/dashboard': 'dashboard/dashboard.ts',
  },
  bundle: true,
  format: 'esm', // fine for the module service worker; content/popup bundles have no imports left after bundling
  target: 'chrome110',
  outdir: 'dist',
  sourcemap: false,
  logLevel: 'info',
};

function copyStatic() {
  cpSync('manifest.json', 'dist/manifest.json');
  cpSync('popup/popup.html', 'dist/popup/popup.html');
  cpSync('popup/popup.css', 'dist/popup/popup.css');
  cpSync('dashboard/dashboard.html', 'dist/dashboard/dashboard.html');
  cpSync('dashboard/dashboard.css', 'dist/dashboard/dashboard.css');
  writeIcons();
}

async function main() {
  if (test) {
    await runTests();
    return;
  }
  rmSync('dist', { recursive: true, force: true });
  mkdirSync('dist', { recursive: true });
  if (watch) {
    const ctx = await esbuild.context(options);
    copyStatic();
    await ctx.watch();
    console.log('watching… (statics are only copied on start; rerun on html/css changes)');
  } else {
    await esbuild.build(options);
    copyStatic();
    console.log('built → dist/  (chrome://extensions → Load unpacked → select dist/)');
  }
}

/* ── Icons: generate simple crown-yellow PNGs so the repo stays binary-free ── */

function writeIcons() {
  mkdirSync('dist/icons', { recursive: true });
  for (const size of [16, 48, 128]) {
    writeFileSync(`dist/icons/icon${size}.png`, makePng(size, [255, 178, 36])); // #ffb224
  }
}

/** Minimal solid-color RGB PNG encoder (IHDR + IDAT + IEND). */
function makePng(size, [r, g, b]) {
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = row + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}


await main();
