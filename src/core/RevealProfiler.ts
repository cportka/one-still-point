/**
 * Reveal profiler — captures the **cold first-load reveal**'s real timings so the
 * splash→engine hitch (roadmap #1) can be *measured*, not guessed.
 *
 * Why it has to live in the app at all: this project's CI GPU is headless
 * (swiftshader) — it renders black and the WebGPU canvas can't be captured by any
 * method — so the reveal's frame-times only exist on a real device. This exposes
 * them at `osp.perf`: open the console on the target Mac/phone after a cold load
 * and read `osp.perf.report()` (the loop also logs it once the first-frames window
 * fills), or compare two URL-param'd builds on the same device.
 *
 * It is **pure** — the caller passes timestamps (`performance.now()`) and absolute
 * frame times, so it unit-tests with no DOM/GPU and no clock of its own. Two kinds
 * of signal:
 *   - **marks** — named span durations (renderer init, shader compile, boot→loop,
 *     loop→reveal), via `begin`/`end` or `record`.
 *   - **frames** — the *true, unclamped* inter-frame interval over the first N live
 *     frames (`tick`). Inter-frame interval is the smoothness signal: a frame the
 *     GPU can't finish in one vsync stretches the interval, so a hitch reads as a
 *     long interval (and a jank). We measure it here rather than reusing the loop's
 *     `frameDelta`, which is clamped to 100 ms (`Loop.ts`) and would hide the worst
 *     hitches — exactly the ones we care about.
 */

export interface RevealStats {
  /** Frames captured (≤ `frameCap`). */
  count: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  /** The worst single inter-frame interval — the biggest hitch. */
  maxMs: number;
  /** Frames slower than `jankMs` — the visible stutters. */
  janks: number;
}

export interface RevealReport {
  /** Named span durations in ms (rendererInit, compile, bootToLoop, loopToReveal, …). */
  marks: Record<string, number>;
  /** WHEN each mark finished, in seconds since the page's time origin (1 decimal) — so a freeze
   *  seen at t≈14.7s in a screen recording can be matched to the mark that caused it (v0.96.1;
   *  spans recorded without an end time are omitted). */
  marksAt: Record<string, number>;
  /** Inter-frame-interval stats over the first `frameCap` live frames, or null before any. */
  frames: RevealStats | null;
  /** Resolution-scaler resizes during the reveal window — each is a pipeline-target rebuild hitch. */
  resizes: number;
  /** True once the first-frames window is full (the report is final). */
  complete: boolean;
}

const round2 = (ms: number): number => Math.round(ms * 100) / 100;

export class RevealProfiler {
  /** How many live frames the smoothness window spans. */
  readonly frameCap: number;
  /** Interval (ms) above which a frame counts as a visible hitch — 33 ms ≈ a dropped frame at 60 Hz. */
  readonly jankMs: number;
  /** Scaler resizes seen during the reveal (set by the loop via `countResize`). */
  resizes = 0;

  private readonly marks = new Map<string, { ms: number; at: number }>();
  private readonly open = new Map<string, number>();
  private readonly frames: number[] = [];
  private lastTickMs = -1; // seeds on the first tick; -1 = no frame yet

  constructor(opts: { frameCap?: number; jankMs?: number } = {}) {
    this.frameCap = opts.frameCap ?? 120;
    this.jankMs = opts.jankMs ?? 33;
  }

  /** Open a named span at time `nowMs` (`performance.now()`). */
  begin(name: string, nowMs: number): void {
    this.open.set(name, nowMs);
  }

  /** Close a named span at time `nowMs`; records `nowMs − begin` (and when it ended). No-op if never begun. */
  end(name: string, nowMs: number): void {
    const t0 = this.open.get(name);
    if (t0 === undefined) return;
    this.open.delete(name);
    this.marks.set(name, { ms: nowMs - t0, at: nowMs });
  }

  /** Record a span duration directly (ms) — for a span timed elsewhere. Pass `atMs`
   *  (`performance.now()` at the span's end) so the mark lands on the `marksAt` timeline. */
  record(name: string, ms: number, atMs = -1): void {
    this.marks.set(name, { ms, at: atMs });
  }

  /**
   * Note a live frame at absolute time `nowMs`. The first call only seeds the clock;
   * each later call pushes the true (unclamped) interval since the previous frame,
   * until the window is full. Returns true on the single frame that *fills* it (so
   * the caller can log the final report exactly once).
   */
  tick(nowMs: number): boolean {
    const wasComplete = this.complete;
    if (this.lastTickMs >= 0 && this.frames.length < this.frameCap) {
      this.frames.push(nowMs - this.lastTickMs);
    }
    this.lastTickMs = nowMs;
    return !wasComplete && this.complete;
  }

  /** True once the first-frames window is full (the report won't change after this). */
  get complete(): boolean {
    return this.frames.length >= this.frameCap;
  }

  /** Count one reveal-window resolution resize (each rebuilds the bloom/FXAA targets — a GPU hitch). */
  countResize(): void {
    this.resizes += 1;
  }

  /** A snapshot of everything captured so far (safe to call any time). */
  report(): RevealReport {
    const marks: Record<string, number> = {};
    const marksAt: Record<string, number> = {};
    for (const [name, m] of this.marks) {
      marks[name] = round2(m.ms);
      if (m.at >= 0) marksAt[name] = Math.round(m.at / 100) / 10; // seconds, 1 decimal
    }
    return {
      marks,
      marksAt,
      frames: this.frames.length ? stats(this.frames, this.jankMs) : null,
      resizes: this.resizes,
      complete: this.complete,
    };
  }
}

function stats(samples: number[], jankMs: number): RevealStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const at = (i: number): number => sorted[i] ?? 0; // caller guarantees n ≥ 1, so the fallback is unreachable
  const pct = (p: number): number => at(Math.min(n - 1, Math.floor(p * (n - 1))));
  return {
    count: n,
    meanMs: round2(sum / n),
    p50Ms: round2(pct(0.5)),
    p95Ms: round2(pct(0.95)),
    maxMs: round2(at(n - 1)),
    janks: samples.filter((ms) => ms > jankMs).length,
  };
}
