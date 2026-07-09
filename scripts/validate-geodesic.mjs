// Numerical validation of the Schwarzschild photon-geodesic integrator used by
// the shader (src/render/tsl/schwarzschild.ts + raymarch.ts). Run with:
//
//     node scripts/validate-geodesic.mjs
//
// We integrate null geodesics in the Cartesian "central-force" form that is
// mathematically equivalent to the Schwarzschild equatorial orbit equation
//     d²u/dφ² + u = 3M·u²        (u = 1/r)
// via the acceleration  a(x) = -3·M·h²·x / r⁵,  h = |x × v|  (conserved).
//
// Geometric units G = c = 1, M = 1 (the length scale). Then:
//     horizon r = 2M = 2,  photon sphere r = 3M = 3,
//     critical impact parameter (shadow) b_crit = 3√3·M ≈ 5.19615.
//
// If our acceleration constant or RK4 is wrong, the recovered b_crit will not
// match 3√3 — so this is a sharp test of the physics the shader depends on.

const M = 1.0;
const RS = 2.0 * M; // event horizon
const PHOTON = 3.0 * M; // photon sphere
const B_CRIT_EXACT = 3 * Math.sqrt(3) * M; // 5.196152...

// --- minimal vec3 ---
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => scl(a, 1 / len(a));

// a(x) = -3 M h² x / r⁵   (function of position; h² is the conserved constant)
// Roadmap #10 (experimental Kerr): an added *phenomenological* frame-dragging term — an azimuthal
// push around the spin axis ŷ, a_drag = K·spin·(ŷ × x)/r⁵ — that drags photons in the spin direction.
// It is NOT the exact Kerr geodesic (no Carter constant / off-equatorial θ-motion); it captures the
// visual signature: prograde (co-rotating) photons reach a smaller critical impact parameter than
// retrograde, so the shadow shifts (the D-shape). spin = 0 recovers exact Schwarzschild.
const KERR_FRAME_DRAG_K = 2.6; // mirrors src/render/tsl/schwarzschild.ts
function accel(x, h2, spin = 0) {
  const r2 = dot(x, x);
  const r5 = Math.pow(r2, 2.5);
  const a = scl(x, (-3.0 * M * h2) / r5);
  if (spin !== 0) {
    const drag = [x[2], 0, -x[0]]; // ŷ × x  (the +φ tangent around the spin axis)
    const c = (KERR_FRAME_DRAG_K * spin) / r5;
    a[0] += drag[0] * c;
    a[1] += drag[1] * c;
    a[2] += drag[2] * c;
  }
  return a;
}

// Adaptive affine step. `factor` lets us probe how fine the GPU loop must be.
function stepSize(r, factor, minStep, maxStep) {
  return Math.min(Math.max(factor * (r - 1.5 * M), minStep), maxStep);
}

// Integrate one photon launched from (0,0,r0) at angle `theta` off the inward
// radial (in the x–z plane).
//
// With cfg.tetrad=false the launch is in raw coordinates (b = r0·sin θ).
// With cfg.tetrad=true we treat θ as the angle a *static observer* at r0
// measures locally and convert to a coordinate velocity via the Schwarzschild
// tetrad: the radial component scales by √(1−2M/r0). This is what a real camera
// at finite r0 sees, and it makes the apparent shadow the textbook size:
//     sin²α = b_crit²·(1−2M/r0)/r0²,  b_crit = 3√3·M.
function integrate(r0, theta, cfg) {
  let x = [0, 0, r0];
  const sr = cfg.tetrad ? Math.sqrt(1 - RS / r0) : 1; // radial frame factor
  let v = norm([Math.sin(theta), 0, -Math.cos(theta) * sr]);
  const h = cross(x, v);
  const h2 = dot(h, h);

  let minR = r0;
  for (let it = 0; it < cfg.maxIter; it++) {
    const r = len(x);
    if (r < minR) minR = r;
    if (r < RS) return { captured: true, dir: norm(v), minR, it };
    if (r > r0 && dot(x, v) > 0) return { captured: false, dir: norm(v), minR, it };
    if (r > 1e7) return { captured: false, dir: norm(v), minR, it };

    const dl = stepSize(r, cfg.factor, cfg.minStep, cfg.maxStep);

    // RK4 for  dx/dλ = v,  dv/dλ = a(x)   (a includes the experimental Kerr frame-drag if cfg.spin ≠ 0)
    const sp = cfg.spin ?? 0;
    const k1x = v;
    const k1v = accel(x, h2, sp);
    const k2x = add(v, scl(k1v, dl / 2));
    const k2v = accel(add(x, scl(k1x, dl / 2)), h2, sp);
    const k3x = add(v, scl(k2v, dl / 2));
    const k3v = accel(add(x, scl(k2x, dl / 2)), h2, sp);
    const k4x = add(v, scl(k3v, dl));
    const k4v = accel(add(x, scl(k3x, dl)), h2, sp);

    x = add(x, scl(add(add(k1x, scl(k2x, 2)), add(scl(k3x, 2), k4x)), dl / 6));
    v = add(v, scl(add(add(k1v, scl(k2v, 2)), add(scl(k3v, 2), k4v)), dl / 6));
  }
  return { captured: true, dir: norm(v), minR, it: cfg.maxIter }; // hit cap → near-critical → black
}

