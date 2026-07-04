import { describe, expect, it } from 'vitest';
import { Galaxy } from './Galaxy';

/** Deterministic rng (mulberry32) so the generated galaxy is reproducible. */
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

const radii = (g: Galaxy, n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = g.positions[i * 3]!;
    const y = g.positions[i * 3 + 1]!;
    const z = g.positions[i * 3 + 2]!;
    out.push(Math.hypot(x, y, z));
  }
  return out;
};

describe('Galaxy (the pure orbital core)', () => {
  it('generates the requested star count + a planet fraction, with sane arrays', () => {
    const g = new Galaxy({ count: 1000, planetFraction: 0.15, rng: seeded(1) });
    expect(g.count).toBe(1000);
    expect(g.planetCount).toBe(150);
    expect(g.total).toBe(1150);
    expect(g.positions.length).toBe(1150 * 3);
    expect(g.colors.length).toBe(1150 * 3);
    for (let i = 0; i < g.positions.length; i++) expect(Number.isFinite(g.positions[i]!)).toBe(true);
  });

  it('places stars inside the disk band, thin in height (a disk, not a sphere)', () => {
    const g = new Galaxy({ count: 800, rInner: 8, rOuter: 140, planetFraction: 0, rng: seeded(2) });
    let maxY = 0;
    let maxR = 0;
    for (let i = 0; i < g.count; i++) {
      const y = Math.abs(g.positions[i * 3 + 1]!);
      const rxz = Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 2]!);
      maxY = Math.max(maxY, y);
      maxR = Math.max(maxR, rxz);
    }
    expect(maxR).toBeGreaterThan(80); // fills out toward the outer edge
    expect(maxR).toBeLessThanOrEqual(140 + 1e-3); // …but not past it
    expect(maxY).toBeLessThan(maxR * 0.4); // clearly flattened — a disk
  });

  it('rotates differentially: inner stars sweep faster than outer ones', () => {
    const g = new Galaxy({ count: 2, rInner: 10, rOuter: 100, planetFraction: 0, rng: seeded(3) });
    // Force a clean inner/outer pair to compare Kepler rates via one small step.
    // (Both start somewhere on their orbit; measure the angle each sweeps.)
    const before = radii(g, 2);
    const a0 = Math.atan2(g.positions[2]!, g.positions[0]!);
    const b0 = Math.atan2(g.positions[5]!, g.positions[3]!);
    g.update(0.01, 100);
    const a1 = Math.atan2(g.positions[2]!, g.positions[0]!);
    const b1 = Math.atan2(g.positions[5]!, g.positions[3]!);
    const inner = before[0]! < before[1]! ? 0 : 1;
    const swept = [Math.abs(a1 - a0), Math.abs(b1 - b0)];
    expect(swept[inner]).toBeGreaterThan(swept[1 - inner]); // the inner star turned more
  });

  it('reveal scales every orbit from the centre outward (the transition bloom)', () => {
    const g = new Galaxy({ count: 300, planetFraction: 0, rng: seeded(4) });
    g.update(0, 1, 1);
    const full = radii(g, 300).reduce((a, b) => a + b, 0);
    g.update(0, 1, 0); // fully collapsed → everything at the centre
    for (const rr of radii(g, 300)) expect(rr).toBeLessThan(1e-4);
    g.update(0, 1, 0.5); // half-bloomed → half the radii
    const half = radii(g, 300).reduce((a, b) => a + b, 0);
    expect(half).toBeCloseTo(full * 0.5, 1);
  });

  it('planets ride near their parent star, not the galactic centre', () => {
    const g = new Galaxy({ count: 100, planetFraction: 0.2, rng: seeded(5) });
    g.update(0, 1, 1);
    for (let k = 0; k < g.planetCount; k++) {
      const pi = g.count + k;
      const parent = k;
      const d = Math.hypot(
        g.positions[pi * 3]! - g.positions[parent * 3]!,
        g.positions[pi * 3 + 1]! - g.positions[parent * 3 + 1]!,
        g.positions[pi * 3 + 2]! - g.positions[parent * 3 + 2]!,
      );
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(6); // within the small planet-orbit radius, never off at the centre
    }
  });
});
