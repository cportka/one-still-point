import { cos, exp, float, length, max, normalize, pow, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BlackHole } from '../../scene/BlackHole';
import { blackbody } from './blackbody';
import { diskFlux } from './disk';
import { keplerOmega } from './flow';
import { fbm } from './turbulence';

/**
 * A compact volumetric accretion disk around a *secondary* black hole — the same
 * idea as the primary (radial envelope × thin-disk Gaussian × co-rotating,
 * inward-drifting turbulence, blackbody-coloured by the shared flux law) but
 * cheaper: it shares the look uniforms, scales with the hole's render radius, and
 * skips the per-sample relativistic beaming. Returns the density (for
 * Beer–Lambert extinction) and the emission already premultiplied by it.
 *
 * It is marched only where a ray actually crosses the (small) slab, so in
 * practice it costs one extra noise lookup on the few steps that graze it.
 *
 * **The plunge look (live review round 2: "not stretching but rather spinning around — completely
 * wrong, it should be a suck and twirl towards the central black hole"):** as a companion hole
 * plunges, its disk is **tidally stripped into a tail pointing at the primary** — so `tear`
 * (0 live → 1 disrupted) *elongates the disk along the direction to the origin* (the primary),
 * not along the body's own motion; it also **twirls faster** and **brightens** as the mass is
 * devoured. The earlier out-of-plane buckle (which read as spinning in place) is gone. At
 * `tear = 0` every term collapses to the quiet disk, so a settled companion hole is unchanged.
 * (Simpler than the previous pass — fewer ops in the 14×-unrolled body loop, which also trims the
 * cold shader-compile time behind the intro.)
 */
export function secondaryDisk(
  p: Node<'vec3'>,
  center: Node<'vec3'>,
  radius: Node<'float'>,
  mass: Node<'float'>,
  time: Node<'float'>,
  timeBlur: Node<'float'>,
  bh: BlackHole,
  tear: Node<'float'>,
): { density: Node<'float'>; emission: Node<'vec3'> } {
  const pl = p.sub(center);

  // Stretch toward the primary: the in-plane direction from the companion to the origin (the
  // central hole). Compressing the along-that-axis component of the metric draws the envelope into
  // a modest tail toward centre at full tear. Softened 1.4 → 0.45 (the BH→BH capture video: the old
  // stretch + brightening ballooned into a blinding oblong ellipse that swallowed the whole event —
  // the WRAPPING STREAM (bodies.ts, now hot-coloured) is the spaghettification carrier; this disk
  // just deforms and depletes).
  const toCenter = normalize(vec2(center.x, center.z).mul(-1).add(vec2(1e-5, 0)));
  const inPlane = vec2(pl.x, pl.z);
  const aComp = inPlane.dot(toCenter).div(float(1).add(tear.mul(0.45)));
  const bComp = inPlane.dot(vec2(toCenter.y.mul(-1), toCenter.x));
  const rl = length(vec2(aComp, bComp)); // stretched cylindrical radius about the hole
  const inner = radius.mul(1.7);
  const outer = radius.mul(5.5);
  const thick = radius.mul(0.4).mul(float(1).add(tear.mul(0.3))); // puffs slightly as it is torn

  const env = smoothstep(inner, inner.add(radius), rl).mul(smoothstep(outer, outer.sub(radius.mul(2)), rl));
  const yh = pl.y.div(thick);
  const vert = exp(yh.mul(yh).mul(-1)); // thin-disk Gaussian in height (no buckle — it read as spin)

  // Co-rotating turbulence: spin the sample into a frame turning at Ω(rl) so the field shears
  // into trailing arms, plus a slow inward drift + churn. The rate climbs with tear — the
  // stripped mass visibly **swirls faster** (the "twirl") as it goes.
  const omega = keplerOmega(rl, mass).mul(time).mul(bh.rotationSpeed).mul(float(1).add(tear.mul(1.5)));
  const ca = cos(omega);
  const sa = sin(omega);
  const pr = vec3(pl.x.mul(ca).sub(pl.z.mul(sa)), pl.y, pl.x.mul(sa).add(pl.z.mul(ca)));
  const radialDir = normalize(vec3(pl.x, float(0), pl.z));
  const drift = radialDir.mul(bh.infallRate.mul(time)).add(vec3(float(0), bh.churnRate.mul(time), float(0)));
  const turb = fbm(pr.mul(bh.turbScale.mul(1.5)).add(drift));
  const amount = bh.turbAmount.mul(float(1).sub(timeBlur)).mul(float(1).add(tear)); // extra churn as it tears
  const filaments = max(float(0), float(1).add(turb.mul(amount)));

  // Depletion: as the tear deepens the disk's mass is what feeds the (now-visible) wrapping stream
  // — it thins out rather than ballooning. Keeps the dark core framed to the end.
  const density = env.mul(vert).mul(filaments).mul(bh.diskDensity).mul(float(1).sub(tear.mul(0.45)));

  // Hot inner falloff via the shared flux law, blackbody-coloured. The ×4 stands in for the
  // beaming the primary gets per-sample (skipped here for speed). A gentle tear-brightening
  // (2.5 → 0.8 — the old boost drove the blinding ellipse) marks the shock without blowing out.
  const temp = bh.diskTemp.mul(pow(diskFlux(rl, inner), float(0.25)));
  const emission = blackbody(temp).mul(bh.emissiveStrength.mul(4).mul(float(1).add(tear.mul(0.8)))).mul(density);

  return { density, emission };
}
