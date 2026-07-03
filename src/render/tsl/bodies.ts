import { atan, clamp, cos, cross, dot, float, length, max, normalize, sign, sin, smoothstep, sqrt, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

// --- Torn-stream arc (roadmap #8) — tuning dials -------------------------------------------------
const STREAM_MAX_ARC = 6.6; // radians the stream wraps at full tear — past 2π, so the plunge finale closes into a full halo ring
const STREAM_SPIRAL = 0.05; // gentle outward spiral along the trail (the debris came from further out)
const STREAM_MIN_TUBE = 0.12; // floor on the tube cross-section (so it never vanishes to a hairline)

/**
 * Whether the segment [a, b] passes within `radius` of `center` — a robust
 * sphere test (closest point on the segment) that catches the body even when a
 * coarse geodesic step would jump over it. Returns a bool node.
 */
export function segmentHitsSphere(
  a: Node<'vec3'>,
  b: Node<'vec3'>,
  center: Node<'vec3'>,
  radius: Node<'float'>,
) {
  const d = b.sub(a);
  const m = a.sub(center);
  const t = clamp(dot(m, d).mul(-1).div(max(dot(d, d), float(0.0001))), float(0), float(1));
  const closest = a.add(d.mul(t));
  return length(closest.sub(center)).lessThan(radius);
}

/**
 * Intensity (0..1) of the **torn-stream arc** at a point `p`: a tube of gas swept along the body's
 * orbital **circle**, starting at the body and **trailing behind** it (opposite its velocity) by an
 * arc that grows with `tear`, wrapping the hole and spiralling gently outward — so the rip follows
 * the event-horizon circle instead of spiking radially. `vel` is the body's velocity (its orbit
 * tangent); `squash` thins the tube. A cheap point test — use it at a segment midpoint.
 *
 * Geometry: in the body's orbital plane (normal `n = center × vel`), `p` has an azimuth measured
 * from the body; we clamp that azimuth to the trailing arc `[0, tear·MAX_ARC]` (the clamp gives
 * rounded end-caps), find the point on the (gently spiralling) circle there, and shade by distance
 * to it. At `tear = 0` the arc is a single point → a plain sphere at the body.
 */
export function streamArcHit(
  p: Node<'vec3'>,
  center: Node<'vec3'>,
  vel: Node<'vec3'>,
  radius: Node<'float'>,
  tear: Node<'float'>,
  squash: Node<'float'>,
  rip: Node<'float'>,
) {
  const R = length(center);
  const u = normalize(center); // radial unit — the body sits at azimuth 0
  const n = normalize(cross(center, vel).add(vec3(1e-4, 1e-4, 1e-4))); // orbit normal (guarded)
  const w = normalize(cross(n, u)); // in-plane tangent (increasing azimuth)
  const trailSign = sign(dot(vel, w)).mul(-1); // the debris trails opposite the motion
  const dn = dot(p, n);
  const pPlane = p.sub(n.mul(dn));
  const ang = atan(dot(pPlane, w), dot(pPlane, u)); // signed azimuth of p from the body
  const phi = ang.mul(trailSign); // ≥ 0 in the trailing direction
  // `rip` scales the whole event (1 = star/planet): a black hole's dragged accretion structure
  // rips **far longer** (arc × rip — multiple full revolutions at the finale) and **thicker**
  // (tube × √rip) — the overwhelming plunge of the set.
  const arcLen = tear.mul(STREAM_MAX_ARC).mul(rip);
  const phiC = clamp(phi, float(0), arcLen); // nearest centreline azimuth (clamp → rounded caps)
  // The trail spirals gently outward — but flattens to a perfect circle as the tear completes
  // (the debris circularizes), so the full-wrap finale closes into a clean halo ring instead of
  // leaving a spiral gap where the tail overlaps the head.
  const Rc = R.mul(float(1).add(phiC.mul(STREAM_SPIRAL).mul(float(1).sub(tear))));
  const dir = u.mul(cos(phiC)).add(w.mul(sin(phiC).mul(trailSign))); // unit dir to the centreline point
  const dist = length(p.sub(dir.mul(Rc))); // distance to the swept centreline
  const tubeR = radius.mul(max(squash, float(STREAM_MIN_TUBE))).mul(sqrt(rip));
  return smoothstep(tubeR, tubeR.mul(0.4), dist); // 1 in the tube core → 0 at its edge
}
