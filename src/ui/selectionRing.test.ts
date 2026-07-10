import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ringFor } from './selectionRing';

// The selection ring reuses the same world→screen projection as pickBody, so these lock the
// projection: a body at the look-at point lands at screen centre, a body behind the camera is
// culled, and a nearer body projects a larger ring than a farther one.
describe('selectionRing.ringFor', () => {
  const cam = (): PerspectiveCamera => {
    const c = new PerspectiveCamera(60, 1, 0.1, 1000);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  };

  it('projects a body at the look-at point to screen centre', () => {
    const p = ringFor(cam(), new Vector3(0, 0, 0), 1, 200, 100);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(100, 1); // centre x = cssW / 2
    expect(p!.y).toBeCloseTo(50, 1); // centre y = cssH / 2
    expect(p!.r).toBeGreaterThan(0); // a positive projected radius
  });

  it('returns null for a body behind the camera', () => {
    // Camera at z = 10 looking toward the origin; a body at z = 20 sits behind it.
    expect(ringFor(cam(), new Vector3(0, 0, 20), 1, 200, 100)).toBeNull();
  });

  it('projects a nearer body to a larger ring than a farther one', () => {
    const near = ringFor(cam(), new Vector3(0, 0, 5), 1, 200, 100); // 5 units away
    const far = ringFor(cam(), new Vector3(0, 0, -5), 1, 200, 100); // 15 units away
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.r).toBeGreaterThan(far!.r);
  });
});
