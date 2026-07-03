/**
 * The message protocol between the main thread and the OffscreenCanvas render worker — a versioned,
 * typed contract both sides import. See `docs/offscreen-canvas.md` for the migration plan. The
 * worker render path is being built incrementally and is **off by default** until it reaches parity
 * with the main-thread path.
 */

/** Bump whenever the message shapes change, so a stale worker bundle is detected at `init`.
 *  v2 (step 3, input + resize): pointer messages carry pointerId/pointerType/button (multi-touch +
 *  pinch), wheel carries deltaMode/ctrlKey (trackpad pinch-zoom), and `init` carries the main
 *  thread's `coarse`-pointer probe (workers have no `matchMedia`, and the camera's home framing
 *  depends on it).
 *  v3 (step 3c, full dynamics): `init` adds the `reducedMotion` probe (the formation length depends
 *  on it); the worker posts `revealReady` (its smoothness gate opened — the splash may play out)
 *  and `perf` (the reveal profiler's report, for on-device debugging); main answers with the
 *  `command 'reveal'` when the splash actually lifts. */
export const WORKER_PROTOCOL_VERSION = 3;

/** Quality tier choice, mirroring `core/quality`'s tiers (`auto` lets the worker auto-detect). */
export type QualityChoice = 'auto' | 'low' | 'medium' | 'high';

// ── main → worker ───────────────────────────────────────────────────────────────────────────────

/** Hand the worker control of the canvas and start the engine. `canvas` is a *transferred*
 *  `OffscreenCanvas` (pass it in the `postMessage` transfer list, not by copy). */
export interface InitMessage {
  type: 'init';
  protocol: number; // WORKER_PROTOCOL_VERSION at the sender
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  quality: QualityChoice;
  /** The main thread's coarse-pointer probe (`isCoarsePointer()`) — drives the camera's home
   *  framing worker-side, where `matchMedia` doesn't exist. */
  coarse: boolean;
  /** The main thread's `prefers-reduced-motion` probe — the formation plays gentler + shorter. */
  reducedMotion: boolean;
}

export interface ResizeMessage {
  type: 'resize';
  width: number;
  height: number;
  dpr: number;
}

/** A pointer event captured on the on-page canvas and replayed onto the worker-side camera
 *  (via the {@link ../worker/elementProxy!ElementProxy}). Coordinates are **CSS pixels** relative
 *  to the canvas (OrbitControls normalizes drag rotation by the element's CSS height). */
export interface PointerMessage {
  type: 'pointer';
  action: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
}

export interface WheelMessage {
  type: 'wheel';
  deltaY: number;
  deltaMode: number;
  /** Trackpad pinch gestures arrive as ctrl+wheel — OrbitControls reads it for zoom speed. */
  ctrlKey: boolean;
}

/** A single settings change from the control panel — one generic channel onto the existing
 *  uniforms/scene setters (rather than a bespoke message per control). */
export interface ControlMessage {
  type: 'control';
  key: string;
  value: number | boolean | string;
}

/** A discrete action: `pause` | `replay` | `scrub` | `addBody` | `removeBody` | … with optional args. */
export interface CommandMessage {
  type: 'command';
  name: string;
  args?: readonly (number | string)[];
}

export interface DisposeMessage {
  type: 'dispose';
}

export type MainToWorker =
  | InitMessage
  | ResizeMessage
  | PointerMessage
  | WheelMessage
  | ControlMessage
  | CommandMessage
  | DisposeMessage;

// ── worker → main ───────────────────────────────────────────────────────────────────────────────

/** The engine booted and the first pipeline compiled (`compileAsync` resolved). */
export interface ReadyMessage {
  type: 'ready';
  protocol: number;
  backend: 'webgpu' | 'webgl';
}

/** Per-frame-ish telemetry for the HUD (throttled by the worker). */
export interface StatusMessage {
  type: 'status';
  fps: number;
  ms: number;
  resScale: number;
  stars: number;
  planets: number;
  holes: number;
  gpu: boolean;
}

/** A transient timeline event (add / absorb / escape / star / planet) for the history scrub bar. */
export interface EventMessage {
  type: 'event';
  event: string;
  frame: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

/** The worker's smoothness gate opened — the loop is flowing, the splash may play out. Main waits
 *  for the splash-hold minimum, hides the splash, then answers with `command 'reveal'`. */
export interface RevealReadyMessage {
  type: 'revealReady';
}

/** The worker's reveal profiler completed its first-frames window — on-device debug telemetry
 *  (span marks + frame stats), the worker-path analogue of `osp.perf.report()`. */
export interface PerfMessage {
  type: 'perf';
  report: unknown;
}

export type WorkerToMain = ReadyMessage | StatusMessage | EventMessage | ErrorMessage | RevealReadyMessage | PerfMessage;

// ── runtime guards (so a `MessageEvent.data` of unknown shape can be narrowed safely) ────────────

export const MAIN_TO_WORKER_TYPES = ['init', 'resize', 'pointer', 'wheel', 'control', 'command', 'dispose'] as const;
export const WORKER_TO_MAIN_TYPES = ['ready', 'status', 'event', 'error', 'revealReady', 'perf'] as const;

function isTagged(m: unknown): m is { type: string } {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}

export function isMainToWorker(m: unknown): m is MainToWorker {
  return isTagged(m) && (MAIN_TO_WORKER_TYPES as readonly string[]).includes(m.type);
}

export function isWorkerToMain(m: unknown): m is WorkerToMain {
  return isTagged(m) && (WORKER_TO_MAIN_TYPES as readonly string[]).includes(m.type);
}
