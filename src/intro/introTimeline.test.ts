import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTRO_BEATS, INTRO_DIALS, INTRO_STORY_FPS, MELT_MS, SPLASH_COVERS_AT_MS } from './introTimeline';
import { SPLASH_RETIRED } from './splashRetire';

describe('intro dials', () => {
  it('orders the beats black → lines → creation → splash → engine', () => {
    expect(INTRO_BEATS.map((b) => b.id)).toEqual(['black', 'lines', 'creation', 'splash', 'engine']);
  });

  it('targets 200fps for the whole intro story, and the engine at its own rate', () => {
    const fps = Object.fromEntries(INTRO_BEATS.map((b) => [b.id, b.fps]));
    expect(INTRO_STORY_FPS).toBe(200);
    for (const id of ['black', 'lines', 'creation', 'splash']) expect(fps[id]).toBe(INTRO_STORY_FPS);
    expect(fps.engine).toBe(0); // 0 = the physics model's own (cappable) rate
  });

  it('holds black for 0.6s, then a split-second of black before the burst', () => {
    expect(INTRO_DIALS.initialBlackMs).toBe(600); // 0.6s: extra covered time for the cold engine pre-warm
    expect(INTRO_DIALS.splitBlackMs).toBeGreaterThan(16);
    expect(INTRO_DIALS.splitBlackMs).toBeLessThan(160);
  });

  it('plays the creation as its own beat, then overlaps the splash (no black gap)', () => {
    expect(INTRO_DIALS.creationBeatMs).toBeGreaterThan(200); // a real beat-length
    expect(INTRO_DIALS.creationToSplashMs).toBeLessThan(0); // negative = overlap, default −80
  });

  it('keeps creation/splash speeds as positive multipliers (1 = as authored)', () => {
    expect(INTRO_DIALS.creationSpeed).toBeGreaterThan(0);
    expect(INTRO_DIALS.splashSpeed).toBeGreaterThan(0);
  });

  it('melts inward for 2s before replaying', () => {
    expect(MELT_MS).toBe(2000);
  });

  it('only un-melts / dismisses once the screen is covered (past the prelude)', () => {
    expect(SPLASH_COVERS_AT_MS).toBeGreaterThan(INTRO_DIALS.initialBlackMs);
  });
});

// The inline boot script paints before the bundle, so it can't import this module — it
// hard-codes the same dials on window.__ospDials. The overlay now lives in one place
// (src/intro/overlay.html), inlined into index.html by the introOverlay() plugin in
// vite.config.ts. These guards keep the mirror in lockstep and the wiring intact.
describe('inline window.__ospDials mirrors INTRO_DIALS', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const overlay = read('./overlay.html');
  const index = read('../../index.html');

  it('defines window.__ospDials', () => {
    expect(overlay).toContain('window.__ospDials = {');
  });

  for (const [key, value] of Object.entries(INTRO_DIALS)) {
    it(`mirrors ${key} = ${value}`, () => {
      expect(overlay).toMatch(new RegExp(`${key}:\\s*${value}(?![0-9])`));
    });
  }

  it('drives the timing from the dials (not magic numbers)', () => {
    expect(overlay).toContain('var D = window.__ospDials');
    expect(overlay).toMatch(/__ospSplash\(true\)/); // prebuild
    expect(overlay).toContain('window.__ospSplashPlay');
    expect(overlay).toMatch(/D\.creationBeatMs \+ D\.creationToSplashMs/); // the overlap maths
  });

  it('resets __ospSplashStart at the start of every intro', () => {
    expect(overlay).toContain('window.__ospSplashStart = undefined');
  });

  // The overlay is the single source: index.html inlines it via the marker the vite
  // plugin replaces, so the shipped markup is never duplicated.
  it('inlines the one overlay into index.html via the build-time marker', () => {
    expect(index).toContain('<!-- @osp-intro-overlay -->');
  });

  // The heavy engine bundle must be deferred behind window.__ospBoot (no eager <script src>),
  // defined in index.html and called from the overlay so its parse runs under the black hold.
  it('defers the engine bundle behind window.__ospBoot (no eager <script src=main>)', () => {
    expect(index).not.toMatch(/<script[^>]*\bsrc=["'][^"']*main\.ts["']/);
    expect(index).toContain('window.__ospBoot');
    expect(overlay).toMatch(/__ospBoot\(\)/);
  });

  // The boot stays a BARE dynamic import — no boot "failsafe" overlay. History lesson (v0.99.1–
  // v0.99.7): a well-meant boot-failure card ('couldn't finish loading' → Reload) false-positived
  // over a fully-working reveal and cost a whole session chasing a phantom Vercel/stale-index
  // cause (OSP is on GitHub Pages; a fresh load is all-200). The cure was worse than the disease.
  // If a boot recovery is ever wanted again, design it so it can NEVER cover a live render — and
  // update this test deliberately. Until then, index.html must carry no such overlay.
  it('the boot is a bare dynamic import — no re-introduced failsafe overlay', () => {
    expect(index).toContain("import('/src/main.ts')");
    expect(index).not.toContain('osp-bootfail');
    expect(index).not.toContain('__ospReload');
    expect(index).not.toContain('osp-boot-retry');
  });
});

