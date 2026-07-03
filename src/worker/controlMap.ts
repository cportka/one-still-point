/**
 * The worker-side control mapping (OffscreenCanvas step 4a): one table from a `control
 * {key, value}` message to the engine object it drives — so lil-gui stays on the main thread
 * and posts keys, and the worker applies them onto the same uniforms/setters the main-thread
 * panel binds directly. Pure (the targets are injected), so the whole table is unit-walkable
 * without a renderer (`controlMap.test.ts`).
 *
 * Keys mirror the objects they set: `bh.*` the BlackHole uniforms, `bg.*` the background
 * mode + look, `bloom.*` the post bloom, `time.*` the TimeController, `render.*` the
 * renderer/loop/quality knobs. Body add/remove/clear are **commands**, not controls — they're
 * discrete actions with side effects (physics buffer rebuilds), routed via `command` messages.
 */
import type { QualityTier } from '../core/quality';

/** A `{ value }` cell — a three.js uniform, or any object shaped like one. */
interface Cell {
  value: number;
}

/** The slice of the worker engine the control table writes to. All injectable. */
export interface ControlTargets {
  blackHole: {
    emissiveStrength: Cell;
    diskDensity: Cell;
    diskTemp: Cell;
    scatterStrength: Cell;
    extinction: Cell;
    doppler: Cell;
    redshift: Cell;
    turbAmount: Cell;
    rotationSpeed: Cell;
    volumeStep: Cell;
  };
  background: { mode: Cell; brightness: Cell; saturation: Cell; tint: Cell };
  bloom: { strength: Cell; radius: Cell; threshold: Cell };
  time: { timeScale: number; paused: boolean };
  /** `renderer.toneMappingExposure`. */
  setExposure(value: number): void;
  /** `loop.maxFps` (0 = uncapped). */
  setMaxFps(value: number): void;
  /** Re-tier quality (resolution scale bounds, DPR cap, volume step) — `'auto'` re-detects. */
  setQuality(tier: QualityTier | 'auto'): void;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);

type Apply = (t: ControlTargets, value: number | boolean | string) => void;

/** One row per panel control. A numeric setter ignores non-finite values (a malformed message
 *  must never write NaN into a live uniform). */
const TABLE: Record<string, Apply> = {
  'bh.emissiveStrength': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.emissiveStrength.value = num(v))),
  'bh.diskDensity': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.diskDensity.value = num(v))),
  'bh.diskTemp': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.diskTemp.value = num(v))),
  'bh.scatterStrength': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.scatterStrength.value = num(v))),
  'bh.extinction': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.extinction.value = num(v))),
  'bh.doppler': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.doppler.value = num(v))),
  'bh.redshift': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.redshift.value = num(v))),
  'bh.turbAmount': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.turbAmount.value = num(v))),
  'bh.rotationSpeed': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.rotationSpeed.value = num(v))),
  'bh.volumeStep': (t, v) => void (Number.isFinite(num(v)) && (t.blackHole.volumeStep.value = num(v))),
  'bg.mode': (t, v) => void (Number.isFinite(num(v)) && (t.background.mode.value = num(v))),
  'bg.brightness': (t, v) => void (Number.isFinite(num(v)) && (t.background.brightness.value = num(v))),
  'bg.saturation': (t, v) => void (Number.isFinite(num(v)) && (t.background.saturation.value = num(v))),
  'bg.tint': (t, v) => void (Number.isFinite(num(v)) && (t.background.tint.value = num(v))),
  'bloom.strength': (t, v) => void (Number.isFinite(num(v)) && (t.bloom.strength.value = num(v))),
  'bloom.radius': (t, v) => void (Number.isFinite(num(v)) && (t.bloom.radius.value = num(v))),
  'bloom.threshold': (t, v) => void (Number.isFinite(num(v)) && (t.bloom.threshold.value = num(v))),
  'time.scale': (t, v) => void (Number.isFinite(num(v)) && (t.time.timeScale = num(v))),
  'time.paused': (t, v) => void (typeof v === 'boolean' && (t.time.paused = v)),
  'render.exposure': (t, v) => void (Number.isFinite(num(v)) && t.setExposure(num(v))),
  'render.maxFps': (t, v) => void (Number.isFinite(num(v)) && t.setMaxFps(num(v))),
  'render.quality': (t, v) => {
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') t.setQuality(v);
  },
};

/** Every key the channel understands — the table-driven test walks these, and the main-thread
 *  panel imports them so a typo'd key is a type error, not a silently dead slider. */
export const CONTROL_KEYS = Object.keys(TABLE) as readonly string[];

/** Apply one control message. Returns whether the key was recognised (unknown keys are ignored —
 *  forward-compatible with a newer main thread posting keys an older worker doesn't know). */
export function applyControl(targets: ControlTargets, key: string, value: number | boolean | string): boolean {
  const apply = TABLE[key];
  if (!apply) return false;
  apply(targets, value);
  return true;
}
