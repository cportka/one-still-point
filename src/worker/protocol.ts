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
 *  `command 'reveal'` when the splash actually lifts.
 *  v4 (fail-safe boot): the worker posts `capability` (its WebGPU adapter probe, before any
 *  renderer exists) and `unsupported` (this environment can't run the worker path — the host
 *  falls back to the main-thread renderer instead of stranding or wedging the tab).
 *  v5 (step 4b, HUD telemetry): the worker streams per-tick `frame` messages (frame ms, res
 *  scale, camera floor position, packed body positions for the orbit map) — but **only while
 *  main has asked for them** (`command 'hudStream' ['on'|'off']`, sent as the HUD shows/hides),
 *  so a hidden HUD costs zero messages. */
export const WORKER_PROTOCOL_VERSION = 5;

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

/** The worker's WebGPU adapter probe, posted at the top of `init` *before any renderer exists*.
 *  Doubles as the "the worker is alive and evaluating" heartbeat for the host's boot watchdog —
 *  it arrives within worker-spawn time, long before the (multi-second) compile finishes. */
export interface CapabilityMessage {
  type: 'capability';
  /** A real WebGPU adapter answered in the worker. `false` → `unsupported` follows immediately. */
  webgpu: boolean;
}

/** This environment cannot run the worker render path (no usable WebGPU adapter in the worker —
 *  e.g. Firefox, which doesn't expose WebGPU to workers and whose WebGL2-in-worker fallback can
 *  wedge the whole GPU process). The host should terminate the worker and fall back to the
 *  main-thread renderer. Distinct from `error`: `unsupported` is an expected, clean outcome. */
export interface UnsupportedMessage {
  type: 'unsupported';
  reason: string;
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
  /** Simulation speed multiplier (the HUD's detail row shows it). */
  timeScale: number;
}

/** A transient timeline event (add / absorb / escape / star / planet) for the history scrub bar. */
export interface EventMessage {
  type: 'event';
  event: string;
  frame: number;
}

/** Per-tick HUD telemetry (step 4b), streamed only while main's HUD is visible. `bodies` is a
 *  packed Float32Array buffer — BODY_STRIDE floats per body: [x, z, typeCode, falling] with
 *  typeCode from BODY_TYPE_CODES and falling 0|1. (≤ 160 bytes at the body cap — the structured
 *  clone is negligible, no transfer-list plumbing needed.) */
export interface FrameMessage {
  type: 'frame';
  /** Last frame time, ms (drives the sparkline + fps). */
  ms: number;
  /** Drawing-buffer scale 0..1 (auto-resolution). */
  resScale: number;
  /** Camera floor position (world x/z) for the orbit map's chevron. */
  camX: number;
  camZ: number;
  /** Packed companion positions (see above). */
  bodies: ArrayBuffer;
  count: number;
}

export const BODY_STRIDE = 4; // floats per body in FrameMessage.bodies
export const BODY_TYPE_CODES = { star: 0, planet: 1, hole: 2 } as const;
export const BODY_TYPE_BY_CODE = ['star', 'planet', 'hole'] as const;

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

export type WorkerToMain =
  | ReadyMessage
  | CapabilityMessage
  | UnsupportedMessage
  | StatusMessage
  | EventMessage
  | FrameMessage
  | ErrorMessage
  | RevealReadyMessage
  | PerfMessage;

// ── runtime guards (so a `MessageEvent.data` of unknown shape can be narrowed safely) ────────────

export const MAIN_TO_WORKER_TYPES = ['init', 'resize', 'pointer', 'wheel', 'control', 'command', 'dispose'] as const;
export const WORKER_TO_MAIN_TYPES = ['ready', 'capability', 'unsupported', 'status', 'event', 'frame', 'error', 'revealReady', 'perf'] as const;

function isTagged(m: unknown): m is { type: string } {
  return typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string';
}

export function isMainToWorker(m: unknown): m is MainToWorker {
  return isTagged(m) && (MAIN_TO_WORKER_TYPES as readonly string[]).includes(m.type);
}

export function isWorkerToMain(m: unknown): m is WorkerToMain {
  return isTagged(m) && (WORKER_TO_MAIN_TYPES as readonly string[]).includes(m.type);
}
