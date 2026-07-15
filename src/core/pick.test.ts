import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Body } from '../scene/Body';
import { apparentScreenPos, pickBody } from './pick';

/** A minimal body at a position (the picker only reads position/radius/fixed). */
const bodyAt = (x: number, y: number, z: number, radius = 1, fixed = false): Body =>
  ({
    id: 1,
    type: 'star',
    mass: 1e-3,
    lensMass: 0,
    fixed,
    position: new Vector3(x, y, z),
    velocity: new Vector3(),
    radius,
    color: new Vector3(1, 1, 1),
  }) as Body;

/** The app's camera shape: at (0, 6, 22) looking at the origin, 60° fov. */
function appCamera(w: number, h: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, w / h, 0.01, 1000);
  cam.position.set(0, 6, 22);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('pickBody (the double-click hit test)', () => {
  it('picks a body under the click and misses far from it', () => {
    const cam = appCamera(800, 600);
    const b = bodyAt(0, 0, 0, 1.5);
    // Project the body ourselves to land the "click" exactly on it.
    const p = b.position.clone().project(cam);
    const sx = ((p.x + 1) / 2) * 800;
    const sy = ((1 - p.y) / 2) * 600;
    expect(pickBody([b], cam, sx, sy, 800, 600)).toBe(b);
    expect(pickBody([b], cam, sx + 300, sy, 800, 600)).toBeNull(); // 300px away → miss
  });

  it('never picks the fixed primary, and prefers the nearest of two bodies', () => {
    const cam = appCamera(800, 600);
    const primary = bodyAt(0, 0, 0, 2, true);
    const near = bodyAt(2, 0, 0, 1);
    const far = bodyAt(6, 0, 0, 1);
    const p = near.position.clone().project(cam);
    const sx = ((p.x + 1) / 2) * 800;
    const sy = ((1 - p.y) / 2) * 600;
    expect(pickBody([primary, far, near], cam, sx, sy, 800, 600)).toBe(near);
    expect(pickBody([primary], cam, 400, 300, 800, 600)).toBeNull(); // only the primary → nothing
  });

  it('ignores a body behind the camera', () => {
    const cam = appCamera(800, 600);
    const behind = bodyAt(0, 6, 40); // past the camera along its axis
    expect(pickBody([behind], cam, 400, 300, 800, 600)).toBeNull();
  });

  it('a tiny far speck is still clickable via the minimum hit circle', () => {
    const cam = appCamera(800, 600);
    const speck = bodyAt(0, 0, -60, 0.2); // far beyond the hole, sub-pixel radius
    const p = speck.position.clone().project(cam);
    const sx = ((p.x + 1) / 2) * 800;
    const sy = ((1 - p.y) / 2) * 600;
    expect(pickBody([speck], cam, sx + 10, sy + 10, 800, 600)).toBe(speck); // inside the 34px floor
  });

  it('the forgiving default radius (34px) makes a near-miss still land', () => {
    const cam = appCamera(800, 600);
    const speck = bodyAt(0, 0, -60, 0.2); // sub-pixel — the floor is what catches the click
    const p = speck.position.clone().project(cam);
    const sx = ((p.x + 1) / 2) * 800;
    const sy = ((1 - p.y) / 2) * 600;
    // A click ~28px off: outside the old 22px floor, inside the new 34px one → now a hit.
    expect(pickBody([speck], cam, sx + 20, sy + 20, 800, 600)).toBe(speck); // hypot(20,20) ≈ 28.3
    // Still bounded — a click well past the floor misses.
    expect(pickBody([speck], cam, sx + 40, sy + 40, 800, 600)).toBeNull(); // hypot(40,40) ≈ 56.6
  });
});

/**
 * INDEPENDENT verifier: a plain fixed-fine-step RK4 of the same ODE (a = −3M·x·h²/r⁵, static-
 * observer launch), structurally different from the implementation (no coarse schedule, no angle
 * bookkeeping). Returns the marched ray's closest approach to the body — if `apparentScreenPos`
 * returned a real image, the ray launched at its screen position must pass (essentially) through
 * the body.
 */
