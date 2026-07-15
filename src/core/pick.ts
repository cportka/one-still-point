import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Body } from '../scene/Body';

/**
 * Screen-space body picking + apparent-position projection for the click/tap gestures and the
 * selection ring. Both need the same thing: **where a body appears on screen** — which, in a scene
 * rendered by bending light around a black hole, is *not* the straight-line projection. The
 * raymarch integrates the Schwarzschild photon geodesic per pixel, so a body near the hole renders
 * displaced **away** from it (gravitational lensing of its primary image); video-measured, the
 * straight projection is centred far from the hole but drifts tens of px toward it beside the disk.
 *
 * `apparentScreenPos` finds the lensed image by **inverting the exact same geodesic the shader
 * marches**: launch a trial ray in the camera–hole–body plane, RK4-integrate the same central-force
 * form a(x) = −3·M·h²·x/r⁵ with the same coarse step schedule (raymarch.ts), measure how far the
 * bent ray misses the body, and secant-iterate the launch angle until it lands (sub-pixel in a few
 * marches). The classic point-lens equation is NOT used for the answer — the camera here sits
 * *inside* the strong-field region (≈20–40M), where that thin-lens formula badly overshoots
 * wide-angle bodies — but its primary-image solution makes a good second secant seed.
 *
 * Cost: a march is ~25 RK4 steps (the coarse schedule reaches the scene edge fast), ≤6 marches per
 * body — trivial next to a single frame. Companion-body deflection and the experimental Kerr drag
 * are ignored (both are far below the ring/pick tolerance).
 */

const MAX_MARCHES = 8; // secant/bisection iterations (each one geodesic march)
const MARCH_STEPS = 200; // safety cap; the coarse schedule terminates in ~25 steps
const PX_TOL = 0.4; // stop refining once the screen miss is below this (CSS px)

const projected = new Vector3(); // scratch
const scratchDir = new Vector3(); // scratch
const ORIGIN = new Vector3(0, 0, 0);
// RK4 stage scratch (module-level so the hot march loop allocates nothing).
const K1: number[] = [0, 0, 0];
const K2: number[] = [0, 0, 0];
const K3: number[] = [0, 0, 0];
const K4: number[] = [0, 0, 0];

export interface ApparentPos {
  /** Apparent screen position in CSS px (lensed primary image). */
  x: number;
  y: number;
  /** Projected body radius in CSS px (from its true distance — lens magnification ignored). */
  rPx: number;
}

/** Linear (unlensed) projection to CSS px, or null outside the clip range. */
function projectLinear(
  camera: PerspectiveCamera,
  position: Vector3,
  cssW: number,
  cssH: number,
): { x: number; y: number } | null {
  projected.copy(position).project(camera);
  if (projected.z < -1 || projected.z > 1) return null;
  return { x: ((projected.x + 1) / 2) * cssW, y: ((1 - projected.y) / 2) * cssH };
}

/**
 * March the shader's geodesic (raymarch.ts: RK4 of a = −3M·h²·x/r⁵, the same coarse step schedule,
 * the same static-observer launch transform) from the camera along the pinhole direction `dir`, and
 * return the **signed in-plane angular miss** (radians about the origin) of its closest approach to
 * the body at `B` — positive = the bent ray passed on the far side of the body (launch angle too
 * high), negative = it fell short toward the hole (or was captured). Scalar math, no allocation.
 */
