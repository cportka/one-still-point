import {
  abs,
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
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BodyUniforms } from '../bodyUniforms';
import type { BlackHole } from '../../scene/BlackHole';
import type { Uniforms } from '../uniforms';
import { segmentHitsSphere, streamArcHit } from './bodies';
import { background } from './background';
import { mediumDensity, mediumSource, streamFeed } from './medium';
import { photonAccel, staticObserverRay } from './schwarzschild';
import { secondaryDisk } from './secondaryDisk';

const MAX_STEPS = 512;
// ⟳ Spaghettification look (tune against a recording): brighter, wispier torn-stream gas so the
// tear reads clearly against the disk — raised from 0.12/0.25 per the "more spaghettified" pass.
const STREAM_EMIT = 0.17; // brightness of the additive torn-stream gas (× its HDR colour, per unit length)
const STREAM_EXT = 0.21; // how much the stream gas occludes (Beer–Lambert) — semi-transparent
const FLASH_EMIT = 3.5; // brightness of the body-body merge flash (× its HDR colour, per unit length)
const FLASH_SPEED = 22; // how fast the flash shell expands (world units / s of age)
const FLASH_TAU = 5.5; // flash decay rate (1/s) — a quick, bright pop that fades in ~0.6s

/**
 * The black-hole shader. Per-pixel Schwarzschild photon geodesics by RK4
 * integration of a(x) = -3M·h²·x/r⁵ (schwarzschild.ts). Along each bent ray:
 *   - the volumetric accretion dust is marched (medium.ts);
 *   - orbiting companion bodies are tested as opaque emissive spheres — because
 *     they sit in the hole's curved spacetime, they lens and are occluded by the
 *     shadow for free;
 *   - crossing the 2M horizon is the shadow; escaping samples the lensed stars.
 */