function independentMissOf(cam: PerspectiveCamera, screen: { x: number; y: number }, body: Vector3, M: number, w: number, h: number): number {
  // Unproject the returned screen position into a world-space pinhole direction.
  const ndc = new Vector3((screen.x / w) * 2 - 1, 1 - (screen.y / h) * 2, 0.5);
  const dir = ndc.unproject(cam).sub(cam.position).normalize();
  // Static-observer launch transform.
  const r0 = cam.position.length();
  const er = cam.position.clone().normalize();
  const radial = dir.dot(er);
  const sr = Math.sqrt(Math.max(1 - (2 * M) / r0, 0.0001));
  const v = dir.clone().addScaledVector(er, radial * (sr - 1)).normalize();
  const p = cam.position.clone();
  const h2 = p.clone().cross(v).lengthSq();
  const acc = (q: Vector3) => q.clone().multiplyScalar(-3 * M * h2 * Math.pow(q.lengthSq(), -2.5));
  let bestD = Infinity;
  const dl = 0.04; // fine fixed step — accuracy over speed; this is a test
  for (let i = 0; i < 4000; i++) {
    if (p.length() < 2 * M) break;
    if (p.length() > 70 && p.dot(v) > 0) break;
    // RK4
    const k1v = acc(p);
    const k2x = v.clone().addScaledVector(k1v, dl / 2);
    const k2v = acc(p.clone().addScaledVector(v, dl / 2));
    const k3x = v.clone().addScaledVector(k2v, dl / 2);
    const k3v = acc(p.clone().addScaledVector(k2x, dl / 2));
    const k4x = v.clone().addScaledVector(k3v, dl);
    const k4v = acc(p.clone().addScaledVector(k3x, dl));
    const dx = v.clone().add(k2x.clone().multiplyScalar(2)).add(k3x.clone().multiplyScalar(2)).add(k4x).multiplyScalar(dl / 6);
    p.add(dx);
    const dv = k1v.clone().add(k2v.clone().multiplyScalar(2)).add(k3v.clone().multiplyScalar(2)).add(k4v).multiplyScalar(dl / 6);
    v.add(dv);
    bestD = Math.min(bestD, p.distanceTo(body));
  }
  return bestD;
}

