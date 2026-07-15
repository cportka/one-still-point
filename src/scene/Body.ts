import type { Vector3 } from 'three';

export type BodyType = 'hole' | 'star' | 'planet';

/**
 * A gravitating body. The primary black hole is body 0 (`fixed`, so it stays at
 * the origin as the reference frame); stars/planets orbit it. `mass` is in
 * geometric units (G = 1) consistent with the hole's length scale M; `radius`
 * and `color` are render properties (companions are drawn as emissive spheres
 * raymarched in the hole's curved spacetime, so they lens and occlude for free).
 */
export interface Body {
  id: number;
  type: BodyType;
  mass: number;
  /** Mass used for weak-field light deflection. 0 for bodies too light to lens
   *  measurably (stars/planets), so the shader can skip them; = mass for a
   *  secondary black hole. */
  lensMass: number;
  fixed: boolean;
  position: Vector3;
  velocity: Vector3;
  radius: number;
  color: Vector3; // HDR emissive colour
  /** Absorption animation progress, 0 → 1, set once a companion reaches the
   *  central merge radius: rather than vanishing at once it is held in place and
   *  the shader shrinks + redshifts + fades it over a brief window, then it is
   *  freed. Undefined for a live, orbiting body. */
  absorbing?: number;
  /** Position captured when absorption began, used to hold the body still during
   *  the fade so it doesn't drift on either integrator. */
  absorbAnchor?: Vector3;
  /** User-removal animation progress, 0 → 1: when the − stepper removes a body it
   *  is sent plunging into the centre over ~1.5 s (accelerating inward, then
   *  absorbed) rather than deleted instantly. Undefined unless being removed. */
  plunging?: number;
  /** Position captured when the plunge began — the start of the inward path. */
  plungeFrom?: Vector3;
  /** Signed angular rate (sim rad/s about the vertical, in the plunge path's rotation convention)
   *  captured from the body's real velocity when the plunge began — the spiral winds *from the
   *  body's own motion* (same direction, same rate at t = 0), so − never visibly kicks it. */
  plungeOmega?: number;
  /** Accumulated wind angle of the plunge spiral (integrated per frame — the rate rises as the
   *  body falls, Kepler-style, so the dive quickens naturally instead of whipping at a fixed rate). */
  plungeAngle?: number;
  /** "Plunge into" homing target (the click-select-then-click-another gesture): the id of the body
   *  this one is chasing. While set, the body is scripted straight at the target (accelerating) until
   *  their surfaces touch and the merge fires — a way to stage a body-body collision. Cleared (and
   *  the chaser falls into a normal centre plunge) if the target vanishes first. */
  chaseId?: number;
  /** The id of the *black hole* consuming this body, when it isn't the central one: set when a
   *  companion hole captures it (or it chases one), so the tidal tear + torn stream wrap around
   *  **that** hole — the same consumption look the central hole gets, relocated. Undefined = the
   *  central hole at the origin (the default eater). Cleared on rescue / if the eater vanishes. */
  eaterId?: number;
  /** Accumulated chase speed (world units/s), ramping up while `chaseId` is set. */
  chaseSpeed?: number;
  /** True for a *seeded* body that has not yet been "born" onto the history timeline — it renders
   *  (it's swooshing in during the formation intro) and is stepped by the physics, but is **excluded
   *  from `History.record`** until its creation tick fires (see {@link BirthTicker}). So rewinding to
   *  before a body's birth marker shows it *absent*, not orbiting. Cleared by `Scene.markBorn`.
   *  Undefined for user-added bodies (born the instant they're added). */
  unborn?: boolean;
}
