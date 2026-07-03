import GUI, { type Controller } from 'lil-gui';
import { VERSION } from '../version';
import type { QualityTier } from '../core/quality';
import { MAX_BODIES } from '../render/bodyUniforms';
import { bodyCap } from '../scene/Scene';
import type { BodyType } from '../scene/Body';
import type { StatusMessage } from '../worker/protocol';
import type { WorkerHost } from '../worker/workerHost';
import { createAboutButton } from './about';
import type { Hud } from './hud';
import { createHudFolder } from './hudFolder';
import { BACKGROUNDS, BG_PRESETS, PRESETS } from './presets';
import { createShareButton } from './share';
import { createStepper, type Stepper } from './stepper';
import { createVersionBadge } from './versionBadge';

/** Attach a native hover tooltip to a controller's row (Controls.ts parity). */
function tip<T extends Controller>(controller: T, text: string): T {
  controller.domElement.title = text;
  return controller;
}

/**
 * The control panel for the **worker render path** (OffscreenCanvas step 4a): the same lil-gui
 * shell as `Controls.ts`, but every change posts a `control {key, value}` (or a body-edit
 * `command`) to the worker instead of writing live objects — the worker applies them through its
 * `controlMap` table. Body counts for the ± steppers come back on the throttled `status`
 * telemetry (feed {@link WorkerPanel.status} from the host's `onStatus`).
 *
 * Scope (deliberate): the essentials + the look/quality knobs. Replay (intro melt spans both
 * threads), Share (step 5), HUD/history (step 4b), and settings persistence stay main-path-only
 * until the RenderHost seam (step 6) unifies the two panels.
 */
export interface WorkerPanel {
  gui: GUI;
  /** Feed the worker's `status` telemetry here — refreshes the ± steppers' counts/limits. */
  status(s: StatusMessage): void;
}

