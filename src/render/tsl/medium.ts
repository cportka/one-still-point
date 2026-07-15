import { dot, exp, float, If, length, max, normalize, pow, smoothstep, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BlackHole } from '../../scene/BlackHole';
import type { BodyUniforms } from '../bodyUniforms';
import { blackbody } from './blackbody';
import { diskTemperature, relativisticShift } from './disk';
import { advectedCoord } from './flow';
import { fbm } from './turbulence';

// --- Roadmap #8: the torn stream feeding the disk -----------------------------------------------
// A star/planet shedding mass within the Roche radius (`tidal` > 0) dumps it into the accretion
// flow. We model that as a hot, semi-dense **streak** added to the disk at the body's azimuth,
// spanning from the inner edge out to the body — so the torn stream visibly *connects* to the disk
// and brightens it (real mass exchange), tracking the body as it spirals in. Tunable dials:
const FEED_DENSITY = 0.6; // extinction the feeding matter adds, relative to the disk's own density
const FEED_FLARE = 7; // brightness of the shock-heated feeding glow (× the disk's emissiveStrength)
const FEED_WEDGE = 40; // angular tightness of the streak along the body's azimuth (higher = narrower)
const FEED_COLOR = vec3(1.0, 0.88, 0.72); // hot white-gold accretion glow

// Extra filament contrast at full hurricane: deeper gaps + brighter ridges so the wound-up flow
// reads as distinct rainbands rather than smooth haze. 0 hurricane → the quiet disk, unchanged.
const HURR_CONTRAST = 1.3;

/**
 * Dust density at a world point and time: a radial envelope (smooth from the
 * ISCO to the outer edge) × a vertical Gaussian (thin disk) × advected
 * turbulence that carves wispy filaments and gaps. `hurricane` (0..1) winds the
 * flow into log-spiral rainbands and deepens their contrast (see flow.ts).
 */
export function mediumDensity(
  p: Node<'vec3'>,
  time: Node<'float'>,
  timeBlur: Node<'float'>,
  bh: BlackHole,
  hurricane: Node<'float'>,
) {
  const r = length(vec2(p.x, p.z));

  const inner = smoothstep(bh.diskInner, bh.diskInner.add(2), r);
  const outer = smoothstep(bh.diskOuter, bh.diskOuter.sub(5), r);
  const radial = inner.mul(outer);

  const yh = p.y.div(bh.diskThickness);
  const vertical = exp(yh.mul(yh).mul(-1)); // Gaussian in height

  // Fade the turbulent filaments out as the time scale climbs → a smooth,
  // time-averaged disk instead of strobing fine structure; deepen them as the hurricane spins up.
  const turb = fbm(advectedCoord(p, time, bh, hurricane));
  const amount = bh.turbAmount.mul(float(1).sub(timeBlur)).mul(float(1).add(hurricane.mul(HURR_CONTRAST)));
  const filaments = max(float(0), float(1).add(turb.mul(amount)));

  return radial.mul(vertical).mul(filaments).mul(bh.diskDensity);
}

/**
 * Source radiance per unit length at a sample (already multiplied by density):
 *   - emission from heat, blackbody(g·T) relativistically beamed by g⁴;
 *   - a cheap single-scatter term — the dust catching the hot inner light,
 *     brightest near the inner edge (∝ 1/r²), no shadow rays.
 */
export function mediumSource(
  p: Node<'vec3'>,
  photonVel: Node<'vec3'>,
  density: Node<'float'>,
  bh: BlackHole,
) {
  const r = length(vec2(p.x, p.z));
  const g = relativisticShift(p, photonVel, bh);

  const emission = blackbody(g.mul(diskTemperature(r, bh)))
    .mul(pow(g, float(4)))
    .mul(bh.emissiveStrength);

  const illum = bh.diskInner.div(r);
  const scatter = vec3(0.7, 0.8, 1.0).mul(illum.mul(illum)).mul(bh.scatterStrength);

  return emission.add(scatter).mul(density);
}

/**
 * The torn stream feeding the disk (roadmap #8). For a sample point `p` in the disk slab, returns
 * the extra `{density, emission}` contributed by any body currently shedding mass (`tidal` > 0):
 * a hot streak at the body's azimuth, banded radially from the disk's inner edge out to the body,
 * and tapered by how near the body is to the disk plane. The whole sweep is gated on
 * `feedingActive`, so it costs a single branch per sample whenever nothing is being torn.
 */
export function streamFeed(p: Node<'vec3'>, bodies: BodyUniforms, bh: BlackHole) {
  const density = float(0).toVar();
  const emission = vec3(0).toVar();
  If(bodies.feedingActive.greaterThan(0.5), () => {
    const sampR = length(vec2(p.x, p.z));
    const sampDir = normalize(vec2(p.x, p.z).add(vec2(1e-5, 0))); // sample's in-plane direction
    bodies.slots.forEach((slot) => {
      // Only bodies being eaten by the CENTRAL hole feed the central disk — a body torn by a
      // companion hole (slot.eater ≠ origin) sheds into ITS disk (the wrap in streamArcHit), not
      // this one.
      If(slot.tidal.greaterThan(0.01).and(length(slot.eater.xyz).lessThan(0.5)), () => {
        const c = slot.posRadius.xyz;
        const bodyR = length(vec2(c.x, c.z));
        const bodyDir = normalize(vec2(c.x, c.z).add(vec2(1e-5, 0)));
        // A tight streak along the body's azimuth, banded from the inner edge out to the body.
        const wedge = pow(max(float(0), dot(sampDir, bodyDir)), float(FEED_WEDGE));
        const band = smoothstep(bh.diskInner.sub(1), bh.diskInner.add(1), sampR) // rises at the inner edge
          .mul(smoothstep(bodyR.add(2), bodyR.sub(2), sampR)); // falls off at the body's radius
        const yn = c.y.div(bh.diskThickness.mul(6));
        const planeNear = exp(yn.mul(yn).mul(-1)); // feeds most when the body is near the disk plane
        const s = slot.tidal.mul(wedge).mul(band).mul(planeNear);
        density.addAssign(s);
        emission.addAssign(FEED_COLOR.mul(s));
      });
    });
  });
  return {
    density: density.mul(bh.diskDensity).mul(FEED_DENSITY),
    emission: emission.mul(bh.emissiveStrength).mul(FEED_FLARE),
  };
}
