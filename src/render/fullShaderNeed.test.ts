import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Body } from '../scene/Body';
import { Scene } from '../scene/Scene';
import { dramaImminent, FULL_SHADER_APPROACH_R } from './fullShaderNeed';

const bodyAt = (r: number, extra: Partial<Body> = {}): Body =>
  ({
    id: 1,
    type: 'star',
    mass: 1e-3,
    lensMass: 0,
    fixed: false,
    position: new Vector3(r, 0, 0),
    velocity: new Vector3(),
    radius: 1.2,
    color: new Vector3(1, 1, 1),
    ...extra,
  }) as Body;

/** A body on a circular orbit of radius `r` in the xz-plane at azimuth `phi` (PRIMARY_MASS = 1,
 *  v = √(1/r)), prograde (+φ) or retrograde (−φ) — the seeded line-up's geometry. */
const orbiting = (r: number, phi: number, retrograde = false, extra: Partial<Body> = {}): Body => {
  const v = Math.sqrt(1 / r) * (retrograde ? -1 : 1);
  return bodyAt(r, {
    position: new Vector3(r * Math.cos(phi), 0, r * Math.sin(phi)),
    velocity: new Vector3(-Math.sin(phi) * v, 0, Math.cos(phi) * v),
    ...extra,
  });
};

