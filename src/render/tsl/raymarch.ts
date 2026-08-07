import {
  abs,
  Break,
  clamp,
  cos,
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
import { cheapNoise3, segmentClosestPoint, streamArcHit } from './bodies';
import { background } from './background';
import { mediumDensity, mediumSource, streamFeed } from './medium';
import { frameDragAccel, photonAccel, staticObserverRay } from './schwarzschild';
import { secondaryDisk } from './secondaryDisk';

const MAX_STEPS = 512;
// ⟳ Spaghettification look v2 (tuned against the ESO tidal-disruption reference): the core DIMS and
// SHRINKS as its mass drains into the stream, and the stream carries the brightness instead —
// raised so the wrap reads clearly against the disk.
const STREAM_EMIT = 0.18; // brightness of the additive torn-stream gas (0.22 → 0.18, "tone down the
// stretching": with the v0.95.4 taper the tail is thinner, so the head reads hotter — trim the base)
const STREAM_EXT = 0.21; // how much the stream gas occludes (Beer–Lambert) — semi-transparent
const CORE_SHRINK = 0.93; // fraction of the body's radius lost at full TIDAL tear (reference: the head ends a knot)
const CORE_DIM = 0.6; // fraction of the core's emissive lost at full tidal tear (the bloom shrinks with it)
// A Newtonian merge's loser (absorb WITHOUT a tidal tear — no stream to carry its mass away) crushes
// more gently: at the tidal rates it visibly "just disappeared" (the capture) since nothing replaces
// its light. It still shrinks + fades — just legibly.
const ABSORB_SHRINK = 0.55;
const ABSORB_DIM = 0.35;
const FLASH_EMIT = 1.5; // brightness of the body-body merge flash. v0.102.0: the desktop recordings
// MEASURED two full-frame washouts — mean frame luma 216 and 218 of 255 (scene median 44) held for
// 1.25 s and 1.50 s. The flash was erasing the very collision it exists to mark: the neck, the
// wobble and the new dust all played inside a white screen. Three causes, all fixed here: the emit
// was ~2.5× too hot for an unbounded additive term, the glow ACCUMULATED without limit along the
// ray (every step added core+ring × dl — a ray passing near the contact point summed dozens of
// samples), and the envelope kept it near peak far too long. A real collision photosphere is
// bright but BOUNDED and brief; the shockwave that follows is what should linger.
const FLASH_MAX = 1.4; // hard ceiling on the accumulated per-ray flash glow — no unbounded wash
const LEAN_FLASH_EMIT = 1.2; // the LEAN flash is dimmer still (v0.99.3; 2.6 → 1.2 in v0.102.0 with
// the full path's cut — the small-screen wash it was already fighting is the same defect the
// desktop recordings finally measured): a mobile capture showed a
// close central-hole merge whiting out the whole small screen — the pop reads as a burst, not a wash
const LEAN_STREAM_EMIT = 0.5; // the LEAN budget tear-streak is brighter than the full wrap's 0.18 —
// it's a single thin streak carrying the whole "matter pulled in" read, not one strand of a wrap
const LEAN_FLASH_TAU = 5; // the LEAN flash decays faster than the full one (3.4) — the iOS capture
// showed ~4s of milky whiteout; on lean (no debris/blotch to carry the interest) brevity is kinder
const FLASH_SPEED = 26; // how fast the flash shell expands (world units / s of age) — a fast shockwave
const FLASH_TAU = 6; // flash decay rate (1/s). 3.4 → 6: at 3.4 the core was still at ~1/3 peak a
// third of a second in and the frame stayed washed for >1.2 s (measured). Shock breakout is a fast
// spike — the pop should be gone in ~0.3 s, handing the eye to the shockwave + the new dust cloud.
const FLASH_CORE_R2 = 3.2; // core-pop Gaussian σ² (16 → 7 → 3.2: σ ≈ 1.8 world units, so the pop
// scales with the bodies that made it rather than with the frame; the 217/255 washout was a σ=2.6
// core integrated along every ray that passed anywhere near the contact point)
const DEBRIS_SPEED = 0.42; // the slower ejecta shell, as a fraction of the shockwave front
const DEBRIS_EMIT = 0.3; // …dimmer + thicker — reads as thrown matter, not light
// The DUST cloud (v0.101.0) — the coalescence's lingering aftermath, long outliving the flash.
// One instance (a single branch when idle), identical in both shader variants: iOS keeps whole
// sessions on lean, and the drop-merge look is exactly what mobile collisions were missing.
export const DUST_LIFE_S = 9; // seconds the cloud lives (both hosts retire dustActive at this age)
// v0.102.0 — the ejecta rebuilt on the real physics after the recordings showed a smooth khaki
// BALL hanging motionless beside the hole (measured: bbox unchanged 0.5→6.5 s, luma 114→73 — it
// only dimmed). Ejecta into near-vacuum expands HOMOLOGOUSLY: every shell moves at constant
// velocity, so the front goes R = R0 + v·t (linear — not the old age^0.55 "stall"), the interior
// evacuates, and the mass piles up in a THIN SHELL. That shell is why explosion remnants read as
// rings: a sight-line near the limb crosses far more material than one through the middle
// (limb brightening), which a filled ball can never show.
const DUST_VEXP = 5.2; // shell expansion speed (world units/s) — free expansion, R = R0 + v·age
const DUST_SHELL_FRAC = 0.42; // shell thickness as a fraction of R (a real remnant's is thin)
const DUST_EMIT = 0.5; // early-ember emissive strength (cools off with the ember envelope)
const DUST_EXT = 1.5; // how strongly the dust ABSORBS background light — the "proper dust" read
const DUST_EMBER_TAU = 0.7; // 1/s — how fast the warm ember glow cools toward neutral dust
// Surface density of a thin shell of fixed fractional thickness falls as 1/R² (mass conserved
// over a growing area). The old R^-1.4 diluted far too slowly, which is why the cloud read as a
// solid object that merely faded instead of a shell thinning into transparency.
const DUST_DILUTE_POW = 2;
// The liquid NECK bridging two coalescing drops (v0.101.0, both variants): an opaque surface —
// a waisted capsule between the melding pair — that grows as the meld deepens, so contact reads
// as two heavy drops fusing rather than a pop. The remnant then rings (the l = 2 wobble below).
const NECK_GROW_END = 0.55; // meld progress by which the neck has reached full radius
const NECK_WAIST = 0.5; // how deeply the mid-neck pinches at first contact (relaxes as they fuse)

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
    // Running total of the merge flash this ray has already collected. The flash is an additive
    // term evaluated at EVERY step, so a ray grazing the contact point used to sum dozens of
    // near-peak samples into an unbounded wash (the measured 217/255 full-frame whiteout). The
    // budget caps that sum at FLASH_MAX: the pop stays bright and local, but it can never bleach
    // the frame no matter how many steps happen to fall inside it.
    const flashAcc = float(0).toVar();

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
      // Gated on `mergeFlashActive` so it costs a single branch except during the pop. The lean
      // first-light variant gets the BUDGET version below (v0.95.3) — lean used to omit it entirely
      // ("no merge happens during the reveal"), but the iOS-family gate now keeps whole sessions on
      // lean, where collisions really do happen.
      if (!lean) {
        If(u.mergeFlashActive.greaterThan(0.5), () => {
          const fmid = mix(pos, newPos, 0.5);
          const off = fmid.sub(u.mergeFlashPos);
          const fd = length(off);
          const shell = u.mergeFlashAge.mul(FLASH_SPEED); // the shockwave front, expanding outward
          const width = float(1.6).add(u.mergeFlashAge.mul(9)); // the ring thickens as it spreads
          const dr = fd.sub(shell);
          // The shockwave is BLOTCHY — modulated by a 3D noise over direction from the contact
          // point, so it reads as thrown debris rays rather than a clean sphere of light.
          const dir = off.div(max(fd, float(0.001)));
          const blotch = float(0.62).add(cheapNoise3(dir.mul(3.1)).mul(0.55));
          const band = exp(dr.mul(dr).div(width.mul(width).mul(-1))).mul(blotch); // a travelling debris ring…
          // …a slower, dimmer EJECTA shell trailing it (thrown matter, not light)…
          const dr2 = fd.sub(shell.mul(DEBRIS_SPEED));
          const width2 = width.mul(1.8);
          const debris = exp(dr2.mul(dr2).div(width2.mul(width2).mul(-1))).mul(blotch).mul(DEBRIS_EMIT);
          // …plus a TIGHT hot core at the contact point (σ² 16 → 7: the old broad core filled the
          // whole frame white when the camera sat near a merge).
          const core = exp(fd.mul(fd).div(float(FLASH_CORE_R2).mul(-1)));
          const env = exp(u.mergeFlashAge.mul(-FLASH_TAU)).mul(smoothstep(float(0), float(0.03), u.mergeFlashAge));
          // The core pops hardest at the instant of contact then hands off to the travelling ring, so
          // the eye reads impact → shockwave + ejecta rather than a single static blob.
          const corePop = core.mul(exp(u.mergeFlashAge.mul(-9)).mul(1.6).add(1));
          const glow = max(max(band, debris), corePop).mul(env);
          // Spend from the ray's flash budget: whatever is left of FLASH_MAX, never more.
          const take = min(glow.mul(dl), max(float(FLASH_MAX).sub(flashAcc), float(0)));
          flashAcc.assign(flashAcc.add(take));
          radiance.assign(radiance.add(transmittance.mul(u.mergeFlashColor).mul(take).mul(FLASH_EMIT)));
        });
      } else {
        // The LEAN merge flash (v0.95.3): the iOS-family gate means those devices never leave the
        // lean shader — with the flash omitted entirely, a collision there showed NOTHING (bodies
        // touched and silently vanished). A budget version: the same core pop + one clean expanding
        // shell, no noise blotch and no ejecta shell (they're the compile-heavy parts). Costs one
        // branch except during the pop, and a fraction of the full block's code size.
        If(u.mergeFlashActive.greaterThan(0.5), () => {
          const fmid = mix(pos, newPos, 0.5);
          const fd = length(fmid.sub(u.mergeFlashPos));
          const shell = u.mergeFlashAge.mul(FLASH_SPEED);
          const width = float(1.6).add(u.mergeFlashAge.mul(9));
          const dr = fd.sub(shell);
          const band = exp(dr.mul(dr).div(width.mul(width).mul(-1)));
          // A second, slower shell chasing the first (v0.96.2) — the "other movement": two rings
          // travelling outward read as an explosion where a single parked core read as whiteout.
          const dr2 = fd.sub(shell.mul(0.55));
          const band2 = exp(dr2.mul(dr2).div(width.mul(width).mul(-1))).mul(0.7);
          const core = exp(fd.mul(fd).div(float(FLASH_CORE_R2).mul(-1)));
          // Faster decay than the full flash + the core's sustained tail nearly halved (1 → 0.55):
          // the pop stays bright, the milky wash leaves in ~half the time.
          const env = exp(u.mergeFlashAge.mul(-LEAN_FLASH_TAU)).mul(smoothstep(float(0), float(0.03), u.mergeFlashAge));
          // Softer on lean (v0.99.3): the small-screen mobile capture still whited out on a close
          // central-hole merge. Trim the core's peak (1.6→1.0) and sustained tail (0.55→0.28) and
          // drop the emit (FLASH_EMIT→LEAN_FLASH_EMIT), so the pop reads as a bright burst handing
          // off to the travelling shells, not a full-frame milky wash.
          const corePop = core.mul(exp(u.mergeFlashAge.mul(-9)).mul(1.0).add(0.28));
          const glow = max(max(band, band2), corePop).mul(env);
          const take = min(glow.mul(dl), max(float(FLASH_MAX).sub(flashAcc), float(0))); // same budget as the full path
          flashAcc.assign(flashAcc.add(take));
          radiance.assign(radiance.add(transmittance.mul(u.mergeFlashColor).mul(take).mul(LEAN_FLASH_EMIT)));
        });
      }

      // The DUST cloud (v0.101.0): the coalescence's aftermath. A mottled volume seeded at the
      // contact point that expands with a decelerating front, glows warm ember early, cools to
      // neutral dust, and — crucially — ABSORBS background light (extinction is what separates
      // "dust" from "glow"). Flattened slightly along the collision axis, so the splash throws
      // hardest in the impact plane. One instance, both variants; a single branch while idle.
      If(u.dustActive.greaterThan(0.5), () => {
        const dm = mix(pos, newPos, 0.5);
        // The cloud DRIFTS with the debris' bulk momentum instead of hanging at the contact point.
        const centre = u.dustPos.add(u.dustVel.mul(u.dustAge));
        const off = dm.sub(centre);
        const dd = length(off);
        // Free (homologous) expansion: the front travels at constant speed.
        const R = u.dustR0.add(u.dustAge.mul(DUST_VEXP));
        // A THIN SHELL, not a filled ball: mass concentrated near the front, interior evacuated.
        // A Gaussian in (dd − R) makes the limb self-brighten for free — the sight-line near the
        // edge is tangent to the shell and crosses far more of it than one through the middle.
        const wShell = R.mul(DUST_SHELL_FRAC);
        const dShell = dd.sub(R);
        const shell = exp(dShell.mul(dShell).div(max(wShell.mul(wShell), float(1e-4)).mul(-1)));
        If(shell.greaterThan(0.008), () => {
          const dir = off.div(max(dd, float(0.001)));
          const ax = dot(dir, u.dustAxis);
          const flatten = float(1).sub(ax.mul(ax).mul(0.55)); // splash ⊥ to the impact axis
          // FILAMENTS (Rayleigh–Taylor fingers), not lobes: two octaves in a frame that expands
          // WITH the shell (offset ÷ R), so the pattern is frozen into the flow and stretches with
          // it — the old fixed-scale noise slid through the cloud and read as soft smoke.
          const q = off.div(max(R, float(0.5)));
          const nse = cheapNoise3(q.mul(5.5)).mul(0.65).add(cheapNoise3(q.mul(12.5)).mul(0.35));
          const clump = float(0.25).add(smoothstep(float(-0.5), float(0.6), nse).mul(1.05));
          const thin = pow(u.dustR0.div(R), float(DUST_DILUTE_POW)); // 1/R² — a shell's surface density
          const life = float(1).sub(smoothstep(float(DUST_LIFE_S * 0.55), float(DUST_LIFE_S), u.dustAge));
          const dens = shell.mul(clump).mul(flatten).mul(thin).mul(life).mul(u.dustStrength);
          // Cooling: shock-heated white → amber → dull red → cold grey dust that survives mostly
          // as extinction. The old two-point ember→neutral mix skipped the red phase entirely.
          const ember = exp(u.dustAge.mul(-DUST_EMBER_TAU));
          const warm = mix(vec3(0.42, 0.36, 0.33), vec3(1.0, 0.42, 0.16), smoothstep(float(0), float(0.45), ember));
          const dustCol = mix(warm, u.dustColor, smoothstep(float(0.45), float(0.95), ember));
          radiance.assign(radiance.add(transmittance.mul(dustCol).mul(dens).mul(dl).mul(float(DUST_EMIT).mul(ember.mul(1.6).add(0.2)))));
          transmittance.assign(transmittance.mul(exp(dens.mul(DUST_EXT).mul(dl).mul(-1))));
        });
      });

      // Companion bodies. The whole per-slot block is gated on an active radius,
      // so empty slots (most of them, most scenes) cost just one branch per step.
      bodies.slots.forEach((slot, slotIndex) => {
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
          const k = float(1).sub(absorb);
          const redshift = vec3(float(1), k, k.mul(k)); // lose blue, then green as it is absorbed
          // The STREAM's base colour: a star/planet sheds its own glowing matter — but a torn BLACK
          // HOLE sheds its dragged **accretion structure**, which is hot gas, not hole-black. Using
          // the body colour made a plunging hole's stream invisible (near-black × anything = 0 —
          // the BH→BH capture video showed no wrapping ring at all). Hot accretion white-gold now.
          const streamBase = select(slot.lensMass.greaterThan(0), vec3(1.0, 0.88, 0.72).mul(3.5), slot.color);
          const heatOf = (c: Node<'vec3'>) => mix(c, c.mul(vec3(0.7, 0.85, 1.25)).mul(2.5), heat);
          const streamCol = heatOf(streamBase).mul(redshift).mul(appear).mul(fade);
          // The CORE keeps the body's own colour — a black hole's silhouette stays dark even as its
          // accretion structure tears away bright.
          const coreCol = heatOf(slot.color).mul(redshift).mul(appear).mul(fade);

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
          } else {
            // BUDGET tear-streak (v0.99.3): the full streamArc wrap is the compile-heavy piece the
            // lean variant omits — so on the iOS-family gate's PERMANENT lean, a body plunging into
            // the central hole (or a companion) just shrank and silently vanished ("collisions with
            // the central black hole are nothing"). This is its cheap stand-in: a straight hot streak
            // along the body→eater rip line — Gaussian falloff off the segment, thinning as the tear
            // deepens, faded at both ends so it neither spears past the hole nor detaches from the
            // body. Not the wrapping ring (that needs streamArc), but it reads as matter being drawn
            // in and consumed — the accretion the plunge was missing. Gated on the Roche tear, so
            // live bodies and Newtonian smashes pay just one branch. ~a dozen ops.
            If(slot.tidal.greaterThan(0.02), () => {
              const mid = mix(pos, newPos, 0.5);
              const seg = eaterPos.sub(center);
              const cp = segmentClosestPoint(center, eaterPos, mid); // nearest point on the rip line
              const dLine = length(mid.sub(cp));
              const tubeR = radius.mul(max(float(0.3), float(1).sub(slot.tidal.mul(0.7)))); // thins as it tears
              const streak = exp(dLine.mul(dLine).div(tubeR.mul(tubeR).mul(-1)));
              // Only between body (t=0) and eater (t=1); soften both ends.
              const t = clamp(dot(mid.sub(center), seg).div(max(dot(seg, seg), float(1e-4))), float(0), float(1));
              const ends = smoothstep(float(0), float(0.1), t).mul(smoothstep(float(1), float(0.8), t));
              const streamI = streak.mul(ends).mul(slot.tidal);
              If(streamI.greaterThan(0.01), () => {
                radiance.assign(radiance.add(transmittance.mul(streamCol).mul(streamI).mul(dl).mul(LEAN_STREAM_EMIT)));
                transmittance.assign(transmittance.mul(exp(streamI.mul(dl).mul(STREAM_EXT).mul(-1))));
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
          // Split crush: a TIDAL tear shreds the body toward a knot (its mass visibly moves into the
          // stream); a bare ABSORB (a Newtonian merge's loser) crushes gently — nothing replaces its
          // light, so the fierce rate read as "it just disappeared" (the capture).
          const shrinkT = max(slot.tidal.mul(CORE_SHRINK), absorb.mul(ABSORB_SHRINK));
          const dimT = max(slot.tidal.mul(CORE_DIM), absorb.mul(ABSORB_DIM));
          const bodyR = radius.mul(float(1).sub(shrinkT));
          // The merged drop's RING-DOWN (v0.101.0): a coalescence remnant oscillates in its
          // fundamental l = 2 mode — a P₂(cosθ) modulation about the collision axis, swinging
          // prolate ↔ oblate (volume-preserving to first order) as it settles liquid-style.
          // Applied as a directional stretch of the hit radius, only on the one slot the CPU
          // named (`wobbleSlot`); every other slot multiplies the term to zero.
          const hitP = segmentClosestPoint(pos, newPos, center);
          const hd = length(hitP.sub(center));
          const wDir = hitP.sub(center).div(max(hd, float(1e-4)));
          const mu = dot(wDir, bodies.wobbleAxis);
          const p2 = mu.mul(mu).mul(1.5).sub(0.5);
          const isWobbler = select(bodies.wobbleSlot.equal(float(slotIndex)), float(1), float(0));
          const rEff = bodyR.mul(float(1).add(bodies.wobbleAmp.mul(cos(bodies.wobblePhase)).mul(p2).mul(isWobbler)));
          If(appear.greaterThan(0.02).and(hd.lessThan(rEff)), () => {
            const nrm = normalize(hitP.sub(center).add(vec3(1e-5, 0, 0))); // surface normal at the hit
            // Slow spin as a true rotation of the normal about ŷ (a longitude offset degenerates at
            // the poles — the radial-pleat artifact of the first pass).
            const spinA = u.time.mul(0.1);
            const cs = cos(spinA);
            const sn = sin(spinA);
            const nS = vec3(nrm.x.mul(cs).sub(nrm.z.mul(sn)), nrm.y, nrm.x.mul(sn).add(nrm.z.mul(cs)));
            const lat = nS.y;
            const ter = cheapNoise3(nS.mul(2.6)); // one shared 3D noise field — continents / band wobble
            const gasW = clamp(float(1).sub(abs(slot.style.sub(1))), float(0), float(1));
            const rockW = clamp(float(1).sub(abs(slot.style.sub(2))), float(0), float(1));
            // GAS GIANT: alternating dark belts / bright zones (sharpened latitude bands, edges
            // wobbled by the noise — Jupiter's look), as a COLOUR tint: belts drop toward warm brown,
            // zones lift toward cream. Mean ≈ 1, so the planet keeps its palette colour overall.
            const band01 = smoothstep(float(-0.35), float(0.35), sin(lat.mul(11).add(ter.mul(2.2))));
            const gasTint = mix(vec3(0.55, 0.46, 0.4), vec3(1.32, 1.28, 1.18), band01);
            // ROCKY WORLD: thresholded continents over darker blue ocean, plus polar ice caps —
            // an Earth/Mars read that survives bloom because it's a strong two-tone, not a ripple.
            const land = smoothstep(float(-0.08), float(0.14), ter);
            const rockTint = mix(vec3(0.38, 0.52, 0.85), vec3(1.22, 1.08, 0.88), land);
            const caps = smoothstep(float(0.72), float(0.86), abs(lat));
            const rockTintIced = mix(rockTint, vec3(1.35, 1.38, 1.45), caps.mul(0.85));
            // Branchless family mix: style 0 (stars/holes) → tint exactly 1 → the old flat shading.
            const one = vec3(1, 1, 1);
            const tint = one.add(gasTint.sub(one).mul(gasW)).add(rockTintIced.sub(one).mul(rockW));
            // Limb darkening, planets only (stars stay bloomy disks) — stronger than v1 so the
            // sphere reads as a lit ball rather than a flat disc.
            const facing = abs(dot(nrm, normalize(newPos.sub(pos))));
            const limb = mix(float(1), facing.mul(0.62).add(0.38), max(gasW, rockW));
            bodyColor.assign(coreCol.mul(tint).mul(limb).mul(float(1).sub(dimT)));
            bodyHit.assign(1);
          });

          // A secondary black hole (lensMass > 0) carries its own compact
          // volumetric accretion disk — marched only where the ray crosses its
          // slab and composited front-to-back like the primary's. Its inner edge
          // glows hot, so the dark core reads as a black hole framed by the disk.
          // Omitted in the lean first-light variant — the seeded intro has no secondary holes.
          // The lean variant instead draws a BUDGET halo (below): iOS never upgrades off lean
          // (the iOS-family gate), so without any hole signature a newborn TOV hole — or an
          // added companion hole — was just a dark spot on dark space ("the objects disappear,
          // no larger object"). A thin emissive spherical shell integrates, along rays that
          // graze it, into a bright rim circle framing the dark core: a photon-ring read for
          // ~a dozen ops, no noise, no extra march window.
          if (lean) {
            If(slot.lensMass.greaterThan(0).and(appear.greaterThan(0.02)), () => {
              const mid = mix(pos, newPos, 0.5);
              const toC = center.sub(mid);
              const dc = length(toC);
              // Impact-parameter mask (v0.97.5): the first cut's bare shell glowed on EVERY ray
              // crossing it — including rays headed straight at the core — so the hole read as a
              // fuzzy grey star with a faint dark pip (the iOS capture). Grazing rays (direction ⊥
              // the to-centre line) keep the full rim; core-bound rays (∥) lose it: sin² of the
              // angle between the ray and the to-centre line. The black disk framed by a crisp
              // warm ring is the photon-ring read.
              const c = dot(vel, toC).div(max(length(vel).mul(dc), float(1e-4)));
              const rim = float(1).sub(c.mul(c));
              const dEdge = dc.sub(radius.mul(1.55));
              const halo = exp(dEdge.mul(dEdge).div(float(-0.025))); // σ ≈ 0.16 — a THIN shell
              radiance.assign(
                radiance.add(transmittance.mul(vec3(1.0, 0.9, 0.72)).mul(halo).mul(rim).mul(appear).mul(fade).mul(dl).mul(1.1)),
              );
            });
          }
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

      // The liquid NECK (v0.101.0): while two drops meld, an opaque waisted capsule bridges their
      // surfaces — thin at first contact (a filament between two spheres), swelling as the meld
      // deepens until the waist relaxes and the pair reads as one blob. Same limb treatment as the
      // body cores, in the pair's blended liquid tone. Both variants; one branch while idle.
      If(bodies.meld.greaterThan(0.005).and(bodyHit.lessThan(0.5)), () => {
        const A = bodies.meldA.xyz;
        const B = bodies.meldB.xyz;
        const nm = mix(pos, newPos, 0.5);
        const cp = segmentClosestPoint(A, B, nm);
        const seg = B.sub(A);
        const tN = clamp(dot(nm.sub(A), seg).div(max(dot(seg, seg), float(1e-4))), float(0), float(1));
        const rEnd = mix(bodies.meldA.w, bodies.meldB.w, tN);
        const grow = smoothstep(float(0), float(NECK_GROW_END), bodies.meld);
        // The waist: a parabola 4t(1−t) peaking mid-neck, pinching by NECK_WAIST at first contact
        // and relaxing toward a straight bridge as the meld completes.
        const waistDepth = float(NECK_WAIST).mul(float(1).sub(bodies.meld.mul(0.8)));
        const waist = float(1).sub(tN.mul(float(1).sub(tN)).mul(4).mul(waistDepth));
        const neckR = rEnd.mul(grow).mul(waist).mul(0.95);
        const dN = length(nm.sub(cp));
        If(dN.lessThan(neckR), () => {
          const nrmN = normalize(nm.sub(cp).add(vec3(1e-5, 0, 0)));
          const facing = abs(dot(nrmN, normalize(newPos.sub(pos))));
          bodyColor.assign(bodies.meldColor.mul(facing.mul(0.55).add(0.45)));
          bodyHit.assign(1);
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
