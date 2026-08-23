import { describe, expect, it } from 'vitest';
import { RevealProfiler } from './RevealProfiler';

describe('RevealProfiler', () => {
  describe('marks (named spans)', () => {
    it('records a begin/end span as its duration in ms', () => {
      const p = new RevealProfiler();
      p.begin('compile', 1000);
      p.end('compile', 1380.5);
      expect(p.report().marks).toEqual({ compile: 380.5 });
    });

    it('rounds durations to 0.01 ms', () => {
      const p = new RevealProfiler();
      p.begin('init', 0);
      p.end('init', 42.126);
      expect(p.report().marks.init).toBe(42.13);
    });

    it('ignores an end with no matching begin', () => {
      const p = new RevealProfiler();
      p.end('never-begun', 100);
      expect(p.report().marks).toEqual({});
    });

    it('records a duration directly', () => {
      const p = new RevealProfiler();
      p.record('bootToLoop', 521);
      expect(p.report().marks.bootToLoop).toBe(521);
    });

    it('keeps independent overlapping spans', () => {
      const p = new RevealProfiler();
      p.begin('outer', 0);
      p.begin('inner', 10);
      p.end('inner', 30);
      p.end('outer', 100);
      expect(p.report().marks).toEqual({ outer: 100, inner: 20 });
    });
  });

  describe('frames (inter-frame intervals)', () => {
    it('reports null frame stats before any frame', () => {
      expect(new RevealProfiler().report().frames).toBeNull();
    });

    it('the first tick only seeds the clock (no interval yet)', () => {
      const p = new RevealProfiler();
      expect(p.tick(1000)).toBe(false);
      expect(p.report().frames).toBeNull();
    });

    it('captures the true unclamped interval between ticks', () => {
      const p = new RevealProfiler({ frameCap: 4 });
      p.tick(0);
      p.tick(16); // 16 ms
      p.tick(216); // a 200 ms hitch — not clamped (Loop's frameDelta would cap at 100)
      const f = p.report().frames!;
      expect(f.count).toBe(2);
      expect(f.maxMs).toBe(200);
    });

    it('computes mean / p50 / p95 / max / jank count', () => {
      const p = new RevealProfiler({ frameCap: 10, jankMs: 33 });
      // intervals: 10,20,30,40,50 (the 40 and 50 are janks > 33)
      const times = [0, 10, 30, 60, 100, 150];
      for (const t of times) p.tick(t);
      const f = p.report().frames!;
      expect(f.count).toBe(5);
      expect(f.meanMs).toBe(30); // (10+20+30+40+50)/5
      expect(f.p50Ms).toBe(30);
      expect(f.maxMs).toBe(50);
      expect(f.janks).toBe(2);
    });

    it('stops capturing once the window is full and fires complete exactly once', () => {
      const p = new RevealProfiler({ frameCap: 2 });
      expect(p.tick(0)).toBe(false); // seed
      expect(p.tick(10)).toBe(false); // 1st interval
      expect(p.complete).toBe(false);
      expect(p.tick(20)).toBe(true); // 2nd interval → fills the window
      expect(p.complete).toBe(true);
      expect(p.tick(30)).toBe(false); // already full → not "just filled", ignored
      expect(p.report().frames!.count).toBe(2);
    });
  });

  describe('resizes', () => {
    it('counts reveal-window resizes', () => {
      const p = new RevealProfiler();
      expect(p.report().resizes).toBe(0);
      p.tick(0); // the window opens with the first frame
      p.countResize();
      p.countResize();
      expect(p.report().resizes).toBe(2);
    });
  });

  it('produces a full report combining marks, frames, and resizes', () => {
    const p = new RevealProfiler({ frameCap: 2 });
    p.record('compile', 300);
    p.tick(0);
    p.tick(16);
    p.countResize();
    p.tick(32);
    const r = p.report();
    expect(r.marks.compile).toBe(300);
    expect(r.frames!.count).toBe(2);
    expect(r.resizes).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('counts resizes only across the window the frame stats describe', () => {
    const p = new RevealProfiler({ frameCap: 2 });
    p.countResize(); // boot + the intro scale arm resize while the splash still covers everything
    p.countResize();
    p.tick(0);
    p.countResize(); // inside the window
    p.tick(16);
    p.tick(32); // window full
    p.countResize(); // a later, unrelated resize — not part of this reveal
    p.countResize();
    expect(p.report().resizes).toBe(1);
  });

  describe('jank attribution (when, not just how many)', () => {
    it('stamps each jank at its offset from the loop’s first frame', () => {
      const p = new RevealProfiler({ frameCap: 6, jankMs: 33 });
      // Absolute clock deliberately does NOT start at 0 — offsets must be relative to frame 1.
      const times = [5000, 5016, 5032, 5090, 5106, 5122, 5180];
      for (const t of times) p.tick(t);
      const f = p.report().frames!;
      expect(f.janks).toBe(2); // the 58 ms and 58 ms gaps
      expect(f.jankAtMs).toEqual([90, 180]); // ms since t=5000, stamped at the frame's end
    });

    it('reports no jank offsets for a clean run', () => {
      const p = new RevealProfiler({ frameCap: 3 });
      for (const t of [0, 16, 32, 48]) p.tick(t);
      expect(p.report().frames!.jankAtMs).toEqual([]);
    });

    it('stamps resizes on the same timeline, so they line up against the janks', () => {
      const p = new RevealProfiler({ frameCap: 4 });
      p.tick(1000);
      p.tick(1016);
      p.countResize(); // observed at the latest frame → 16 ms in
      p.tick(1080); // a 64 ms jank right after the rebuild
      p.tick(1096);
      const r = p.report();
      expect(r.resizeAtMs).toEqual([16]);
      expect(r.frames!.jankAtMs).toEqual([80]);
    });

    it('the report snapshot does not alias internal state', () => {
      const p = new RevealProfiler({ frameCap: 3 });
      for (const t of [0, 100, 116, 232]) p.tick(t);
      const first = p.report();
      first.frames!.jankAtMs.push(9999);
      first.resizeAtMs.push(9999);
      expect(p.report().frames!.jankAtMs).toEqual([100, 232]);
      expect(p.report().resizeAtMs).toEqual([]);
    });
  });
});
