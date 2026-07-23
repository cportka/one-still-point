import type { WebGPURenderer } from 'three/webgpu';

/**
 * The frame driver. Each animation frame it measures the elapsed time from the
 * loop's **vsync-aligned timestamp** (clamped against background-tab stalls) and
 * hands it to the tick callback, which advances time (see TimeController),
 * updates the camera, and renders.
 */
export class Loop {
  /** Seconds between the previous and current *rendered* frames' vsync timestamps. */
  frameDelta = 0;

  onTick: (frameDelta: number) => void = () => {};

  /** Cap the render rate to at most this many fps (0 = uncapped / display rate).
   *  Frames that arrive too soon are skipped, so the achieved rate locks to the
   *  nearest divisor of the display refresh — 24 → exactly 24 on a 120 Hz panel,
   *  ~20 (every 3rd frame) on 60 Hz — which keeps the pacing even (no telecine
   *  judder). The extra per-frame budget lets the GPU hold full resolution. */
  maxFps = 0;

  private last = 0; // timestamp of the last rendered frame
  private running = false;

  constructor(private readonly renderer: WebGPURenderer) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    void this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    void this.renderer.setAnimationLoop(null);
  }

  private readonly tick = (time?: number): void => {
    // Use the animation loop's VSYNC-ALIGNED timestamp, not performance.now(): the callback's
    // *execution* start wanders inside each frame slot (scheduling, GC, GPU backpressure), so a
    // wall-clock read here made frameDelta oscillate around the true frame interval — bodies
    // advanced by a jittery dt but were PRESENTED on the even vsync grid, which reads as a
    // few-pixel back-and-forth shimmer on the fastest movers. Live-only, and invisible in a
    // share recording (frames are re-timed evenly on capture) — which is exactly how it was
    // caught: the on-device clip was smooth while the screen wasn't. Timestamps between frames
    // are refresh-interval multiples, so the deltas are exact. (The rAF timestamp shares
    // performance.now()'s time origin, so start()'s epoch and the fallback stay comparable.)
    const now = typeof time === 'number' ? time : performance.now();
    const elapsed = (now - this.last) / 1000;
    // Frame cap: skip this animation frame if not enough time has passed (a 2 ms
    // slack so it locks cleanly to the nearest refresh divisor).
    if (this.maxFps > 0 && elapsed < 1 / this.maxFps - 0.002) return;
    this.frameDelta = Math.min(elapsed, 0.1); // clamp background-tab / cap stalls
    this.last = now;
    this.onTick(this.frameDelta);
  };
}
