import { Vector3, Vector4 } from 'three';
import { uniform } from 'three/tsl';
import { smoothstep } from '../core/mathUtils';
import type { Body, BodyType } from '../scene/Body';
import type { Scene } from '../scene/Scene';

/** Fixed render slots for orbiting bodies (the raymarch unrolls these). Sized
 *  for the body caps (up to 4 holes, or 1 hole + 5 stars + 5 planets); empty
 *  slots short-circuit in the shader, so the headroom is cheap when unused. */
export const MAX_BODIES = 14;

// Tidal disruption (spaghettification) onset, roadmap #8. A star/planet that falls within the
// **Roche radius** is torn into a stream long *before* it reaches the merge; `tidal` ramps 0→1
// across [ROCHE, MERGE] and drives the stretch in the raymarch. (Toy values — tune to taste;
// MERGE matches Scene's MERGE_RADIUS so tidal is full just as absorption begins.) ROCHE raised
// 14 → 18 (the reference-footage pass): the stretch starts earlier in the descent, so the head
// visibly sheds mass — and shrinks — through the approach instead of only at the finale.
const TIDAL_ROCHE = 18;
const TIDAL_MERGE = 3;
// A body eaten by a COMPANION hole (slot.eater ≠ origin) uses radii scaled to that hole's size:
// roche = eaterRadius × EATER_ROCHE_SCALE, full tear at eaterRadius × EATER_MERGE_SCALE — the same
// consumption look the central hole gets, shrunk to the companion's scale.
const EATER_ROCHE_SCALE = 6;
const EATER_MERGE_SCALE = 1.2;
// The eater uniform's `w` = the eater's **disk-mid radius**: where the torn stream's wrap settles
// (and the scale of its heat gradient). Central hole: mid of the accretion disk (rIn 6 … rOut 20);
// companion hole: its mini-disk's mid (secondaryDisk spans radius×1.7…5.5). Exported — the
// raymarch normalizes its heat gradient by the central value (one source for the constant).
export const EATER_DISK_MID_CENTRAL = 12;
const EATER_DISK_MID_SCALE = 3.5; // companion: radius × this
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

// Two highlight states, both driven purely through the body's emissive `slot.color` (no shader
// change — the HDR boost blooms into a glow via the post bloom pass):
//   • Selected (Scene.selected, a click): an other-worldly **neon halo** — a big boost so bloom
//     throws a glow around it, a cool electric-blue sheen mixed in, and a breathing pulse.
//   • Hovered (Scene.hovered, pointer over it): a soft, steady warm-white lift — a "you can click
//     this" affordance, clearly milder than selected, no pulse.
const HL_BOOST = 4.0; // emissive multiplier on the selected body (was 3.4 — a bigger bloom halo)
const HL_WHITE = 0.6; // fraction of the selected colour mixed toward the neon sheen
const HL_PULSE = 0.28; // ± fraction the boost breathes, so the halo visibly pulses
const HL_NEON = new Vector3(0.55, 0.9, 1.25); // the cool electric-blue sheen the selected halo takes
const HOVER_BOOST = 1.7; // a gentle lift on the hovered body — much softer than selected
const HOVER_WHITE = 0.18; // a touch of warm white so a hovered body reads as "liftable", not neon

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
      // Which hole is consuming this body: xyz = the eater's position (the ORIGIN — the central
      // hole — by default), w = its disk-mid radius (12 central; radius×3.5 for a companion). The
      // tear geometry (stream arcs, wrap radius, heat gradient) is measured relative to this point,
      // so a body captured by a companion hole spaghettifies around IT, not the centre.
      eater: uniform(new Vector4(0, 0, 0, 12)),
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
  slot.eater.value.set(0, 0, 0, 12);
};

