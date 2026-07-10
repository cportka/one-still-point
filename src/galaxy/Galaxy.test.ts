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

  it('exposes a compact default disk (rInner/rOuter) the camera can frame within its dolly reach', () => {
    const g = new Galaxy({ rng: seeded(9) });
    expect(g.rInner).toBe(6);
    expect(g.rOuter).toBe(64);
    // rOuter × the render layer's 2.35 framing factor must stay inside OrbitControls' maxDistance (240),
    // or the auto-frame would clamp short and cut the disk off. 64 × 2.35 ≈ 150 ✓.
    expect(g.rOuter * 2.35).toBeLessThan(240);
    // The outer stars actually reach toward that edge (so the framing radius is honest).
    let maxR = 0;
    for (let i = 0; i < g.count; i++) {
      maxR = Math.max(maxR, Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 2]!));
    }
    expect(maxR).toBeGreaterThan(g.rOuter * 0.6);
    expect(maxR).toBeLessThanOrEqual(g.rOuter + 1e-3);
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
    // A clean inner/outer pair; compare Kepler rates over one small step. Measure each star's swept
    // angle in the xz-plane as the *unsigned* angle between its before/after position vectors —
    // atan2(|x0·z1 − z0·x1|, x0·x1 + z0·z1) ∈ [0, π]. This is wrap-safe: a raw `atan2` difference
    // jumps 2π across the ±π branch cut, which for a star sitting near that cut spuriously reads a
    // near-full-turn sweep and would flip the comparison (a latent flake on ~0.2% of seeds).
    const before = radii(g, 2);
    const x0 = [g.positions[0]!, g.positions[3]!];
    const z0 = [g.positions[2]!, g.positions[5]!];
    g.update(0.01, 100);
    const x1 = [g.positions[0]!, g.positions[3]!];
    const z1 = [g.positions[2]!, g.positions[5]!];
    const swept = [0, 1].map((i) =>
      Math.atan2(Math.abs(x0[i]! * z1[i]! - z0[i]! * x1[i]!), x0[i]! * x1[i]! + z0[i]! * z1[i]!),
    );
    const inner = before[0]! < before[1]! ? 0 : 1;
    expect(swept[inner]!).toBeGreaterThan(swept[1 - inner]!); // the inner star turned more
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

  it('defaults to a dense spiral with a distinct bulge population', () => {
    const g = new Galaxy({ rng: seeded(11) });
    expect(g.count).toBe(1600);
    expect(g.bulgeCount).toBe(480); // 30% of the stars form the central bulge
    expect(g.bulgeCount).toBeLessThan(g.count);
  });

  it('packs a warm bulge that fills the core (no dark centre)', () => {
    const g = new Galaxy({ count: 1000, planetFraction: 0, rng: seeded(7) });
    expect(g.bulgeCount).toBe(300);
    // Every bulge star (they sit at the tail of the star range) lands inside the core radius, so the
    // centre is packed with light rather than an empty gap.
    let inside = 0;
    let warmR = 0;
    let warmB = 0;
    for (let i = g.count - g.bulgeCount; i < g.count; i++) {
      const rr = Math.hypot(g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!);
      if (rr < g.rInner + 1e-3) inside += 1;
      warmR += g.colors[i * 3]!;
      warmB += g.colors[i * 3 + 2]!;
    }
    expect(inside).toBe(g.bulgeCount); // the whole bulge is inside rInner
    expect(warmR).toBeGreaterThan(warmB); // …and it's warm (gold core, red > blue)
  });

  it('gives the disk a blue-white young-arm population (temperature contrast)', () => {
    const g = new Galaxy({ count: 1000, planetFraction: 0, rng: seeded(8) });
    // A real chunk of the disk is genuinely blue (B clearly above R) — the young stars on the arms.
    let blue = 0;
    for (let i = 0; i < g.count - g.bulgeCount; i++) {
      if (g.colors[i * 3 + 2]! > g.colors[i * 3]! * 1.1) blue += 1;
    }
    expect(blue).toBeGreaterThan(50);
  });

  it('dark matter flattens the rotation curve; dark energy stalls the outer edge', () => {
    const g = new Galaxy({ count: 10, rng: seeded(5) });

    // Pure Kepler (no dark sector): a steeply falling curve — always slower outward.
    g.setDark(0, 0);
    const keplerInner = g.omegaAt(6);
    const keplerOuter = g.omegaAt(64);
    expect(keplerInner).toBeGreaterThan(keplerOuter);

    // Dark-matter halo: the outer rate lifts (a flatter curve — outer stars keep up better)…
    g.setDark(1, 0);
    expect(g.omegaAt(64)).toBeGreaterThan(keplerOuter);
    expect(g.omegaAt(6) / g.omegaAt(64)).toBeLessThan(keplerInner / keplerOuter);
    // …yet it stays monotonic (inner faster than outer → the arms still wind forward, no reversal).
    expect(g.omegaAt(10)).toBeGreaterThan(g.omegaAt(50));

    // Dark energy at full strength overwhelms gravity at the outer edge → it freezes (fixed radii
    // can't actually unbind — the test-particle limit); the inner disk still turns.
    g.setDark(0, 1);
    expect(g.omegaAt(64)).toBe(0);
    expect(g.omegaAt(6)).toBeGreaterThan(0);
  });
});
