import { createOrbitMap, type OrbitMapInfo } from './orbitMap';

/** Per-frame state the HUD can show (passed from the render loop). */
export interface HudInfo {
  /** Drawing-buffer scale 0..1 (auto-resolution). */
  resScale?: number;
  /** Orbiting companions by type — shown as the S/P/B breakdown. These mirror the
   *  Bodies panel (the always-present central primary isn't tallied). */
  stars?: number;
  planets?: number;
  holes?: number;
  /** Simulation speed multiplier. */
  timeScale?: number;
  /** N-body sim running on the GPU? (which path the auto-selector chose) */
  gpu?: boolean;
  /** The overhead orbit map's frame (assembled only while `wantsMap` — see Hud). */
  map?: OrbitMapInfo;
}

/** Which optional rows the HUD shows (driven by the Display-HUD child toggles).
 *  The resolution always shows next to the FPS, so it isn't an option. */
export interface HudOptions {
  graph: boolean; // the frame-time sparkline
  detail: boolean; // S/P/B bodies · speed · CPU/GPU
  map: boolean; // the overhead orbit map (bodies + orbits + the camera chevron)
}

export interface Hud {
  /** Call once per frame with the real frame delta (seconds) + optional state. */
  update(frameDelta: number, info?: HudInfo): void;
  /** Show/hide the readout (the panel's "Display HUD" title checkbox). */
  setVisible(on: boolean): void;
  /** Toggle which rich rows appear (the Advanced "HUD" options). */
  setOptions(opts: Partial<HudOptions>): void;
  /** True while the orbit map is actually on screen — the render loop only assembles the
   *  (allocating) per-frame map state when it is. */
  readonly wantsMap: boolean;
}

const GRAPH_W = 124;
const GRAPH_H = 26;
const SAMPLES = GRAPH_W; // one column per recent frame
// Frame-time → colour: green ≤ ~16ms (60fps), amber ~33ms, red beyond.
const TARGET_MS = 1000 / 60;

/**
 * A small, beautiful debug HUD pinned to the **lower-left**. Always shows the live
 * frame rate + the current **resolution scale** (right of the FPS); optionally a
 * **frame-time sparkline** and a **detail** line (S/P/B bodies · speed · CPU/GPU) —
 * toggled by the Display-HUD child checkboxes. Hidden by default; revealed (with a
 * fade + pop) by "Display HUD".
 */
export function createHud(): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML =
    `<div class="hud__top"><span class="hud__fps">— fps</span><span class="hud__res">—</span></div>` +
    `<canvas class="hud__graph" width="${GRAPH_W}" height="${GRAPH_H}"></canvas>` +
    `<div class="hud__ft">—</div><div class="hud__detail">—</div>`;
  document.body.appendChild(el);

  const fpsEl = el.querySelector<HTMLElement>('.hud__fps')!;
  const resEl = el.querySelector<HTMLElement>('.hud__res')!;
  const ftEl = el.querySelector<HTMLElement>('.hud__ft')!;
  const detailEl = el.querySelector<HTMLElement>('.hud__detail')!;
  const canvas = el.querySelector<HTMLCanvasElement>('.hud__graph')!;
  const g = canvas.getContext('2d');

  const map = createOrbitMap();
  el.appendChild(map.el);

  const opts: HudOptions = { graph: true, detail: true, map: true };
  const times = new Float32Array(SAMPLES); // ring of recent frame times (ms)
  let head = 0;
  let frames = 0;
  let acc = 0;
  let fps = 0;
  let lastMs = TARGET_MS;
  let visible = false;

  const applyOptions = (): void => {
    canvas.style.display = opts.graph ? '' : 'none';
    ftEl.style.display = opts.graph ? '' : 'none';
    detailEl.style.display = opts.detail ? '' : 'none';
    map.el.style.display = opts.map ? '' : 'none';
  };
  applyOptions();

  const drawGraph = (): void => {
    if (!g || !opts.graph) return;
    g.clearRect(0, 0, GRAPH_W, GRAPH_H);
    for (let i = 0; i < SAMPLES; i++) {
      const ms = times[(head + i) % SAMPLES]!;
      if (ms <= 0) continue;
      const h = Math.min(GRAPH_H, (ms / (TARGET_MS * 2)) * GRAPH_H); // full height ≈ 2× target
      const over = ms / TARGET_MS;
      g.fillStyle = over < 1.15 ? '#7CFFB0' : over < 2 ? '#ffd24a' : '#ff6a6a';
      g.fillRect(i, GRAPH_H - h, 1, h);
    }
  };

  return {
    update(frameDelta: number, info?: HudInfo): void {
      lastMs = frameDelta * 1000;
      times[head] = lastMs;
      head = (head + 1) % SAMPLES;
      frames += 1;
      acc += frameDelta;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc);
        frames = 0;
        acc = 0;
        fpsEl.textContent = `${fps} fps`;
        // Resolution always sits to the right of the FPS (replacing the backend).
        resEl.textContent = info?.resScale !== undefined ? `${Math.round(info.resScale * 100)}%` : '';
        if (opts.graph) ftEl.textContent = `${lastMs.toFixed(1)} ms`;
        if (opts.detail && info) {
          const speed = info.timeScale ?? 1;
          const speedStr = speed >= 1 ? `×${Math.round(speed)}` : `×1/${Math.round(1 / speed)}`;
          // S/P/B = stars / planets / black holes (orbiting companions).
          const spb = `${info.stars ?? 0}/${info.planets ?? 0}/${info.holes ?? 0}`;
          const compute = info.gpu ? 'GPU' : 'CPU';
          const computeClass = info.gpu ? 'hud__compute--gpu' : 'hud__compute--cpu';
          detailEl.innerHTML =
            `${spb} bodies · ${speedStr} · ` +
            `<span class="hud__compute ${computeClass}">${compute}</span>`;
        }
      }
      if (opts.graph) drawGraph();
      if (opts.map && info?.map) map.draw(info.map);
    },
    setVisible(on: boolean): void {
      visible = on;
      // The class fades + pops it in/out (CSS), so it's easy to spot.
      el.classList.toggle('hud--on', on);
    },
    setOptions(next: Partial<HudOptions>): void {
      Object.assign(opts, next);
      applyOptions();
    },
    get wantsMap(): boolean {
      return visible && opts.map;
    },
  };
}

/** Replace the whole view with a fatal-error message (no WebGPU *and* no WebGL2,
 *  or an init failure). */
export function showFatalError(error: unknown): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  const detail = error instanceof Error ? error.message : String(error);
  el.innerHTML =
    `<div><strong>One Still Point couldn't start.</strong><br><br>` +
    `This visualizer needs a browser with WebGPU or WebGL2.<br>` +
    `<br><small>${detail}</small></div>`;
  document.body.appendChild(el);
}
