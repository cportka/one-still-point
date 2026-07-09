// Sanity check for the N-body integrator (src/physics). A test particle placed
// on a circular orbit around the fixed primary should keep a near-constant
// radius over many orbits, and velocity-Verlet (symplectic) should conserve
// energy to a tiny bounded error. It also checks roadmap #7: the position-only
// r^-3 term precesses the ellipse at the analytic apsidal rate.
// Run: node scripts/validate-orbit.mjs

const G = 1;
const M = 1; // primary mass
const SOFT2 = 0.25; // matches integrators.ts
const PRECESSION_K = 0.3; // mirrors integrators.ts (the r^-3 apsidal-advance dial)

// The central force, all position-only: f(r) = M/r^2 (Newton) + k/r^3 (precession, #7)
// + A/r (dark-matter halo, inward, #12) − L·r (dark-energy Λ, OUTWARD, #13). `k` defaults to
// PRECESSION_K (overridable for the k=0 control); A and L default to 0.
const accel = (p, k = PRECESSION_K, A = 0, L = 0) => {
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + SOFT2;
  const invR3 = 1 / (Math.sqrt(r2) * r2);
  // `c` is the inward coefficient on `p` (which points outward): −c·p is the inward pull. Λ is the
  // outward term, so it enters as +L·p.
  const c = G * M * invR3 + (k * invR3) / Math.sqrt(r2) + A / r2; // M/r^2 + k/r^3 + A/r, all inward
  return [(-c + L) * p[0], (-c + L) * p[1], (-c + L) * p[2]];
};

// True conserved energy, including the precession potential U = -k/(2 r^2).
const energy = (p, v) => {
  const r = Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2);
  return 0.5 * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) - (G * M) / r - PRECESSION_K / (2 * r * r);
};

function runCircular(r) {
  const p = [r, 0, 0];
  const v = [0, 0, Math.sqrt(G * M / r + PRECESSION_K / (r * r))]; // combined-field circular speed
  let a = accel(p);

  const e0 = energy(p, v);
  let rmin = Infinity;
  let rmax = 0;

  const dt = 0.05;
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * M));
  const steps = Math.round((period * 10) / dt); // 10 orbits

  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < 3; k++) {
      v[k] += a[k] * dt * 0.5;
      p[k] += v[k] * dt;
    }
    a = accel(p);
    for (let k = 0; k < 3; k++) v[k] += a[k] * dt * 0.5;

    const rr = Math.hypot(p[0], p[1], p[2]);
    rmin = Math.min(rmin, rr);
    rmax = Math.max(rmax, rr);
  }

  const drift = Math.abs((energy(p, v) - e0) / e0);
  const ok = rmax - rmin < 0.05 * r && drift < 1e-3;
  console.log(
    `  r=${String(r).padStart(3)}: radius ∈ [${rmin.toFixed(3)}, ${rmax.toFixed(3)}] ` +
      `(period ${period.toFixed(0)}), energy drift ${(drift * 100).toExponential(2)}% → ${ok ? 'OK' : 'FAIL'}`,
  );
  return ok;
}

// Measure the apsidal advance per orbit of a mildly eccentric orbit in the x–z plane: integrate,
// track perihelion passages (local minima of r), and return the mean azimuth gained between them
// beyond a full turn. Returns the RAW advance (includes the integrator's tiny discretisation bias);
// the physical precession is isolated by subtracting the k=0 run with the same dt/geometry.
function measureAdvance(r, k) {
  const p = [r, 0, 0];
  const vc = Math.sqrt(G * M / r + k / (r * r)); // combined circular speed
  const v = [0, 0, vc * 0.96]; // under-speed → mild eccentricity (apsides to track), small enough that
  let a = accel(p, k); //          the near-circular apsidal formula holds within tolerance
  const dt = 0.02;

  let theta = 0; // cumulative (unwrapped) azimuth
  let prevAng = Math.atan2(p[2], p[0]);
  let rPrev2 = Infinity;
  let rPrev = Math.hypot(p[0], p[2]);
  let thetaPrev = 0; // theta at the rPrev sample
  let lastApsisTheta = null;
  const advances = [];
  const target = 18; // perihelia to collect

  for (let i = 0; i < 200_000_000 && advances.length < target; i++) {
    for (let c = 0; c < 3; c++) {
      v[c] += a[c] * dt * 0.5;
      p[c] += v[c] * dt;
    }
    a = accel(p, k);
    for (let c = 0; c < 3; c++) v[c] += a[c] * dt * 0.5;

    const ang = Math.atan2(p[2], p[0]);
    let d = ang - prevAng;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    theta += d;
    prevAng = ang;

    const rr = Math.hypot(p[0], p[2]);
    if (rPrev < rr && rPrev < rPrev2) {
      // rPrev was a local minimum → a perihelion at azimuth thetaPrev
      if (lastApsisTheta !== null) advances.push(thetaPrev - lastApsisTheta - 2 * Math.PI);
      lastApsisTheta = thetaPrev;
    }
    rPrev2 = rPrev;
    rPrev = rr;
    thetaPrev = theta;
  }

  const mid = advances.slice(2, -2); // drop the first/last transients
  return mid.reduce((s, x) => s + x, 0) / mid.length;
}

