import { describe, expect, it } from 'vitest';
import { createRotation } from './rotation';

/** A tiny deterministic rng (mulberry32) so seam behaviour is reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('createRotation (the music pool order)', () => {
  it('plays every track exactly once per cycle', () => {
    const next = createRotation(5, seeded(1));
    for (let cycle = 0; cycle < 20; cycle++) {
      const seen = new Set(Array.from({ length: 5 }, () => next()));
      expect(seen).toEqual(new Set([0, 1, 2, 3, 4]));
    }
  });

  it('never plays the same track twice in a row — across 500 draws and many seeds', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const next = createRotation(4, seeded(seed));
      let prev = -1;
      for (let k = 0; k < 500; k++) {
        const cur = next();
        expect(cur).not.toBe(prev);
        prev = cur;
      }
    }
  });

  it('a single-track pool legitimately repeats; an empty pool answers −1', () => {
    const one = createRotation(1, seeded(7));
    expect([one(), one(), one()]).toEqual([0, 0, 0]);
    const none = createRotation(0);
    expect(none()).toBe(-1);
  });
});
