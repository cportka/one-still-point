import { describe, expect, it } from 'vitest';
import { SOFTENING2 } from '../physics/integrators';
import { bodyCap, Scene } from './Scene';

describe('Scene', () => {
  it('starts with a fixed primary hole, prograde stars and retrograde planets', () => {
    const scene = new Scene();
    const primary = scene.bodies[0]!;
    expect(primary.type).toBe('hole');
    expect(primary.fixed).toBe(true);

    const stars = scene.companions.filter((b) => b.type === 'star');
    const planets = scene.companions.filter((b) => b.type === 'planet');
    expect(scene.companions.length).toBe(6);
    expect(stars.length).toBe(3);
    expect(planets.length).toBe(3);

    // Planets orbit the opposite way to the stars (the reverse-direction swoosh):
    // their vertical angular momentum L_y = (r × v)_y has the opposite sign.
    const ly = (b: { position: { x: number; z: number }; velocity: { x: number; z: number } }): number =>
      b.position.z * b.velocity.x - b.position.x * b.velocity.z;
    expect(Math.sign(ly(stars[0]!))).toBe(Math.sign(ly(stars[1]!))); // stars agree
    expect(Math.sign(ly(planets[0]!))).toBe(-Math.sign(ly(stars[0]!))); // planets opposed
  });

  it('addStar adds a companion on a circular bound orbit at the requested radius', () => {
    const scene = new Scene();
    const before = scene.companions.length;
    const star = scene.addStar(35);

    expect(scene.companions.length).toBe(before + 1);
    // Placed exactly on the requested orbit radius — the inclination no longer
    // inflates it, so added bodies keep their intended separations.
    expect(star.position.length()).toBeCloseTo(35, 5);
    // Velocity is the circular-orbit speed in the *softened* central field,
    // v = √(M·r² / (r² + ε²)^{3/2}) with M = 1 — a closed circle, not a drifting
    // ellipse.
    const r = star.position.length();
    const v = Math.sqrt((r * r) / Math.pow(r * r + SOFTENING2, 1.5));
    expect(star.velocity.length()).toBeCloseTo(v, 6);
    // and perpendicular to the radius (a circular orbit).
    expect(star.position.dot(star.velocity)).toBeCloseTo(0, 5);
  });

  it('clearCompanions leaves only the hole', () => {
    const scene = new Scene();
    scene.clearCompanions();
    expect(scene.bodies.length).toBe(1);
    expect(scene.companions.length).toBe(0);
  });

  it('advancing physics moves a companion but not the fixed hole', () => {
    const scene = new Scene();
    const star = scene.companions[0]!;
    const start = star.position.clone();
    scene.physics.timeScale = 1;
    scene.step(1);
    expect(star.position.distanceTo(start)).toBeGreaterThan(0);
    expect(scene.bodies[0]!.position.length()).toBe(0);
  });

  it('frees escaped companions at once but absorbs merged ones over a brief window', () => {
    const scene = new Scene();
    const before = scene.companions.length;
    const escaped = scene.companions[0]!;
    const merging = scene.companions[1]!;
    escaped.position.set(0, 9999, 0); // flung away → freed immediately
    merging.position.set(0.5, 0, 0); // fallen to the centre → absorbed, not instant
    let changed = 0;
    scene.onChange = () => {
      changed += 1;
    };

    // First pass frees the escaped body and *starts* absorbing the merged one.
    expect(scene.prune(0)).toBe(true);
    expect(scene.companions.length).toBe(before - 1);
    expect(changed).toBe(1);
    expect(merging.absorbing).toBe(0);
    expect(scene.companions).toContain(merging); // still present, fading out

    // Advancing past the absorption window frees it (held at its anchor meanwhile).
    expect(scene.prune(10)).toBe(true);
    expect(scene.companions.length).toBe(before - 2);
    expect(changed).toBe(2);
    expect(scene.bodies[0]!.fixed).toBe(true); // the primary is kept
    expect(scene.prune(1)).toBe(false); // nothing left to prune
  });

  it('removeOne sends a companion plunging in, freed once the animation completes', () => {
    const scene = new Scene();
    const stars = () => scene.companions.filter((b) => b.type === 'star').length;
    const before = stars();
    const events: string[] = [];
    scene.onEvent = (e) => events.push(e);

    expect(scene.removeOne('star')).toBe(true);
    expect(scene.removing).toBe(true); // a removal is animating
    expect(stars()).toBe(before); // still present — spiralling into the centre, not deleted

    // Inside the short tap-guard the − stepper stays debounced.
    scene.prune(0.25); // t ≈ 0.056 — still guarded
    expect(stars()).toBe(before); // still spiralling in
    expect(scene.removing).toBe(true);

    // The debounce is a ~0.5s tap-guard, not an animation lock: the next − may fire while this
    // body is still early in its descent (rapid removals overlap freely).
    scene.prune(0.3); // t ≈ 0.12 — guard released
    expect(scene.removing).toBe(false); // stepper unblocked…
    expect(stars()).toBe(before); // …but the body is still on screen, plunging

    // Past the whole inspiral + absorption window it is finally freed. Prune generously until it
    // lands (well past PLUNGE_DURATION + ABSORB_DURATION at any reasonable tuning).
    for (let i = 0; i < 20 && stars() === before; i++) scene.prune(0.5); // up to +10 s
    expect(stars()).toBe(before - 1);
    expect(scene.removing).toBe(false);

    // − routes through the *same* absorption a natural merge does: exactly one
    // 'absorb' tick fires (when it crosses the merge radius), so it drops the same
    // timeline mark and fires the same ringdown ripple — no special-casing.
    expect(events.filter((e) => e === 'absorb')).toEqual(['absorb']);

    expect(scene.removeOne('hole')).toBe(false); // no orbiting holes to remove
    expect(scene.bodies[0]!.fixed).toBe(true); // the primary is untouched
  });

  it('the − plunge finale holds a fast perfect circle just above the horizon, then dives', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 80; // the default — the loop spins at the capped Kepler rate
    const star = scene.addStar(30);
    expect(scene.removeOne('star')).toBe(true);

    // Walk into the LOOP act (t ∈ [0.5, 0.92]) with small steps and sample the radius: it must sit
    // on one constant circle above the merge radius (radial' = 0 — a perfect circle), while the
    // azimuth keeps sweeping (the light-streak wrapping around).
    const dt = 0.02;
    const radii: number[] = [];
    let angleStart = 0;
    let angleEnd = 0;
    for (let t = 0; t < 4.5 * 0.9; t += dt) {
      scene.prune(dt);
      const p = star.plunging ?? 0;
      if (p > 0.55 && p < 0.9) {
        radii.push(star.position.length());
        if (!angleStart) angleStart = Math.atan2(star.position.z, star.position.x);
        angleEnd = star.plungeAngle ?? 0;
      }
    }
    expect(radii.length).toBeGreaterThan(10);
    const rMin = Math.min(...radii);
    const rMax = Math.max(...radii);
    expect(rMin).toBeGreaterThan(3); // never dips through MERGE_RADIUS during the loop…
    expect(rMax - rMin).toBeLessThan(0.01); // …and holds ONE radius: a perfect circle
    expect(Math.abs(angleEnd)).toBeGreaterThan(2 * Math.PI); // wraps at least a full fast ring

    // The dive act then carries it through the merge radius into absorption.
    for (let i = 0; i < 60 && star.absorbing === undefined; i++) scene.prune(0.05);
    expect(star.absorbing).not.toBe(undefined);
  });

  it('the − plunge winds from the body\'s own motion — no spin kick, direction preserved', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 1; // wall-clock = sim, so the rate check is exact
    const star = scene.addStar(30); // prograde
    const planet = scene.addPlanet(30); // retrograde — orbits the other way

    // ω₀ about the vertical, in the plunge path's rotation convention (+ = toward +z at +x).
    const omegaOf = (b: typeof star): number =>
      (b.position.x * b.velocity.z - b.position.z * b.velocity.x) / (b.position.x ** 2 + b.position.z ** 2);
    const starOmega = omegaOf(star);
    const planetOmega = omegaOf(planet);
    expect(Math.sign(planetOmega)).toBe(-Math.sign(starOmega)); // opposite directions to begin with

    expect(scene.removeOne('planet')).toBe(true);
    // The captured rate IS the body's own rate — the spiral starts at the spin the eye is tracking.
    expect(planet.plungeOmega).toBeCloseTo(planetOmega, 8);

    // A small step in: the azimuth advances in the body's OWN direction at ≈ its own rate — the old
    // fixed 4-turn wind both whipped it faster and could reverse a retrograde body.
    const dt = 0.01;
    scene.prune(dt);
    const f = planet.plungeFrom!;
    const turned = Math.atan2(
      f.x * planet.position.z - f.z * planet.position.x, // sin of the swept angle (signed)
      f.x * planet.position.x + f.z * planet.position.z, // cos
    );
    expect(Math.sign(turned)).toBe(Math.sign(planetOmega)); // keeps falling its own way round
    expect(Math.abs(turned)).toBeGreaterThan(Math.abs(planetOmega) * dt * 0.8); // ≈ its own rate…
    expect(Math.abs(turned)).toBeLessThan(Math.abs(planetOmega) * dt * 1.5); // …no visible kick
  });

  it('adding a body with no explicit radius prefers the widest open gap (a stable orbit)', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.addStar(26); // occupy the band edges…
    scene.addStar(48);
    const added = scene.addStar(); // …so the widest gap is the middle
    // Gap (26, 48) → centre 37, jitter stays within ±15% of the gap width.
    expect(added.position.length()).toBeGreaterThan(33);
    expect(added.position.length()).toBeLessThan(41);
    // And an empty field lands mid-band, not anywhere at random.
    scene.clearCompanions();
    const first = scene.addPlanet();
    expect(first.position.length()).toBeGreaterThan(20);
    expect(first.position.length()).toBeLessThan(44);
  });

  it('restoreRoster revives gone bodies (from the registry) and drops ones added since', () => {
    const scene = new Scene();
    scene.clearCompanions(); // start from just the primary
    const a = scene.addStar(30);
    const b = scene.addPlanet(40);
    const snap = new Int32Array([a.id, b.id]); // the roster {a, b}

    // …time passes: a + b are gone, and a new star c is added.
    scene.clearCompanions();
    const c = scene.addStar(50);
    expect(scene.companions.map((x) => x.id)).toEqual([c.id]);

    // Rewind to the snapshot: revive a + b (from the registry), drop c, in order.
    expect(scene.restoreRoster(snap)).toBe(true);
    expect(scene.companions.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(scene.companions.map((x) => x.type)).toEqual(['star', 'planet']); // identities preserved
    expect(scene.bodies[0]!.fixed).toBe(true); // primary untouched

    expect(scene.restoreRoster(snap)).toBe(false); // already that roster → no rebuild
  });
});

describe('bodyCap', () => {
  it('allows a 4th black hole only when no stars or planets are present', () => {
    for (const holes of [0, 1, 2, 3, 4]) expect(bodyCap('hole', holes, 0)).toBe(4); // nothing else orbits
    for (const holes of [0, 1, 2, 3]) expect(bodyCap('hole', holes, 1)).toBe(3); // a star/planet present → 3
  });

  it('shrinks the star/planet allowance as black holes are added', () => {
    for (const type of ['star', 'planet'] as const) {
      expect(bodyCap(type, 0)).toBe(5);
      expect(bodyCap(type, 1)).toBe(5);
      expect(bodyCap(type, 2)).toBe(4);
      expect(bodyCap(type, 3)).toBe(3);
      expect(bodyCap(type, 4)).toBe(0); // 4 holes → nothing else
    }
  });
});
