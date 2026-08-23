import { MAX_BODIES } from '../render/bodyUniforms';
import type { Body } from '../scene/Body';

const STRIDE = 6; // [x, y, z, vx, vy, vz] per body
const SLOTS = MAX_BODIES; // max movable bodies a frame can hold (the primary is fixed)

/** One restorable simulation snapshot — a view, valid until the next record(). */
export interface HistoryFrame {
  /** Bumps whenever the body *set* changes (add / remove / reseed), so a restore
   *  is only valid within a run of identical layout. */
  readonly generation: number;
  /** Movable-body ids, in order. */
  readonly ids: Int32Array;
  /** `[x, y, z, vx, vy, vz]` per body, `ids.length * 6` long. */
  readonly state: Float32Array;
}

/**
 * A bounded, **zero-allocation** ring buffer of simulation snapshots — the
 * foundation for a future timeline / scrub bar (Tier 2). There is no UI yet: each
 * running frame the loop `record()`s the movable bodies' kinematics into
 * pre-allocated slots (a cheap copy, no per-frame garbage), and a future scrub
 * will `restore()` a past frame back onto the bodies. Because the gravity
 * integrator is time-reversible, exact replay is possible — but body-set changes
 * are not, so each snapshot carries a `generation` and its ids: a restore only
 * applies while the layout still matches.
 */
export class History {
  readonly capacity: number;
  private readonly state: Float32Array;
  private readonly ids: Int32Array;
  private readonly counts: Int32Array;
  private readonly gens: Int32Array;
  private head = -1; // ring index of the most recent frame
  private count = 0; // recorded frames so far (≤ capacity)
  private total = 0; // frames ever recorded (monotonic) — a stable axis for the scrub bar
  private generation = 0;
  private prevIds: number[] = [];
  /** Swapped with `prevIds` each roster check so neither array is reallocated (see idsChanged). */
  private scratch: number[] = [];

  constructor(capacity = 7200 /* ~2 min at 60 fps — the scrub bar's tracked window */) {
    this.capacity = capacity;
    this.state = new Float32Array(capacity * SLOTS * STRIDE);
    this.ids = new Int32Array(capacity * SLOTS);
    this.counts = new Int32Array(capacity);
    this.gens = new Int32Array(capacity);
  }

  /** Number of recorded frames (≤ capacity). */
  get length(): number {
    return this.count;
  }

  /** The current generation (bumped when the body set last changed). */
  get currentGeneration(): number {
    return this.generation;
  }

  /** Total frames ever recorded (monotonic — never wraps). The scrub bar uses this
   *  as a stable time axis: the live window spans absolute indices
   *  `[recorded − length, recorded − 1]`, and a transient event tagged with the
   *  `recorded` value at the time keeps a fixed position as the window scrolls. */
  get recorded(): number {
    return this.total;
  }

  /** How many of the most-recent frames share the current generation — the span a
   *  scrub can actually `restore()` (older frames have a different body layout, so a
   *  restore there would no-op). 0 when nothing is recorded. */
  get restorableLength(): number {
    let n = 0;
    for (let back = 0; back < this.count; back++) {
      const idx = (this.head - back + this.capacity) % this.capacity;
      if (this.gens[idx] !== this.generation) break;
      n += 1;
    }
    return n;
  }

  /** Snapshot the movable bodies into the next ring slot. No allocation — a typed
   *  copy of up to `MAX_BODIES` bodies. Detects a body-set change (ids differ from
   *  the previous frame) and bumps the generation. */
  record(bodies: Body[]): void {
    let n = 0;
    const changed = this.idsChanged(bodies);
    if (changed) this.generation += 1;
    this.head = (this.head + 1) % this.capacity;
    const base = this.head * SLOTS;
    for (let i = 0; i < bodies.length && n < SLOTS; i++) {
      const b = bodies[i]!;
      if (b.fixed) continue;
      if (b.unborn) continue; // a seeded body not yet born onto the timeline — recorded from its birth
      this.ids[base + n] = b.id;
      const o = (base + n) * STRIDE;
      this.state[o] = b.position.x;
      this.state[o + 1] = b.position.y;
      this.state[o + 2] = b.position.z;
      this.state[o + 3] = b.velocity.x;
      this.state[o + 4] = b.velocity.y;
      this.state[o + 5] = b.velocity.z;
      n += 1;
    }
    this.counts[this.head] = n;
    this.gens[this.head] = this.generation;
    this.count = Math.min(this.count + 1, this.capacity);
    this.total += 1;
  }