export function createWorkerControls(host: WorkerHost, hud?: Hud, captureShare?: () => Promise<File | null>): WorkerPanel {
  const gui = new GUI({ title: 'One Still Point' });
  {
    const mark = document.createElement('img');
    mark.src = '/favicon.svg';
    mark.alt = '';
    mark.setAttribute('aria-hidden', 'true');
    mark.className = 'osp-panel__mark';
    gui.$title.appendChild(mark);
    gui.$title.classList.add('osp-panel__title');
  }

  // --- Filter (named looks) — posts the whole preset as individual control keys ---
  const filterProxy = { preset: 'Physical' };
  tip(
    gui.add(filterProxy, 'preset', Object.keys(PRESETS)).name('Filter').onChange((name: string) => {
      const p = PRESETS[name];
      if (!p) return;
      host.control('bh.emissiveStrength', p.emissiveStrength);
      host.control('bh.diskDensity', p.diskDensity);
      host.control('bh.diskTemp', p.diskTemp);
      host.control('bh.scatterStrength', p.scatterStrength);
      host.control('bh.extinction', p.extinction);
      host.control('bh.doppler', p.doppler);
      host.control('bh.redshift', p.redshift);
      host.control('bh.turbAmount', p.turbAmount);
      host.control('bh.rotationSpeed', p.rotationSpeed);
      host.control('render.exposure', p.exposure);
    }),
    'A named look — same set as the main panel (Physical / EHT / Interstellar / Stylized).',
  );

  // --- Background — mode + its look preset, over the channel ---
  const bgProxy = { sky: 'Stars' };
  tip(
    gui.add(bgProxy, 'sky', BACKGROUNDS).name('Background').onChange((v: string) => {
      const mode = Math.max(0, BACKGROUNDS.indexOf(v));
      host.control('bg.mode', mode);
      const p = BG_PRESETS[mode] ?? BG_PRESETS[0]!;
      host.control('bg.brightness', p.brightness);
      host.control('bg.saturation', p.saturation);
      host.control('bg.tint', p.tint);
    }),
    'The sky behind the hole — each loads its own look preset, exactly as on the main panel.',
  );

  // --- Speed (log10 slider, main-panel mapping) ---
  const speedProxy = { exp: 0 };
  const fmtScale = (s: number): string => {
    if (s >= 1e6) return `${(s / 1e6).toFixed(1)}M`;
    if (s >= 1e3) return `${(s / 1e3).toFixed(1)}k`;
    if (s >= 1) return `${Math.round(s)}`;
    return `1/${Math.round(1 / s)}`;
  };
  const speedCtrl = gui.add(speedProxy, 'exp', -3, 6, 0.1).name('Speed ×1');
  tip(speedCtrl, 'Simulation speed, log scale: ×1/1000 slow-motion up to ×1,000,000.');
  speedCtrl.onChange((v: number) => {
    const scale = Math.pow(10, v);
    host.control('time.scale', scale);
    speedCtrl.name(`Speed ×${fmtScale(scale)}`);
  });

  // --- Bodies (± steppers) — commands out, counts back on `status` ---
  const counts = { star: 3, planet: 3, hole: 0 }; // seeded roster; corrected by the first status
  const steppers: Stepper[] = [];
  const bodies = gui.addFolder('Bodies');
  const addStepper = (type: BodyType, label: string): void => {
    const noun = label.toLowerCase().replace(/s$/, '');
    const stepper = createStepper({
      label,
      count: () => counts[type],
      canInc: () =>
        counts[type] < bodyCap(type, counts.hole, counts.star + counts.planet) &&
        counts.star + counts.planet + counts.hole < MAX_BODIES,
      onInc: () => host.command('addBody', [type]),
      // The plunge tap-guard lives worker-side (the engine ignores a removeBody while one is
      // still inside the guard), so − stays enabled here — parity with the guard's intent.
      onDec: () => host.command('removeBody', [type]),
      incTip: `Add a ${noun}`,
      decTip: `Remove a ${noun}`,
    });
    bodies.$children.appendChild(stepper.row);
    steppers.push(stepper);
  };
  addStepper('star', 'Stars');
  addStepper('planet', 'Planets');
  addStepper('hole', 'Black holes');
  tip(
    bodies.add({ clear: () => host.command('clearBodies') }, 'clear').name('Clear companions'),
    'Remove all added bodies and restore the default orbits.',
  );

  // --- Quality / FPS cap / Bloom — the perf + post knobs, over the channel ---
  const advanced = gui.addFolder('Advanced').close();
  const qualityProxy = { tier: 'Auto' };
  tip(
    advanced.add(qualityProxy, 'tier', ['Auto', 'Low', 'Medium', 'High']).name('Quality').onChange((v: string) => {
      host.control('render.quality', v === 'Auto' ? 'auto' : (v.toLowerCase() as QualityTier));
    }),
    'Resolution scale bounds, DPR cap and dust step — Auto re-detects for this device.',
  );
  const fpsProxy = { cap: 0 };
  tip(
    advanced.add(fpsProxy, 'cap', { Uncapped: 0, '30 fps': 30, '24 fps': 24 }).name('Frame cap').onChange((v: number) => {
      host.control('render.maxFps', v);
    }),
    'Cap the render rate (cinematic look / battery saver). Uncapped = vsync.',
  );
  const bloomProxy = { strength: 0.45, radius: 0.85, threshold: 0.0 };
  const post = advanced.addFolder('Bloom').close();
  tip(post.add(bloomProxy, 'strength', 0, 2, 0.02).name('Strength').onChange((v: number) => host.control('bloom.strength', v)), 'Glow intensity.');
  tip(post.add(bloomProxy, 'radius', 0, 1, 0.02).name('Radius').onChange((v: number) => host.control('bloom.radius', v)), 'Glow spread.');
  tip(post.add(bloomProxy, 'threshold', 0, 2, 0.02).name('Threshold').onChange((v: number) => host.control('bloom.threshold', v)), 'Brightness above which things bloom.');

  // --- Pause / Resume (button-style, main-panel look) ---
  let paused = false;
  const pauseProxy = {
    toggle: (): void => {
      paused = !paused;
      host.control('time.paused', paused);
      pauseCtrl.name(paused ? 'Resume' : 'Pause');
      pauseCtrl.domElement.classList.toggle('osp-paused', paused);
      pauseCtrl.domElement.classList.toggle('osp-running', !paused);
    },
  };
  const pauseCtrl = gui.add(pauseProxy, 'toggle').name('Pause');
  pauseCtrl.domElement.classList.add('osp-running');
  tip(pauseCtrl, 'Freeze the simulation (the render keeps running).');

  // --- Display HUD (step 4b): the same folder as the main panel, wrapping the HUD so showing/
  // hiding it also starts/stops the worker's per-tick `frame` telemetry (hidden HUD = zero
  // messages). The HUD object itself renders from onFrame/onStatus in main.ts.
  if (hud) {
    const streamedHud: Hud = {
      update: (d, i) => hud.update(d, i),
      setOptions: (o) => hud.setOptions(o),
      setVisible: (on) => {
        hud.setVisible(on);
        host.command('hudStream', [on ? 'on' : 'off']);
      },
      get wantsMap() {
        return hud.wantsMap;
      },
    };
    createHudFolder(gui, streamedHud, { showFps: false }, tip);
  }

  // --- Top row: About + Share + the click-to-copy version chip (main-panel parity) ---
  const about = createAboutButton();
  const topRow = document.createElement('div');
  topRow.className = 'osp-toprow';
  if (captureShare) topRow.append(about.button, createShareButton(captureShare), createVersionBadge(VERSION));
  else topRow.append(about.button, createVersionBadge(VERSION));
  gui.$children.prepend(topRow);
  gui.close(); // starts collapsed, like the main panel

  return {
    gui,
    status(s) {
      counts.star = s.stars;
      counts.planet = s.planets;
      counts.hole = s.holes;
      steppers.forEach((st) => st.refresh());
    },
  };
}
