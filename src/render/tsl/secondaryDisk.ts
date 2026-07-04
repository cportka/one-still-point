import { atan, cos, exp, float, length, max, normalize, pow, sin, smoothstep, vec2, vec3 } from 'three/tsl';
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
 * **The plunge stretch (live review: "its accretion disk stretched and warped … the actual
 * mass that would show as swirling and brightening"):** `tear` (0 live → 1 fully disrupted)
 * drives the disk itself — it **stretches along the motion** (`along`, the plunge tangent: the
 * in-plane metric compresses by 1+1.4·tear along it, so the disk reaches ~2.4× further that
 * way), **warps out of plane** (a travelling m=2 buckle in the disk height), **spins visibly
 * faster** (the co-rotation rate climbs with tear) and **brightens** (~3.5× at full tear, with
 * extra churn in the turbulence). At `tear = 0` every term collapses to the quiet disk.
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
  along: Node<'vec3'>,
): { density: Node<'float'>; emission: Node<'vec3'> } {
  const pl = p.sub(center);

  // Stretch along the motion: compress the along-tangent component of the in-plane metric so
  // the same envelope reaches ~2.4× further that way at full tear (the "pulled taffy" disk).
  const a2 = normalize(vec2(along.x, along.z).add(vec2(1e-5, 0)));
  const inPlane = vec2(pl.x, pl.z);
  const aComp = inPlane.dot(a2).div(float(1).add(tear.mul(1.4)));
  const bComp = inPlane.dot(vec2(a2.y.mul(-1), a2.x));
  const rl = length(vec2(aComp, bComp)); // stretched cylindrical radius about the hole
  const inner = radius.mul(1.7);
  const outer = radius.mul(5.5);
  const thick = radius.mul(0.4).mul(float(1).add(tear.mul(0.4))); // puffs slightly as it is torn

  const env = smoothstep(inner, inner.add(radius), rl).mul(smoothstep(outer, outer.sub(radius.mul(2)), rl));
  // Warp out of plane: a travelling m=2 buckle in the disk height, growing with tear.
  const phase = atan(pl.z, pl.x);
  const buckle = sin(phase.mul(2).sub(time.mul(3))).mul(tear).mul(radius.mul(0.55));
  const yh = pl.y.sub(buckle).div(thick);
  const vert = exp(yh.mul(yh).mul(-1)); // thin-disk Gaussian in (warped) height

  // Co-rotating turbulence: spin the sample into a frame turning at Ω(rl) so the
  // field shears into trailing arms, plus a slow inward drift (infall) and churn.
  // The rate climbs with tear — the stripped mass visibly swirls faster as it goes.
  const omega = keplerOmega(rl, mass).mul(time).mul(bh.rotationSpeed).mul(float(1).add(tear.mul(1.5)));
  const ca = cos(omega);
  const sa = sin(omega);
  const pr = vec3(pl.x.mul(ca).sub(pl.z.mul(sa)), pl.y, pl.x.mul(sa).add(pl.z.mul(ca)));
  const radialDir = normalize(vec3(pl.x, float(0), pl.z));
  const drift = radialDir.mul(bh.infallRate.mul(time)).add(vec3(float(0), bh.churnRate.mul(time), float(0)));
  const turb = fbm(pr.mul(bh.turbScale.mul(1.5)).add(drift));
  const amount = bh.turbAmount.mul(float(1).sub(timeBlur)).mul(float(1).add(tear.mul(1.2))); // extra churn
  const filaments = max(float(0), float(1).add(turb.mul(amount)));

  const density = env.mul(vert).mul(filaments).mul(bh.diskDensity);

  // Hot inner falloff via the shared flux law, blackbody-coloured. The ×4 stands
  // in for the beaming the primary gets per-sample (skipped here for speed).
  // Brightening: the stripped, shocked mass glows harder as the tear deepens.
  const temp = bh.diskTemp.mul(pow(diskFlux(rl, inner), float(0.25)));
  const emission = blackbody(temp).mul(bh.emissiveStrength.mul(4).mul(float(1).add(tear.mul(2.5)))).mul(density);

  return { density, emission };
}