export function updateBodyUniforms(bodyUniforms: BodyUniforms, scene: Scene, progress = 1): void {
  // Iterate the body list directly and skip the fixed primary, rather than
  // `scene.companions` — that getter allocates a filtered array, and this runs
  // every frame. Non-fixed bodies fill the slots in order, exactly as before.
  const bodies = scene.bodies;
  const sel = scene.selected; // the click-highlighted body — the neon halo below
  const hov = scene.hovered; // the pointer-hovered body — a soft lift (skipped if it's also selected)
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
        // Selected: the neon halo. Mix the body's colour toward the cool electric-blue sheen and boost
        // hard so the bloom pass throws an other-worldly glow around it; a slow pulse breathes the halo
        // so a still, distant body still announces itself. (No shader change — the body core reads
        // slot.color, and the HDR magnitude drives the bloom.)
        const c = body.color;
        const boost = HL_BOOST * (1 + HL_PULSE * Math.sin(performance.now() * 0.006));
        slot.color.value.set(
          (c.x * (1 - HL_WHITE) + HL_NEON.x * HL_WHITE) * boost,
          (c.y * (1 - HL_WHITE) + HL_NEON.y * HL_WHITE) * boost,
          (c.z * (1 - HL_WHITE) + HL_NEON.z * HL_WHITE) * boost,
        );
      } else if (body === hov) {
        // Hover: a soft, steady warm-white lift — a "you can click this" affordance, clearly milder
        // than the selected neon (a gentle boost, a touch of white, no pulse).
        const c = body.color;
        slot.color.value.set(
          (c.x * (1 - HOVER_WHITE) + HOVER_WHITE) * HOVER_BOOST,
          (c.y * (1 - HOVER_WHITE) + HOVER_WHITE) * HOVER_BOOST,
          (c.z * (1 - HOVER_WHITE) + HOVER_WHITE) * HOVER_BOOST,
        );
      } else {
        slot.color.value.copy(body.color);
      }
      slot.lensMass.value = body.lensMass;
      slot.appear.value = appearFor(body.type, progress);
      slot.absorb.value = body.absorbing ?? 0;
      // Spaghettify on approach, ramping 0→1 across [ROCHE, MERGE] — measured from the body's
      // EATER: the central hole at the origin by default, or the companion hole consuming it
      // (body.eaterId — set on capture/chase), whose smaller radii scale the whole event down.
      // A star/planet tears itself; a hole tears its dragged accretion structure — starting much
      // further out and drawn at RIP_SCALE (the overwhelming plunge: longer + thicker rips).
      const r = p.length();
      // An eater that is itself absorbing is still a valid anchor — it's HELD STILL at its absorb
      // anchor for the whole fade, and dropping it here snapped the victim's tear geometry to the
      // origin mid-animation (adversarial review). Only a fully vanished eater falls back.
      const eater: Body | undefined =
        body.eaterId !== undefined
          ? bodies.find((e) => e.id === body.eaterId && !e.fixed && e.type === 'hole')
          : undefined;
      let roche: number;
      let merge: number;
      let rTear: number;
      if (eater) {
        slot.eater.value.set(eater.position.x, eater.position.y, eater.position.z, eater.radius * EATER_DISK_MID_SCALE);
        roche = eater.radius * EATER_ROCHE_SCALE;
        merge = eater.radius * EATER_MERGE_SCALE;
        rTear = p.distanceTo(eater.position);
      } else {
        slot.eater.value.set(0, 0, 0, EATER_DISK_MID_CENTRAL);
        roche = body.type === 'hole' ? TIDAL_ROCHE_HOLE : TIDAL_ROCHE;
        merge = TIDAL_MERGE;
        rTear = r;
      }
      slot.tidal.value = smoothstep(roche, merge, rTear);
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
      // Feeding covers companion-local tears too — deliberately: besides gating streamFeed (which
      // itself skips non-origin eaters per slot), `feedingActive` is the LATE-FALLBACK full-shader
      // trigger in main.ts/workerEngine — narrowing it to origin-only would strand those tears on
      // the lean shader. Don't "optimize" without moving that trigger.
      if (slot.tidal.value > 0) feeding = 1; // a body is shedding mass (into the central OR a companion disk)
      // Hurricane suck: full while tearing (tidal) or being absorbed; partial for a body merely
      // swept in close. Max over companions — a smooth function of position, so it eases in on its
      // own. A body torn by a COMPANION hole doesn't spin up the CENTRAL disk (its tear stays local
      // to the eater), so only origin-eaten tears count here.
      const centralTidal = eater ? 0 : slot.tidal.value;
      // Likewise an absorb far from the centre (a body-body merge fading at its contact point)
      // is a local event — only central-region absorbs drive the disk's hurricane.
      const centralAbsorb = r < HURR_NEAR_FAR ? (body.absorbing ?? 0) : 0;
      const near = smoothstep(HURR_NEAR_FAR, HURR_NEAR_CLOSE, r) * HURR_NEAR_WEIGHT;
      hurricane = Math.max(hurricane, centralTidal, centralAbsorb, near);
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
