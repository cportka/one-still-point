import { atan, clamp, cos, cross, dot, exp, float, length, max, normalize, sign, sin, smoothstep, sqrt, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

// --- Torn-stream arc (roadmap #8) — tuning dials -------------------------------------------------
// ⟳ Spaghettification look v2 (tuned against the ESO tidal-disruption reference footage): the tear
// is TWO blended arcs — the fresh rip trailing the body on its own (inclined) orbit, and a wrap
// that settles into the EATER's disk plane and sweeps the full circumference as the tear completes,
// so the stretch visibly spins all the way around the accretion disk instead of hugging a tiny deep
// circle near the horizon.
const STREAM_MAX_ARC = 6.6; // radians the fresh arc wraps at full tear (past 2π — closes a halo)
const STREAM_SPIRAL = 0.05; // gentle outward spiral along the fresh trail (debris came from further out)
const STREAM_MIN_TUBE = 0.12; // floor on the tube cross-section (so it never vanishes to a hairline)
const DISK_MAX_ARC = 7.2; // radians the disk-plane wrap reaches at full tear (a full lap + overlap)
const DISK_SETTLE_LO = 0.25; // tear at which the wrap starts taking over from the fresh arc…
const DISK_SETTLE_HI = 0.9; // …and where it is fully the dominant stream
const DISK_SINK = 0.6; // how fast the wrap's centreline sinks from the body's height into the disk plane (per radian)
const DISK_TUBE_SPREAD = 0.8; // the wrap's tube fattens by up to this fraction as it spreads into the disk

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

/** The closest point on segment [a, b] to `center` — the hit point for surface shading. */
export function segmentClosestPoint(
  a: Node<'vec3'>,
  b: Node<'vec3'>,
  center: Node<'vec3'>,
) {
  const d = b.sub(a);
  const m = a.sub(center);
  const t = clamp(dot(m, d).mul(-1).div(max(dot(d, d), float(0.0001))), float(0), float(1));
  return a.add(d.mul(t));
}

/**
 * Intensity (0..1) of the **torn-stream** at a point `p` — all positions **relative to the eater**
 * (the hole consuming the body: the origin for the central hole, a companion hole's position
 * otherwise). Two blended tubes:
 *
 *  1. **The fresh rip** — swept along the body's own orbital circle about the eater, starting at
 *     the body and trailing behind it (opposite its velocity) by an arc that grows with `tear`,
 *     spiralling gently outward. The tear as it happens, anchored to the body.
 *  2. **The disk wrap** — as the tear deepens (`tear` past DISK_SETTLE_LO), the shed mass
 *     circularizes into the eater's **disk plane** (y = 0): a tube at a radius easing onto
 *     `diskMid` (the disk's middle), its centreline sinking from the body's height into the plane
 *     along the trail, sweeping up to a **full lap** of the disk at full tear — the
 *     reference-footage look: the stretch spins all the way around the accretion disk.
 *
 * `vel` is the body's velocity (its orbit tangent — sets the trailing direction of both arcs);
 * `squash` thins the fresh tube; `rip` scales the whole event (a plunging hole's dragged accretion
 * structure rips longer + thicker). At `tear = 0` both arcs collapse to the body → a plain sphere.
 * A cheap point test — use it at a segment midpoint.
 */
export function streamArcHit(
  p: Node<'vec3'>,
  center: Node<'vec3'>,
  vel: Node<'vec3'>,
  radius: Node<'float'>,
  tear: Node<'float'>,
  squash: Node<'float'>,
  rip: Node<'float'>,
  diskMid: Node<'float'>,
) {
  // ---- 1. The fresh rip, on the body's own (possibly inclined) orbital circle ----
  const R = length(center);
  const u = normalize(center); // radial unit — the body sits at azimuth 0
  const n = normalize(cross(center, vel).add(vec3(1e-4, 1e-4, 1e-4))); // orbit normal (guarded)
  const w = normalize(cross(n, u)); // in-plane tangent (increasing azimuth)
  const trailSign = sign(dot(vel, w)).mul(-1); // the debris trails opposite the motion
  const dn = dot(p, n);
  const pPlane = p.sub(n.mul(dn));
  const ang = atan(dot(pPlane, w), dot(pPlane, u)); // signed azimuth of p from the body
  const phi = ang.mul(trailSign); // ≥ 0 in the trailing direction
  const arcLen = tear.mul(STREAM_MAX_ARC).mul(rip);
  const phiC = clamp(phi, float(0), arcLen); // nearest centreline azimuth (clamp → rounded caps)
  const Rc = R.mul(float(1).add(phiC.mul(STREAM_SPIRAL).mul(float(1).sub(tear))));
  const dir = u.mul(cos(phiC)).add(w.mul(sin(phiC).mul(trailSign)));
  const dist = length(p.sub(dir.mul(Rc)));
  const tubeR = radius.mul(max(squash, float(STREAM_MIN_TUBE))).mul(sqrt(rip));
  const fresh = smoothstep(tubeR, tubeR.mul(0.4), dist); // 1 in the tube core → 0 at its edge

  // ---- 2. The disk wrap, in the eater's disk plane ----
  // How settled the shed mass is: 0 = all fresh rip, 1 = fully circularized into the disk.
  const settle = smoothstep(float(DISK_SETTLE_LO), float(DISK_SETTLE_HI), tear);
  const uD = normalize(vec3(center.x, float(0), center.z).add(vec3(1e-4, 0, 0))); // body azimuth, in-plane
  const wD = cross(vec3(0, 1, 0), uD); // in-plane tangent (fixed y-up frame)
  const trailSignD = sign(dot(vel, wD).add(1e-5)).mul(-1); // trail opposite the in-plane motion
  const pD = vec3(p.x, float(0), p.z);
  const angD = atan(dot(pD, wD), dot(pD, uD));
  const phiD = angD.mul(trailSignD); // ≥ 0 trailing, in the disk plane
  const arcLenD = tear.mul(DISK_MAX_ARC).mul(rip);
  const phiDC = clamp(phiD, float(0), arcLenD);
  // The wrap's radius eases from the body's own cylindrical radius onto the disk's middle as the
  // mass settles; its height sinks from the body's height into the plane along the trail.
  const rCyl = length(vec2(center.x, center.z));
  const frac = clamp(phiDC.div(max(arcLenD, float(0.001))), float(0), float(1)); // how far along the trail
  const settleLocal = clamp(settle.mul(0.35).add(frac.mul(0.65)), float(0), float(1));
  const Rd = rCyl.add(diskMid.sub(rCyl).mul(settleLocal));
  const yC = center.y.mul(exp(phiDC.mul(-DISK_SINK)));
  const dirD = uD.mul(cos(phiDC)).add(wD.mul(sin(phiDC).mul(trailSignD)));
  const distD = length(p.sub(dirD.mul(Rd).add(vec3(0, 1, 0).mul(yC))));
  const tubeD = radius.mul(max(squash, float(STREAM_MIN_TUBE))).mul(sqrt(rip)).mul(float(1).add(settle.mul(DISK_TUBE_SPREAD)));
  const wrap = smoothstep(tubeD, tubeD.mul(0.4), distD);

  // The fresh rip hands off to the wrap as the mass settles; max avoids double-brightness overlap.
  return max(fresh.mul(float(1).sub(settle.mul(0.55))), wrap.mul(smoothstep(float(0.12), float(0.45), tear)));
}
