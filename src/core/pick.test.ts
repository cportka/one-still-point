import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Body } from '../scene/Body';
import { pickBody } from './pick';

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
