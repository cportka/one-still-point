import { abs, acos, asin, atan, clamp, dot, exp, float, fract, If, max, mix, normalize, pow, select, sin, smoothstep, sqrt, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { starfield } from './starfield';
import { fbm } from './turbulence';

const TWO_PI = 6.2831853;
const PI = 3.14159265;

// --- Merger ringdown ripple (roadmap #6) — tuning dials -----------------------------------------
// A gravitational-wave-styled ringdown radiating from the hole (the merger point), fired by an
// absorption. Applied **globally** (in `background()`) by warping the sampled sky direction, so it
// reads the SAME on every background. Reworked 2026-07 from the earlier soft glow-band (which read
// as "vague spread whiteness" on the recording): a real wave *displaces*, it barely glows — so the
// signal is now the **distortion**: a thin, crisp leading front that visibly drags the starfield as
// it passes, trailing a longer wake of ringing crests that decay (the ringdown), with only a faint
// cool glint riding the front. `ripple` (uniform) is seconds since the event; large when idle →
// no-op. ⟳ Tune against a recording (a hole merger rides `rippleStrength` up to 3× these).
const RIPPLE_SPEED = 0.58; // how fast the wavefront sweeps outward, in radians of sky-angle per second (−20%, review: "20% too large")
const RIPPLE_TAU = 2.6; // amplitude decay time (s) — the "ringdown" length
const RIPPLE_W2_LEAD = 0.012; // squared width AHEAD of the front — small = a sharp, crisp leading edge
const RIPPLE_W2_TRAIL = 0.1; // squared width BEHIND — wide = a trailing wake with visible ringing crests
const RIPPLE_FREQ = 26; // spatial ringing frequency — ~2–3 crests visible in the trailing wake
const RIPPLE_WARP = 0.072; // radians the sky is dragged at the crest — the distortion IS the signal (−20% with SPEED, per review)
const RIPPLE_GLOW = 0.015; // a faint cool glint at the front only — the old 0.07 fog was the "whiteness"
// The amplitude (`rippleStrength` uniform) is computed CPU-side from the absorbed body's mass —
// see `rippleStrengthForMass` in `src/render/rippleStrength.ts`.

/**
 * The global ringdown distortion: warp the sampled sky direction `dir` radially in an expanding,
 * decaying wave from the hole (`camFwd`). Asymmetric profile — a sharp leading edge (`W2_LEAD`), a
 * longer ringing wake behind it (`W2_TRAIL`) — so it reads as a travelling wave train, not a fog.
 * Returns the warped direction + the front band (for the faint glint). Background-agnostic — every
 * sky lenses the same way through it. Idle (`ripple` large) → wave ≈ 0 → `dir` unchanged.
 */
function rippleWarp(dir: Node<'vec3'>, camFwd: Node<'vec3'>, ripple: Node<'float'>, strength: Node<'float'>) {
  const cosT = clamp(dot(dir, camFwd), float(-0.9999), float(0.9999));
  const theta = acos(cosT); // sky-angle from the merger point
  const front = ripple.mul(RIPPLE_SPEED); // wavefront radius, expanding with time
  // rise → ringdown, scaled by the merger's mass. The decay TIME also stretches with √strength
  // (a hole merger at ~4× strength rings ~2× longer — ringdown time grows with the final mass),
  // so the overwhelming event is long as well as hard. Idle → exp term ≈ 0, still a no-op.
  const tau = sqrt(strength).mul(RIPPLE_TAU);
  const env = exp(ripple.div(tau.mul(-1))).mul(smoothstep(float(0), float(0.08), ripple)).mul(strength);
  const d = theta.sub(front); // >0 = ahead of the front, <0 = in the wake
  const width2 = select(d.greaterThan(0), float(RIPPLE_W2_LEAD), float(RIPPLE_W2_TRAIL));
  const band = exp(d.mul(d).div(width2.mul(-1))); // sharp edge ahead, ringing wake behind
  const wave = sin(d.mul(RIPPLE_FREQ)).mul(band).mul(env); // the travelling wave train
  const radial = normalize(dir.sub(camFwd.mul(cosT)).add(vec3(1e-4, 0, 0))); // outward (⟂ to centre)
  const warped = normalize(dir.add(radial.mul(wave.mul(RIPPLE_WARP))));
  // The glint hugs only the leading edge (the tight profile), not the whole wake — no fog.
  const glint = exp(d.mul(d).div(-RIPPLE_W2_LEAD)).mul(env);
  return { dir: warped, glow: glint };
}

/** Thin bright lines wherever `coord × count` lands on an integer. */
function gridLines(coord: Node<'float'>, count: number) {
  const f = abs(fract(coord.mul(count).add(0.5)).sub(0.5));
  return smoothstep(float(0.035), float(0), f);
}

/**
 * Mode 1 — a high-contrast emission nebula: orange-dominant glowing gas with dark
 * ember shadows and rare cool-blue pockets, carved hard by black dust pillars.
 * This is the v0.14.1 look (tuned for punch — deep voids, bright cores), which
 * the later "blue-green darks" ramps had drifted away from; the only addition is
 * a *faint* dark blue-green floor that lifts the blackest gaps just enough to
 * read as deep space rather than pure void.
 */
function nebula(dir: Node<'vec3'>) {
  const base = fbm(dir.mul(1.8)).mul(0.5).add(0.5); // large-scale structure
  const detail = fbm(dir.mul(4.0).add(vec3(19, 7, 13))).mul(0.5).add(0.5);
  const dust = fbm(dir.mul(2.6).add(vec3(40, 5, 30))).mul(0.5).add(0.5);

  // Narrow, powered masks → dark voids and bright cores (the contrast/punch).
  const orangeMask = pow(smoothstep(float(0.45), float(0.85), base), float(1.5)); // dominant
  const blueMask = pow(smoothstep(float(0.62), float(0.92), detail), float(2)).mul(0.6); // accent

  // Deep, saturated tones: ACES tone-mapping + bloom desaturate bright values
  // toward white, so the orange is kept rich (low green, ~no blue) and not too
  // hot — that is what stops the cores washing out to pale cream.
  const orange = vec3(0.95, 0.3, 0.04); // rich, red-leaning orange (saturated)
  const ember = vec3(0.5, 0.1, 0.014); // deep rust mid-shadow
  const blue = vec3(0.1, 0.42, 0.62);

  const warm = mix(ember, orange, orangeMask).mul(orangeMask);
  const gas = warm.add(blue.mul(blueMask));

  const dustMask = smoothstep(float(0.45), float(0.7), dust); // pillars carve to black
  const carved = gas.mul(float(1).sub(dustMask)).mul(1.45); // dimmer → less bloom-to-white, deeper orange

  // The "little dark blue/green near the blacker areas": a dim cool floor where
  // the orange gas is absent, mostly (not fully) carved by the dust so the
  // pillars stay near-black and the punch survives.
  const darkBlueGreen = vec3(0.02, 0.07, 0.06);
  const floor = darkBlueGreen.mul(float(1).sub(orangeMask)).mul(float(1).sub(dustMask.mul(0.6)));

  // Knots: deep-orange (not cream) and rarer, so the hot spots glow amber rather
  // than blowing out to white.
  const tips = vec3(1.0, 0.5, 0.12).mul(pow(detail, float(11)).mul(1.4));
  return carved.add(floor).add(tips).add(starfield(dir, float(0.5)));
}

/**
 * Mode 2 — Filaments: a high-contrast cosmic web. Ridged noise (1 − |noise|)
 * makes sharp threads over big dark gaps, with brighter knots at the
 * intersections. Tinted cool blue-silver so it always reads as *background*
 * against the warm-white central disk rather than washing into it.
 */
function filaments(dir: Node<'vec3'>) {
  const r1 = float(1).sub(abs(fbm(dir.mul(2.2))));
  const r2 = float(1).sub(abs(fbm(dir.mul(5.0).add(vec3(13, 9, 21)))));
  const web = max(float(0), r1.mul(0.55).add(r2.mul(0.55)).sub(0.52)); // high threshold → dark gaps
  const webGlow = pow(web, float(3)).mul(6);
  const nodes = pow(max(float(0), r1.mul(r2)), float(10)).mul(4); // bright cluster knots
  const intensity = clamp(webGlow.add(nodes), float(0), float(2.6)); // lower cap → less blowout
  return vec3(0.5, 0.68, 1.0).mul(intensity).add(starfield(dir, float(0.22)));
}

/**
 * Mode 3 — a glowing spacetime lattice; lat/long lines bend through the lensing.
 * Major lines plus fainter minor lines four to a cell for a finer grid. (The merger ripple is
 * applied globally in `background()` now — see `rippleWarp` — so it reads the same on every sky.)
 */
function lattice(dir: Node<'vec3'>) {
  const lon = atan(dir.z, dir.x).div(TWO_PI).add(0.5);
  const lat = asin(clamp(dir.y, float(-0.999), float(0.999))).div(PI).add(0.5);
  const major = max(gridLines(lon, 24), gridLines(lat, 12));
  const minor = max(gridLines(lon, 96), gridLines(lat, 48)).mul(0.3); // in-between lines
  // Greener and a touch less saturated than the old cyan (raised red toward the
  // others, lowered blue so green leads).
  return vec3(0.4, 0.66, 0.6).mul(max(major, minor)).add(starfield(dir, float(0.35)));
}

/**
 * The background sky, selected by a mode uniform and sampled along each photon's
 * bent escape direction — so every option lenses around the holes. Mode 0 is the
 * original star field (the default); 1–3 are stylised alternatives. Each mode is
 * gated, so only the selected one runs. `brightness`, `saturation` and `tint`
 * (Advanced → Background) post-process whichever one is chosen.
 */
export function background(
  dir: Node<'vec3'>,
  mode: Node<'float'>,
  brightness: Node<'float'>,
  saturation: Node<'float'>,
  tint: Node<'float'>,
  camFwd: Node<'vec3'>,
  ripple: Node<'float'>,
  rippleStrength: Node<'float'>,
) {
  // Global merger ringdown: warp the sampled sky direction in an expanding ring (same on every
  // background), so the selected sky lenses through the ripple identically. Idle → `sky` ≈ `dir`.
  const ring = rippleWarp(dir, camFwd, ripple, rippleStrength);
  const sky = ring.dir;

  const col = vec3(0).toVar();
  If(mode.lessThan(0.5), () => col.assign(starfield(sky, float(1.2))));
  If(mode.greaterThan(0.5).and(mode.lessThan(1.5)), () => col.assign(nebula(sky)));
  If(mode.greaterThan(1.5).and(mode.lessThan(2.5)), () => col.assign(filaments(sky)));
  If(mode.greaterThan(2.5), () => col.assign(lattice(sky)));
  // A faint cool glow riding the wavefront so the ripple reads on a sparse sky too.
  col.addAssign(vec3(0.7, 0.85, 1.0).mul(ring.glow.mul(RIPPLE_GLOW)));

  // Universal post: saturation (toward luminance) → warm/cool tint → brightness.
  const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  const sat = mix(vec3(luma), col, saturation);
  const tinted = sat.mul(vec3(float(1).add(tint), float(1), float(1).sub(tint)));
  return max(vec3(0), tinted).mul(brightness);
}