describe('dramaImminent (the compile-ahead trigger)', () => {
  it('is quiet for a steady scene: far live orbits + the fixed primary', () => {
    const primary = bodyAt(0, { fixed: true, type: 'hole' });
    expect(dramaImminent([primary, orbiting(30, 0), orbiting(44, 2)], 80)).toBe(false);
  });

  it('fires the moment a plunge or chase starts — seconds before the tear renders', () => {
    expect(dramaImminent([bodyAt(30, { plunging: 0 })])).toBe(true);
    expect(dramaImminent([bodyAt(30, { chaseId: 7 })])).toBe(true);
  });

  it('fires on a natural close approach inside the approach radius', () => {
    expect(dramaImminent([bodyAt(FULL_SHADER_APPROACH_R - 1)])).toBe(true);
    expect(dramaImminent([bodyAt(FULL_SHADER_APPROACH_R + 1)])).toBe(false);
  });

  it('the approach radius sits BELOW the planet orbit band (min 20) — a seeded planet cannot trip it', () => {
    // v0.91.2 regression fix: at 24 the radius overlapped the band and the compile freeze landed
    // mid-intro (video-measured ~970ms). 19 keeps it above the Roche radius (18) but under the band.
    expect(FULL_SHADER_APPROACH_R).toBeLessThan(20);
    expect(FULL_SHADER_APPROACH_R).toBeGreaterThan(18);
    expect(dramaImminent([bodyAt(20)])).toBe(false); // the band's innermost planet — quiet
  });

  it('fires on a genuine head-on collision course — well before the old 8-unit bubble', () => {
    const a = bodyAt(30, { velocity: new Vector3(0.2, 0, 0) });
    const b = bodyAt(40, { velocity: new Vector3(-0.2, 0, 0) }); // 10 apart, closing radially
    expect(dramaImminent([a, b], 80)).toBe(true);
    // …but only when the horizon (wall-clock, timeScale-converted) actually reaches the contact:
    // at ×1 the same pair closes 10 units in 25 sim-seconds — far beyond the 2.5 s horizon.
    expect(dramaImminent([a, b], 1)).toBe(false);
  });

  it('predicts a counter-rotating conjunction ~36 units out — where the old bubble was blind', () => {
    // Two stars share the r=30 ring in opposite directions, 1.2 rad of azimuth apart. They meet
    // in ~1.2 wall-seconds at ×80 — a real contact the blanket 8-unit check could only see ~0.3 s
    // out (they close those last 8 units in a fraction of a second at opposed orbital speed).
    const a = orbiting(30, 0);
    const b = orbiting(30, 1.2, true);
    expect(a.position.distanceTo(b.position)).toBeGreaterThan(8); // the old check said "calm"
    expect(dramaImminent([a, b], 80)).toBe(true);
  });

  it('stays quiet for the seeded geometry: adjacent counter-rotating rings passing 5 apart (v0.94.1)', () => {
    // The v0.88.0–v0.94.0 regression: the blanket "any pair within 8 units" fired on ~the first
    // frame after the intro in every session, because seeded rings sit 4.5–6.5 units apart. A
    // radially-aligned pass of the tightest counter-rotating pair (planet r=30 retrograde, star
    // r=35 prograde) must NOT trip the predictor — circular propagation keeps their separation ≥ 5.
    const planet = orbiting(30, 0, true, { type: 'planet', radius: 0.8 });
    const star = orbiting(35, 0);
    expect(dramaImminent([planet, star], 80)).toBe(false);
  });

  it('a stationary / non-closing pair a few units apart is not a conjunction', () => {
    const a = bodyAt(30);
    const b = bodyAt(35); // 5 apart, zero relative velocity — nothing will happen
    expect(dramaImminent([a, b], 80)).toBe(false);
  });

  it('an absorbing partner is past the drama — even on a collision course', () => {
    const a = bodyAt(30, { velocity: new Vector3(0.2, 0, 0) });
    const b = bodyAt(40, { velocity: new Vector3(-0.2, 0, 0), absorbing: 0.5 });
    expect(dramaImminent([a, b], 80)).toBe(false);
  });

  it('a body already absorbing is past the drama — not a trigger', () => {
    expect(dramaImminent([bodyAt(1, { absorbing: 0.3 })])).toBe(false);
  });

  it('the fixed primary at the origin never triggers', () => {
    expect(dramaImminent([bodyAt(0, { fixed: true, type: 'hole' })])).toBe(false);
  });

  it('the seeded line-up: no mid-intro merges, no boot/early compile trips (20 real-pipeline runs)', () => {
    // Review-measured on the old seed (star r=28 prograde beside planet r=27 retrograde): a real
    // contact merge inside the 6.5 s intro in ~41% of loads, and the blanket pairwise trigger
    // firing right after the intro in ~every session. Drive the REAL pipeline (step + prune at
    // the default ×80) through the 6.5 s intro + 2 s settle, 20 random seeds.
    //
    // The seeded system does slowly "heat up" — close passes pump eccentricity, so rings wobble
    // ~1–2 units within a minute and a *genuine* near-contact pass (< 1.5× touching) occurs in a
    // small tail of sessions even early; the trigger firing there is correct (that pass is one
    // wobble from a real merge flash). Hence tail-tolerant bounds, still decisive against the
    // old bugs: 41% intro merges → P(≤1 of 20) ≈ 2e-4; every-session trips → P(≤3 of 20) = 0.
    let freshTrips = 0;
    let introMergedRuns = 0;
    let earlyTripRuns = 0;
    const INTRO_FRAMES = Math.round(6.5 * 60); // the merge pin is INTRO-scoped — the review's bug
    for (let run = 0; run < 20; run++) {
      const scene = new Scene();
      scene.physics.timeScale = 80;
      if (dramaImminent(scene.bodies, scene.physics.timeScale)) freshTrips++;
      const count = scene.companions.length;
      let tripped = false;
      for (let f = 0; f < Math.round(8.5 * 60); f++) {
        scene.step(1 / 60);
        scene.prune(1 / 60);
        if (f === INTRO_FRAMES - 1 && scene.companions.length !== count) introMergedRuns++;
        if (!tripped && dramaImminent(scene.bodies, scene.physics.timeScale)) tripped = true;
      }
      if (tripped) earlyTripRuns++;
    }
    // The fresh line-up is deterministic-quiet: predicted separations along circular propagation
    // can never undercut the ring gaps (4.5–6.5), all above the widest threshold (~4.1).
    expect(freshTrips).toBe(0);
    // Intro-window merges only: measured 0/160 dev runs (was ~41%/run). Merges in the settle
    // seconds AFTER the intro are the system's real (small) tail — a CI run caught 2/20 when
    // this bound mistakenly covered the settle window too, so it deliberately does not.
    expect(introMergedRuns).toBeLessThanOrEqual(1);
    expect(earlyTripRuns).toBeLessThanOrEqual(3); // measured ~2%/run (was ~every run)
  });
});