describe('apparentScreenPos (the lensed-image projection, marched on the true geodesic)', () => {
  const linear = (cam: PerspectiveCamera, pos: Vector3, w: number, h: number) => {
    const p = pos.clone().project(cam);
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  };

  it('with holeMass 0 it matches the plain linear projection', () => {
    const cam = appCamera(800, 600);
    const pos = new Vector3(4, 1, -8);
    const a = apparentScreenPos(cam, pos, 1, 800, 600, 0)!;
    const l = linear(cam, pos, 800, 600);
    expect(a.x).toBeCloseTo(l.x, 6);
    expect(a.y).toBeCloseTo(l.y, 6);
  });

  it('shifts grade with how close the sight line passes the hole', () => {
    const cam = appCamera(800, 600);
    const shiftOf = (pos: Vector3): number => {
      const a = apparentScreenPos(cam, pos, 1, 800, 600, 1)!;
      const l = linear(cam, pos, 800, 600);
      return Math.hypot(a.x - l.x, a.y - l.y);
    };
    // Camera-side body: the ray reaches it after a short inbound leg (min r ≈ 12M at the body) —
    // a few px of genuine bend, near-invisible. A body *behind* the scene whose sight line passes
    // ~13M from the hole bends hard; one hidden right behind the hole is pushed out to the shadow
    // edge. (With the camera at ~23M everything far-side is strongly lensed — this matches the big
    // background-star arcs visible in captures.)
    const frontShift = shiftOf(new Vector3(5, 4, 10));
    const behindShift = shiftOf(new Vector3(30, 0, -20)); // sight line passes ≈13M from the hole
    const hiddenShift = shiftOf(new Vector3(2, 0, -10)); // buried behind the hole
    expect(frontShift).toBeLessThan(8);
    expect(behindShift).toBeGreaterThan(30);
    expect(hiddenShift).toBeGreaterThan(15);
    expect(frontShift).toBeLessThan(behindShift);
    expect(frontShift).toBeLessThan(hiddenShift);
  });

  it('displaces the image radially AWAY from the hole', () => {
    const cam = appCamera(800, 600);
    const pos = new Vector3(3, 1, -12); // behind + off-axis
    const a = apparentScreenPos(cam, pos, 1, 800, 600, 1)!;
    const l = linear(cam, pos, 800, 600);
    const hole = linear(cam, new Vector3(0, 0, 0), 800, 600);
    const betaPx = Math.hypot(l.x - hole.x, l.y - hole.y);
    const thetaPx = Math.hypot(a.x - hole.x, a.y - hole.y);
    expect(thetaPx).toBeGreaterThan(betaPx); // pushed outward
    // Colinear with the true offset (the bend is planar → the displacement is purely radial).
    const cross = (l.x - hole.x) * (a.y - hole.y) - (l.y - hole.y) * (a.x - hole.x);
    expect(Math.abs(cross) / (betaPx * thetaPx)).toBeLessThan(0.02);
  });

  it('a body hidden behind the hole appears at (or outside) the shadow edge b_crit = 3√3·M', () => {
    const cam = appCamera(800, 600);
    // Almost dead-centre behind the hole: the linear projection dives deep into the shadow, but
    // the primary image must appear pushed out to at least the critical impact parameter.
    const pos = new Vector3(1.2, 0.33, -18); // β·D_L ≈ 1.4M — well inside b_crit 5.196M
    const a = apparentScreenPos(cam, pos, 1, 800, 600, 1)!;
    const hole = linear(cam, new Vector3(0, 0, 0), 800, 600);
    const focal = 600 / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const thetaPx = Math.hypot(a.x - hole.x, a.y - hole.y);
    const bApparent = cam.position.length() * Math.sin(Math.atan(thetaPx / focal));
    expect(bApparent).toBeGreaterThan(3 * Math.sqrt(3) * 0.9); // at/outside the shadow edge
  });

  it('TWO-SIDED anchor: a ray launched at the returned position actually HITS the body', () => {
    // The decisive test (added after adversarial review caught a spurious-root convergence): for
    // strong-field bodies — including cases where a closest-approach-based objective converged to
    // the shadow edge instead of the image — re-march the returned screen position with an
    // INDEPENDENT fixed-fine-step integrator and require it to pass essentially through the body.
    const cam = appCamera(800, 600);
    const cases = [
      new Vector3(2, 0, -10), // hidden just off-axis behind the hole (the review's 57px-error case)
      new Vector3(1.2, 0.33, -18), // deeply hidden (the review's 90px-error case)
      new Vector3(8, 0, -2), // visible beside the disk (the review's worse-than-linear case)
      new Vector3(30, 0, -20), // strongly bent far-side body
    ];
    for (const pos of cases) {
      const a = apparentScreenPos(cam, pos, 1, 800, 600, 1)!;
      const missWorld = independentMissOf(cam, a, pos, 1, 800, 600);
      // Sub-body-radius at the body — i.e. the returned point is a real image of it. The bound
      // (0.35 world units ≈ 6 px at this distance) absorbs the coarse-vs-fine integrator gap.
      expect(missWorld, `image miss for body ${pos.toArray().join(',')}`).toBeLessThan(0.35);
    }
  });

  it('pickBody with holeMass hits at the lensed image, not the stale linear position', () => {
    const cam = appCamera(800, 600);
    const primary = bodyAt(0, 0, 0, 2, true);
    const b = bodyAt(2, 0, -10, 1); // behind + just off-axis → strongly lensed
    const a = apparentScreenPos(cam, b.position, 1, 800, 600, 1)!;
    const l = linear(cam, b.position, 800, 600);
    expect(Math.hypot(a.x - l.x, a.y - l.y)).toBeGreaterThan(12); // the shift is real
    // A tight click on the apparent image hits (tiny floor so the discrimination is sharp)…
    expect(pickBody([primary, b], cam, a.x, a.y, 800, 600, 6, false, 1)).toBe(b);
    // …and the SAME tight click misses when the picker is lens-unaware (mass 0).
    expect(pickBody([primary, b], cam, a.x, a.y, 800, 600, 6, false, 0)).toBeNull();
  });
});