function geodesicMiss(
  cx: number,
  cy: number,
  cz: number, // camera position
  dirX: number,
  dirY: number,
  dirZ: number, // pinhole launch direction (unit)
  bx: number,
  by: number,
  bz: number, // body position
  M: number,
  e1x: number,
  e1y: number,
  e1z: number, // in-plane polar axis (unit, camera→hole)
  e2x: number,
  e2y: number,
  e2z: number, // in-plane transverse axis (unit)
): number {
  // Static-observer launch transform (schwarzschild.ts staticObserverRay): scale the radial
  // component of the view ray by √(1 − 2M/r) so the coordinate velocity matches the shader's.
  let px = cx;
  let py = cy;
  let pz = cz;
  const r0 = Math.hypot(cx, cy, cz) || 1e-9;
  const erx = cx / r0;
  const ery = cy / r0;
  const erz = cz / r0;
  const radial = dirX * erx + dirY * ery + dirZ * erz;
  const sr = Math.sqrt(Math.max(1 - (2 * M) / r0, 0.0001));
  let vx = dirX + erx * radial * (sr - 1);
  let vy = dirY + ery * radial * (sr - 1);
  let vz = dirZ + erz * radial * (sr - 1);
  const vl = Math.hypot(vx, vy, vz) || 1e-9;
  vx /= vl;
  vy /= vl;
  vz /= vl;

  // Conserved h² = |x × v|², evaluated once at launch (matching the shader).
  const hx = py * vz - pz * vy;
  const hy = pz * vx - px * vz;
  const hz = px * vy - py * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  const k = -3 * M * h2; // a(x) = k·x/r⁵

  const rBody = Math.hypot(bx, by, bz);
  const rEnd = Math.max(rBody, r0) * 1.1 + 4; // escape radius: past both camera and body
  const bodyAngle = Math.atan2(
    bx * e2x + by * e2y + bz * e2z,
    bx * e1x + by * e1y + bz * e1z,
  );

  let bestD2 = Infinity;
  let bestX = px;
  let bestY = py;
  let bestZ = pz;
  for (let i = 0; i < MARCH_STEPS; i++) {
    const r = Math.hypot(px, py, pz);
    if (r < 2 * M) break; // captured — treat via the fell-short branch below
    // Outbound past everything → done.
    if (r > rEnd && px * vx + py * vy + pz * vz > 0) break;
    const dl = Math.min(Math.max((r - 1.5 * M) * 0.06, 0.02), 3); // the shader's coarse schedule
    const half = dl * 0.5;
    // RK4 with a(x) = k·x·r⁻⁵ (scalar-expanded; no allocation).
    const a = (qx: number, qy: number, qz: number, out: number[]): void => {
      const rr = qx * qx + qy * qy + qz * qz;
      const inv = k * Math.pow(rr, -2.5);
      out[0] = qx * inv;
      out[1] = qy * inv;
      out[2] = qz * inv;
    };
    const k1v = K1;
    const k2v = K2;
    const k3v = K3;
    const k4v = K4;
    a(px, py, pz, k1v);
    a(px + vx * half, py + vy * half, pz + vz * half, k2v);
    a(px + (vx + k1v[0]! * half) * half, py + (vy + k1v[1]! * half) * half, pz + (vz + k1v[2]! * half) * half, k3v);
    a(px + (vx + k2v[0]! * half) * dl, py + (vy + k2v[1]! * half) * dl, pz + (vz + k2v[2]! * half) * dl, k4v);
    const sixth = dl / 6;
    const nx = px + (vx + 2 * (vx + k1v[0]! * half) + 2 * (vx + k2v[0]! * half) + (vx + k3v[0]! * dl)) * sixth;
    const ny = py + (vy + 2 * (vy + k1v[1]! * half) + 2 * (vy + k2v[1]! * half) + (vy + k3v[1]! * dl)) * sixth;
    const nz = pz + (vz + 2 * (vz + k1v[2]! * half) + 2 * (vz + k2v[2]! * half) + (vz + k3v[2]! * dl)) * sixth;
    const nvx = vx + (k1v[0]! + 2 * k2v[0]! + 2 * k3v[0]! + k4v[0]!) * sixth;
    const nvy = vy + (k1v[1]! + 2 * k2v[1]! + 2 * k3v[1]! + k4v[1]!) * sixth;
    const nvz = vz + (k1v[2]! + 2 * k2v[2]! + 2 * k3v[2]! + k4v[2]!) * sixth;

    // Closest approach of the segment [p, n] to the body (segmentHitsSphere's t, CPU form).
    const dx = nx - px;
    const dy = ny - py;
    const dz = nz - pz;
    const mx = px - bx;
    const my = py - by;
    const mz = pz - bz;
    const dd = dx * dx + dy * dy + dz * dz;
    let t = dd > 1e-12 ? -(mx * dx + my * dy + mz * dz) / dd : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = px + dx * t;
    const qy = py + dy * t;
    const qz = pz + dz * t;
    const d2 = (qx - bx) * (qx - bx) + (qy - by) * (qy - by) + (qz - bz) * (qz - bz);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = qx;
      bestY = qy;
      bestZ = qz;
    }
    px = nx;
    py = ny;
    pz = nz;
    vx = nvx;
    vy = nvy;
    vz = nvz;
  }
  // Signed angular miss about the origin, in the launch plane: the bent path stays in the plane
  // spanned by (camera, hole, launch dir) — the same plane the body lies in — so a single angle
  // fully captures the miss. Positive = overshot past the body (away from the hole).
  const closestAngle = Math.atan2(
    bestX * e2x + bestY * e2y + bestZ * e2z,
    bestX * e1x + bestY * e1y + bestZ * e1z,
  );
  return closestAngle - bodyAngle;
}

