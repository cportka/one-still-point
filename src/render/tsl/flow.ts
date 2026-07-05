import { cos, float, length, log, max, normalize, sin, sqrt, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BlackHole } from '../../scene/BlackHole';

/** Keplerian angular velocity Ω(r) = √(M/r³) — inner orbits faster than outer. */
export function keplerOmega(r: Node<'float'>, mass: Node<'float'>) {
  return sqrt(mass.div(r.mul(r).mul(r)));
}

// Hurricane (live review: "sucking something in should animate a taste more like a hurricane"): when
// the hole is actively drawing a companion in (`hurricane` 0 idle → 1), the swirl tightens into
// **log-spiral rainbands** winding toward the eye, spins **faster**, and the **inflow accelerates**.
// At hurricane = 0 every term below vanishes, so a quiet disk is bit-for-bit unchanged.
const HURR_SPIN = 1.6; // extra co-rotation rate at full hurricane (up to ~2.6× the winding shear)
const HURR_WIND = 2.2; // radians of static equiangular (log) winding per e-fold in r — the rainbands
const HURR_INFALL = 3.0; // extra inward drift at full hurricane (up to ~4× the infall — the suck)

/**
 * The advected sample coordinate for the turbulence field. The dust is carried
 * by the flow, so we look up a *static* noise field at a coordinate that moves
 * with the gas — the field never reseeds, which is what keeps animated
 * volumetrics from boiling. Three motions compose:
 *
 *   - **differential rotation**: rotate into a frame co-rotating at Ω(r). Since
 *     Ω depends on radius, inner gas winds ahead of outer → the field shears
 *     into trailing spiral arms (the accretion-disk look);
 *   - **infall**: a slow radial drift so features spiral inward;
 *   - **churn**: a smooth drift through the noise so turbulence evolves rather
 *     than rigidly rotating (the role 4D noise would play).
 *
 * `hurricane` (0..1) intensifies all three into the suck-and-swirl look above.
 */
export function advectedCoord(p: Node<'vec3'>, time: Node<'float'>, bh: BlackHole, hurricane: Node<'float'>) {
  const r = length(vec2(p.x, p.z)); // cylindrical radius
  // Co-rotation, sped up as the hurricane spins up, plus a persistent equiangular log-spiral
  // winding that only appears with the hurricane — it twists the sampled static field into trailing
  // rainbands that wind into the centre. log(max(r/inner,1)) is 0 at the eye and grows outward.
  const ang = keplerOmega(r, bh.mass)
    .mul(time)
    .mul(bh.rotationSpeed)
    .mul(float(1).add(hurricane.mul(HURR_SPIN)))
    .add(hurricane.mul(HURR_WIND).mul(log(max(r.div(bh.diskInner), float(1)))));
  const ca = cos(ang);
  const sa = sin(ang);

  // Rotate p by -ang about the y axis (into the co-rotating frame).
  const pr = vec3(p.x.mul(ca).sub(p.z.mul(sa)), p.y, p.x.mul(sa).add(p.z.mul(ca)));

  const radial = normalize(vec3(p.x, float(0), p.z));
  // sample outward over time → inward flow; the hurricane accelerates the suck.
  const infall = radial.mul(bh.infallRate.mul(time).mul(float(1).add(hurricane.mul(HURR_INFALL))));
  const churn = vec3(float(0), bh.churnRate.mul(time), float(0));

  return pr.mul(bh.turbScale).add(infall).add(churn);
}
