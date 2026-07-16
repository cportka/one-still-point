import { atan, clamp, cos, cross, dot, exp, float, length, max, min, normalize, select, sign, sin, smoothstep, sqrt, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';

// --- Torn-stream arc (roadmap #8) — tuning dials -------------------------------------------------
// ⟳ Spaghettification look v3 (v0.95.2, retuned against the BH-plunge capture): the tear is TWO
// blended arcs — the fresh rip trailing the body on its own (inclined) orbit, and a wrap that
// settles into the EATER's disk plane. Trailing azimuths are UNWRAPPED to [0, 2π) before the arc
// clamp (adversarial review: atan's (−π, π] range silently cut both arcs to half a lap with a hard
// edge at 180°). Three v3 dynamics rules, each answering a video-verified wrongness:
//   1. The fresh trail spirals **inward** toward the eater's disk (STREAM_INFALL) — v2's outward
//      drift read as material being flung AWAY from the hole instead of sucked toward it.
//   2. Neither arc ever **closes into a ring**: the cap is ARC_CAP (~85% of a lap), so a head and
//      tail stay visible and the sweep reads as flow — the closed 2π lap rode the plunging body's
//      azimuth as a rigid glowing hula-hoop for the whole ~8s descent ("twirling and twirling").
//   3. The wrap **drains late in the tear** (WRAP_DRAIN past tear 0.8) — the shed mass has mostly
//      accreted by then; the stream dims into the disk instead of persisting at full blaze.
const TWO_PI = Math.PI * 2;
const STREAM_MAX_ARC = 6.6; // radians of fresh arc at full tear (before the ARC_CAP)
const STREAM_INFALL_RATE = 1.1; // v4: the trail falls TOWARD the eater front-loaded — 1−e^(−rate·φ)
// of the body→disk gap closed per radian, so ~63% of the dive happens in the first radian ("the
// suck is towards first, THEN around" — v3's linear ease spread the dive over the whole lap and
// the launch read as tangential circling)
const STREAM_MIN_TUBE = 0.12; // floor on the tube cross-section (so it never vanishes to a hairline)
const ARC_CAP = TWO_PI * 0.85; // arcs never close: a permanent moving gap keeps head + tail visible
const TUBE_TAPER = 0.55; // both tubes thin along the trail, to 45% at the tail — sucked matter narrows as it falls
const DISK_MAX_ARC = 7.2; // radians of disk wrap at full tear (before the ARC_CAP)
const DISK_SETTLE_LO = 0.25; // tear at which the wrap starts taking over from the fresh arc…
const DISK_SETTLE_HI = 0.9; // …and where it is fully the dominant stream
const DISK_SINK = 0.6; // how fast the wrap's centreline sinks from the body's height into the disk plane (per radian)
const DISK_TUBE_SPREAD = 0.8; // the wrap's tube fattens by up to this fraction as it spreads into the disk
const RING_DESCEND = 0.65; // as the mass settles the wrap's target radius descends from diskMid toward the
// event-horizon ring — final target = diskMid·(1 − RING_DESCEND) ≈ a tight bright circle hugging the
// shadow (the ESO reference's last beat: the tapered filament joins the glowing ring at the horizon).
const WRAP_DRAIN_LO = 0.8; // tear past which the wrap starts draining into the disk…
const WRAP_DRAIN = 0.45; // …dimming by up to this fraction at full tear (softened 0.6 → 0.45: the tail
// now IS the horizon ring — it should visibly add to the bright circle, not fade out early)

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
 * A cheap, fully-3D smooth noise in ~[−1, 1]: two "octaves" of summed incommensurate sine plaids.
 * ~25 ALU ops and a few emitted statements — deliberately NOT MaterialX fbm, whose code size ×14
 * unrolled body slots would bloat the intro-critical lean compile. Being genuinely 3D (no
 * longitude/latitude parameterization) it has **no pole degeneracy** — the planet-surface fix for
 * the radial-pleat artifact the first trig pattern showed at the poles.
 */
export function cheapNoise3(p: Node<'vec3'>) {
  const a = sin(dot(p, vec3(1.7, 4.1, 2.3)))
    .add(sin(dot(p, vec3(3.9, 1.3, 3.1))))
    .add(sin(dot(p, vec3(2.4, 3.2, 1.9))));
  const b = sin(dot(p, vec3(5.9, 8.3, 6.7)))
    .add(sin(dot(p, vec3(7.7, 5.3, 9.1))));
  return a.mul(0.27).add(b.mul(0.13)); // ≈ ±1, dominated by the low octave
}

/**
 * Intensity (0..1) of the **torn-stream** at a point `p` — all positions **relative to the eater**
 * (the hole consuming the body: the origin for the central hole, a companion hole's position
 * otherwise). Two blended tubes:
 *
 *  1. **The fresh rip** — swept along the body's orbit about the eater, starting at the body and
 *     trailing behind it (opposite its velocity) by an arc that grows with `tear`, **spiralling
 *     inward toward the eater's disk** (the sucking read — the tail is further along its fall
 *     than the head). The tear as it happens, anchored to the body.
 *  2. **The disk wrap** — as the tear deepens (`tear` past DISK_SETTLE_LO), the shed mass
 *     circularizes into the eater's **disk plane** (y = 0): a tube at a radius easing onto
 *     `diskMid` (the disk's middle), its centreline sinking from the body's height into the plane
 *     along the trail, sweeping most of the way around the disk (capped at ARC_CAP so it never
 *     closes into a rigid ring) and **draining** late in the tear as the mass accretes.
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
  const trailSign = sign(dot(vel, w).add(1e-5)).mul(-1); // the debris trails opposite the motion (guarded)
  const dn = dot(p, n);
  const pPlane = p.sub(n.mul(dn));
  const ang = atan(dot(pPlane, w), dot(pPlane, u)); // signed azimuth of p from the body, (−π, π]
  const phiRaw = ang.mul(trailSign);
  const phi = phiRaw.add(select(phiRaw.lessThan(0), float(TWO_PI), float(0))); // unwrapped: [0, 2π) trailing
  const arcLen = min(tear.mul(STREAM_MAX_ARC).mul(rip), float(ARC_CAP)); // never closes — the gap keeps it a stream
  const phiC = clamp(phi, float(0), arcLen); // nearest centreline azimuth (clamp → rounded caps)
  // The trail falls INWARD along the arc — from the body's radius toward the eater's disk middle.
  // FRONT-LOADED (v4): most of the dive happens in the first radian (1 − e^(−rate·φ)), so the
  // stream visibly plunges TOWARD the eater off the body, then levels out and rides AROUND —
  // towards first, then around. (v3's linear φ/2π ease spread the dive so thin the launch read
  // as tangential circling.) When the body is already inside diskMid the same ease carries the
  // trail outward onto the disk: either way, toward where the mass is going.
  const inward = float(1).sub(exp(phiC.mul(-STREAM_INFALL_RATE)));
  const Rc = R.add(diskMid.sub(R).mul(inward).mul(tear));
  const dir = u.mul(cos(phiC)).add(w.mul(sin(phiC).mul(trailSign)));
  const dist = length(p.sub(dir.mul(Rc)));
  // The tube TAPERS along the trail (sucked matter narrows as it falls) — the head keeps the
  // full rip cross-section (the loved passing-object stretch), the tail thins toward a filament.
  const fracF = phiC.div(max(arcLen, float(0.001)));
  const tubeR = radius.mul(max(squash, float(STREAM_MIN_TUBE))).mul(sqrt(rip)).mul(float(1).sub(fracF.mul(TUBE_TAPER)));
  const fresh = smoothstep(tubeR, tubeR.mul(0.4), dist); // 1 in the tube core → 0 at its edge

  // ---- 2. The disk wrap, in the eater's disk plane ----
  // How settled the shed mass is: 0 = all fresh rip, 1 = fully circularized into the disk.
  const settle = smoothstep(float(DISK_SETTLE_LO), float(DISK_SETTLE_HI), tear);
  const uD = normalize(vec3(center.x, float(0), center.z).add(vec3(1e-4, 0, 0))); // body azimuth, in-plane
  const wD = cross(vec3(0, 1, 0), uD); // in-plane tangent (fixed y-up frame)
  const trailSignD = sign(dot(vel, wD).add(1e-5)).mul(-1); // trail opposite the in-plane motion
  const pD = vec3(p.x, float(0), p.z);
  const angD = atan(dot(pD, wD), dot(pD, uD));
  const phiDRaw = angD.mul(trailSignD);
  const phiD = phiDRaw.add(select(phiDRaw.lessThan(0), float(TWO_PI), float(0))); // unwrapped: [0, 2π) trailing
  const arcLenD = min(tear.mul(DISK_MAX_ARC).mul(rip), float(ARC_CAP)); // never closes — the gap keeps it a stream
  const phiDC = clamp(phiD, float(0), arcLenD);
  // The wrap's radius eases from the body's own cylindrical radius onto the disk's middle as the
  // mass settles; its height sinks from the body's height into the plane along the trail.
  const rCyl = length(vec2(center.x, center.z));
  const frac = clamp(phiDC.div(max(arcLenD, float(0.001))), float(0), float(1)); // how far along the trail
  // Front-loaded too (v4): the wrap reaches its target radius within the first half-lap and then
  // rides AT the ring — around as the peak, not a whole lap of slow descent.
  const fracIn = smoothstep(float(0), float(0.45), frac);
  const settleLocal = clamp(settle.mul(0.35).add(fracIn.mul(0.65)), float(0), float(1));
  // The wrap's target radius DESCENDS as the mass settles: early tear circularizes at the disk's
  // middle; by full settle the tail has spiralled down to a tight circle just outside the shadow —
  // the sucked matter tapers to the bright ring around the event horizon (the ESO reference).
  const target = diskMid.mul(float(1).sub(settle.mul(RING_DESCEND)));
  const Rd = rCyl.add(target.sub(rCyl).mul(settleLocal));
  const yC = center.y.mul(exp(phiDC.mul(-DISK_SINK)));
  const dirD = uD.mul(cos(phiDC)).add(wD.mul(sin(phiDC).mul(trailSignD)));
  const distD = length(p.sub(dirD.mul(Rd).add(vec3(0, 1, 0).mul(yC))));
  // Spread with settle, then taper along the trail — the far end is a filament joining the ring.
  const tubeD = radius
    .mul(max(squash, float(STREAM_MIN_TUBE)))
    .mul(sqrt(rip))
    .mul(float(1).add(settle.mul(DISK_TUBE_SPREAD)))
    .mul(float(1).sub(frac.mul(TUBE_TAPER)));
  const wrap = smoothstep(tubeD, tubeD.mul(0.4), distD);

  // The fresh rip hands off to the wrap as the mass settles; max avoids double-brightness overlap.
  // Late in the tear the wrap DRAINS — the shed mass has mostly accreted into the disk, so the
  // stream dims instead of riding the plunging body's azimuth at full blaze to the very end.
  const drain = float(1).sub(smoothstep(float(WRAP_DRAIN_LO), float(1), tear).mul(WRAP_DRAIN));
  return max(fresh.mul(float(1).sub(settle.mul(0.55))), wrap.mul(smoothstep(float(0.12), float(0.45), tear)).mul(drain));
}