function runPrecession(r) {
  const closed = 2 * Math.PI * (Math.sqrt(1 + PRECESSION_K / r) - 1); // analytic apsidal advance/orbit
  const physical = measureAdvance(r, PRECESSION_K) - measureAdvance(r, 0); // cancel the dt bias via k=0
  const relErr = Math.abs((physical - closed) / closed);
  const ok = relErr < 0.12;
  console.log(
    `  r=${String(r).padStart(3)}: precession ${(physical * (180 / Math.PI)).toFixed(3)}°/orbit ` +
      `(closed-form ${(closed * (180 / Math.PI)).toFixed(3)}°, err ${(relErr * 100).toFixed(1)}%) → ${ok ? 'OK' : 'FAIL'}`,
  );
  return ok;
}

// Roadmap #12/#13 — the dark sector. Mirrors integrators.ts scaling (slider 1 = these maxima).
const DARK_MATTER_MAX = 0.05;
const DARK_ENERGY_MAX = 3e-5;

// Exact circular speed for accel() at radius r with halo A / Λ L: v² = r·(g_inward − Λ·r).
const vCirc = (r, A, L) => {
  const r2 = r * r + SOFT2;
  return Math.sqrt(Math.max(0, ((G * M + A * r) / r2 - L * r) * r));
};

// A body seeded at the combined-field circular speed should hold its radius (the extra terms are
// central) over 10 periods.
function holdsCircular(r, A, L) {
  const p = [r, 0, 0];
  const v = [0, 0, vCirc(r, A, L)];
  let a = accel(p, PRECESSION_K, A, L);
  const dt = 0.05;
  const steps = Math.round((2 * Math.PI * Math.sqrt(r ** 3 / (G * M)) * 10) / dt);
  let rmin = Infinity;
  let rmax = 0;
  for (let i = 0; i < steps; i++) {
    for (let c = 0; c < 3; c++) {
      v[c] += a[c] * dt * 0.5;
      p[c] += v[c] * dt;
    }
    a = accel(p, PRECESSION_K, A, L);
    for (let c = 0; c < 3; c++) v[c] += a[c] * dt * 0.5;
    const rr = Math.hypot(p[0], p[1], p[2]);
    rmin = Math.min(rmin, rr);
    rmax = Math.max(rmax, rr);
  }
  return { rmin, rmax };
}

function runDarkSector() {
  let ok = true;
  // (a) Dark matter flattens the rotation curve: with the halo the circular speed barely falls from
  //     r to 2r, where Keplerian drops ~29% (1 − 1/√2); and a halo-circular orbit holds its radius.
  const A = DARK_MATTER_MAX;
  const keplerDrop = 1 - Math.sqrt(0.5); // vK(2r)/vK(r) = 1/√2
  const haloDrop = 1 - vCirc(160, A, 0) / vCirc(80, A, 0);
  const { rmin, rmax } = holdsCircular(80, A, 0);
  const flat = haloDrop < keplerDrop * 0.4;
  const stable = rmax - rmin < 0.05 * 80;
  ok = flat && stable && ok;
  console.log(
    `  dark matter (A=${A}): rotation-curve drop r→2r ${(haloDrop * 100).toFixed(1)}% vs Kepler ` +
      `${(keplerDrop * 100).toFixed(1)}%; halo-circular radius ∈ [${rmin.toFixed(2)}, ${rmax.toFixed(2)}] → ` +
      `${flat && stable ? 'OK' : 'FAIL'}`,
  );
  // (b) Dark energy has a turnaround radius r_ta = (M/Λ)^(1/3): net pull is inward below it, outward
  //     above it (the outer bodies unbind).
  const L = DARK_ENERGY_MAX;
  const rta = Math.cbrt(G * M / L);
  const radial = (r) => accel([r, 0, 0], 0, 0, L)[0]; // x-component = radial accel (>0 outward)
  const inside = radial(rta * 0.5) < 0;
  const outside = radial(rta * 1.5) > 0;
  ok = inside && outside && ok;
  console.log(
    `  dark energy (Λ=${L}): turnaround r_ta=${rta.toFixed(1)} — inward at ${(rta * 0.5).toFixed(1)} ` +
      `(${inside ? '✓' : '✗'}), outward at ${(rta * 1.5).toFixed(1)} (${outside ? '✓' : '✗'}) → ` +
      `${inside && outside ? 'OK' : 'FAIL'}`,
  );
  return ok;
}

console.log('N-body velocity-Verlet: circular orbits over 10 periods\n');
let allOk = true;
for (const r of [20, 30, 42]) allOk = runCircular(r) && allOk;

console.log('\nRoadmap #7: r^-3 apsidal precession vs the closed form Δφ = 2π(√(1+k/r) − 1)\n');
for (const r of [20, 30]) allOk = runPrecession(r) && allOk;

console.log('\nRoadmap #12/#13: dark matter flattens the rotation curve; dark energy has a turnaround radius\n');
allOk = runDarkSector() && allOk;

if (!allOk) {
  console.error('\nFAIL: an orbit check did not pass.');
  process.exit(1);
}
console.log('\nAll orbit checks passed.');
