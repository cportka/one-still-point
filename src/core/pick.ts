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
 * Cost: a march is ~25–140 RK4 steps (coarse legs are long; strong-field passes go fine), ≤10
 * marches per annotated body — sub-ms per body. pickBody additionally prunes bodies whose linear
 * projection is farther from the click than the largest possible lensing shift, so a full pointer
 * sweep stays cheap. Companion-body deflection is ignored (well below tolerance). The experimental
 * **Kerr frame-drag is also ignored**: with the toggle ON (a/M 0.99, K = 6) images near the shadow
 * shift asymmetrically by up to tens of px that this march doesn't model — the drag twists paths
 * out of the launch plane, so modelling it needs a 2-D search; it goes with the deferred exact-Kerr
 * follow-up. Schwarzschild (spin OFF, the default) is exact.
 */

const MAX_MARCHES = 18; // bracket/secant/bisection iterations (each one geodesic march ≈ tens of µs)
const MARCH_STEPS = 320; // cap for pathological loops; the coarse schedule usually ends in ~25–140 steps
const PX_TOL = 0.4; // stop refining once the miss is below this (CSS px, converted to length at the body)
// The largest apparent-vs-linear displacement the strong field produces at the app's camera
// distances (measured ≤ ~150 px; the image is pinned near the shadow edge in the worst case).
// pickBody uses it to skip the march for bodies that can't possibly reach the click.
const MAX_LENS_SHIFT_PX = 220;

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

