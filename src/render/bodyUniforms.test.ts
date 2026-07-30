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

describe('eater-relative tearing (a companion hole consumes like the central one)', () => {
  it('a body near its companion-hole eater tears, where an un-eaten body would be whole', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    hole.position.set(40, 0, 0); // far from the centre — origin-based tidal would be 0 out here
    const prey = scene.addStar();
    prey.position.set(44, 0, 0); // 4 units from the hole — inside its Roche (radius 1.5 × 6 = 9)
    const bu = createBodyUniforms();

    updateBodyUniforms(bu, scene, 1);
    const preySlot = bu.slots.find((s) => s.posRadius.value.x === 44)!;
    expect(preySlot.tidal.value).toBe(0); // no eater set — whole (too far from the CENTRE to tear)

    prey.eaterId = hole.id; // the hole captures it
    updateBodyUniforms(bu, scene, 1);
    expect(preySlot.tidal.value).toBeGreaterThan(0); // now tearing — around the COMPANION
    expect(preySlot.eater.value.x).toBe(40); // the tear geometry is anchored to the eater…
    expect(preySlot.eater.value.w).toBeCloseTo(hole.radius * 3.5, 5); // …at its disk's scale
    // A companion-local tear must not wind up the CENTRAL disk's hurricane.
    expect(bu.hurricane.value).toBe(0);
  });

  it('an eater that is itself absorbing still anchors the tear (it is held still by its fade)', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    hole.position.set(40, 0, 0);
    hole.absorbing = 0.4; // the eater is mid-fade — anchored at its absorb anchor
    const prey = scene.addStar();
    prey.position.set(44, 0, 0);
    prey.eaterId = hole.id;
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    const preySlot = bu.slots.find((s) => s.posRadius.value.x === 44)!;
    expect(preySlot.eater.value.x).toBe(40); // still anchored to the eater — no origin snap mid-fade
    expect(preySlot.tidal.value).toBeGreaterThan(0);
  });

  it('falls back to the central hole if the eater has vanished', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const prey = scene.addStar();
    prey.position.set(8, 0, 0); // inside the central Roche
    prey.eaterId = 9999; // a hole that no longer exists
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    expect(bu.slots[0]!.eater.value.x).toBe(0); // anchored back to the origin
    expect(bu.slots[0]!.tidal.value).toBeGreaterThan(0); // and tearing on the central radii
  });

  it('a Newtonian merge loser (absorbing far out, no eater) has NO tear — flash-only physics', () => {
    // The shader gates the wrapping stream on `tidal`; a star-on-star smash far from any hole
    // fades its loser via `absorbing` alone, so tidal must stay 0 out there.
    const scene = new Scene();
    scene.clearCompanions();
    const loser = scene.addStar();
    loser.position.set(35, 0, 0);
    loser.absorbing = 0.3; // mid-fade at the contact point
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    expect(bu.slots[0]!.tidal.value).toBe(0); // no wrapping stream for a Newtonian impact
    expect(bu.slots[0]!.absorb.value).toBeCloseTo(0.3, 5); // the crush/fade still runs
    expect(bu.hurricane.value).toBe(0); // a far-out impact doesn't wind up the central disk
  });
});

describe('style (the planet surface family reaches the shader)', () => {
  it('maps look → style: gas 1, rock 2, stars/holes 0', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const star = scene.addStar(30);
    const planet = scene.addPlanet(40);
    const bu = createBodyUniforms();
    updateBodyUniforms(bu, scene, 1);
    const starSlot = bu.slots.find((s) => s.posRadius.value.w === star.radius)!;
    const planetSlot = bu.slots.find((s) => s.posRadius.value.w === planet.radius)!;
    expect(starSlot.style.value).toBe(0);
    expect(planetSlot.style.value).toBe(planet.look === 'gas' ? 1 : 2);
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

describe('liquid coalescence uniforms (v0.101.0)', () => {
  it('a melding pair fills meld/meldA/meldB/meldColor; idle scenes zero the meld', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addStar(30);
    const b = scene.addStar(34);
    a.mass = 0.01;
    b.mass = 0.03; // b thrice as heavy — the colour blend must lean toward b
    a.radius = 1.2;
    b.radius = 1.0;
    a.msun = 0.7;
    b.msun = 0.7;
    a.color.set(1, 0, 0);
    b.color.set(0, 1, 0);
    a.position.set(30, 0, 0);
    b.position.set(32, 0, 0); // touching → the meld begins on prune
    const bu = createBodyUniforms();

    updateBodyUniforms(bu, scene, 1);
    expect(bu.meld.value).toBe(0); // not yet melding — a single branch in the shader

    scene.prune(0);
    scene.prune(0.55); // mid-meld
    updateBodyUniforms(bu, scene, 1);
    expect(bu.meld.value).toBeCloseTo(0.5, 1);
    expect(bu.meldA.value.w).toBeCloseTo(a.radius, 5); // pos+radius rides in w
    expect(bu.meldB.value.w).toBeCloseTo(b.radius, 5);
    expect(bu.meldA.value.x).toBeCloseTo(a.position.x, 5);
    // Mass-weighted liquid tone: 3/4 of b's green, 1/4 of a's red.
    expect(bu.meldColor.value.x).toBeCloseTo(0.25, 5);
    expect(bu.meldColor.value.y).toBeCloseTo(0.75, 5);

    scene.prune(0.7); // completes
    updateBodyUniforms(bu, scene, 1);
    expect(bu.meld.value).toBe(0); // the neck block is a single branch again
  });

  it('the ringing remnant is named by SLOT index with a decaying l = 2 envelope', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const other = scene.addStar(44); // fills slot 0 — the wobbler must be named by ITS slot
    other.position.set(44, 0, 0);
    const a = scene.addStar(30);
    const b = scene.addStar(34);
    a.mass = 0.01;
    b.mass = 0.02;
    a.radius = 1.2;
    b.radius = 1.0;
    a.msun = 0.7;
    b.msun = 0.7;
    a.position.set(30, 0, 0);
    b.position.set(32, 0, 0);
    const bu = createBodyUniforms();

    updateBodyUniforms(bu, scene, 1);
    expect(bu.wobbleSlot.value).toBe(-1); // nothing rings at rest
    expect(bu.wobbleAmp.value).toBe(0);

    scene.prune(0);
    scene.prune(0.6);
    scene.prune(0.6); // the meld completes in this pass — the survivor (b) starts ringing
    updateBodyUniforms(bu, scene, 1);
    // Slots: other = 0, a (absorbing, still present) = 1, b = 2 — the wobbler is b's slot.
    const slotOfB = scene.bodies.filter((x) => !x.fixed).indexOf(b);
    expect(bu.wobbleSlot.value).toBe(slotOfB);
    expect(bu.wobbleAmp.value).toBeGreaterThan(0);
    const ampEarly = bu.wobbleAmp.value;
    expect(bu.wobbleAxis.value.length()).toBeCloseTo(1, 5);

    scene.prune(1.0); // deep into the ring-down — the envelope has decayed
    updateBodyUniforms(bu, scene, 1);
    expect(bu.wobbleAmp.value).toBeLessThan(ampEarly);
    expect(bu.wobblePhase.value).toBeGreaterThan(0);

    scene.prune(1.5); // settled (past WOBBLE_DURATION)
    updateBodyUniforms(bu, scene, 1);
    expect(bu.wobbleSlot.value).toBe(-1);
    expect(bu.wobbleAmp.value).toBe(0);
  });
});
