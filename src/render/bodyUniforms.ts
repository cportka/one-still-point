import { Vector3, Vector4 } from 'three';
import { uniform } from 'three/tsl';
import { smoothstep } from '../core/mathUtils';
import type { BodyType } from '../scene/Body';
import type { Scene } from '../scene/Scene';

/** Fixed render slots for orbiting bodies (the raymarch unrolls these). Sized
 *  for the body caps (up to 4 holes, or 1 hole + 5 stars + 5 planets); empty
 *  slots short-circuit in the shader, so the headroom is cheap when unused. */
export const MAX_BODIES = 14;

// Tidal disruption (spaghettification) onset, roadmap #8. A star/planet that falls within the
// **Roche radius** is torn into a radial stream long *before* it reaches the merge; `tidal` ramps
// 0→1 across [ROCHE, MERGE] and drives the stretch in the raymarch. (Toy values — tune to taste;
// MERGE matches Scene's MERGE_RADIUS so tidal is full just as absorption begins.)
const TIDAL_ROCHE = 14;
const TIDAL_MERGE = 3;
// A companion BLACK HOLE plunge must be the overwhelming one (live review: "real long and huge
// rips to the object falling inward and to spacetime"). The hole itself can't spaghettify — what
// rips is its own dragged **accretion structure** (see docs/physical-script.md), so its tear
// starts much further out (a longer rip)…
const TIDAL_ROCHE_HOLE = 26;
// …and is drawn at this scale: the stream arc wraps ~2.4× further (multiple full revolutions at
// the finale) with a √-scaled thicker tube (see streamArcHit's `rip`).
const RIP_SCALE_HOLE = 2.4;

// Hurricane (live review: "the central hole sucking something in should animate a taste more like a
// hurricane"): how hard the hole is drawing a companion in, 0 (idle) → 1. A body shedding mass
// (`tidal`) or being absorbed spins the disk into a hurricane; one merely swept in *close* does so
// mildly ("or even sucking at something nearby"). The disk shader reads it (flow.ts + medium.ts).
const HURR_NEAR_FAR = 18; // beyond this a nearby body adds nothing (< the 26M default orbits → idle = 0)
const HURR_NEAR_CLOSE = 6; // within this a swept-in body drives the proximity term to full
const HURR_NEAR_WEIGHT = 0.7; // a nearby-but-not-tearing body only partly spins it up

// Soft highlight for the click-selected body (Scene.selected): brighten its emissive and mix a
// white sheen in, so the picked body clearly stands out without any shader change (the body core
// already reads slot.color). Cleared the instant the selection resolves or the body leaves.
const HL_BOOST = 3.4; // emissive multiplier on the selected body (was 2.3 — more prominent)
const HL_WHITE = 0.55; // fraction mixed toward white (a "selected" sheen, not just brighter; was 0.35)
const HL_PULSE = 0.22; // ± fraction the boost breathes, so a highlighted body visibly pulses

export function createBodyUniforms() {
  return {
    slots: Array.from({ length: MAX_BODIES }, () => ({
      posRadius: uniform(new Vector4(0, 0, 0, 0)), // xyz = position, w = radius (0 = inactive)
      color: uniform(new Vector3(0, 0, 0)), // HDR emissive colour
      lensMass: uniform(0), // weak-field light-deflection mass (0 = no lensing)
      appear: uniform(1), // formation fade-in 0 → 1, staggered by body type
      absorb: uniform(0), // 0 = live, → 1 as it is absorbed at the centre (shrink + redshift fade)
      tidal: uniform(0), // 0 = whole, → 1 as it is spaghettified falling within the Roche radius
      rip: uniform(1), // tear-stream scale: 1 = star/planet; a hole's dragged accretion structure rips far longer + thicker
      streamAxis: uniform(new Vector3(1, 0, 0)), // unit direction of motion — the torn stream stretches along this (the spiral path), not radially
    })),
    // How far the geodesic must integrate to reach the outermost body. 0 when
    // there are no companions, so rays escape at the camera radius (cheaper).
    sceneRadius: uniform(0),
    // 1 when any body lenses, so the (otherwise-skipped) secondary-deflection
    // block in the geodesic does nothing — zero cost — in the default scene.
    lensingActive: uniform(0),
    // 1 when any body is tearing (tidal > 0), so the disk-feeding streak block is
    // skipped entirely — zero cost — whenever nothing is being torn into the disk.
    feedingActive: uniform(0),
    // 0 → 1 as the hole actively draws a companion in (tidal shedding, absorption, or a body swept
    // in close): the disk shader tightens the flow into hurricane rainbands + faster inflow. 0 at
    // rest (the default orbits sit past the trigger band), so the quiet disk is unchanged.
    hurricane: uniform(0),
  };
}

export type BodyUniforms = ReturnType<typeof createBodyUniforms>;

/**
 * Staggered entrance during the formation intro: the outer stars swoosh in
 * first, then the (retrograde) planets and any companion hole — so the two
 * swooshes read as a sequence rather than one simultaneous blur. `progress` is
 * the intro's linear 0→1 (and 1 whenever the intro is done, so bodies added
 * later just appear immediately).
 */
