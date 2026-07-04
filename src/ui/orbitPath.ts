/**
 * Orbit prediction for the HUD map (live review: "a better estimation for orbit path (ie
 * elliptical, take into account current acceleration, but also be mindful of CPU usage)").
 *
 * The exact closed-form answer, not an integrator: in the central field the acceleration is
 * −μ·r̂/r², and the orbit that position+velocity define under it is a **Kepler conic** — so
 * computing the conic from the state vectors *is* "taking the current acceleration into account",
 * with zero per-frame simulation. From (r⃗, v⃗): the specific angular momentum h⃗ = r⃗×v⃗, the
 * eccentricity vector e⃗ = (v⃗×h⃗)/μ − r̂, and the semi-major axis a from vis-viva. Bound orbit →
 * sample the ellipse r(θ) = a(1−e²)/(1+e·cosθ) in the orbital-plane basis (p̂ toward periapsis,
 * q̂ = ĥ×p̂) and hand back world-space points (the map projects them to x/z top-down).
 *
 * Cost: ~50 trig evaluations per body per drawn map frame — microseconds, and only while the map
 * is on screen. Deliberately ignored (stated, not hidden): the softening ε (visible only within a
 * few units of the hole) and the other companions' pulls (a small perturbation — the same
 * precession the sim itself shows as the drawn path slowly turning).
 *
 * Returns `null` for unbound/degenerate states (e ≳ 1, radial plunges) — the map draws no path
 * for a body that has no closed one.
 */

export const ORBIT_PATH_SAMPLES = 48;

/** Max eccentricity we draw — beyond this the ellipse is effectively an escape sliver. */
const E_MAX = 0.97;

export interface OrbitPathState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * The predicted orbit as a flat `[x0, z0, x1, z1, …]` polyline (closed — the map joins the last
 * point back to the first), or `null` when there is no bound path to draw. `mu` is the central
 * mass in the sim's units (the primary is 1). Pure.
 */
export function orbitPathXZ(s: OrbitPathState, mu = 1, samples = ORBIT_PATH_SAMPLES): Float32Array | null {
  const r = Math.hypot(s.x, s.y, s.z);
  const v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
  if (!(r > 1e-6) || !Number.isFinite(v2)) return null;

  // h⃗ = r⃗ × v⃗ — a near-zero h is a radial plunge: no closed path.
  const hx = s.y * s.vz - s.z * s.vy;
  const hy = s.z * s.vx - s.x * s.vz;
  const hz = s.x * s.vy - s.y * s.vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  if (h2 < 1e-9) return null;

  // Vis-viva: 1/a = 2/r − v²/μ. a ≤ 0 (or huge) → unbound / effectively unbound.
  const inv2a = 2 / r - v2 / mu;
  if (inv2a <= 1e-6) return null;
  const a = 1 / inv2a;

  // e⃗ = (v⃗ × h⃗)/μ − r̂.
  const ex = (s.vy * hz - s.vz * hy) / mu - s.x / r;
  const ey = (s.vz * hx - s.vx * hz) / mu - s.y / r;
  const ez = (s.vx * hy - s.vy * hx) / mu - s.z / r;
  const e = Math.hypot(ex, ey, ez);
  if (e >= E_MAX) return null;

  // Orbital-plane basis: p̂ toward periapsis (falls back to r̂ for a perfect circle), q̂ = ĥ×p̂.
  const h = Math.sqrt(h2);
  const nx = hx / h;
  const ny = hy / h;
  const nz = hz / h;
  let px: number;
  let py: number;
  let pz: number;
  if (e > 1e-6) {
    px = ex / e;
    py = ey / e;
    pz = ez / e;
  } else {
    px = s.x / r;
    py = s.y / r;
    pz = s.z / r;
  }
  // Only the x/z of q̂ are needed — the map is a top-down projection.
  const qx = ny * pz - nz * py;
  const qz = nx * py - ny * px;

  const semiLatus = a * (1 - e * e);
  const out = new Float32Array(samples * 2);
  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2;
    const c = Math.cos(theta);
    const rTheta = semiLatus / (1 + e * c);
    const sTheta = Math.sin(theta);
    // World-space point on the conic; the top-down map wants its x and z.
    out[i * 2] = rTheta * (px * c + qx * sTheta);
    out[i * 2 + 1] = rTheta * (pz * c + qz * sTheta);
  }
  return out;
}

/** The path's largest |(x,z)| — the map's extent fitting (so an eccentric apoapsis stays in frame). */
export function pathMaxRadiusXZ(path: Float32Array): number {
  let max = 0;
  for (let i = 0; i < path.length; i += 2) {
    const r = Math.hypot(path[i]!, path[i + 1]!);
    if (r > max) max = r;
  }
  return max;
}