export function createBlackHoleNode(u: Uniforms, bh: BlackHole, bodies: BodyUniforms) {
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
      const accelAt = (p: Node<'vec3'>) => photonAccel(p, h2, M).add(secAccel);

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
        const diskDen = mediumDensity(midPos, u.time, u.timeBlur, bh);
        // Roadmap #8: torn mass feeding the disk — a hot, semi-dense streak where a tearing body
        // sheds into the accretion flow (a single branch when nothing tears, via `feedingActive`).
        const feed = streamFeed(midPos, bodies, bh);
        const density = diskDen.add(feed.density).mul(u.formation);
        If(density.greaterThan(0.001), () => {
          const source = mediumSource(midPos, vel, diskDen.mul(u.formation), bh).add(feed.emission.mul(u.formation));
          radiance.assign(radiance.add(transmittance.mul(source).mul(dl)));
          transmittance.assign(transmittance.mul(exp(density.mul(bh.extinction).mul(dl).mul(-1))));
        });
      });

      // The merge flash (roadmap #8, body-body): a bright expanding shell at a companion collision.
      // Gated on `mergeFlashActive` so it costs a single branch except during the brief pop. The
      // shell radius grows with age and the whole thing decays fast — a violent spark at the site.
      If(u.mergeFlashActive.greaterThan(0.5), () => {
        const fmid = mix(pos, newPos, 0.5);
        const fd = length(fmid.sub(u.mergeFlashPos));
        const shell = u.mergeFlashAge.mul(FLASH_SPEED); // the flash front, expanding outward
        const width = float(1.2).add(u.mergeFlashAge.mul(6)); // the shell thickens as it spreads
        const dr = fd.sub(shell);
        const band = exp(dr.mul(dr).div(width.mul(width).mul(-1))); // a travelling bright shell…
        const core = exp(fd.mul(fd).div(float(9).mul(-1))); // …plus a hot core at the contact point
        const env = exp(u.mergeFlashAge.mul(-FLASH_TAU)).mul(smoothstep(float(0), float(0.03), u.mergeFlashAge));
        const glow = max(band, core).mul(env);
        radiance.assign(radiance.add(transmittance.mul(u.mergeFlashColor).mul(glow).mul(dl).mul(FLASH_EMIT)));
      });

      // Companion bodies. The whole per-slot block is gated on an active radius,
      // so empty slots (most of them, most scenes) cost just one branch per step.
      bodies.slots.forEach((slot) => {
        const radius = slot.posRadius.w;
        If(radius.greaterThan(0), () => {
          const center = slot.posRadius.xyz;
          const appear = slot.appear;
          // Spaghettification (roadmap #8): a doomed star/planet is torn into a hot stream of gas
          // that **wraps along its orbital circle**, trailing the body around the hole toward the
          // horizon — not a radial spike. The body **core shrinks** as it dissolves into the stream;
          // the stream itself is an additive, semi-transparent emissive **arc** swept along the orbit
          // (see `streamArcHit`), blue-white hot nearest the hole (being devoured) and redshifting as
          // it is finally taken in. `tear` 0 → a plain sphere (live body), 1 → a long wrapping rip.
          const absorb = slot.absorb;
          const tear = max(absorb, slot.tidal); // stronger of the Roche-gated approach tear and the absorb fade
          const fade = float(1).sub(smoothstep(float(0.5), float(1), absorb)); // hold, then fade
          // Tidal heating, graded by this sample's distance from the hole (`r`): hottest (brighter +
          // blue-white) nearest the hole, cooling along the trail; then redshift as it's absorbed.
          const inner = float(1).sub(smoothstep(float(3), float(14), r));
          const heat = tear.mul(inner);
          const heated = mix(slot.color, slot.color.mul(vec3(0.7, 0.85, 1.25)).mul(2.5), heat);
          const k = float(1).sub(absorb);
          const redshift = vec3(float(1), k, k.mul(k)); // lose blue, then green as it is absorbed
          const streamCol = heated.mul(redshift).mul(appear).mul(fade);

          // The wrapping stream — additive glowing gas along the orbital arc, composited front-to-back
          // like the dust. Only when actually tearing (gated), so live bodies and the default scene
          // pay nothing here.
          If(tear.greaterThan(0.02), () => {
            const mid = mix(pos, newPos, 0.5);
            const squash = max(float(0.12), float(1).sub(tear.mul(0.7))); // thin the tube as it tears
            const arcI = streamArcHit(mid, center, slot.streamAxis, radius, tear, squash, slot.rip);
            If(arcI.greaterThan(0.01), () => {
              radiance.assign(radiance.add(transmittance.mul(streamCol).mul(arcI).mul(dl).mul(STREAM_EMIT)));
              transmittance.assign(transmittance.mul(exp(arcI.mul(dl).mul(STREAM_EXT).mul(-1))));
            });
          });

          // The body core: an opaque emissive sphere that **shrinks** as it tears (dissolving into the
          // stream). A robust segment test, so a coarse geodesic step can't skip it; gated on `appear`
          // so a body still swooshing in during the intro neither occludes as a black disc nor flashes.
          const bodyR = radius.mul(float(1).sub(tear.mul(0.7)));
          If(appear.greaterThan(0.02).and(segmentHitsSphere(pos, newPos, center, bodyR)), () => {
            bodyColor.assign(streamCol);
            bodyHit.assign(1);
          });

          // A secondary black hole (lensMass > 0) carries its own compact
          // volumetric accretion disk — marched only where the ray crosses its
          // slab and composited front-to-back like the primary's. Its inner edge
          // glows hot, so the dark core reads as a black hole framed by the disk.
          If(slot.lensMass.greaterThan(0), () => {
            const mid = mix(pos, newPos, 0.5);
            const pl = mid.sub(center);
            const rl = length(vec2(pl.x, pl.z));
            // The slab grows with tear: the plunge-stretched disk (see secondaryDisk) reaches
            // further along the motion and buckles out of plane, so its march window must too.
            const grow = float(1).add(tear.mul(1.5));
            const inSecSlab = rl
              .greaterThan(radius.mul(1.4))
              .and(rl.lessThan(radius.mul(6).mul(grow)))
              .and(abs(pl.y).lessThan(radius.mul(0.7).mul(grow)));
            If(inSecSlab.and(appear.greaterThan(0.02)), () => {
              const disk = secondaryDisk(mid, center, radius, slot.lensMass, u.time, u.timeBlur, bh, tear, slot.streamAxis);
              const density = disk.density.mul(appear).mul(fade); // fades with the core as it is absorbed
              If(density.greaterThan(0.001), () => {
                radiance.assign(radiance.add(transmittance.mul(disk.emission).mul(appear).mul(fade).mul(dl)));
                transmittance.assign(transmittance.mul(exp(density.mul(bh.extinction).mul(dl).mul(-1))));
              });
            });
          });
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
