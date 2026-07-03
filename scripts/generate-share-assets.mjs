#!/usr/bin/env node
/**
 * Generate the static share/branding rasters from the monoline still mark — re-runnable
 * whenever the brand changes:
 *
 *     npm run generate:share
 *
 * Produces (committed, served from public/):
 *   • public/og.png               1200×630 — the Open Graph / Twitter share card: the mark
 *                                 beside the wordmark + description on the void.
 *   • public/apple-touch-icon.png 180×180 — the iOS home-screen icon (the mark's own tile;
 *                                 iOS applies its own corner mask over the SVG's rounding).
 *
 * Same approach as capture-splash.mjs: compose a small HTML file and let headless Chromium
 * screenshot it deterministically (SVG-in-HTML rasterizes with full fidelity — gradients,
 * blurs, masks). Needs a Chromium; set $CHROME to override the binary.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const bin of ['/opt/pw-browsers/chromium', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const probe = spawnSync(bin, ['--version'], { stdio: 'ignore' });
    if (!probe.error) return bin;
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('generate-share-assets: no Chromium found. Set $CHROME to a chromium binary.');
  process.exit(1);
}

const mark = readFileSync(join(ROOT, 'public', 'favicon.svg'), 'utf8');
const TMP = mkdtempSync(join(tmpdir(), 'osp-share-'));

/** Screenshot one composed HTML card at an exact size. */
function shoot(name, width, height, body, extraCss = '') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; background: #000; overflow: hidden; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #d8d1c4; }
    svg { display: block; }
    ${extraCss}
  </style></head><body>${body}</body></html>`;
  const page = join(TMP, `${name}.html`);
  writeFileSync(page, html);
  const out = join(ROOT, 'public', `${name}.png`);
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ],
    { stdio: 'pipe' },
  );
  if (r.status !== 0 || !existsSync(out)) {
    console.error(`generate-share-assets: ${name} failed`, r.stderr?.toString().slice(0, 400));
    process.exit(1);
  }
  console.log(`wrote public/${name}.png (${width}×${height})`);
}

// The share card: the mark on the left third, wordmark + description + domain on the right —
// the void background, warm-silver monoline palette (the brand reference from assets/logo.svg).
shoot(
  'og',
  1200,
  630,
  `<div class="card">
    <div class="mark">${mark}</div>
    <div class="copy">
      <div class="word">One Still Point</div>
      <div class="desc">A scientifically grounded, GPU-accelerated,<br>animated black hole visualizer.</div>
      <div class="site">onestillpoint.app</div>
    </div>
  </div>`,
  `.card { display: flex; align-items: center; height: 100%; padding: 0 72px; gap: 56px; }
   .mark { width: 400px; height: 400px; flex: none; }
   .mark svg { width: 100%; height: 100%; }
   .copy { display: flex; flex-direction: column; gap: 22px; }
   .word { font-size: 74px; letter-spacing: 0.5px; color: #e9e3d5; }
   .desc { font-size: 30px; line-height: 1.45; color: #aca496; }
   .site { font-size: 26px; letter-spacing: 2px; color: #7d776c; }`,
);

// The iOS home-screen icon: the mark IS the tile (its own rounded void square) — rendered
// full-bleed; iOS masks the corners itself.
shoot(
  'apple-touch-icon',
  180,
  180,
  `<div class="tile">${mark}</div>`,
  `.tile, .tile svg { width: 180px; height: 180px; }`,
);

rmSync(TMP, { recursive: true, force: true });
