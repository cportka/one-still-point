import type { Body } from '../scene/Body';

/**
 * First light's **compile-ahead trigger** (the choppy-collision fix, v0.88.0; retuned v0.91.2).
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
 * a natural inspiral crosses the approach radius just above the Roche radius; and **two live bodies
 * drifting within a few units of each other** (the pairwise check) signal a possible natural merge
 * seconds out. The scaler is frozen during the compile (the depth-texture crash guard) and its
 * smoothing reset after, so the giant compile frame can't crater the resolution either.
 *
 * ⚠️ v0.91.2 regression fix (video-measured: a ~970 ms freeze INSIDE the moment-of-creation intro):
 * the approach radius briefly sat at 24, **overlapping the planet orbit band (min 20)** — a seeded
 * planet tripped the compile at boot, landing the freeze mid-intro. The radius now sits BELOW the
 * band (19, still above the star/planet Roche radius 18), and hosts additionally gate this trigger
 * on the intro being done — the seeded line-up is stars/planets on separated stable orbits, so
 * nothing the trigger guards against can happen mid-intro, while the late fallbacks
 * (feeding/merge-flash/lensing) stay ungated as the safety net.
 */
export const FULL_SHADER_APPROACH_R = 19;
/** Two live bodies within this distance may touch (and merge) within seconds — compile now. */
export const FULL_SHADER_PAIR_D = 8;

/** Whether any body is on a path that will need the full shader within seconds: plunging toward
 *  the centre, chasing another body, orbiting/falling inside the approach radius, or closing on a
 *  possible body-body contact (the pairwise check — a natural merge's flash and the newborn hole's
 *  disk only exist in the full shader). Bodies already absorbing are past the drama — not counted. */
export function dramaImminent(
  bodies: readonly Body[],
  approachR = FULL_SHADER_APPROACH_R,
  pairD = FULL_SHADER_PAIR_D,
): boolean {
  for (const b of bodies) {
    if (b.fixed || b.absorbing !== undefined) continue;
    if (b.plunging !== undefined || b.chaseId !== undefined || b.position.length() < approachR) return true;
  }
  // Pairwise close approach — O(n²) over ≤ ~13 live companions, trivial per frame.
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (a.fixed || a.absorbing !== undefined) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (b.fixed || b.absorbing !== undefined) continue;
      if (a.position.distanceTo(b.position) < pairD) return true;
    }
  }
  return false;
}
