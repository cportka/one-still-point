import { Vector2, Vector3 } from 'three';
import { uniform } from 'three/tsl';

/**
 * The uniform "bus" — the single set of GPU uniforms shared between the core
 * systems that *produce* state (CameraRig, Loop, the resize handler) and the
 * raymarch shader that *consumes* it.
 *
 * Keeping these in one object, injected where needed, means:
 *   - CameraRig / Loop stay pure producers (no shader knowledge),
 *   - the shader stays a pure consumer (no engine knowledge),
 *   - and Phase 5's `Scene` has exactly one thing to pack each frame.
 *
 * All spatial values are in geometric units where the black hole mass M is the
 * length scale (G = c = 1); see the build plan §5.
 */
export function createUniforms() {
  return {
    /** Dust-animation clock in seconds. Advanced by the TimeController at a
     *  bounded rate so the turbulence never strobes. */
    time: uniform(0),

    /** Representation crossfade: 0 = resolved turbulence, 1 = smooth averaged
     *  disk (rises as the time scale climbs). */
    timeBlur: uniform(0),

    /** Formation "ignition": 0 = no disk, 1 = fully formed. Driven by the intro
     *  (FormationSequence) and multiplied into the dust; 1 in steady state. */
    formation: uniform(1),

    /** Background sky mode: 0 = Stars (default), 1 = Nebula, 2 = Filaments, 3 = Lattice. */
    background: uniform(0),
    /** Post knobs that apply to whichever background is selected (Advanced →
     *  Background): overall brightness ×, saturation (1 = unchanged, 0 = grey),
     *  and a warm↔cool tint (−0.5 cool … 0 neutral … +0.5 warm). */
    bgBrightness: uniform(1),
    bgSaturation: uniform(1),
    bgTint: uniform(0),

    /** Orbit-camera world position — the ray origin for every pixel. */
    camPos: uniform(new Vector3(0, 6, 22)),
    /** Orthonormal camera basis in world space (right / up / forward). */
    camRight: uniform(new Vector3(1, 0, 0)),
    camUp: uniform(new Vector3(0, 1, 0)),
    camForward: uniform(new Vector3(0, 0, -1)),
    /** Pinhole projection params: tan(fov/2) and width/height. */
    tanHalfFov: uniform(Math.tan((60 * Math.PI) / 360)),
    aspect: uniform(1),

    /** Drawing-buffer size in physical pixels (for AA / dithering / dynamic res). */
    resolution: uniform(new Vector2(1, 1)),

    /** Warm-fuzzy reveal filter weight: 1 the instant the engine is revealed (the
     *  low-resolution buffer rendered "warm and out of focus"), eased to 0 over the
     *  settle as the scene sharpens into reality. Read by PostPipeline; 0 in steady
     *  state, so the veil is a no-op once the intro has resolved. */
    fuzz: uniform(0),

    /** Seconds since the last merger/absorption — drives the **spacetime ripple** on the Lattice
     *  background (a decaying ring radiating from the hole). Set to 0 on an `absorb` event and
     *  advanced each frame; large when idle, so the ripple envelope is 0 and the effect is a
     *  no-op. Only the Lattice sky reads it (see render/tsl/background.ts). */
    ripple: uniform(99),

    /** Amplitude of the current ripple — scaled by the absorbed body's mass at the `absorb` event
     *  (roadmap #6), so a black-hole merger rings harder than a star/planet plunge. 1 = baseline
     *  (the star-plunge value, unchanged); larger for a heavier coalescence. Multiplies the ripple
     *  envelope in `rippleWarp`, so it's a no-op whenever the ripple itself is (idle → envelope 0). */
    rippleStrength: uniform(1),

    /** The **merge flash** — a bright expanding pop at a companion-companion collision (roadmap
     *  #8 body-body). `mergeFlashActive` gates the whole term (0 = a single branch, no cost; 1 =
     *  a merge is flashing), `mergeFlashAge` is seconds since it fired (envelope: fast rise, ~1s
     *  decay), `mergeFlashPos` the world contact point, and `mergeFlashColor` the already-scaled
     *  HDR colour (warm white for a star/planet collision, blue-white + brighter for a hole
     *  capture). Set by the collision in `Scene` via `onMerge`; aged each frame. */
    mergeFlashActive: uniform(0),
    mergeFlashAge: uniform(99),
    mergeFlashPos: uniform(new Vector3(0, 0, 0)),
    mergeFlashColor: uniform(new Vector3(1, 1, 1)),

    /** The **dust cloud** (v0.101.0) — the lingering aftermath of a drop coalescence, long
     *  outliving the flash: a mottled volume that expands (decelerating), glows warm ember early,
     *  cools to neutral dust, and *absorbs* background light (the thing that makes it read as
     *  dust rather than glow). One cloud at a time (a new merge replaces it). `dustAxis` is the
     *  collision axis — the cloud splashes hardest in the plane ⊥ to the impact. Set by `Scene`
     *  via `onDust`; aged each frame; retired at DUST_LIFE_S (raymarch.ts). */
    dustActive: uniform(0),
    dustAge: uniform(99),
    dustPos: uniform(new Vector3(0, 0, 0)),
    dustAxis: uniform(new Vector3(0, 1, 0)),
    dustColor: uniform(new Vector3(1, 0.9, 0.78)),
    dustStrength: uniform(1),
    dustR0: uniform(2),
    /** The shell's launch speed (v0.103.0) — impact-energy-scaled by the Scene: a violent smash
     *  throws its debris fast, a coalescence exhales it, the hole's accretion wind drifts. */
    dustSpeed: uniform(5.2),
    /** The ejecta's BULK velocity (v0.102.0): the merged pair's centre-of-mass motion. Debris
     *  carries the momentum of what made it, so the cloud drifts with the remnant instead of
     *  hanging nailed to the contact point (the recording's "fog ball pasted on the scene"). */
    dustVel: uniform(new Vector3(0, 0, 0)),
  };
}

export type Uniforms = ReturnType<typeof createUniforms>;
