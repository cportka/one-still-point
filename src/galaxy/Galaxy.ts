/**
 * Galaxy Mode (roadmap #9): a small full galaxy — ~1000 stars, some with a planet, all orbiting a
 * central supermassive black hole. This is the **pure** core: it generates the star system and
 * advances it each frame, writing positions into a flat `Float32Array` the render layer uploads.
 * No three.js, no DOM — fully unit-testable.
 *
 * The stars are **test particles** in the central potential (they don't pull on each other — that
 * would be O(N²) = a million pairs a frame), each on its own inclined Kepler orbit: position =
 * r · (cos φ · û + sin φ · ŵ), with φ advancing at the Kepler rate Ω = √(M/r³). That single
 * fact makes the galaxy cheap *and* correct-looking: inner stars sweep faster than outer ones, so
 * an initial two-arm spiral **shears and winds** over time exactly as a real differentially-
 * rotating disk does.
 *
 * Distribution: an exponential-ish surface density (more stars inward), a thin vertical spread
 * (small random inclinations → disk thickness), a mild **two-arm logarithmic spiral** bias on the
 * initial phase (what reads as "a galaxy"), and hotter/bluer inner → cooler/redder outer colours.
 * A fraction of stars carry one small planet orbiting them.
 *
 * The **mode transition** rides a single `reveal` 0→1 that scales every orbit radius from 0 (all
 * mass at the centre) out to full — a galaxy blooming from the seed. Eased + brightened mid-way by
 * the render layer.
 */

export interface GalaxyOptions {
  count?: number;
  planetFraction?: number;
  rInner?: number;
  rOuter?: number;
  /** Central mass in sim units (sets the orbital rate). */
  centralMass?: number;
  /** Injectable RNG for deterministic tests (defaults to Math.random). */
  rng?: () => number;
}

const TWO_PI = Math.PI * 2;
const SPIRAL_TWIST = 3.4; // radians of arm wind per e-fold in radius (the arm tightness)
const ARM_JITTER = 0.5; // radians of scatter off the arm centre (loose, gassy arms)

export class Galaxy {
  readonly count: number;
  readonly planetCount: number;
  /** Total render points = stars + planets. */
  readonly total: number;
  /** The disk's inner gap and outer edge (sim units) — the render layer frames the camera to these. */
  readonly rInner: number;
  readonly rOuter: number;

  // Per-point orbital state (index 0..count-1 = stars, then planets). Flat arrays for cache-friendly
  // per-frame advance; the render layer reads `positions` + the static `colors`/`sizes`.
  private readonly r: Float32Array;
  private readonly phase: Float32Array;
  private readonly omega: Float32Array;
  // Orbital-plane basis per point (û, ŵ) — the inclined orbit's two in-plane axes.
  private readonly ux: Float32Array;
  private readonly uy: Float32Array;
  private readonly uz: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly wz: Float32Array;
  // A planet's parent star index (−1 for a star). A planet's r/phase/omega are about its PARENT,
  // so its world position is parent + planet-orbit — see update().
  private readonly parent: Int32Array;

  readonly positions: Float32Array; // total × 3, written each update()
  readonly colors: Float32Array; // total × 3, static
  readonly sizes: Float32Array; // total, static (world-ish point size)

