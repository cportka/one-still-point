import {
  abs,
  atan,
  Break,
  clamp,
  cross,
  dot,
  exp,
  float,
  Fn,
  If,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  pow,
  screenUV,
  select,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { EATER_DISK_MID_CENTRAL, type BodyUniforms } from '../bodyUniforms';
import type { BlackHole } from '../../scene/BlackHole';
import type { Uniforms } from '../uniforms';
import { segmentClosestPoint, segmentHitsSphere, streamArcHit } from './bodies';
import { background } from './background';
import { mediumDensity, mediumSource, streamFeed } from './medium';
import { frameDragAccel, photonAccel, staticObserverRay } from './schwarzschild';
import { secondaryDisk } from './secondaryDisk';

const MAX_STEPS = 512;
// ⟳ Spaghettification look v2 (tuned against the ESO tidal-disruption reference): the core DIMS and
// SHRINKS as its mass drains into the stream, and the stream carries the brightness instead —
// raised so the wrap reads clearly against the disk.
const STREAM_EMIT = 0.22; // brightness of the additive torn-stream gas (× its HDR colour, per unit length)
const STREAM_EXT = 0.21; // how much the stream gas occludes (Beer–Lambert) — semi-transparent
const CORE_SHRINK = 0.93; // fraction of the body's radius lost at full tear (reference: the head ends a knot)
const CORE_DIM = 0.6; // fraction of the core's emissive lost at full tear (the bloom shrinks with it)
const FLASH_EMIT = 5.0; // brightness of the body-body merge flash (× its HDR colour, per unit length)
const FLASH_SPEED = 26; // how fast the flash shell expands (world units / s of age) — a fast shockwave
const FLASH_TAU = 3.4; // flash decay rate (1/s) — a bright pop, then a shockwave ring that lingers ~1s

/**
 * The black-hole shader. Per-pixel Schwarzschild photon geodesics by RK4
 * integration of a(x) = -3M·h²·x/r⁵ (schwarzschild.ts). Along each bent ray:
 *   - the volumetric accretion dust is marched (medium.ts);
 *   - orbiting companion bodies are tested as opaque emissive spheres — because
 *     they sit in the hole's curved spacetime, they lens and are occluded by the
 *     shadow for free;
 *   - crossing the 2M horizon is the shadow; escaping samples the lensed stars.
 *
 * **`opts.lean` — the first-light reveal variant (roadmap #1).** The four heaviest per-slot blocks
 * — disk-feeding (`streamFeed`), the body-body merge flash, the tidal `streamArc`, and the secondary
 * hole's `secondaryDisk` — are **omitted at build time**. Each is runtime-gated to a no-op whenever
 * nothing is tearing / merging / lensing a hole, which is *always true during the cold-start intro*
 * (the seeded line-up is stars + planets on stable orbits — no holes, no tears, no merges). So the
 * lean variant is **pixel-identical to the full shader for the whole reveal** but compiles far faster
 * (those blocks dominate the 14×-unrolled body loop). First light compiles `lean`, shows the reveal,
 * then compiles the full variant off the critical path and swaps it in invisibly. See `firstLight.ts`.
 */
export function createBlackHoleNode(
  u: Uniforms,
  bh: BlackHole,
  bodies: BodyUniforms,
  opts: { lean?: boolean } = {},
) {
  const lean = opts.lean ?? false;
  return Fn(() => {
    const M = bh.mass;
    const rIn = bh.diskInner;
    const rOut = bh.diskOuter;
    const yMax = bh.diskThickness.mul(3.5);

    // --- camera-local pinhole ray ---
    const ndc = screenUV.sub(0.5).mul(2);
    const px = ndc.x.mul(u.tanHalfFov).mul(u.aspect);
    // Flip vertical: the post-pipeline pass renders to an offscreen target whose
    // y is inverted vs the canvas, so without this a camera above the disk plane
    // renders as if seen from below. (Camera basis itself is unaffected.)
    const py = ndc.y.mul(u.tanHalfFov).mul(-1);
    const localDir = normalize(u.camForward.add(u.camRight.mul(px)).add(u.camUp.mul(py)));

    // --- initial geodesic state ---
    const ro = u.camPos;
    const rd = staticObserverRay(localDir, ro, M);
    const pos = ro.toVar();
    const vel = rd.toVar();

    // Integrate out past the disk / outermost companion, then let escaping rays
    // sample the background by direction. Capping at the scene radius (not the
    // camera radius) spares the FAR intro camera a long outbound leg it doesn't
    // need — the bending out there is negligible and it's the dominant intro cost.
    const escapeR = max(bodies.sceneRadius, float(34));
    const h2 = dot(cross(pos, vel), cross(pos, vel)).toVar();
    const rHorizon = M.mul(2);

    const captured = float(0).toVar();
    const escaped = float(0).toVar();
    const radiance = vec3(0).toVar();
    const transmittance = float(1).toVar();
    const volSamples = float(0).toVar();
    const bodyHit = float(0).toVar();
    const bodyColor = vec3(0).toVar();

    Loop(MAX_STEPS, () => {
      const r = length(pos);

      If(r.lessThan(rHorizon), () => {
        captured.assign(1);
        Break();
      });
      If(r.greaterThan(escapeR).and(dot(pos, vel).greaterThan(0)), () => {
        escaped.assign(1);
        Break();
      });

      // Fine steps near the disk plane so a coarse step can't skip the thin slab.
      const cylR = length(vec2(pos.x, pos.z));
      const distY = abs(pos.y);
      const inRadial = cylR.greaterThan(rIn.sub(2)).and(cylR.lessThan(rOut.add(2)));
      const inSlab = inRadial.and(distY.lessThan(yMax));

      const coarse = clamp(r.sub(M.mul(1.5)).mul(0.06), float(0.02), float(3));
      const dlBase = select(inRadial, min(coarse, max(distY.mul(0.4), bh.volumeStep)), coarse);
      // Near a secondary hole, cap the step so its thin disk slab can't be jumped
      // by a coarse step far from the primary. Gated, so the default scene pays nothing.
      const stepCap = float(99).toVar();
      If(bodies.lensingActive.greaterThan(0.5), () => {
        bodies.slots.forEach((slot) => {
          If(slot.lensMass.greaterThan(0), () => {
            const near = length(pos.sub(slot.posRadius.xyz)).lessThan(slot.posRadius.w.mul(6).add(2));
            stepCap.assign(select(near, min(stepCap, max(slot.posRadius.w.mul(0.3), bh.volumeStep)), stepCap));
          });
        });
      });
      const dl = min(dlBase, stepCap);
      const half = dl.mul(0.5);

      // Acceleration = exact Schwarzschild (primary, strong-field) + weak-field
      // deflection from any massive companion (a = −2·m·d/|d|³, validated in
      // scripts/validate-lensing.mjs). The secondary term varies slowly, so it is
      // evaluated ONCE per step here and shared across the RK4 stages — only the
      // primary is re-evaluated per stage. That keeps the geodesic accurate while
      // cutting the companion-lensing cost ~4×, which is what made adding a black
      // hole expensive. The whole block is gated on `lensingActive`, so the
      // default (no-lensing) scene pays nothing.
      const secAccel = vec3(0).toVar();
      If(bodies.lensingActive.greaterThan(0.5), () => {
        bodies.slots.forEach((slot) => {
          const d = pos.sub(slot.posRadius.xyz);
          const invR3 = pow(dot(d, d).add(0.04), float(-1.5));
          secAccel.assign(secAccel.add(d.mul(slot.lensMass.mul(-2).mul(invR3))));
        });
      });
      // Experimental Kerr (#10): add the phenomenological frame-drag PER RK4 stage (matching
      // validate-geodesic.mjs), full shader only. `frameDragAccel` returns exactly 0 when `bh.spin`
      // is 0, so the default (Schwarzschild) reveal/steady state is unchanged; the lean reveal shader
      // omits the term entirely (it stays minimal for the first-light compile).
      const accelAt = (p: Node<'vec3'>) => {
        const a = photonAccel(p, h2, M).add(secAccel);
        return lean ? a : a.add(frameDragAccel(p, bh.spin));
      };

      // RK4 for dx/dλ = v, dv/dλ = a(x).
      const k1x = vel;
      const k1v = accelAt(pos);
      const k2x = vel.add(k1v.mul(half));
      const k2v = accelAt(pos.add(k1x.mul(half)));
      const k3x = vel.add(k2v.mul(half));
      const k3v = accelAt(pos.add(k2x.mul(half)));
      const k4x = vel.add(k3v.mul(dl));
      const k4v = accelAt(pos.add(k3x.mul(dl)));

      const sixth = dl.div(6);
      const newPos = pos.add(k1x.add(k2x.mul(2)).add(k3x.mul(2)).add(k4x).mul(sixth));
      const newVel = vel.add(k1v.add(k2v.mul(2)).add(k3v.mul(2)).add(k4v).mul(sixth));

      // Volume sample at the segment midpoint (front-to-back compositing).
      If(inSlab, () => {
        volSamples.assign(volSamples.add(1));
        const midPos = mix(pos, newPos, 0.5);
        const diskDen = mediumDensity(midPos, u.time, u.timeBlur, bh, bodies.hurricane);
        // Roadmap #8: torn mass feeding the disk — a hot, semi-dense streak where a tearing body
        // sheds into the accretion flow (a single branch when nothing tears, via `feedingActive`).
        // Omitted in the lean first-light variant — nothing feeds the disk during the reveal.
        const feed = lean ? null : streamFeed(midPos, bodies, bh);
        const density = (feed ? diskDen.add(feed.density) : diskDen).mul(u.formation);
        If(density.greaterThan(0.001), () => {
          const base = mediumSource(midPos, vel, diskDen.mul(u.formation), bh);
          const source = feed ? base.add(feed.emission.mul(u.formation)) : base;
          radiance.assign(radiance.add(transmittance.mul(source).mul(dl)));
          transmittance.assign(transmittance.mul(exp(density.mul(bh.extinction).mul(dl).mul(-1))));
        });
      });

      // The merge flash (roadmap #8, body-body): a violent collision burst — a hot core pop at the
      // contact point plus an expanding **shockwave ring** that travels outward and lingers ~1s.
      // Gated on `mergeFlashActive` so it costs a single branch except during the pop. Omitted in the
      // lean first-light variant — no merge happens during the reveal.
      if (!lean) {
        If(u.mergeFlashActive.greaterThan(0.5), () => {
          const fmid = mix(pos, newPos, 0.5);
          const fd = length(fmid.sub(u.mergeFlashPos));
          const shell = u.mergeFlashAge.mul(FLASH_SPEED); // the shockwave front, expanding outward
          const width = float(1.6).add(u.mergeFlashAge.mul(9)); // the ring thickens as it spreads
          const dr = fd.sub(shell);
          const band = exp(dr.mul(dr).div(width.mul(width).mul(-1))); // a travelling bright ring…
          const core = exp(fd.mul(fd).div(float(16).mul(-1))); // …plus a broad hot core at the contact point
          const env = exp(u.mergeFlashAge.mul(-FLASH_TAU)).mul(smoothstep(float(0), float(0.03), u.mergeFlashAge));
          // The core pops hardest at the instant of contact then hands off to the travelling ring, so
          // the eye reads impact → shockwave rather than a single static blob.
          const corePop = core.mul(exp(u.mergeFlashAge.mul(-9)).mul(1.6).add(1));
          const glow = max(band, corePop).mul(env);
          radiance.assign(radiance.add(transmittance.mul(u.mergeFlashColor).mul(glow).mul(dl).mul(FLASH_EMIT)));
        });
      }

      // Companion bodies. The whole per-slot block is gated on an active radius,
      // so empty slots (most of them, most scenes) cost just one branch per step.
      bodies.slots.forEach((slot) => {
        const radius = slot.posRadius.w;
        If(radius.greaterThan(0), () => {
          const center = slot.posRadius.xyz;
          const appear = slot.appear;
          // Spaghettification v2 (roadmap #8, reference-footage pass): a doomed star/planet is torn
          // into a hot stream that trails its orbit and **settles into a wrap around the eater's
          // accretion disk** (see `streamArcHit`) — the eater being the central hole (origin) or a
          // companion hole (slot.eater). The body **core shrinks to a knot and dims** as its mass
          // drains into the stream. Crucially, the WRAPPING STREAM is driven by `slot.tidal` only —
          // a hole's Roche tear — while the absorb fade alone (a body-body Newtonian smash losing
          // its loser at the contact point) shrinks + redshifts + fades WITHOUT a wrapping stream,
          // so a star-on-star impact reads as a collision, not a spaghettification.
          const absorb = slot.absorb;
          const tear = max(absorb, slot.tidal); // drives the core shrink/heat either way
          const fade = float(1).sub(smoothstep(float(0.5), float(1), absorb)); // hold, then fade
          const eaterPos = slot.eater.xyz;
          const heatScale = slot.eater.w.mul(1 / EATER_DISK_MID_CENTRAL); // 1 for the central hole; a companion's scale
          // Tidal heating, graded by this sample's distance from the EATER: hottest (brighter +
          // blue-white) nearest it, cooling along the trail; then redshift as it's absorbed.
          const rEat = length(pos.sub(eaterPos));
          const inner = float(1).sub(smoothstep(float(3).mul(heatScale), float(14).mul(heatScale), rEat));
          const heat = tear.mul(inner);
          const heated = mix(slot.color, slot.color.mul(vec3(0.7, 0.85, 1.25)).mul(2.5), heat);
          const k = float(1).sub(absorb);
          const redshift = vec3(float(1), k, k.mul(k)); // lose blue, then green as it is absorbed
          const streamCol = heated.mul(redshift).mul(appear).mul(fade);

          // The wrapping stream — additive glowing gas along the fresh rip + the disk wrap,
          // composited front-to-back like the dust. Gated on the Roche tear only (see above), so
          // live bodies, Newtonian smashes, and the default scene pay nothing here. Omitted in the
          // lean first-light variant — nothing tears during the reveal.
          if (!lean) {
            If(slot.tidal.greaterThan(0.02), () => {
              const mid = mix(pos, newPos, 0.5);
              const squash = max(float(0.12), float(1).sub(slot.tidal.mul(0.7))); // thin the tube as it tears
              const arcI = streamArcHit(
                mid.sub(eaterPos),
                center.sub(eaterPos),
                slot.streamAxis,
                radius,
                slot.tidal,
                squash,
                slot.rip,
                slot.eater.w,
              );
              If(arcI.greaterThan(0.01), () => {
                radiance.assign(radiance.add(transmittance.mul(streamCol).mul(arcI).mul(dl).mul(STREAM_EMIT)));
                transmittance.assign(transmittance.mul(exp(arcI.mul(dl).mul(STREAM_EXT).mul(-1))));
              });
            });
          }

          // The body core: an opaque emissive sphere that **shrinks toward a knot and dims** as it
          // tears (its mass — and its light — moving into the stream; reference: the head ends as a
          // small bright knot on a thin strand). A robust segment test, so a coarse geodesic step
          // can't skip it; gated on `appear` so a body still swooshing in during the intro neither
          // occludes as a black disc nor flashes. PLANETS get a procedural surface (style 1 = a
          // banded gas giant, 2 = mottled rock — a few trig ops at the hit point, branchless so
          // stars/holes at style 0 shade exactly as before), plus gentle limb darkening.
          const bodyR = radius.mul(float(1).sub(tear.mul(CORE_SHRINK)));
          If(appear.greaterThan(0.02).and(segmentHitsSphere(pos, newPos, center, bodyR)), () => {
            const hitP = segmentClosestPoint(pos, newPos, center);
            const nrm = normalize(hitP.sub(center).add(vec3(1e-5, 0, 0))); // surface normal at the hit
            const lon = atan(nrm.z, nrm.x).add(u.time.mul(0.15)); // slow spin so the surface lives
            const lat = nrm.y;
            // Gas: wavy latitudinal bands (Jupiter's belts). Rock: patchy continents/mottle.
            const bands = float(0.78).add(sin(lat.mul(9).add(sin(lon.mul(2).add(lat.mul(4))).mul(0.6))).mul(0.22));
            const mottle = float(0.72).add(sin(lon.mul(7).add(lat.mul(13))).mul(sin(lat.mul(17).add(lon.mul(3)))).mul(0.28));
            const gasW = clamp(float(1).sub(abs(slot.style.sub(1))), float(0), float(1));
            const rockW = clamp(float(1).sub(abs(slot.style.sub(2))), float(0), float(1));
            const pattern = float(1).add(bands.sub(1).mul(gasW)).add(mottle.sub(1).mul(rockW));
            // Limb darkening, planets only (stars stay bloomy disks): the rim falls off gently.
            const facing = abs(dot(nrm, normalize(newPos.sub(pos))));
            const limb = mix(float(1), facing.mul(0.45).add(0.55), max(gasW, rockW));
            bodyColor.assign(streamCol.mul(pattern).mul(limb).mul(float(1).sub(tear.mul(CORE_DIM))));
            bodyHit.assign(1);
          });

          // A secondary black hole (lensMass > 0) carries its own compact
          // volumetric accretion disk — marched only where the ray crosses its
          // slab and composited front-to-back like the primary's. Its inner edge
          // glows hot, so the dark core reads as a black hole framed by the disk.
          // Omitted in the lean first-light variant — the seeded intro has no secondary holes.
          if (!lean) {
            If(slot.lensMass.greaterThan(0), () => {
              const mid = mix(pos, newPos, 0.5);
              const pl = mid.sub(center);
              const rl = length(vec2(pl.x, pl.z));
              // The slab grows with tear: the plunge-stripped disk (see secondaryDisk) reaches
              // further along the direction to the primary, so its march window must too.
              const grow = float(1).add(tear.mul(1.5));
              const inSecSlab = rl
                .greaterThan(radius.mul(1.4))
                .and(rl.lessThan(radius.mul(6).mul(grow)))
                .and(abs(pl.y).lessThan(radius.mul(0.7).mul(grow)));
              If(inSecSlab.and(appear.greaterThan(0.02)), () => {
                const disk = secondaryDisk(mid, center, radius, slot.lensMass, u.time, u.timeBlur, bh, tear);
                const density = disk.density.mul(appear).mul(fade); // fades with the core as it is absorbed
                If(density.greaterThan(0.001), () => {
                  radiance.assign(radiance.add(transmittance.mul(disk.emission).mul(appear).mul(fade).mul(dl)));
                  transmittance.assign(transmittance.mul(exp(density.mul(bh.extinction).mul(dl).mul(-1))));
                });
              });
            });
          }
        });
      });

      If(transmittance.lessThan(0.02).or(volSamples.greaterThan(64)).or(bodyHit.greaterThan(0.5)), () => {
        Break();
      });

      pos.assign(newPos);
      vel.assign(newVel);
    });

    // Background behind the dust: a hit body, else the lensed star field (escaped)
    // or the black horizon. Composite by the surviving transmittance.
    const sky = background(normalize(vel), u.background, u.bgBrightness, u.bgSaturation, u.bgTint, u.camForward, u.ripple, u.rippleStrength).mul(escaped);
    const backdrop = select(bodyHit.greaterThan(0.5), bodyColor, sky); // bodyColor already faded by appear
    return radiance.add(transmittance.mul(backdrop));
  })();
}