// Binary-search the launch angle where capture flips to escape → b_crit.
function findBcrit(r0, cfg) {
  let lo = 0; // radial: captured
  let hi = Math.PI / 2; // tangent: escapes
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (integrate(r0, mid, cfg).captured) lo = mid;
    else hi = mid;
  }
  const thetaCrit = (lo + hi) / 2;
  return { bcrit: r0 * Math.sin(thetaCrit), thetaCrit };
}

const FINE = { factor: 0.01, minStep: 0.0005, maxStep: 0.05, maxIter: 2_000_000, tetrad: false };
const FINE_T = { ...FINE, tetrad: true };
const SHADER = { factor: 0.06, minStep: 0.02, maxStep: 4.0, maxIter: 512, tetrad: true };

// Textbook apparent angular radius for a static observer (degrees).
const textbookAlpha = (r0) =>
  (Math.asin((B_CRIT_EXACT * Math.sqrt(1 - RS / r0)) / r0) * 180) / Math.PI;

console.log(`exact b_crit = 3√3·M = ${B_CRIT_EXACT.toFixed(6)} M\n`);

console.log('FINE, raw coordinates (asymptotic b_crit → 3√3 as r0 → ∞):');
for (const r0 of [22, 100, 1000]) {
  const { bcrit, thetaCrit } = findBcrit(r0, FINE);
  const errPct = (100 * (bcrit - B_CRIT_EXACT)) / B_CRIT_EXACT;
  console.log(
    `  r0=${String(r0).padStart(4)}M  b_crit=${bcrit.toFixed(4)}M  ` +
      `err=${errPct >= 0 ? '+' : ''}${errPct.toFixed(3)}%  ` +
      `coord angle=${((thetaCrit * 180) / Math.PI).toFixed(2)}°`,
  );
}

console.log('\nFINE, static-observer tetrad (apparent angular radius vs textbook):');
for (const r0 of [22, 100, 1000]) {
  const { thetaCrit } = findBcrit(r0, FINE_T);
  const alpha = (thetaCrit * 180) / Math.PI;
  const want = textbookAlpha(r0);
  console.log(
    `  r0=${String(r0).padStart(4)}M  apparent α=${alpha.toFixed(3)}°  ` +
      `textbook=${want.toFixed(3)}°  Δ=${(alpha - want).toFixed(4)}°`,
  );
}

console.log('\nSHADER budget (512 steps, tetrad) at r0=22:');
{
  const r0 = 22;
  const { thetaCrit } = findBcrit(r0, SHADER);
  const alpha = (thetaCrit * 180) / Math.PI;
  console.log(
    `  apparent α=${alpha.toFixed(3)}°  textbook=${textbookAlpha(r0).toFixed(3)}°  ` +
      `Δ=${(alpha - textbookAlpha(r0)).toFixed(4)}°`,
  );
}

// Roadmap #10 (experimental Kerr): the frame-drag makes the shadow asymmetric — a prograde
// (co-rotating) photon reaches a SMALLER critical impact parameter than a retrograde one, so the
// shadow shifts toward the prograde side (the D-shape). spin = 0 must recover exact Schwarzschild.
console.log('\nRoadmap #10 (experimental Kerr): frame-dragging shifts the shadow (prograde b_crit < retrograde)\n');
{
  const spin = 0.9;
  const bSchw = findBcrit(1000, { ...FINE, spin: 0 }).bcrit; // spin 0 → must recover 3√3
  const bPro = findBcrit(1000, { ...FINE, spin: +spin }).bcrit; // +ŷ-h photon co-rotates with +ŷ spin
  const bRetro = findBcrit(1000, { ...FINE, spin: -spin }).bcrit; // same photon, spin flipped → retrograde
  const recovers = Math.abs(bSchw - B_CRIT_EXACT) / B_CRIT_EXACT < 1e-3;
  const asym = bPro < bRetro;
  const spread = (100 * (bRetro - bPro)) / bSchw;
  console.log(`  spin 0 → b_crit=${bSchw.toFixed(4)}M (exact ${B_CRIT_EXACT.toFixed(4)}M; recovered: ${recovers ? '✓' : '✗'})`);
  console.log(
    `  spin ${spin} → prograde b_crit=${bPro.toFixed(4)}M vs retrograde ${bRetro.toFixed(4)}M ` +
      `(shift ${spread.toFixed(1)}%) → ${recovers && asym ? 'OK' : 'FAIL'}`,
  );
  if (!recovers || !asym) {
    console.error('\nFAIL: the experimental-Kerr frame-drag check did not pass.');
    process.exit(1);
  }
}

// Sanity: a tangential photon circling at the photon sphere. Its coordinate
// angular momentum is L = |x×v| = r = 3M, and the *proper* impact parameter
// (what a distant observer measures) is b = L/√(1−2M/r) = 3M/√(1/3) = 3√3·M.
{
  const r = PHOTON;
  const x = [0, 0, r];
  const v = [1, 0, 0]; // tangential, unit coordinate speed
  const L = len(cross(x, v));
  const b = L / Math.sqrt(1 - RS / r);
  console.log(
    `\nphoton-sphere check: tangential photon at r=3M → L=${L.toFixed(4)}M, ` +
      `b=L/√(1−2M/r)=${b.toFixed(4)}M (expect ${B_CRIT_EXACT.toFixed(4)}M) → ` +
      `${Math.abs(b - B_CRIT_EXACT) < 1e-9 ? 'OK' : 'FAIL'}`,
  );
}
