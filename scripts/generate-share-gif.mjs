#!/usr/bin/env node
/**
 * Generate the Share button's animated GIF from the Infall mark — re-runnable whenever the
 * brand changes:
 *
 *     npm run generate:share-gif
 *
 * Produces `public/share.gif` (committed, served): the monoline black hole with its stardust
 * motes riding one full 9.6s loop — optimized for size *and* beauty (a diff-mode global palette
 * over the mark's warm-silver-on-void colours compresses beautifully).
 *
 * Same deterministic approach as the other capture scripts: the SVG's mote animation is pure
 * CSS (`offset-distance` keyframes), so each frame pins `animation-play-state: paused` with a
 * per-class negative `animation-delay` (preserving the three motes' −3.2s/−6.4s stagger),
 * headless Chromium screenshots it, and ffmpeg assembles a palette-optimized looping GIF.
 * Needs a Chromium ($CHROME overrides) and ffmpeg.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'share.gif');

const SIZE = 480; // px square — share-sheet friendly, retina-decent, small on the wire
const FRAMES = 32; // one full 9.6s mote loop; the halo is static, so ~3.3 fps reads smooth
const LOOP_S = 9.6; // the mark's own animation period (assets/hero.svg)
const DELAY_CS = Math.round((LOOP_S / FRAMES) * 100); // GIF frame delay, centiseconds (real-time)

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
  console.error('generate-share-gif: no Chromium found. Set $CHROME.');
  process.exit(1);
}

const mark = readFileSync(join(ROOT, 'assets', 'hero.svg'), 'utf8');
const TMP = mkdtempSync(join(tmpdir(), 'osp-gif-'));

for (let i = 0; i < FRAMES; i++) {
  const t = (i / FRAMES) * LOOP_S;
  // Freeze the mote loop at t: pause + per-class negative delays (base stagger preserved).
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    html, body { width: ${SIZE}px; height: ${SIZE}px; background: #000; overflow: hidden; }
    svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
    .a-dust { visibility: visible !important; }
    .a-m { animation: a-fall ${LOOP_S}s linear infinite !important; animation-play-state: paused !important; animation-delay: ${-t}s !important; }
    .a-m.a-d2 { animation-delay: ${-(t + 3.2)}s !important; }
    .a-m.a-d3 { animation-delay: ${-(t + 6.4)}s !important; }
  </style></head><body>${mark}</body></html>`;
  const page = join(TMP, `f${i}.html`);
  writeFileSync(page, html);
  const shot = join(TMP, `f${String(i).padStart(2, '0')}.png`);
  const r = spawnSync(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1', '--hide-scrollbars', `--window-size=${SIZE},${SIZE}`, `--screenshot=${shot}`, `file://${page}`],
    { stdio: 'pipe' },
  );
  if (r.status !== 0 || !existsSync(shot)) {
    console.error(`generate-share-gif: frame ${i} failed`, r.stderr?.toString().slice(0, 300));
    process.exit(1);
  }
}

// Palette-optimized assembly: one global palette over the whole loop (stats_mode=diff biases it
// toward the moving motes), sierra dithering for the soft glows. Loops forever.
const filters = `fps=${FRAMES / LOOP_S},split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=128[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
const ff = spawnSync(
  'ffmpeg',
  ['-y', '-framerate', String(FRAMES / LOOP_S), '-i', join(TMP, 'f%02d.png'), '-vf', filters, '-loop', '0', OUT],
  { stdio: 'pipe' },
);
if (ff.status !== 0) {
  console.error('generate-share-gif: ffmpeg failed', ff.stderr?.toString().slice(-400));
  process.exit(1);
}
rmSync(TMP, { recursive: true, force: true });
console.log(`wrote public/share.gif (${SIZE}×${SIZE}, ${FRAMES} frames @ ${DELAY_CS}cs, ${(statSync(OUT).size / 1024).toFixed(0)} KB)`);