/**
 * Project a body to its **apparent** CSS-pixel screen position: the linear projection when
 * `holeMass` is 0, else the lensed primary image found by inverting the shader's geodesic (see
 * module doc). Returns `null` when the body projects outside the clip range. Callers must have
 * `camera.updateMatrixWorld()` current. `holePos` defaults to the origin (the fixed primary).
 */
export function apparentScreenPos(
  camera: PerspectiveCamera,
  position: Vector3,
  radius: number,
  cssW: number,
  cssH: number,
  holeMass = 0,
  holePos: Vector3 = ORIGIN,
): ApparentPos | null {
  const lin = projectLinear(camera, position, cssW, cssH);
  if (!lin) return null;
  const focal = cssH / 2 / Math.tan((camera.fov * Math.PI) / 360); // px per world-unit at distance 1
  const dist = camera.position.distanceTo(position);
  const rPx = (radius / Math.max(dist, 1e-3)) * focal;
  if (holeMass <= 0) return { x: lin.x, y: lin.y, rPx };

  // In-plane frame: e1 = camera→hole, e2 ⊥ e1 toward the body; the launch angle β from e1
  // parameterizes every candidate ray in the camera–hole–body plane.
  const C = camera.position;
  const cx = C.x - holePos.x;
  const cy = C.y - holePos.y;
  const cz = C.z - holePos.z; // hole→camera
  const bx = position.x - holePos.x;
  const by = position.y - holePos.y;
  const bz = position.z - holePos.z; // hole→body
  const dL = Math.hypot(cx, cy, cz);
  if (dL < 1e-6) return { x: lin.x, y: lin.y, rPx };
  const e1x = -cx / dL;
  const e1y = -cy / dL;
  const e1z = -cz / dL; // camera→hole (unit)
  // Body direction from the camera, decomposed against e1.
  const tbx = bx - cx; // body − camera = (hole→body) − (hole→camera)
  const tby = by - cy;
  const tbz = bz - cz;
  const tbl = Math.hypot(tbx, tby, tbz) || 1e-9;
  const along = (tbx * e1x + tby * e1y + tbz * e1z) / tbl;
  const beta = Math.acos(Math.min(1, Math.max(-1, along))); // true angular offset from the hole
  let p2x = tbx / tbl - e1x * along;
  let p2y = tby / tbl - e1y * along;
  let p2z = tbz / tbl - e1z * along;
  const p2l = Math.hypot(p2x, p2y, p2z);
  if (p2l < 1e-9) return { x: lin.x, y: lin.y, rPx }; // dead centre — occluded by the shadow anyway
  p2x /= p2l;
  p2y /= p2l;
  p2z /= p2l;

  const missAt = (theta: number): number =>
    geodesicMiss(
      cx, // camera, hole-centred (the march measures r from the hole)
      cy,
      cz,
      e1x * Math.cos(theta) + p2x * Math.sin(theta),
      e1y * Math.cos(theta) + p2y * Math.sin(theta),
      e1z * Math.cos(theta) + p2z * Math.sin(theta),
      bx,
      by,
      bz,
      holeMass,
      e1x,
      e1y,
      e1z,
      p2x,
      p2y,
      p2z,
    );

  // px-per-radian of launch angle (for the convergence tolerance; conservative — origin-angle
  // misses map to somewhat fewer screen px than camera angles).
  const pxPerRad = focal;
  // Seeds: the true angle β, and a point-lens-style outward nudge (an overestimate near the hole,
  // harmless far away — it's only a seed; the march is the authority).
  const dLS = Math.max(dist - dL, 0.001);
  const thetaE2 = (4 * holeMass * dLS) / (dL * dist);
  const seed = (beta + Math.sqrt(beta * beta + 4 * thetaE2)) / 2;
  let t0 = beta;
  let m0 = missAt(t0);
  if (Math.abs(m0) * pxPerRad < PX_TOL) return { x: lin.x, y: lin.y, rPx }; // already lands (far field)
  let t1 = Math.max(seed, beta + 1e-4);
  let m1 = missAt(t1);
  let best = Math.abs(m0) < Math.abs(m1) ? t0 : t1;
  let bestMiss = Math.min(Math.abs(m0), Math.abs(m1));
  // A bracketing pair (miss > 0 on the hole side of the root, < 0 outside) lets us fall back to
  // bisection when the secant misbehaves — near the photon ring the miss is non-monotonic.
  let lo = m0 > 0 ? t0 : NaN;
  let hi = m0 < 0 ? t0 : NaN;
  const bracket = (t: number, m: number): void => {
    if (m > 0 && (!Number.isFinite(lo) || t > lo)) lo = t;
    if (m < 0 && (!Number.isFinite(hi) || t < hi)) hi = t;
  };
  bracket(t1, m1);
  for (let i = 2; i < MAX_MARCHES && bestMiss * pxPerRad > PX_TOL; i++) {
    let t2: number;
    const denom = m1 - m0;
    if (Math.abs(denom) > 1e-12 && Number.isFinite(t1 - (m1 * (t1 - t0)) / denom)) {
      t2 = t1 - (m1 * (t1 - t0)) / denom;
    } else if (Number.isFinite(lo) && Number.isFinite(hi)) {
      t2 = (lo + hi) / 2;
    } else {
      break;
    }
    // A secant step that leaves the known bracket (or goes non-physical) → bisect instead.
    if (t2 <= 0 || t2 >= Math.PI || (Number.isFinite(lo) && Number.isFinite(hi) && (t2 <= Math.min(lo, hi) || t2 >= Math.max(lo, hi)))) {
      if (Number.isFinite(lo) && Number.isFinite(hi)) t2 = (lo + hi) / 2;
      else break;
    }
    const m2 = missAt(t2);
    bracket(t2, m2);
    t0 = t1;
    m0 = m1;
    t1 = t2;
    m1 = m2;
    if (Math.abs(m2) < bestMiss) {
      bestMiss = Math.abs(m2);
      best = t2;
    }
  }

  // The apparent image = the pinhole direction at launch angle `best`, projected through the
  // camera (exact for any camera orientation — no small-angle mapping).
  scratchDir
    .set(
      e1x * Math.cos(best) + p2x * Math.sin(best),
      e1y * Math.cos(best) + p2y * Math.sin(best),
      e1z * Math.cos(best) + p2z * Math.sin(best),
    )
    .multiplyScalar(dist)
    .add(C);
  const ap = projectLinear(camera, scratchDir, cssW, cssH);
  if (!ap) return { x: lin.x, y: lin.y, rPx };
  return { x: ap.x, y: ap.y, rPx };
}

