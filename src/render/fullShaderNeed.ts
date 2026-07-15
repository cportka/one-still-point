import type { Body } from '../scene/Body';

/**
 * First light's **compile-ahead trigger** (the choppy-collision fix).
 *
 * The lean→full shader swap is on-demand: it used to fire the first frame the scene *rendered*
 * drama (`feedingActive` > 0 — i.e. the moment a tear appears). Video-measured on a capture, that
 * put the one-shot ~1s compile freeze **exactly on the dramatic beat** (a 1133 ms frozen frame as
 * the tear began, then a resolution-scaler spiral), while a session whose full shader was already
 * resident played the same collision at a steady 34–52 fps.
 *
 * The fix: compile when drama becomes **imminent**, not when it arrives. Every scripted path to a
 * tear/merge gives seconds of calm notice — a plunge (the − stepper / click-to-plunge) spends
 * ~2–4.5 s descending before the Roche tear; a chase (plunge-into) accelerates for a second or
 * two; a natural inspiral crosses the approach radius (comfortably above the star/planet Roche
 * radius of 18 — see bodyUniforms.ts) well before tearing. Firing on those signals moves the
 * freeze to a moment when the body is drifting gently — barely perceptible — and the drama itself
 * plays on the already-compiled shader. The scaler is frozen during the compile (the depth-texture
 * crash guard) and its smoothing reset after, so the giant compile frame can't crater the
 * resolution either.
 */
export const FULL_SHADER_APPROACH_R = 24;

/** Whether any body is on a path that will need the full shader within seconds: plunging toward
 *  the centre, chasing another body, or orbiting/falling inside the approach radius (a natural
 *  close pass that could tear). Bodies already absorbing are past the drama — not counted. */
export function dramaImminent(bodies: readonly Body[], approachR = FULL_SHADER_APPROACH_R): boolean {
  return bodies.some(
    (b) =>
      !b.fixed &&
      b.absorbing === undefined &&
      (b.plunging !== undefined || b.chaseId !== undefined || b.position.length() < approachR),
  );
}
