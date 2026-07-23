import { describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { Loop } from './Loop';

/** A stub renderer that hands back the registered animation-loop callback. */
function harness(): { loop: Loop; fire: (time?: number) => void } {
  let cb: ((time?: number) => void) | null = null;
  const renderer = {
    setAnimationLoop: (fn: ((time?: number) => void) | null) => {
      cb = fn;
    },
  } as unknown as WebGPURenderer;
  const loop = new Loop(renderer);
  return { loop, fire: (time?: number) => cb?.(time) };
}

describe('Loop (the frame driver)', () => {
  it('derives frameDelta from the VSYNC timestamps, not wall-clock at callback time', () => {
    // The judder lesson (v0.100.2): the callback's execution start wanders inside each frame
    // slot, so measuring performance.now() here oscillated frameDelta around the true frame
    // interval — a few-pixel back-and-forth shimmer on fast orbiting bodies, live only (share
    // recordings re-time frames evenly, which is how the on-device report caught it). The loop
    // must trust the animation-loop timestamp; deltas then come out as exact vsync multiples.
    const { loop, fire } = harness();
    const deltas: number[] = [];
    loop.onTick = (fd) => deltas.push(fd);
    const wallClock = vi.spyOn(performance, 'now').mockReturnValue(0);
    loop.start();
    fire(1000);
    // Even 60 Hz vsync stamps; wall-clock (mocked frozen at 0) must NOT be consulted between them.
    const before = wallClock.mock.calls.length;
    fire(1016.6667);
    fire(1033.3333);
    fire(1050);
    expect(wallClock.mock.calls.length).toBe(before); // timestamps used — no wall-clock reads
    expect(deltas.slice(1).every((d) => Math.abs(d - 1 / 60) < 1e-4)).toBe(true);
    wallClock.mockRestore();
  });

  it('falls back to performance.now() when no timestamp arrives (exotic hosts)', () => {
    const { loop, fire } = harness();
    const deltas: number[] = [];
    loop.onTick = (fd) => deltas.push(fd);
    const wallClock = vi.spyOn(performance, 'now');
    wallClock.mockReturnValue(0);
    loop.start();
    wallClock.mockReturnValue(80);
    fire(); // no timestamp
    expect(deltas.at(-1)).toBeCloseTo(0.08, 5);
    wallClock.mockRestore();
  });

  it('clamps a background-tab stall to 100 ms of sim time', () => {
    const { loop, fire } = harness();
    const deltas: number[] = [];
    loop.onTick = (fd) => deltas.push(fd);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    loop.start();
    fire(0);
    fire(5000); // 5 s in the background
    expect(deltas.at(-1)).toBe(0.1);
    vi.restoreAllMocks();
  });

  it('maxFps skips too-soon frames and locks to a refresh divisor', () => {
    const { loop, fire } = harness();
    let ticks = 0;
    loop.onTick = () => ticks++;
    vi.spyOn(performance, 'now').mockReturnValue(0);
    loop.maxFps = 30;
    loop.start();
    // 120 Hz vsync stamps: only every 4th frame (33.3 ms apart) should tick.
    for (let i = 0; i <= 12; i++) fire(i * 8.3333);
    expect(ticks).toBe(3); // t=33.3, 66.7, 100 — a clean 30 fps lock
    vi.restoreAllMocks();
  });
});
