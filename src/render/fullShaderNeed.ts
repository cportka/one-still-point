import { Quaternion, Vector3 } from 'three';
import type { Body } from '../scene/Body';
import { CONTACT_FACTOR } from '../scene/Scene';

/**
 * First light's **compile-ahead trigger** (the choppy-collision fix, v0.88.0; retuned v0.91.2;
 * conjunction predictor v0.94.1).
 *
 * The lean→full shader swap is on-demand: it used to fire the first frame the scene *rendered*
 * drama (`feedingActive` > 0 — i.e. the moment a tear appears). Video-measured on a capture, that
 * put the one-shot ~1s compile freeze **exactly on the dramatic beat** (a 1133 ms frozen frame as
 * the tear began, then a resolution-scaler spiral), while a session whose full shader was already
 * resident played the same collision at a steady 34–52 fps.
 *
 * The fix: compile when drama becomes **imminent**, not when it arrives. Every scripted path to a
 * tear/merge gives seconds of calm notice — a plunge (the − stepper / click-to-plunge) spends
 * ~2–4.5 s descending before the Roche tear; a chase (plunge-into) accelerates for a second or two;
 * a natural inspiral crosses the approach radius just above the Roche radius; and a **predicted
 * body-body conjunction** (below) signals a possible natural merge seconds out. The scaler is
 * frozen during the compile (the depth-texture crash guard) and its smoothing reset after, so the
 * giant compile frame can't crater the resolution either.
 *
 * ⚠️ v0.91.2 regression fix (video-measured: a ~970 ms freeze INSIDE the moment-of-creation intro):
 * the approach radius briefly sat at 24, **overlapping the planet orbit band (min 20)** — a seeded
 * planet tripped the compile at boot, landing the freeze mid-intro. The radius now sits BELOW the
 * band (19, still above the star/planet Roche radius 18), and hosts additionally gate this trigger
 * on the intro being done — the seeded line-up is stars/planets on separated stable orbits, so
 * nothing the trigger guards against can happen mid-intro, while the late fallbacks
 * (feeding/merge-flash/lensing) stay ungated as the safety net.
 *
 * ⚠️ v0.94.1: the body-body check was a blanket "any pair within 8 units" — but the seeded rings
 * are 4.5–6.5 units apart, so it fired on ~the first frame after the intro in every session,
 * spending the compile on non-events (and giving only ~0.3 s notice on a *real* counter-rotating
 * pass anyway, since two opposed orbits close 8 units in a fraction of a second at ×80). It is now
 * a **conjunction predictor**: each live body is propagated along its instantaneous circular orbit
 * and the trigger fires only when a pair's *predicted* separation dips near contact within the
 * horizon. Circular-arc propagation (not linear extrapolation) matters: 2.5 s at ×80 speed is
 * ~60° of orbital arc, where a straight line overshoots by ~10 scene units — worse than the
 * geometry it's trying to resolve.
 */
export const FULL_SHADER_APPROACH_R = 19;
/** Wall-clock seconds of notice the conjunction predictor gives the compile (~330–970 ms). */
export const CONJUNCTION_HORIZON_S = 2.5;
/** Fire when a predicted separation dips under contact (Scene's (ra+rb)·CONTACT_FACTOR) × this —
 *  allowance for orbit ellipticity, perturbations, and the sampling grid. Sized to stay clear of
 *  the seeded line-up's tightest gap (4.5 between planet rings: (0.8+0.8)·1.15·1.5 ≈ 2.8). */
export const CONJUNCTION_MARGIN = 1.5;
/** Future positions sampled per body across the horizon (t = 0 … horizon inclusive). */
const SAMPLES = 16;

// Module-level scratch — this runs every frame in both hosts, so no per-call allocation.
const scratchP = new Vector3();
const scratchAxis = new Vector3();
const scratchQ = new Quaternion();
let futures = new Float64Array(0); // [body][sample][xyz], flat

/** Whether any body is on a path that will need the full shader within seconds: plunging toward
 *  the centre, chasing another body, orbiting/falling inside the approach radius, or on a
 *  predicted near-contact conjunction with another live body (a natural merge's flash and the
 *  newborn hole's disk only exist in the full shader). Bodies already absorbing are past the
 *  drama — not counted. `timeScale` converts sim-time to the wall-clock the compile freeze lives
 *  in (the integrator drifts positions by velocity × timeScale per wall second). */
export function dramaImminent(
  bodies: readonly Body[],
  timeScale = 1,
  approachR = FULL_SHADER_APPROACH_R,
): boolean {
  const live: Body[] = [];
  for (const b of bodies) {
    if (b.fixed || b.absorbing !== undefined) continue;
    if (b.plunging !== undefined || b.chaseId !== undefined || b.position.length() < approachR) return true;
    live.push(b);
  }
  const n = live.length;
  if (n < 2) return false;

  // Propagate each live body along its instantaneous circular orbit about the primary:
  // ω = |r×v|/r² about the axis r̂×v̂ (sign carries pro/retrograde). Exact for the seeded
  // circular rings; near-radial motion falls back to a straight line.
  const h = (CONJUNCTION_HORIZON_S * Math.max(timeScale, 0)) / SAMPLES; // sim-time per sample
  const stride = (SAMPLES + 1) * 3;
  if (futures.length < n * stride) futures = new Float64Array(n * stride);
  for (let i = 0; i < n; i++) {
    const b = live[i]!;
    scratchP.copy(b.position);
    scratchAxis.crossVectors(b.position, b.velocity);
    const r2 = b.position.lengthSq();
    const cross2 = scratchAxis.lengthSq();
    const circular = r2 > 1e-12 && cross2 > 1e-12;
    if (circular) scratchQ.setFromAxisAngle(scratchAxis.normalize(), (Math.sqrt(cross2) / r2) * h);
    for (let s = 0, k = i * stride; s <= SAMPLES; s++, k += 3) {
      futures[k] = scratchP.x;
      futures[k + 1] = scratchP.y;
      futures[k + 2] = scratchP.z;
      if (circular) scratchP.applyQuaternion(scratchQ);
      else scratchP.addScaledVector(b.velocity, h);
    }
  }

  // A pair whose sampled separation dips near contact anywhere in the horizon → compile now.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const touch = (live[i]!.radius + live[j]!.radius) * CONTACT_FACTOR * CONJUNCTION_MARGIN;
      const t2 = touch * touch;
      for (let s = 0, ki = i * stride, kj = j * stride; s <= SAMPLES; s++, ki += 3, kj += 3) {
        const dx = futures[ki]! - futures[kj]!;
        const dy = futures[ki + 1]! - futures[kj + 1]!;
        const dz = futures[ki + 2]! - futures[kj + 2]!;
        if (dx * dx + dy * dy + dz * dz < t2) return true;
      }
    }
  }
  return false;
}
