// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clampToRim, createOrbitMap, headingToward, mapExtent, worldToMap } from './orbitMap';

describe('orbitMap projection (pure helpers)', () => {
  it('mapExtent fits the widest orbit with headroom, floored for small systems', () => {
    expect(mapExtent([])).toBe(58); // empty field → the floor (default system scale)
    expect(mapExtent([10, 20, 30])).toBe(58); // still inside the floor
    expect(mapExtent([80])).toBeCloseTo(80 * 1.18, 10); // beyond it → widest × headroom
    expect(mapExtent([80, Number.NaN])).toBeCloseTo(94.4, 10); // NaNs ignored
  });

  it('worldToMap centres the origin and scales linearly (x → right, z → down)', () => {
    expect(worldToMap(0, 0, 60, 128)).toEqual({ px: 64, py: 64 });
    expect(worldToMap(60, 0, 60, 128)).toEqual({ px: 128, py: 64 }); // rim right
    expect(worldToMap(0, -60, 60, 128)).toEqual({ px: 64, py: 0 }); // rim top (−z = up)
    expect(worldToMap(30, 30, 60, 128)).toEqual({ px: 96, py: 96 }); // half-extent diagonal
  });

  it('clampToRim leaves inside points alone and pins outside points to the rim, direction kept', () => {
    expect(clampToRim(70, 64, 128, 57)).toEqual({ px: 70, py: 64, clamped: false });
    const far = clampToRim(64 + 200, 64, 128, 57); // way off right → pinned at the rim, same bearing
    expect(far.clamped).toBe(true);
    expect(far.px).toBeCloseTo(64 + 57, 10);
    expect(far.py).toBeCloseTo(64, 10);
    const diag = clampToRim(64 + 100, 64 + 100, 128, 57);
    expect(Math.hypot(diag.px - 64, diag.py - 64)).toBeCloseTo(57, 10); // exactly on the rim…
    expect(diag.px - 64).toBeCloseTo(diag.py - 64, 10); // …on the same 45° bearing
  });

  it("headingToward gives the camera chevron's facing (toward the origin-locked target)", () => {
    // Camera on +x looking back at the origin → facing −x → angle π.
    expect(Math.abs(headingToward(22, 0))).toBeCloseTo(Math.PI, 10);
    // Camera on +z (map-down) → facing −z (map-up) → −π/2 in canvas angles.
    expect(headingToward(0, 22)).toBeCloseTo(-Math.PI / 2, 10);
    // Camera on the −x/−z diagonal → facing +x/+z → +π/4.
    expect(headingToward(-10, -10)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('createOrbitMap mounts a canvas and draw() is safe without a 2D context (jsdom)', () => {
    const map = createOrbitMap();
    expect(map.el.className).toBe('hud__map');
    expect(map.el.width).toBe(256); // 2× backing for the 128px CSS square
    // jsdom has no canvas 2D context — the guard must make draw a clean no-op.
    expect(() =>
      map.draw({ bodies: [{ x: 30, y: 0, z: 0, vx: 0, vy: 0, vz: 0.18, type: 'star' }], camX: 0, camZ: 22 }),
    ).not.toThrow();
  });
});
