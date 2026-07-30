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

  it('hover is dropped when it clears or when the hovered body leaves the scene', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addStar(30);
    scene.hovered = a;
    // clearCompanions wipes the hover along with everything else.
    scene.clearCompanions();
    expect(scene.hovered).toBeNull();
    // A hover pointing at a body that leaves the scene is dropped by prune's stale sweep once the body
    // is actually gone from the roster.
    const b = scene.addStar(30);
    scene.hovered = b;
    b.position.set(400, 0, 0); // beyond ESCAPE_RADIUS → flung clear
    scene.prune(0); // frees b from the roster (the stale sweep runs before the removal this pass)…
    scene.prune(0); // …so the next sweep sees it gone and drops the hover
    expect(scene.hovered).toBeNull();
  });

  it('reseedDefault restores the default 3 stars + 3 planets even from an empty scene', () => {
    const scene = new Scene();
    scene.clearCompanions(); // e.g. the Galaxy-Mode enter, which empties the roster
    expect(scene.companions.length).toBe(0);
    scene.reseedDefault(); // Galaxy-Mode exit — must regenerate the default line-up, not the (empty) one
    expect(scene.companions.filter((b) => b.type === 'star').length).toBe(3);
    expect(scene.companions.filter((b) => b.type === 'planet').length).toBe(3);
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
    scene.prune(0.2); // t ≈ 0.044 — still under the 0.06 guard
    expect(stars()).toBe(before); // still spiralling in
    expect(scene.removing).toBe(true);

    // The debounce is a ~0.27s tap-guard (halved from ~0.54s), not an animation lock: the next −
    // may fire while this body is still early in its descent (rapid removals overlap freely).
    scene.prune(0.2); // t ≈ 0.089 — past the 0.06 guard, released
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

  it('two companions that touch merge: momentum conserved, victor grows, loser absorbs, flash fires', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addStar(30);
    const b = scene.addStar(30);
    a.mass = 0.01; a.radius = 1.2;
    b.mass = 0.02; b.radius = 1.0; // b is heavier → the victor
    a.msun = 0.8; b.msun = 0.8; // pinned under the TOV limit — this test is the NEWTONIAN merge
    a.position.set(30, 0, 0);
    b.position.set(31, 0, 0); // within (1.2 + 1.0) * 1.15 ≈ 2.53 → touching
    a.velocity.set(0, 0, 1);
    b.velocity.set(0, 0, -0.5);
    const merges: Array<{ kind: string; strength: number }> = [];
    scene.onMerge = (_x, _y, _z, kind, strength) => merges.push({ kind, strength });
    const events: string[] = [];
    scene.onEvent = (e) => events.push(e);

    const pBefore = a.mass * a.velocity.z + b.mass * b.velocity.z; // z-momentum before
    scene.prune(0);

    // LIQUID COALESCENCE (v0.101.0): contact no longer merges on the spot — the drops MELD first,
    // glued to their COM (both velocities pinned to the momentum-conserving blend) while the gap
    // eases closed. The real merge fires when the window completes.
    expect(a.absorbing).toBeUndefined();
    expect(b.absorbing).toBeUndefined();
    expect(scene.melding).not.toBeNull();
    expect(a.velocity.z).toBeCloseTo(b.velocity.z, 12); // glued: one shared COM velocity
    expect(a.velocity.z * a.mass + b.velocity.z * b.mass).toBeCloseTo(pBefore, 12); // …conserving
    scene.prune(1.2); // > MELD_DURATION — the coalescence completes

    // b (heavier) survives; a begins absorbing.
    expect(scene.melding).toBeNull();
    expect(b.absorbing).toBeUndefined();
    expect(a.absorbing).not.toBeUndefined(); // the loser fades (the completing pass also advances it)
    expect(b.mass).toBeCloseTo(0.03, 12); // masses summed
    expect(b.radius).toBeCloseTo(Math.cbrt(1.0 ** 3 + 1.2 ** 3), 10); // volume added
    // Momentum conserved: victor's new z-velocity × combined mass = the pre-merge total.
    expect(b.velocity.z * b.mass).toBeCloseTo(pBefore, 12);
    // A near-massless star smash still flashes bright: the strength floor (1.7) dominates the tiny
    // mass term, so the collision is clearly *marked* rather than an invisible pop.
    expect(merges).toEqual([{ kind: 'body', strength: Math.min(3.6, 1.7 + 0.03 * 3.5) }]);
    expect(merges[0]!.strength).toBeGreaterThan(1.7);
    expect(events).toContain('merge');
    expect(a.absorbAnchor).not.toBeUndefined(); // the loser fades at the contact point
  });

  it('two planets that smash together IGNITE: the remnant is a small star, not a rocky lump', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addPlanet(30);
    const b = scene.addPlanet(30);
    a.mass = 1e-5;
    b.mass = 2e-5; // b heavier → the victor
    a.radius = 0.6;
    b.radius = 0.6;
    a.position.set(30, 0, 0);
    b.position.set(30.9, 0, 0); // within (0.6 + 0.6) * 1.15 ≈ 1.38 → touching
    const events: string[] = [];
    scene.onEvent = (e) => events.push(e);
    scene.prune(0); // contact → the coalescence begins (liquid, not instant — v0.101.0)
    scene.prune(1.2); // > MELD_DURATION — the merge fires at completion

    expect(b.absorbing).toBeUndefined();
    expect(a.absorbing).not.toBeUndefined(); // the loser fades (the completing pass also advances it)
    expect(b.type).toBe('star'); // ignition — planets → star (the escalation ladder's first rung)
    expect(b.color.length()).toBeGreaterThan(3); // the HDR seeded-star tint — blooms, on lean too
    expect(b.radius).toBeGreaterThanOrEqual(1.0);
    expect(b.msun).toBeCloseTo(0.9, 5); // star-scale TOV bookkeeping — future mergers count
    expect(b.mass).toBe(1e-3); // the addStar test-particle mass
    expect(b.look).toBeUndefined(); // the planet-only surface family is gone
    expect(events).toContain('merge');
    expect(events).toContain('star'); // a star was born — its own timeline tick
  });

  it('a black hole always wins the merge (it captures) and reports a hole-kind flash', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const star = scene.addStar(30);
    const hole = scene.addBlackHole();
    star.mass = 0.5; // heavier than the hole by mass…
    hole.mass = 0.2;
    star.position.set(30, 0, 0);
    hole.position.set(30.5, 0, 0);
    star.radius = 1;
    hole.radius = 1;
    let kind = '';
    scene.onMerge = (_x, _y, _z, k) => (kind = k);
    scene.prune(0);
    expect(hole.absorbing).toBeUndefined(); // …the hole still captures the star
    expect(star.absorbing).toBe(0);
    expect(kind).toBe('hole');
    expect(hole.mass).toBeCloseTo(0.7, 12);
  });

  it('double-click gestures: plungeBody dooms one specific body; rescueBody saves it onto a stable orbit', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 80;
    const doomed = scene.addPlanet(30); // retrograde — the rescue must keep it retrograde
    const bystander = scene.addStar(40);
    const events: string[] = [];
    scene.onEvent = (e) => events.push(e);

    // Plunge exactly the chosen body — not "the last of its type".
    expect(scene.plungeBody(doomed)).toBe(true);
    expect(doomed.plunging).toBe(0);
    expect(bystander.plunging).toBeUndefined();
    expect(scene.plungeBody(doomed)).toBe(false); // already plunging → no double-start

    // Ride it deep into the plunge, then save it.
    for (let t = 0; t < 3.0; t += 0.1) scene.prune(0.1);
    expect(doomed.plunging).toBeGreaterThan(0.5);
    const omegaSign = Math.sign(doomed.plungeOmega ?? 0);
    expect(scene.rescueBody(doomed)).toBe(true);
    expect(doomed.plunging).toBeUndefined(); // the plunge is cancelled…
    const r = doomed.position.length();
    expect(r).toBeGreaterThanOrEqual(18 - 1e-9); // …lifted into the stable band…
    expect(r).toBeLessThanOrEqual(48 + 1e-9);
    // …on the circular-orbit speed for that radius (addStar parity), perpendicular to the radius…
    const v = Math.sqrt((r * r) / Math.pow(r * r + SOFTENING2, 1.5));
    expect(doomed.velocity.length()).toBeCloseTo(v, 6);
    expect(doomed.position.dot(doomed.velocity)).toBeCloseTo(0, 5);
    // …still turning the way it was (retrograde stays retrograde).
    const ly = doomed.position.z * doomed.velocity.x - doomed.position.x * doomed.velocity.z;
    expect(Math.sign(-ly)).toBe(omegaSign);
    expect(events).toContain('rescue'); // the save drops its own timeline tick

    // The rescued body then lives: many prune passes leave it orbiting.
    for (let i = 0; i < 30; i++) scene.prune(0.2);
    expect(scene.companions).toContain(doomed);

    // A body that has crossed into absorption is beyond saving (one-way, per the covenant).
    expect(scene.plungeBody(doomed)).toBe(true);
    for (let i = 0; i < 200 && doomed.absorbing === undefined; i++) scene.prune(0.1);
    expect(doomed.absorbing).not.toBeUndefined();
    expect(scene.rescueBody(doomed)).toBe(false);
  });

  it('eater wiring: a hole capture/chase consumes locally; a star smash stays Newtonian', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    hole.position.set(40, 0, 0);
    hole.velocity.set(0, 0, 0);
    const prey = scene.addStar(30);

    // Chasing a hole marks it as the eater (the tear wraps around IT as the chase closes).
    expect(scene.plungeInto(prey, hole)).toBe(true);
    expect(prey.eaterId).toBe(hole.id);

    // Contact: the hole captures — the loser keeps the hole as its eater through the fade.
    prey.position.set(40 + (hole.radius + prey.radius) * 0.5, 0, 0);
    scene.prune(0.01);
    expect(prey.absorbing).not.toBeUndefined();
    expect(prey.eaterId).toBe(hole.id);

    // A sub-TOV star-on-star smash far from any hole sets NO eater — a Newtonian impact, no wrap.
    // (Above the TOV limit the merger collapses and the loser IS eaten — by the newborn hole.)
    const a = scene.addStar(44);
    const b = scene.addStar(46);
    a.msun = 0.7;
    b.msun = 0.7; // pinned under the limit — this is the plain-impact case
    b.position.copy(a.position); // force contact
    scene.prune(0.01); // the coalescence begins (v0.101.0)…
    scene.prune(1.2); // …and completes past MELD_DURATION
    const loser = [a, b].find((s) => s.absorbing !== undefined)!;
    expect(loser.eaterId).toBeUndefined();
  });

  it('a chase homes in WALL-CLOCK with the real integrator running — travel time exists at Speed ×80', () => {
    // Adversarial review: the previous incremental chase was double-stepped by the physics drift
    // (velocity × timeScale) and hit contact in 2 frames even though its own step was wall-clock.
    // This test runs the REAL pipeline (step → prune, like the render loop) at the default Speed.
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 80;
    const a = scene.addStar(30);
    const b = scene.addStar(44);
    a.position.set(30, 0, 0);
    b.position.set(44, 0, 0);
    b.velocity.set(0, 0, 0); // park the target so the distance is the story
    b.mass = 1; // heavy target → it wins the merge (the chaser is absorbed)
    expect(scene.plungeInto(a, b)).toBe(true);
    let contactFrame = -1;
    for (let f = 0; f < 600 && contactFrame < 0; f++) {
      scene.step(1 / 60); // the integrator drifts everything, chaser included…
      scene.prune(1 / 60); // …and prune's scripted anchor overwrites the drift
      if (a.absorbing !== undefined) contactFrame = f;
    }
    expect(contactFrame).toBeGreaterThan(30); // > half a second of visible flight (was frame 2)
    expect(contactFrame).toBeLessThan(300); // and it does arrive within ~5s
    // The SURVIVOR survives: its chase state cleared by the merge (it must not "vanish" into a
    // centre plunge via a stale chaseId — the capture's "both bodies vanished").
    expect(b.plunging).toBeUndefined();
    expect(b.chaseId).toBeUndefined();
    expect(scene.bodies).toContain(b);
    // And it doesn't get launched: the chaser's velocity was kept in SIM units, so the momentum
    // blend can't fling the merged body at ×timeScale.
    expect(b.velocity.length()).toBeLessThan(1);
  });

  it('the merge clears BOTH sides\' chase state — a winning chaser stays instead of centre-plunging', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 80;
    const chaser = scene.addStar(30);
    const target = scene.addStar(44);
    chaser.mass = 2e-3;
    target.mass = 1e-3; // the CHASER is heavier → it wins the merge
    chaser.msun = 0.7;
    target.msun = 0.7; // sub-TOV — a plain Newtonian merge
    chaser.position.set(30, 0, 0);
    target.position.set(33, 0, 0);
    expect(scene.plungeInto(chaser, target)).toBe(true);
    let merged = false;
    for (let f = 0; f < 600 && !merged; f++) {
      scene.step(1 / 60);
      scene.prune(1 / 60);
      merged = target.absorbing !== undefined;
    }
    expect(merged).toBe(true);
    // The winning chaser's stale chaseId used to send IT into a centre plunge the same frame.
    expect(chaser.chaseId).toBeUndefined();
    expect(chaser.plunging).toBeUndefined();
    expect(scene.bodies).toContain(chaser); // the survivor is still on the roster, orbiting
  });

  it('eater wiring: a centre plunge on a mid-chase body supersedes the chase AND its eater', () => {
    // Adversarial-review scenario: chase a companion hole, then plunge the chaser to the centre —
    // a stale eaterId would keep measuring the tear from the far-away hole, silently killing the
    // marquee central spaghettification for the whole plunge.
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    hole.position.set(40, 0, 0);
    const prey = scene.addStar(30);
    expect(scene.plungeInto(prey, hole)).toBe(true);
    expect(prey.eaterId).toBe(hole.id);
    // Plunging the chaser to the centre supersedes the chase: startPlunge clears BOTH the chase
    // and its eater, so the tear measures from the origin again (the marquee central look).
    expect(scene.plungeBody(prey)).toBe(true);
    expect(prey.plunging).toBe(0);
    expect(prey.chaseId).toBeUndefined();
    expect(prey.eaterId).toBeUndefined(); // the centre consumes it now
  });

  it('eater wiring: rescue clears the eater', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    const prey = scene.addStar(30);
    prey.eaterId = hole.id;
    prey.plunging = 0.2; // mid-plunge — rescuable
    prey.plungeFrom = prey.position.clone();
    expect(scene.rescueBody(prey)).toBe(true);
    expect(prey.eaterId).toBeUndefined(); // saved — nothing is consuming it
  });

  it('planets get a randomized size and a size-matched surface family (gas vs rock)', () => {
    const scene = new Scene();
    scene.clearCompanions();
    for (let i = 0; i < 24; i++) {
      const p = scene.addPlanet(20 + i);
      expect(p.radius).toBeGreaterThanOrEqual(0.45);
      expect(p.radius).toBeLessThan(0.8 + 1e-9);
      expect(p.look).toBe(p.radius >= 0.62 ? 'gas' : 'rock'); // big → gas giant, small → rocky
      expect(p.msun).toBeCloseTo(0.001, 6);
    }
    // Stars and holes carry no surface family (the flat emissive look).
    expect(scene.addStar(50).look).toBeUndefined();
  });

  it('TOV collapse: a merger above ~2.17 M☉ becomes a black hole; below it stays a star', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const events: Array<[string, number | undefined]> = [];
    scene.onEvent = (e, b) => events.push([e, b?.id]);

    // Two heavy stars: 1.2 + 1.1 = 2.3 M☉ ≥ TOV → collapse.
    const a = scene.addStar(30);
    const b = scene.addStar(40);
    a.msun = 1.2;
    b.msun = 1.1;
    a.mass = 2e-3;
    b.mass = 1e-3; // a heavier → a wins
    b.position.copy(a.position); // force contact
    let flash: { kind: string; strength: number } | null = null;
    scene.onMerge = (_x, _y, _z, kind, strength) => {
      flash = { kind, strength };
    };
    scene.prune(0.01); // the coalescence begins (v0.101.0)…
    scene.prune(1.2); // …and completes past MELD_DURATION
    expect(a.type).toBe('hole'); // the victor transformed
    expect(a.lensMass).toBeGreaterThan(0); // it lenses (and gets the render's mini-disk)
    expect(a.msun).toBeCloseTo(2.3, 5);
    expect(a.radius).toBeCloseTo(1.5, 5); // a newborn hole at the added-hole scale (visible mini-disk)
    expect(flash!.kind).toBe('collapse'); // the icy formation flash…
    expect(flash!.strength).toBeGreaterThan(3.6); // …at the hardest strength
    expect(events.some(([e, id]) => e === 'collapse' && id === a.id)).toBe(true); // its own timeline mark

    // A light pair: 0.9 + 0.95 = 1.85 M☉ < TOV → an ordinary bigger star, no collapse.
    const c = scene.addStar(44);
    const d = scene.addStar(46);
    c.msun = 0.9;
    d.msun = 0.95;
    c.mass = 2e-3;
    d.mass = 1e-3;
    d.position.copy(c.position);
    flash = null;
    scene.prune(0.01); // meld…
    scene.prune(1.2); // …complete
    expect(c.type).toBe('star');
    expect(flash!.kind).toBe('body'); // the warm Newtonian smash flash
    expect(c.msun).toBeCloseTo(1.85, 5); // the bookkeeping still accumulates

    // Star + planet can never tip over the limit (a Jupiter is ~0.001 M☉).
    const e = scene.addStar(48);
    const p = scene.addPlanet(34);
    e.msun = 1.8;
    p.position.copy(e.position);
    scene.prune(0.01); // meld…
    scene.prune(1.2); // …complete
    expect(e.type).toBe('star');
  });

  it('eater wiring: a vanished chase target clears the eater and resolves to a centre plunge', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.addBlackHole();
    const prey = scene.addStar(30);
    expect(scene.plungeInto(prey, hole)).toBe(true);
    expect(prey.eaterId).toBe(hole.id);
    // The hole is snatched from the scene (absorbed elsewhere / cleared) before contact…
    scene.bodies = scene.bodies.filter((x) => x !== hole);
    scene.prune(0.01);
    // …so the chase resolves to a normal centre plunge with the centre as the consumer again.
    expect(prey.eaterId).toBeUndefined();
    expect(prey.plunging).not.toBeUndefined();
  });

  it('clickBody state machine: tap highlights, tap-again plunges, empty-tap deselects', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addStar(30);
    const b = scene.addStar(40);
    expect(scene.selected).toBeNull();

    scene.clickBody(a); // tap A → highlight
    expect(scene.selected).toBe(a);
    expect(a.plunging).toBeUndefined();

    scene.clickBody(null); // tap empty space → deselect
    expect(scene.selected).toBeNull();

    scene.clickBody(a); // highlight A again…
    let centred: unknown = 'unset';
    scene.onFocus = (body) => {
      centred = body;
    };
    scene.clickBody(a); // …tap the SAME body → centre the view on it (the "one still point")
    expect(scene.selected).toBeNull();
    expect(centred).toBe(a); // onFocus fired for A
    expect(a.plunging).toBeUndefined(); // it centres — it does NOT plunge (changed from the old behaviour)
    expect(b.plunging).toBeUndefined();
  });

  it('clickBody: select a body then tap the central hole plunges it in; the hole itself is a target', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const hole = scene.bodies[0]!; // the fixed primary
    const a = scene.addStar(30);

    scene.clickBody(a); // highlight A
    scene.clickBody(hole); // tap the central hole → plunge A into the centre
    expect(scene.selected).toBeNull();
    expect(a.plunging).toBe(0);

    // Double-tapping the hole re-centres the view on the origin (onFocus(null)).
    let focus: unknown = 'unset';
    scene.onFocus = (b) => {
      focus = b;
    };
    const b = scene.addStar(30);
    scene.clickBody(hole); // select the hole
    expect(scene.selected).toBe(hole);
    scene.clickBody(hole); // tap it again → re-centre on the origin
    expect(scene.selected).toBeNull();
    expect(focus).toBeNull();
    expect(b.plunging).toBeUndefined(); // nothing plunged
  });

  it('clickBody: tapping a second body plunges the highlighted one INTO it (homing collision)', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 80;
    const a = scene.addStar(30);
    const b = scene.addStar(30);

    scene.clickBody(a); // highlight A
    scene.clickBody(b); // → plunge A into B
    expect(scene.selected).toBeNull();
    expect(a.chaseId).toBe(b.id); // A is now homing at B

    // Home it in: A accelerates straight at B until their surfaces touch and the merge fires.
    let collided = false;
    for (let i = 0; i < 600 && !collided; i++) {
      scene.prune(0.05);
      collided = a.absorbing !== undefined || b.absorbing !== undefined || !scene.companions.includes(a) || !scene.companions.includes(b);
    }
    expect(collided).toBe(true);
  });

  it('clickBody: tapping a plunging body rescues it directly (no select step)', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const s = scene.addStar(30);
    scene.plungeBody(s);
    expect(s.plunging).toBe(0);
    scene.clickBody(s); // a plunging body → rescue, not select
    expect(s.plunging).toBeUndefined();
    expect(scene.selected).toBeNull();
  });

  it('clickBody: the highlight clears when the selected body plunges away, and on clearCompanions', () => {
    const scene = new Scene();
    scene.clearCompanions();
    const s = scene.addStar(30);
    scene.clickBody(s); // highlight it
    expect(scene.selected).toBe(s);
    scene.plungeBody(s); // it starts plunging (e.g. via a select-then-hole gesture)
    scene.prune(0.05); // prune runs clearStaleSelection
    expect(scene.selected).toBeNull(); // the highlight drops once the selected body is plunging
    // And clearCompanions (e.g. entering Galaxy mode) drops any highlight.
    const other = scene.addStar(35);
    scene.clickBody(other);
    expect(scene.selected).toBe(other);
    scene.clearCompanions();
    expect(scene.selected).toBeNull();
  });

  it("a black hole's plunge is the long, overwhelming one — nearly twice a star's clock", () => {
    // Star control: removed at t=0, it lands + absorbs within ~5.2s (4.5s plunge + 0.6s absorb).
    const a = new Scene();
    a.clearCompanions();
    a.physics.timeScale = 80;
    a.addStar(30);
    expect(a.removeOne('star')).toBe(true);
    for (let t = 0; t < 5.4; t += 0.1) a.prune(0.1);
    expect(a.companions.length).toBe(0); // the star's plunge is long over

    // The hole: at the same 5.4s mark it is still mid-plunge (its clock runs ~8s)…
    const b = new Scene();
    b.clearCompanions();
    b.physics.timeScale = 80;
    const hole = b.addBlackHole();
    expect(b.removeOne('hole')).toBe(true);
    for (let t = 0; t < 5.4; t += 0.1) b.prune(0.1);
    expect(b.companions).toContain(hole);
    expect(hole.plunging).toBeGreaterThan(0.5); // …deep in its acts…
    expect(hole.plunging).toBeLessThan(1); // …but nowhere near done
    // …and it still routes through the same absorption in the end.
    for (let i = 0; i < 80 && b.companions.includes(hole); i++) b.prune(0.1);
    expect(b.companions).not.toContain(hole);
  });

  it('the − plunge winds from the body\'s own motion — no spin kick, direction preserved', () => {
    const scene = new Scene();
    scene.clearCompanions();
    scene.physics.timeScale = 1; // wall-clock = sim, so the rate check is exact
    // Separated radii: at a shared radius a close azimuth draw can spawn the pair inside contact
    // distance (~2.3 units) and mergeCollisions strikes the plunging planet mid-prune — a rare
    // flake that yanks it off the parametric path this test measures.
    const star = scene.addStar(40); // prograde
    const planet = scene.addPlanet(28); // retrograde — orbits the other way

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

describe('liquid coalescence (v0.101.0)', () => {
  /** Two touching drops staged at rest-ish with distinct velocities — the standard specimen. */
  const stagePair = () => {
    const scene = new Scene();
    scene.clearCompanions();
    const a = scene.addStar(30);
    const b = scene.addStar(34);
    a.mass = 0.01;
    b.mass = 0.02;
    a.radius = 1.2;
    b.radius = 1.0;
    a.msun = 0.7;
    b.msun = 0.7; // under TOV — the plain drop merge
    a.position.set(30, 0, 0);
    b.position.set(32, 0, 0); // within (1.2 + 1.0) × 1.15 → touching
    a.velocity.set(0, 0, 1);
    b.velocity.set(0, 0, -0.5);
    return { scene, a, b };
  };

  it('contact melds first — the gap eases closed while the pair stays glued — then merges', () => {
    const { scene, a, b } = stagePair();
    scene.prune(0);
    const meld0 = scene.melding!;
    expect(meld0).not.toBeNull();
    expect(meld0.t).toBe(0);
    const d0 = a.position.distanceTo(b.position);

    scene.prune(0.5); // mid-meld
    const mid = scene.melding!;
    expect(mid.t).toBeCloseTo(0.5 / 1.1, 5);
    expect(a.position.distanceTo(b.position)).toBeLessThan(d0); // the gap is closing
    expect(a.velocity.distanceTo(b.velocity)).toBeLessThan(1e-9); // still glued

    scene.prune(0.7); // past MELD_DURATION → the merge fires
    expect(scene.melding).toBeNull();
    expect(b.absorbing).toBeUndefined(); // b (heavier) survives
    expect(a.absorbing).not.toBeUndefined();
    expect(b.mass).toBeCloseTo(0.03, 12);
  });

  it('the survivor RINGS — the damped l = 2 wobble — and settles after ~2 s', () => {
    const { scene, b } = stagePair();
    scene.prune(0);
    scene.prune(0.6);
    scene.prune(0.6); // meld completes inside this pass (t crosses 1)
    expect(b.wobbleT).not.toBeUndefined(); // the remnant is ringing
    expect(b.wobbleAxis).not.toBeUndefined();
    expect(b.wobbleAxis!.length()).toBeCloseTo(1, 5); // a unit collision axis
    scene.prune(1.0);
    expect(b.wobbleT).not.toBeUndefined(); // still ringing at ~1 s
    scene.prune(1.5); // past WOBBLE_DURATION (2.2 s)
    expect(b.wobbleT).toBeUndefined(); // settled spherical
    expect(b.wobbleAxis).toBeUndefined();
  });

  it('a drop coalescence throws the dust cloud; a hole capture does not', () => {
    const { scene, a, b } = stagePair();
    const dust: Array<{ strength: number; r0: number; axisLen: number }> = [];
    scene.onDust = (_x, _y, _z, ax, ay, az, strength, r0) =>
      dust.push({ strength, r0, axisLen: Math.hypot(ax, ay, az) });
    const summedR = a.radius + b.radius; // captured now — the victor's radius grows at the merge
    scene.prune(0);
    scene.prune(1.2);
    expect(dust.length).toBe(1);
    expect(dust[0]!.r0).toBeCloseTo(summedR, 5); // seeded at the summed PRE-merge radii
    expect(dust[0]!.strength).toBeGreaterThan(0);
    expect(dust[0]!.axisLen).toBeCloseTo(1, 5); // a unit collision axis

    // A hole capturing a star swallows — instant, no dust, no meld.
    const scene2 = new Scene();
    scene2.clearCompanions();
    const hole = scene2.addBlackHole();
    hole.position.set(40, 0, 0);
    const prey = scene2.addStar(30);
    prey.position.set(40 + (hole.radius + prey.radius) * 0.5, 0, 0);
    const dust2: number[] = [];
    scene2.onDust = () => dust2.push(1);
    scene2.prune(0.01);
    expect(scene2.melding).toBeNull(); // no meld window for a capture
    expect(prey.absorbing).not.toBeUndefined(); // swallowed on contact, as before
    expect(dust2.length).toBe(0);
  });

  it('a newborn TOV-collapse hole throws dust but does NOT ring (it is no drop)', () => {
    const { scene, a, b } = stagePair();
    a.msun = 1.2;
    b.msun = 1.1; // combined 2.3 ≥ TOV → collapse
    let dusted = 0;
    scene.onDust = () => dusted++;
    scene.prune(0);
    scene.prune(1.2);
    expect(b.type).toBe('hole'); // collapsed
    expect(dusted).toBe(1); // the blown-off envelope
    expect(b.wobbleT).toBeUndefined(); // a horizon doesn't slosh
  });

  it('a scrub-teleport breaks a stale meld — nobody merges, nobody is yanked back', () => {
    const { scene, a, b } = stagePair();
    scene.prune(0);
    expect(scene.melding).not.toBeNull();
    a.position.set(-30, 0, 0); // a restore snapped the pair far apart
    const events: string[] = [];
    scene.onEvent = (e) => events.push(e);
    scene.prune(0.1);
    expect(scene.melding).toBeNull(); // the meld dropped
    expect(a.absorbing).toBeUndefined(); // neither body merged
    expect(b.absorbing).toBeUndefined();
    expect(events).not.toContain('merge');
    expect(a.position.x).toBeCloseTo(-30, 0); // and a stayed where the restore put it
  });

  it('the melding getter SELF-HEALS on a teleported pair — no prune needed (scrub/replay renders)', () => {
    // A scrub drag / replay teleports bodies via History.restore without ever running prune; the
    // getter must not hand the shader a neck spanning the separated pair (review #1).
    const { scene, a } = stagePair();
    scene.prune(0);
    expect(scene.melding).not.toBeNull();
    a.position.set(-30, 0, 0); // the restore snapped the pair ~60 units apart
    expect(scene.melding).toBeNull(); // read-side invalidation — the very next frame renders clean
    expect(scene.melding).toBeNull(); // and it stays dropped (the getter cleared the state)
  });

  it('mid-meld gestures are refused — plunge/chase scripts cannot fight the glue', () => {
    const { scene, a, b } = stagePair();
    const other = scene.addStar(44);
    scene.prune(0);
    expect(scene.melding).not.toBeNull();
    expect(scene.plungeBody(a)).toBe(false); // a melding drop can't be sent plunging (review #2)
    expect(scene.plungeInto(other, b)).toBe(false); // …nor chased (the chase could never resolve)
    expect(scene.plungeInto(a, other)).toBe(false); // …nor sent chasing
    expect(scene.melding).not.toBeNull(); // the coalescence carries on undisturbed
    expect(scene.plungeBody(other)).toBe(true); // an uninvolved body still plunges fine
  });

  it('meld start clears chase-residue eaterId — no phantom spaghettification later (review #4)', () => {
    const { scene, a } = stagePair();
    a.eaterId = 999; // chase residue: a was homing at a hole when it grazed b instead
    scene.prune(0);
    expect(scene.melding).not.toBeNull();
    expect(a.eaterId).toBeUndefined(); // cleared with the chase at meld start
  });

  it('contact clears the chase state at meld START, so the homing script cannot fight the glue', () => {
    const { scene, a, b } = stagePair();
    a.position.set(30, 0, 0);
    b.position.set(38, 0, 0); // apart again — stage a chase instead
    scene.plungeInto(a, b);
    expect(a.chaseId).toBe(b.id);
    // Drive the chase to contact (wall-clock homing) — generously.
    for (let i = 0; i < 100 && scene.melding === null; i++) scene.prune(0.05);
    expect(scene.melding).not.toBeNull(); // the chase's terminal contact opens the meld window
    expect(a.chaseId).toBeUndefined(); // and the chase is fully resolved at meld start
    expect(a.chaseFrom).toBeUndefined();
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
