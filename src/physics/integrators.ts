import { Vector3 } from 'three';
import type { Body } from '../scene/Body';

const G = 1; // geometric units
/** Softened gravity to avoid singular accelerations. Exported so a freshly added
 *  body can be given the matching circular-orbit speed (see Scene.addBody). */
export const SOFTENING2 = 0.25;

/**
 * Roadmap #7 — relativistic-*looking* perihelion precession, the safe way. A companion's pull from
 * the primary gets one extra **position-only** inverse-cube term, so the total central force is
 * `f(r) = M/r² + k/r³`. That force precesses the ellipse *analytically* — the apsidal angle is
 * `Φ = π·√(1 + k/r)`, i.e. the orbit advances `Δφ = 2π(√(1 + k/r) − 1)` per turn (validated in
 * `scripts/validate-orbit.mjs`), reproducing the GR perihelion advance's `~1/r` falloff with a single
 * constant. Crucially it is a pure function of position (a gradient of `U = −kM/(2r²)`), so
 * velocity-Verlet stays symplectic and **bit-exact time-reversible** (`integrators.test.ts`) — unlike
 * a true velocity-dependent 1PN term, which would break Step-back / the DVR timeline.
 *
 * It is a **look** dial, not a geodesic: the literal weak-field GR match is `k = 6M`, which at these
 * radii is a fast rosette; `0.3` is a slow, on-theme apsidal drift (a few degrees per orbit, most
 * visible once an orbit is eccentric — e.g. after a body is scattered). `0` disables it with zero
 * branch cost. The induced eccentricity for a body seeded at the *Newtonian* circular speed is only
 * `~k/(Mr) ≈ 1%`, so the existing seed speed (`Scene.addBody`) is left as-is at this value.
 */
export const PRECESSION_K: number = 0.3;

/**
 * Dark sector (roadmap #12/#13) — two runtime knobs (Advanced sliders), each a **position-only**
 * radial term added to a companion's pull from the fixed primary. Like `PRECESSION_K` they are pure
 * functions of position, so velocity-Verlet stays symplectic and **bit-exact time-reversible**
 * (Step-back / DVR intact — see `integrators.test.ts`). Both default to `0` (off) with zero branch
 * cost, so the intro and the default scene are untouched.
 *
 *   • **Dark matter** — an isothermal halo: an inward `A/r` acceleration (enclosed halo mass ∝ r).
 *     A companion then needs a higher circular speed, so at its seeded Newtonian speed the orbit
 *     tightens/precesses, and the implied rotation curve **flattens** (v → √A at large r) instead of
 *     falling off Keplerian — the classic dark-matter fingerprint.
 *   • **Dark energy** — the cosmological constant Λ: an outward `Λ·r` repulsion. Past the turnaround
 *     radius `r_ta = (M/Λ)^(1/3)` it overwhelms gravity and flings the outer bodies away.
 *
 * Both are exaggerated **look dials**, not literal cosmology — the magnitudes are chosen so a slider
 * at 1 is dramatic-but-stable at the app's ~20–48 M orbit radii. The sliders are 0..1 and scale to
 * these maxima via {@link setDarkSector}.
 */
const DARK_MATTER_MAX = 0.05; // A at slider 1 — ≈2× gravity at r≈40 (√A ≈ the r≈40 circular speed)
const DARK_ENERGY_MAX = 3e-5; // Λ at slider 1 — turnaround r_ta ≈ 32 (the outer companions unbind)
let darkMatter = 0; // scaled halo strength A (0 … DARK_MATTER_MAX)
let darkEnergy = 0; // scaled Λ (0 … DARK_ENERGY_MAX)

/** Set the dark-sector strengths from two 0..1 sliders (Advanced → Dark matter / Dark energy). */
export function setDarkSector(matter01: number, energy01: number): void {
  darkMatter = Math.min(1, Math.max(0, matter01)) * DARK_MATTER_MAX;
  darkEnergy = Math.min(1, Math.max(0, energy01)) * DARK_ENERGY_MAX;
}

/** The current raw (scaled) strengths — for tests / introspection. */
export function getDarkSector(): { darkMatter: number; darkEnergy: number } {
  return { darkMatter, darkEnergy };
}

const diff = new Vector3();

/** Newtonian pairwise gravitational accelerations into `acc` (one per body), plus the position-only
 *  r⁻³ precession term (`PRECESSION_K`) on each companion↔primary pull. */
export function computeAccelerations(bodies: Body[], acc: Vector3[]): void {
  for (let i = 0; i < bodies.length; i++) acc[i]!.set(0, 0, 0);

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i]!;
    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j]!;
      diff.subVectors(bj.position, bi.position);
      const r2 = diff.lengthSq() + SOFTENING2;
      const invR3 = 1 / (Math.sqrt(r2) * r2);
      // a_i += G m_j (r_j - r_i) / |r|³, and the equal-and-opposite on j.
      acc[i]!.addScaledVector(diff, G * bj.mass * invR3);
      acc[j]!.addScaledVector(diff, -G * bi.mass * invR3);

      // Extra central-force terms on a companion's pull from the fixed primary (exactly one of the
      // pair is fixed) — never companion↔companion, where a 1/r⁴ pull could spike at a softened close
      // pass. All three are POSITION-ONLY, so reversibility holds. `s` is the scalar on `diff` in the
      // "toward the primary" convention (+diff points the companion at the primary), so the inward
      // precession (k/r³) and dark-matter halo (A/r) add, and the outward dark-energy Λ·r subtracts.
      if (bi.fixed !== bj.fixed && (PRECESSION_K !== 0 || darkMatter !== 0 || darkEnergy !== 0)) {
        let s = 0;
        if (PRECESSION_K !== 0) s += (PRECESSION_K * invR3) / Math.sqrt(r2); // k/r⁴ scalar → k/r³ inward
        if (darkMatter !== 0) s += darkMatter / r2; // A/r² scalar → A/r inward (isothermal halo)
        if (darkEnergy !== 0) s -= darkEnergy; // Λ scalar → Λ·r outward (away from the primary)
        if (!bi.fixed) acc[i]!.addScaledVector(diff, s); // i is the companion (+diff → toward primary j)
        else acc[j]!.addScaledVector(diff, -s); // j is the companion (−diff → toward primary i)
      }
    }
  }
}

/**
 * One velocity-Verlet (kick–drift–kick) step. Symplectic, so orbits stay stable
 * over long runs (validated in scripts/validate-orbit.mjs). `acc` must hold the
 * accelerations at the current positions on entry; it is left holding the
 * accelerations at the new positions on exit, ready for the next step.
 */
export function velocityVerletStep(bodies: Body[], acc: Vector3[], dt: number): void {
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    if (b.fixed) continue;
    b.velocity.addScaledVector(acc[i]!, dt * 0.5); // half kick
    b.position.addScaledVector(b.velocity, dt); // drift
  }

  computeAccelerations(bodies, acc);

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    if (b.fixed) continue;
    b.velocity.addScaledVector(acc[i]!, dt * 0.5); // half kick
  }
}
