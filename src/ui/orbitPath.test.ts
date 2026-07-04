import { describe, expect, it } from 'vitest';
import { orbitPathXZ, pathMaxRadiusXZ } from './orbitPath';

const radii = (path: Float32Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < path.length; i += 2) out.push(Math.hypot(path[i]!, path[i + 1]!));
  return out;
};

describe('orbitPathXZ (Kepler conic from state vectors)', () => {
  it('a circular state draws a circle at its radius', () => {
    const r = 30;
    const v = Math.sqrt(1 / r); // circular speed, μ = 1
    const path = orbitPathXZ({ x: r, y: 0, z: 0, vx: 0, vy: 0, vz: v })!;
    expect(path).not.toBeNull();
    for (const rr of radii(path)) expect(rr).toBeCloseTo(r, 4); // Float32 storage ≈ 1e-7 relative
  });

  it('an under-speed tangential state draws an ellipse: apoapsis here, periapsis inside', () => {
    const r = 40;
    const vCirc = Math.sqrt(1 / r);
    const v = vCirc * 0.8; // sub-circular → this point is the apoapsis
    const path = orbitPathXZ({ x: r, y: 0, z: 0, vx: 0, vy: 0, vz: v })!;
    const rs = radii(path);
    const apo = Math.max(...rs);
    const peri = Math.min(...rs);
    expect(apo).toBeCloseTo(r, 4); // launched at apoapsis
    // Closed-form check: e = 1 − r·v²/μ at apoapsis → peri = r(1−e)/(1+e).
    const e = 1 - r * v * v;
    expect(peri).toBeCloseTo((r * (1 - e)) / (1 + e), 4);
    expect(pathMaxRadiusXZ(path)).toBeCloseTo(apo, 4);
  });

  it('an inclined orbit still projects to a closed top-down path at the right scale', () => {
    const r = 30;
    const v = Math.sqrt(1 / r);
    // Tilt the velocity 30° out of the xz-plane — same speed, circular, inclined plane.
    const path = orbitPathXZ({ x: r, y: 0, z: 0, vx: 0, vy: v * Math.sin(Math.PI / 6), vz: v * Math.cos(Math.PI / 6) })!;
    expect(path).not.toBeNull();
    // The 3D orbit is a circle of radius r; its x/z projection never exceeds r.
    expect(pathMaxRadiusXZ(path)).toBeLessThanOrEqual(r + 1e-6);
    expect(pathMaxRadiusXZ(path)).toBeGreaterThan(r * 0.8); // …and isn't degenerate
  });

  it('escape and radial-plunge states have no closed path', () => {
    const r = 30;
    const vEsc = Math.sqrt(2 / r);
    expect(orbitPathXZ({ x: r, y: 0, z: 0, vx: 0, vy: 0, vz: vEsc * 1.01 })).toBeNull(); // unbound
    expect(orbitPathXZ({ x: r, y: 0, z: 0, vx: -0.1, vy: 0, vz: 0 })).toBeNull(); // straight infall (h ≈ 0)
  });
});