// ⟳ Intro look: these windows time the bodies' swoosh-in during the intro.
// Changing them substantially → update docs/intro-script.md (the master beats + tuning log).
export function appearFor(type: BodyType, progress: number): number {
  return type === 'star' ? smoothstep(0.03, 0.2, progress) : smoothstep(0.2, 0.52, progress);
}

const clearSlot = (slot: BodyUniforms['slots'][number]): void => {
  slot.posRadius.value.set(0, 0, 0, 0);
  slot.lensMass.value = 0;
  slot.appear.value = 0;
  slot.absorb.value = 0;
  slot.tidal.value = 0;
  slot.rip.value = 1;
  slot.streamAxis.value.set(1, 0, 0);
};

export function updateBodyUniforms(bodyUniforms: BodyUniforms, scene: Scene, progress = 1): void {
  // Iterate the body list directly and skip the fixed primary, rather than
  // `scene.companions` — that getter allocates a filtered array, and this runs
  // every frame. Non-fixed bodies fill the slots in order, exactly as before.
  const bodies = scene.bodies;
  const sel = scene.selected; // the click-highlighted body, brightened below
  let maxR = 0;
  let lensing = 0;
  let feeding = 0;
  let hurricane = 0; // strongest accretion-suck over all companions (drives the disk's hurricane)
  let n = 0; // active companion slots filled

  for (let i = 0; i < bodies.length && n < MAX_BODIES; i++) {
    const body = bodies[i]!;
    if (body.fixed) continue; // the primary isn't a render slot
    const slot = bodyUniforms.slots[n]!;
    const p = body.position;
    // Guard against a non-finite body (a rare close-encounter blow-up): a NaN/Inf
    // position would poison every ray's geodesic (via the shared secondary-
    // deflection term) and black out the whole render — so treat it as an empty
    // slot this frame (it is pruned next frame).
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(body.radius)) {
      slot.posRadius.value.set(p.x, p.y, p.z, body.radius);
      if (body === sel) {
        // Prominent highlight: brighten + a strong white sheen + a gentle pulse, so the click-selected
        // body clearly stands out and reads as "picked" without any shader change (the body core reads
        // slot.color). The pulse breathes the boost so a still, distant body still announces itself.
        const c = body.color;
        const boost = HL_BOOST * (1 + HL_PULSE * Math.sin(performance.now() * 0.006));
        slot.color.value.set(
          (c.x * (1 - HL_WHITE) + HL_WHITE) * boost,
          (c.y * (1 - HL_WHITE) + HL_WHITE) * boost,
          (c.z * (1 - HL_WHITE) + HL_WHITE) * boost,
        );
      } else {
        slot.color.value.copy(body.color);
      }
      slot.lensMass.value = body.lensMass;
      slot.appear.value = appearFor(body.type, progress);
      slot.absorb.value = body.absorbing ?? 0;
      // Spaghettify on approach, ramping 0→1 across [ROCHE, MERGE]. A star/planet tears itself;
      // a hole tears its dragged accretion structure — starting much further out and drawn at
      // RIP_SCALE (the overwhelming plunge: longer + thicker rips than anything else).
      const r = p.length();
      const roche = body.type === 'hole' ? TIDAL_ROCHE_HOLE : TIDAL_ROCHE;
      slot.tidal.value = smoothstep(roche, TIDAL_MERGE, r);
      slot.rip.value = body.type === 'hole' ? RIP_SCALE_HOLE : 1;
      // The torn stream stretches along the body's *path* (its velocity) — so it trails the spiral
      // plunge instead of spiking radially toward/away from the hole. Unit-normalized; falls back to
      // the radial direction if the body is ~stationary.
      const v = body.velocity;
      const vl = Math.hypot(v.x, v.y, v.z);
      if (vl > 1e-4) slot.streamAxis.value.set(v.x / vl, v.y / vl, v.z / vl);
      else slot.streamAxis.value.set(p.x / (r || 1), p.y / (r || 1), p.z / (r || 1));
      maxR = Math.max(maxR, r + body.radius);
      if (body.lensMass > 0) lensing = 1;
      if (slot.tidal.value > 0) feeding = 1; // a body is shedding mass into the disk
      // Hurricane suck: full while tearing (tidal) or being absorbed; partial for a body merely
      // swept in close. Max over companions — a smooth function of position, so it eases in on its own.
      const near = smoothstep(HURR_NEAR_FAR, HURR_NEAR_CLOSE, r) * HURR_NEAR_WEIGHT;
      hurricane = Math.max(hurricane, slot.tidal.value, slot.absorb.value, near);
    } else {
      clearSlot(slot);
    }
    n++;
  }

  for (let i = n; i < MAX_BODIES; i++) clearSlot(bodyUniforms.slots[i]!); // bodies removed since last frame

  bodyUniforms.sceneRadius.value = n > 0 ? maxR + 6 : 0;
  bodyUniforms.lensingActive.value = lensing;
  bodyUniforms.feedingActive.value = feeding;
  bodyUniforms.hurricane.value = hurricane;
}