  constructor(opts: GalaxyOptions = {}) {
    const count = opts.count ?? 1000;
    const planetFraction = opts.planetFraction ?? 0.15;
    // A compact disk (rOuter 64, not 140): the whole galaxy frames within the camera's reach so it
    // reads as a legible spiral instead of a scatter of far, sub-pixel stars ("too small to see").
    const rInner = opts.rInner ?? 6;
    const rOuter = opts.rOuter ?? 64;
    const M = opts.centralMass ?? 1;
    const rng = opts.rng ?? Math.random;

    const planetCount = Math.round(count * planetFraction);
    const total = count + planetCount;
    this.count = count;
    this.planetCount = planetCount;
    this.total = total;
    this.rInner = rInner;
    this.rOuter = rOuter;

    this.r = new Float32Array(total);
    this.phase = new Float32Array(total);
    this.omega = new Float32Array(total);
    this.ux = new Float32Array(total);
    this.uy = new Float32Array(total);
    this.uz = new Float32Array(total);
    this.wx = new Float32Array(total);
    this.wy = new Float32Array(total);
    this.wz = new Float32Array(total);
    this.parent = new Int32Array(total).fill(-1);
    this.positions = new Float32Array(total * 3);
    this.colors = new Float32Array(total * 3);
    this.sizes = new Float32Array(total);

    // ── Stars ───────────────────────────────────────────────────────────────────────────────
    for (let i = 0; i < count; i++) {
      // Exponential-ish radius: more stars inward, capped at the outer edge.
      const u = rng();
      const rr = Math.min(rOuter, rInner + (rOuter - rInner) * Math.pow(u, 1.7));
      this.r[i] = rr;

      // Two-arm log-spiral initial phase + scatter → visible arms that then shear.
      const arm = i % 2 === 0 ? 0 : Math.PI;
      const spiral = SPIRAL_TWIST * Math.log(rr / rInner);
      this.phase[i] = spiral + arm + (rng() - 0.5) * 2 * ARM_JITTER + rng() * 0.001;

      // Kepler rate (all prograde — one coherent disk spin).
      this.omega[i] = Math.sqrt(M / (rr * rr * rr));

      // A thin disk: a small random inclination about a random node.
      const inc = (rng() - 0.5) * 0.18; // ±~5° — a thin disk with a little puff
      const node = rng() * TWO_PI;
      this.setBasis(i, inc, node);

      // Colour: hotter/bluer inner → cooler/redder outer, with scatter. HDR-ish (values > 1 so
      // the additive layer + bloom give the core its glow).
      const t = (rr - rInner) / (rOuter - rInner); // 0 inner … 1 outer
      const warm = 0.55 + t * 0.5; // more red outward
      const cool = 1.15 - t * 0.55; // more blue inward
      const jig = 0.85 + rng() * 0.4;
      this.colors[i * 3] = warm * jig;
      this.colors[i * 3 + 1] = (0.85 + rng() * 0.2) * jig;
      this.colors[i * 3 + 2] = cool * jig;
      // Size: mostly small, a few brighter; inner disk a touch bigger (the bulge reads denser).
      this.sizes[i] = (0.5 + Math.pow(rng(), 3) * 2.2) * (1 + (1 - t) * 0.6);
    }

    // ── Planets: attach one to the first `planetCount` stars ────────────────────────────────
    for (let k = 0; k < planetCount; k++) {
      const idx = count + k;
      const star = k; // deterministic parent — the first planetCount stars each get one
      this.parent[idx] = star;
      const pr = 1.6 + rng() * 2.4; // small orbit about the star
      this.r[idx] = pr;
      this.phase[idx] = rng() * TWO_PI;
      this.omega[idx] = Math.sqrt(0.02 / (pr * pr * pr)); // a light star's field — a gentle planet rate
      const inc = (rng() - 0.5) * 0.9;
      const node = rng() * TWO_PI;
      this.setBasis(idx, inc, node);
      // Planets: dim, cool, tiny.
      this.colors[idx * 3] = 0.5;
      this.colors[idx * 3 + 1] = 0.62;
      this.colors[idx * 3 + 2] = 0.9;
      this.sizes[idx] = 0.35 + rng() * 0.25;
    }

    this.update(0, 1); // seed positions at full reveal
  }

  /** Set point `i`'s inclined orbital-plane basis (û in the disk plane rotated by `node`, tilted
   *  by `inc`; ŵ perpendicular in-plane). */
  private setBasis(i: number, inc: number, node: number): void {
    const cn = Math.cos(node);
    const sn = Math.sin(node);
    const ci = Math.cos(inc);
    const si = Math.sin(inc);
    // û: the node direction in the disk plane. ŵ: tilted out of plane by inc.
    this.ux[i] = cn;
    this.uy[i] = 0;
    this.uz[i] = sn;
    this.wx[i] = -sn * ci;
    this.wy[i] = si;
    this.wz[i] = cn * ci;
  }

  /**
   * Advance the galaxy by `dt` seconds at `timeScale`, with the orbits scaled by `reveal` (0 = all
   * at the centre, 1 = full disk — the mode-transition bloom). Writes `positions`.
   */
  update(dt: number, timeScale: number, reveal = 1): void {
    const pos = this.positions;
    const step = dt * timeScale;
    // Stars first (planets read their parent's fresh position).
    for (let i = 0; i < this.count; i++) {
      this.phase[i] = this.phase[i]! + this.omega[i]! * step;
      const rr = this.r[i]! * reveal;
      const c = Math.cos(this.phase[i]!);
      const s = Math.sin(this.phase[i]!);
      pos[i * 3] = rr * (c * this.ux[i]! + s * this.wx[i]!);
      pos[i * 3 + 1] = rr * (c * this.uy[i]! + s * this.wy[i]!);
      pos[i * 3 + 2] = rr * (c * this.uz[i]! + s * this.wz[i]!);
    }
    for (let i = this.count; i < this.total; i++) {
      const p = this.parent[i]!;
      this.phase[i] = this.phase[i]! + this.omega[i]! * step;
      const rr = this.r[i]! * reveal;
      const c = Math.cos(this.phase[i]!);
      const s = Math.sin(this.phase[i]!);
      pos[i * 3] = pos[p * 3]! + rr * (c * this.ux[i]! + s * this.wx[i]!);
      pos[i * 3 + 1] = pos[p * 3 + 1]! + rr * (c * this.uy[i]! + s * this.wy[i]!);
      pos[i * 3 + 2] = pos[p * 3 + 2]! + rr * (c * this.uz[i]! + s * this.wz[i]!);
    }
  }
}