  /** The frame `back` steps before the latest (0 = latest), or null if out of
   *  range. The returned arrays are **copies**, safe to hold past the next record. */
  peek(back: number): HistoryFrame | null {
    if (back < 0 || back >= this.count) return null;
    const idx = (this.head - back + this.capacity) % this.capacity;
    const n = this.counts[idx]!;
    return {
      generation: this.gens[idx]!,
      ids: this.ids.slice(idx * SLOTS, idx * SLOTS + n),
      state: this.state.slice(idx * SLOTS * STRIDE, idx * SLOTS * STRIDE + n * STRIDE),
    };
  }

  /** Write a frame's kinematics back onto the bodies — only if the body set still
   *  matches it (same ids, in order). Returns whether it applied. */
  restore(frame: HistoryFrame, bodies: Body[]): boolean {
    const movable = bodies.filter((b) => !b.fixed);
    if (movable.length !== frame.ids.length) return false;
    for (let i = 0; i < movable.length; i++) if (movable[i]!.id !== frame.ids[i]) return false;
    for (let i = 0; i < movable.length; i++) {
      const b = movable[i]!;
      const o = i * STRIDE;
      b.position.set(frame.state[o]!, frame.state[o + 1]!, frame.state[o + 2]!);
      b.velocity.set(frame.state[o + 3]!, frame.state[o + 4]!, frame.state[o + 5]!);
    }
    return true;
  }

  /** Drop all recorded history (e.g. on Replay / reseed). */
  clear(): void {
    this.head = -1;
    this.count = 0;
    this.prevIds = [];
  }

  /** Discard the `dropNewest` most-recent frames — used when a live edit made *while scrubbed* makes
   *  the scrubbed moment the new live edge: the recorded "future" is thrown away so fresh history
   *  accrues from here. Rewinds the head, the count, and the monotonic `total` (so logged events stay
   *  aligned to their frames), and restores `generation`/`prevIds` to the new newest frame — so the
   *  next `record()` sees the edit's roster change and opens a clean new generation. `dropNewest` is
   *  clamped to the recorded length. */
  truncate(dropNewest: number): void {
    const drop = Math.min(Math.max(0, Math.floor(dropNewest)), this.count);
    if (drop === 0) return;
    this.head = (this.head - drop + this.capacity) % this.capacity;
    this.count -= drop;
    this.total -= drop;
    if (this.count > 0) {
      this.generation = this.gens[this.head]!;
      this.prevIds = this.idsAt(this.head);
    } else {
      this.head = -1;
      this.prevIds = [];
    }
  }

  /** The movable-body ids stored in ring slot `idx`, in order — used to re-seed `prevIds` after a
   *  truncate so the next record's change-detection compares against the (new) newest frame. */
  private idsAt(idx: number): number[] {
    const n = this.counts[idx]!;
    const base = idx * SLOTS;
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.ids[base + i]!);
    return out;
  }

  /** Roster comparison against the previous recorded frame. Runs on every recorded frame, so it
   *  writes into a reused scratch array rather than allocating one per frame — a fresh array
   *  each frame is exactly the kind of steady nursery churn that shows up as a fat tail in the
   *  reveal's frame times. `prevIds` and `scratch` swap, so neither is ever reallocated. */
  private idsChanged(bodies: Body[]): boolean {
    const ids = this.scratch;
    let n = 0;
    for (const b of bodies) if (!b.fixed && !b.unborn) ids[n++] = b.id; // unborn aren't in the roster yet
    let changed = n !== this.prevIds.length;
    if (!changed) for (let i = 0; i < n; i++) if (ids[i] !== this.prevIds[i]) { changed = true; break; }
    ids.length = n;
    this.scratch = this.prevIds;
    this.prevIds = ids;
    return changed;
  }
}