/**
 * Screen-space body picking for the click/tap gestures (highlight / plunge / plunge-into / rescue).
 * Projects every companion through the camera — via {@link apparentScreenPos}, so with `holeMass`
 * the hit circle sits on the body's *lensed* image, exactly where the raymarch draws it — and
 * returns the nearest one within its hit circle: the body's projected radius (with slack, small
 * bodies are hard to hit) floored at `minPx` so even a speck is clickable. Pure over its inputs and
 * shared verbatim by both render paths. Returns `null` when nothing is near the click.
 */
export function pickBody(
  bodies: readonly Body[],
  camera: PerspectiveCamera,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  // The hit-circle floor in CSS px: even a distant speck is clickable within this radius. Generous
  // (was 22) so bodies are easy to grab — a fingertip is ~44px, and precise aim shouldn't be needed.
  minPx = 34,
  // Include the fixed primary hole as a pick target (the click gestures use it: select a companion
  // then click the hole to plunge it in; double-tap the hole to re-centre the view on it). Off by
  // default, so callers that only target companions are unchanged.
  includeFixed = false,
  // The central hole's mass (world units, G = c = 1). > 0 → clicks land on the *lensed* image.
  holeMass = 0,
): Body | null {
  camera.updateMatrixWorld();
  const holePos = bodies.find((b) => b.fixed)?.position ?? ORIGIN;
  let best: Body | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    if (b.fixed && !includeFixed) continue; // the primary is normally the destination, not a target
    const p = apparentScreenPos(camera, b.position, b.radius, cssW, cssH, b.fixed ? 0 : holeMass, holePos);
    if (!p) continue;
    const d = Math.hypot(p.x - cssX, p.y - cssY);
    const hit = Math.max(minPx, p.rPx * 1.9); // the body circle with generous slack, floored for specks
    if (d <= hit && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
