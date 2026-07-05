import { describe, expect, it } from 'vitest';
import { Scene } from '../scene/Scene';
import { appearFor, createBodyUniforms, updateBodyUniforms } from './bodyUniforms';

/** The slot-0 `tidal` value for a single companion of `type` parked at radius `r`. */
function tidalAt(r: number, type: 'star' | 'hole' = 'star'): number {
  const scene = new Scene();
  scene.clearCompanions();
  const b = type === 'hole' ? scene.addBlackHole() : scene.addStar();
  b.position.set(r, 0, 0); // override the random orbit placement
  const bu = createBodyUniforms();
  updateBodyUniforms(bu, scene, 1);
  return bu.slots[0]!.tidal.value;
}

describe('appearFor (staggered formation entrance)', () => {
  it('is 0 before the intro and 1 once it is done', () => {
    expect(appearFor('star', 0)).toBe(0);
    expect(appearFor('planet', 0)).toBe(0);
    expect(appearFor('star', 1)).toBe(1);
    expect(appearFor('planet', 1)).toBe(1);
  });

  it('brings the stars in before the planets', () => {
    // Partway through, the stars have swooshed in but the planets have not yet.
    expect(appearFor('star', 0.3)).toBeGreaterThan(appearFor('planet', 0.3));
    expect(appearFor('star', 0.25)).toBeCloseTo(1, 5); // stars fully in early
    expect(appearFor('planet', 0.15)).toBe(0); // planets still off-stage early on
  });

  it('is monotonic in progress', () => {
    for (const type of ['star', 'planet'] as const) {
      let prev = -1;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const a = appearFor(type, p);
        expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = a;
      }
    }
  });
});

describe('tidal disruption factor (spaghettification onset)', () => {
  it('is 0 outside the Roche radius and ramps to 1 at the merge', () => {
    expect(tidalAt(30)).toBe(0); // far out on its orbit — whole
    expect(tidalAt(3)).toBeCloseTo(1, 5); // at the merge radius — fully torn
    const mid = tidalAt(8);
    expect(mid).toBeGreaterThan(0); // mid-fall — partly spaghettified
    expect(mid).toBeLessThan(1);
    expect(tidalAt(6)).toBeGreaterThan(tidalAt(11)); // tears further the closer it falls
  });

  it("tears a black hole's dragged accretion structure — starting further out, drawn at rip scale", () => {
    // The overwhelming-plunge pass (live review): the hole itself is a horizon and cannot
    // spaghettify, but its dragged accretion structure rips — from a much wider radius…
    expect(tidalAt(20, 'hole')).toBeGreaterThan(0); // already tearing where a star is still whole
    expect(tidalAt(20, 'star')).toBe(0);
    expect(tidalAt(5, 'hole')).toBeGreaterThan(tidalAt(5, 'star') - 1e-9); // and never behind a star's
  });
});

describe('feedingActive (the disk is fed only while something is tearing)', () => {
  it('is 1 when a body is within the Roche radius, 0 otherwise', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const star = scene.addStar();
    const bu = createBodyUniforms();

    star.position.set(30, 0, 0); // far out on its orbit — whole, not feeding
    updateBodyUniforms(bu, scene, 1);
    expect(bu.feedingActive.value).toBe(0);

    star.position.set(8, 0, 0); // fallen within the Roche radius — shedding into the disk
    updateBodyUniforms(bu, scene, 1);
    expect(bu.feedingActive.value).toBe(1);
  });

  it("a deep-in black hole feeds the disk (its stripped accretion structure) at rip scale", () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    hole.position.set(5, 0, 0); // deep in — the dragged accretion structure is being stripped
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    expect(bu.feedingActive.value).toBe(1);
    expect(bu.slots[0]!.rip.value).toBeGreaterThan(2); // drawn at the overwhelming rip scale
  });
});

describe('hurricane (the disk winds up as the hole draws a companion in)', () => {
  /** The hurricane intensity for a single companion of `type` parked at radius `r`. */
  function hurricaneAt(r: number, type: 'star' | 'hole' = 'star'): number {
    const scene = new Scene();
    scene.clearCompanions();
    const b = type === 'hole' ? scene.addBlackHole() : scene.addStar();
    b.position.set(r, 0, 0);
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    return bu.hurricane.value;
  }

  it('is 0 at rest — the default orbits sit past the trigger band', () => {
    const scene = new Scene(); // the seeded 3/3/0 line-up on its default (>26M) orbits
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    expect(bu.hurricane.value).toBe(0);
    expect(hurricaneAt(40)).toBe(0); // a lone far companion — quiet disk
  });

  it('ramps up as a companion is drawn in close, reaching full when it tears', () => {
    expect(hurricaneAt(3)).toBeCloseTo(1, 5); // at the merge — full suck (tidal = 1)
    const near = hurricaneAt(10); // swept in close but not yet at the merge
    expect(near).toBeGreaterThan(0);
    expect(hurricaneAt(6)).toBeGreaterThan(hurricaneAt(16)); // stronger the closer it is
  });

  it('spins up from further out for a plunging black hole than a star', () => {
    // A hole tears its dragged accretion structure from a wider radius, so the disk winds up sooner.
    expect(hurricaneAt(22, 'hole')).toBeGreaterThan(hurricaneAt(22, 'star') - 1e-9);
  });
});