// The intro stylesheet is split out of the app's (src/intro/intro.css) so the whole
// intro is one forkable unit (see src/intro/README.md). These guards keep the split
// clean — the styles really moved (not duplicated), the app links the new file, and the
// splash's flash keyframe is uniquely named (it used to silently collide with the app's
// `osp-flash`, so the merger flash animated with the wrong keyframe).
describe('intro stylesheet split (forkable unit)', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const introCss = read('./intro.css');
  const appCss = read('../style.css');
  const index = read('../../index.html');

  it('index.html links the intro stylesheet alongside the app styles', () => {
    expect(index).toMatch(/<link[^>]+href="\/src\/intro\/intro\.css"/);
  });

  it('intro.css owns the creation + splash + Replay-melt styles', () => {
    for (const sel of ['#osp-creation', '#osp-splash', '@keyframes osp-melt', '@keyframes osp-cr-core', '@keyframes osp-splash-core']) {
      expect(introCss).toContain(sel);
    }
  });

  it('uniquely names the splash flash keyframe (no collision with the app osp-flash)', () => {
    expect(introCss).toContain('@keyframes osp-splash-flash');
    expect(introCss).not.toMatch(/@keyframes osp-flash\b/); // the app keeps osp-flash; the splash must not reuse it
  });

  it('the app stylesheet no longer carries the intro styles (split, not duplicated)', () => {
    expect(appCss).not.toContain('#osp-creation');
    expect(appCss).not.toContain('#osp-splash');
    expect(appCss).not.toContain('@keyframes osp-melt');
  });
});

/**
 * The splash dismissal has two halves: `hideSplash()` (src/intro/splashRetire.ts) fades the layer
 * and then retires it, while the dust field animates from the inline overlay script, which can't
 * import that module. These guards keep the halves in lockstep.
 */
describe('the inline splash canvas gives the main thread back at the crossfade', () => {
  const overlay = readFileSync(fileURLToPath(new URL('./overlay.html', import.meta.url)), 'utf8');

  it('stops its rAF chain the moment --hide appears, not half a second later', () => {
    expect(overlay).toContain("var hiding = splash.classList.contains('osp-splash--hide')");
    expect(overlay).toContain('if (t < STOP && !hiding)');
    // The old behaviour kept drawing until hide + 0.5s: a second rAF chain doing a full-viewport
    // clearRect plus up to 320 drawImage calls per frame, in competition with the engine over
    // exactly the frames where it ramps disk ignition and climbs the resolution scaler back.
    expect(overlay).not.toMatch(/__hideAt \+ 0\.5/);
  });

  it('leaves the last frame painted so the layer’s opacity carries the dust out', () => {
    // Clearing on the hide path would pop the dust off in one frame instead of crossfading it.
    expect(overlay).toContain('if (!hiding) ctx.clearRect(0, 0, W, H)');
  });

  it('puts the splash back in the compositor when a replay rebuilds it', () => {
    expect(overlay).toContain(`splash.classList.remove('${SPLASH_RETIRED}')`);
  });
});