/** Wrap an angle to (−π, π]. */
function wrapPi(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * March the shader's geodesic (raymarch.ts: RK4 of a = −3M·h²·x/r⁵, the same coarse step schedule,
 * the same static-observer launch transform) from the camera along the pinhole direction `dir`, and
 * return the **signed radial miss at the body's polar angle** (world length units):
 *
 * The bent path stays in the launch plane and its in-plane polar angle φ about the hole is
 * **monotonic** (h = |x×v| is conserved), so the trajectory crosses the body's polar angle φ_b at
 * most once before capture/escape — the primary image's sweep. The miss is
 * `r(crossing) − r_body`: **> 0** = the ray crossed the body's angle *outside* its radius (launch
 * angle too high); **< 0** = crossed inside, or was captured before reaching φ_b (too low); no
 * crossing before escape ⇒ positive (scaled by the angular shortfall). This objective is zero
 * exactly at an image and increases monotonically with the launch angle above the shadow edge —
 * which is what makes the bracket/secant search below converge to the *image*, not to a spurious
 * closest-approach alignment. Scalar math; one small closure per march, nothing per step.
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
  const rEnd = Math.max(rBody, r0) * 1.15 + 6; // escape radius: comfortably past camera and body
  const bodyAngle = Math.atan2(
    bx * e2x + by * e2y + bz * e2z,
    bx * e1x + by * e1y + bz * e1z,
  ); // ∈ (0, π): the body's in-plane polar angle; the camera sits at exactly π

  // One closure per march (not per step): a(x) = k·x·r⁻⁵, scalar-expanded into module scratch.
  const a = (qx: number, qy: number, qz: number, out: number[]): void => {
    const rr = qx * qx + qy * qy + qz * qz;
    const inv = k * Math.pow(rr, -2.5);
    out[0] = qx * inv;
    out[1] = qy * inv;
    out[2] = qz * inv;
  };

  // Unwrapped polar sweep: starts at the camera's φ = π and decreases monotonically toward (and
  // possibly past) the body's angle. Track the crossing of `bodyAngle` — and, for the no-crossing
  // outcome, the path's closest approach to the body (see the fallback below).
  let phi = Math.PI;
  let captured = false;
  let minD2 = Infinity;
  for (let i = 0; i < MARCH_STEPS; i++) {
    const r = Math.hypot(px, py, pz);
    if (r < 2 * M) {
      captured = true; // fell in before reaching the body's angle → launch too low
      break;
    }
    // Outbound past everything → done (no crossing happened, or we'd have returned below).
    if (r > rEnd && px * vx + py * vy + pz * vz > 0) break;
    const dl = Math.min(Math.max((r - 1.5 * M) * 0.06, 0.02), 3); // the shader's coarse schedule
    const half = dl * 0.5;
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

    // Advance the unwrapped sweep (steps are ≪ π, so the minimal-branch delta is exact) and test
    // the single possible crossing of the body's polar angle on this segment.
    const phiNewRaw = Math.atan2(nx * e2x + ny * e2y + nz * e2z, nx * e1x + ny * e1y + nz * e1z);
    const phiNew = phi + wrapPi(phiNewRaw - wrapPi(phi));
    if ((phi - bodyAngle) * (phiNew - bodyAngle) <= 0 && phi !== phiNew) {
      const t = (phi - bodyAngle) / (phi - phiNew);
      const cxp = px + (nx - px) * t;
      const cyp = py + (ny - py) * t;
      const czp = pz + (nz - pz) * t;
      return Math.hypot(cxp, cyp, czp) - rBody; // the signed radial miss at the body's angle
    }
    // Segment closest-approach to the body — the magnitude of the no-crossing fallback.
    const sdx = nx - px;
    const sdy = ny - py;
    const sdz = nz - pz;
    const smx = px - bx;
    const smy = py - by;
    const smz = pz - bz;
    const sdd = sdx * sdx + sdy * sdy + sdz * sdz;
    let st = sdd > 1e-12 ? -(smx * sdx + smy * sdy + smz * sdz) / sdd : 0;
    st = Math.max(0, Math.min(1, st));
    const qx = px + sdx * st - bx;
    const qy = py + sdy * st - by;
    const qz = pz + sdz * st - bz;
    const d2 = qx * qx + qy * qy + qz * qz;
    if (d2 < minD2) minD2 = d2;
    phi = phiNew;
    px = nx;
    py = ny;
    pz = nz;
    vx = nvx;
    vy = nvy;
    vz = nvz;
  }
  // No crossing. Captured → too low (more negative the earlier it fell). Escaped / step-capped
  // while still short of the body's angle → too high (the ray flew wide). The overshoot magnitude
  // is the path's true closest approach to the body — NOT the angular shortfall, which sneaks to
  // zero on the asymptotic knife-edge (a launch whose sweep barely fails to reach the body's angle
  // still misses the body by units; a shortfall-based value there faked convergence).
  const shortfall = Math.max(phi - bodyAngle, 0);
  return captured ? -rBody * (0.5 + shortfall) : Math.max(Math.sqrt(minD2), 1e-3);
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
  // A non-finite body (a transient integrator blow-up — Scene prunes it next frame) has no
  // meaningful projection; return null rather than NaN coordinates.
  if (!Number.isFinite(position.x + position.y + position.z)) return null;
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

  // Convergence tolerance in world length at the body's distance (≈ PX_TOL screen px there).
  const lenTol = (PX_TOL * dist) / focal;
  // Seeds: the true angle β, and a point-lens-style outward nudge (an overestimate near the hole,
  // harmless far away — it's only a seed; the march is the authority).
  const dLS = Math.max(dist - dL, 0.001);
  const thetaE2 = (4 * holeMass * dLS) / (dL * dist);
  const seed = (beta + Math.sqrt(beta * beta + 4 * thetaE2)) / 2;
  let t0 = beta;
  let m0 = missAt(t0);
  if (Math.abs(m0) < lenTol) return { x: lin.x, y: lin.y, rPx }; // already lands (far field)
  let t1 = Math.max(seed, beta + 1e-4);
  let m1 = missAt(t1);
  let marches = 2;
  // The miss increases with the launch angle (crossing radius grows; capture = very negative), so
  // bracket the sign change: `lo` = highest angle known too LOW (miss < 0), `hi` = lowest known
  // too HIGH (miss > 0). If both seeds undershoot (a deeply hidden body — even the point-lens
  // seed is captured), expand upward geometrically until the ray clears the hole.
  let lo = NaN;
  let hi = NaN;
  const bracket = (t: number, m: number): void => {
    if (m < 0 && (!Number.isFinite(lo) || t > lo)) lo = t;
    if (m > 0 && (!Number.isFinite(hi) || t < hi)) hi = t;
  };
  bracket(t0, m0);
  bracket(t1, m1);
  while (!Number.isFinite(hi) && marches < MAX_MARCHES) {
    t1 = Math.min(t1 * 1.6 + 0.02, Math.PI - 1e-3);
    m1 = missAt(t1);
    marches++;
    bracket(t1, m1);
    if (t1 >= Math.PI - 1e-3) break;
  }
  let best = Math.abs(m0) < Math.abs(m1) ? t0 : t1;
  let bestMiss = Math.min(Math.abs(m0), Math.abs(m1));
  for (; marches < MAX_MARCHES && bestMiss > lenTol; marches++) {
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
    // Cheap prune before the geodesic search: a body whose *linear* projection is farther from the
    // click than the largest possible lensing shift (+ its hit circle) can't be under it.
    if (holeMass > 0 && !b.fixed) {
      const l = apparentScreenPos(camera, b.position, b.radius, cssW, cssH, 0, holePos);
      if (!l) continue;
      const hitL = Math.max(minPx, l.rPx * 1.9);
      if (Math.hypot(l.x - cssX, l.y - cssY) > hitL + MAX_LENS_SHIFT_PX) continue;
    }
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
