import { describe, expect, it } from 'vitest';
import { drawingBufferSize, SizeLatch } from './renderSize';

describe('drawingBufferSize', () => {
  it('scales the CSS viewport by the DPR cap and the render scale', () => {
    expect(drawingBufferSize(800, 600, 2, 1)).toEqual({ w: 1600, h: 1200 });
    expect(drawingBufferSize(800, 600, 2, 0.5)).toEqual({ w: 800, h: 600 });
    expect(drawingBufferSize(390, 844, 2, 0.22)).toEqual({ w: 171, h: 371 });
  });

  it('never yields a zero-sized buffer, however small the scale', () => {
    const { w, h } = drawingBufferSize(320, 200, 1, 0.0001);
    expect(w).toBeGreaterThanOrEqual(1);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

describe('SizeLatch', () => {
  it('commits the first size, then refuses an identical one', () => {
    const latch = new SizeLatch();
    expect(latch.commit(1600, 1200)).toBe(true);
    expect(latch.commit(1600, 1200)).toBe(false);
    expect(latch.commit(1600, 1200)).toBe(false);
  });

  it('commits again as soon as either dimension moves', () => {
    const latch = new SizeLatch();
    latch.commit(1600, 1200);
    expect(latch.commit(1601, 1200)).toBe(true);
    expect(latch.commit(1601, 1199)).toBe(true);
    expect(latch.commit(1601, 1199)).toBe(false);
  });

  it('commits a 1×1 buffer — a real size is never mistaken for "nothing latched yet"', () => {
    const latch = new SizeLatch();
    expect(latch.commit(1, 1)).toBe(true);
    expect(latch.commit(1, 1)).toBe(false);
  });

  it('reset() forces the next commit through, for targets torn down behind our back', () => {
    const latch = new SizeLatch();
    latch.commit(1600, 1200);
    latch.reset();
    expect(latch.commit(1600, 1200)).toBe(true);
  });

  /**
   * The reveal is the case this exists for. The scaler climbs from the intro's deep cut toward
   * native under a *continuously ramping* ceiling, so it asks for a resize far more often than
   * the buffer actually changes — and each committed one disposes and reallocates the bloom
   * chain plus the HDR pass target. Only the steps that move the integer size may cost that.
   */
  it('collapses a reveal climb to one rebuild per distinct buffer size', () => {
    const latch = new SizeLatch();
    const cssW = 390;
    const cssH = 844;
    let rebuilds = 0;
    // A ramping ceiling produces many nearly-identical scales; several round to the same buffer.
    for (const scale of [0.22, 0.2201, 0.2202, 0.32, 0.3201, 0.42, 0.42, 0.52]) {
      const { w, h } = drawingBufferSize(cssW, cssH, 2, scale);
      if (latch.commit(w, h)) rebuilds += 1;
    }
    expect(rebuilds).toBe(4); // 0.22 · 0.32 · 0.42 · 0.52 — the four that actually differ
  });
});
