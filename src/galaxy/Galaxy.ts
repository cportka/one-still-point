/**
 * Galaxy Mode (roadmap #9): a small full **spiral galaxy** — a glowing warm bulge, blue-white
 * spiral arms, a redder outer halo, and a scatter of planets, all orbiting a central supermassive
 * black hole. This is the **pure** core: it generates the star system and advances it each frame,
 * writing positions into a flat `Float32Array` the render layer uploads. No three.js, no DOM —
 * fully unit-testable.
 *
 * The stars are **test particles** in the central potential (they don't pull on each other — that
 * would be O(N²) = a million pairs a frame), each on its own inclined Kepler orbit: position =
 * r · (cos φ · û + sin φ · ŵ), with φ advancing at the Kepler rate Ω = √(M/r³). That single
 * fact makes the galaxy cheap *and* correct-looking: inner stars sweep faster than outer ones, so
 * the initial spiral **shears and winds** over time exactly as a real differentially-rotating disk
 * does.
 *
 * ── The realistic-spiral look (v2) ────────────────────────────────────────────────────────────
 * Three stellar populations give it structure instead of a uniform scatter of white pinpoints:
 *   • **Bulge** — a dense, puffy, *warm gold* core packed inside `rInner`. Many overlapping
 *     additive points + bloom read as a glowing centre (no more "dark central area").
 *   • **Arms** — most disk stars are concentrated onto a **two-arm logarithmic spiral** (a
 *     density-wave bias, not uniform jitter), coloured **blue-white** (young, hot stars) with the
 *     occasional bright blue O/B supergiant sparkling along the arm.
 *   • **Disk + halo** — the rest fill the inter-arm disk (older, warmer, dimmer), fading to a dim
 *     **red halo** at the outer edge.
 *
 * The **mode transition** rides a single `reveal` 0→1 that scales every orbit radius from 0 (all
 * mass at the centre) out to full — a galaxy blooming from the seed. Eased + brightened by the
 * render layer.
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
const SPIRAL_TWIST = 2.8; // radians of arm wind per e-fold in radius (the arm tightness)
const ARM_WIDTH = 0.5; // radians of scatter about the arm centre (tighter = crisper arms)
const ARM_FRACTION = 0.72; // fraction of disk stars pulled onto an arm (rest fill the inter-arm disk)
const BULGE_FRACTION = 0.3; // fraction of stars in the central warm bulge
const OB_CHANCE = 0.045; // chance an on-arm star is a bright blue O/B supergiant

export class Galaxy {
  readonly count: number;
  readonly planetCount: number;
  /** How many of the `count` stars are bulge stars (the warm core). The rest are disk/arm stars. */
  readonly bulgeCount: number;
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
    const count = opts.count ?? 1600;
    const planetFraction = opts.planetFraction ?? 0.1;
    // A compact disk (rOuter 64, not 140): the whole galaxy frames within the camera's reach so it
    // reads as a legible spiral instead of a scatter of far, sub-pixel stars ("too small to see").
    const rInner = opts.rInner ?? 6;
    const rOuter = opts.rOuter ?? 64;
    const M = opts.centralMass ?? 1;
    const rng = opts.rng ?? Math.random;

    const planetCount = Math.round(count * planetFraction);
    const bulgeCount = Math.round(count * BULGE_FRACTION);
    const diskCount = count - bulgeCount;
    const total = count + planetCount;
    this.count = count;
    this.planetCount = planetCount;
    this.bulgeCount = bulgeCount;
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

    // ── Disk / arm stars (indices 0 … diskCount-1) ──────────────────────────────────────────────
    // Placed first so the planet-attach loop (parent = k) hangs planets on disk stars, not the bulge.
    for (let i = 0; i < diskCount; i++) {
      // Exponential-ish radius: more stars inward, capped at the outer edge, floored at rInner so
      // the disk starts where the bulge ends (a clean core-then-disk profile).
      const u = rng();
      const rr = Math.min(rOuter, rInner + (rOuter - rInner) * Math.pow(u, 1.6));
      this.r[i] = rr;
      const t = (rr - rInner) / (rOuter - rInner); // 0 inner disk … 1 outer edge

      // Two-arm log-spiral phase. A density-wave bias: most stars land *on* an arm (a tight,
      // centre-peaked scatter — sum of three uniforms ≈ a bell), the rest fill the inter-arm disk.
      const arm = i % 2 === 0 ? 0 : Math.PI;
      const spiral = SPIRAL_TWIST * Math.log(rr / rInner);
      const onArm = rng() < ARM_FRACTION;
      const bell = (rng() + rng() + rng() - 1.5) / 1.5; // ≈ gaussian in [-1, 1], peaked at 0
      const off = onArm ? bell * ARM_WIDTH : (rng() - 0.5) * TWO_PI; // on-arm scatter vs. free
      this.phase[i] = spiral + arm + off;

      // Kepler rate (all prograde — one coherent disk spin).
      this.omega[i] = Math.sqrt(M / (rr * rr * rr));

      // A thin disk: a small random inclination about a random node (a little puff outward).
      const inc = (rng() - 0.5) * (0.1 + t * 0.14);
      this.setBasis(i, inc, rng() * TWO_PI);

      // Colour: blue-white on the arms (young, hot), warmer & dimmer between; the outer edge reddens
      // into a dim halo. HDR-ish (values may exceed 1 so the additive layer + bloom carry the glow).
      let R: number;
      let G: number;
      let B: number;
      if (onArm) {
        R = 0.7;
        G = 0.86;
        B = 1.3; // blue-white
      } else {
        R = 0.96;
        G = 0.84;
        B = 0.74; // older, warmer inter-arm disk
      }
      const red = t * t; // reddening/dimming concentrated in the outer halo
      R = R * (1 - 0.12 * red) + 0.6 * red;
      G = G * (1 - 0.34 * red) + 0.32 * red;
      B = B * (1 - 0.72 * red) + 0.24 * red;
      const bright = (onArm ? 1.15 : 0.82) * (1 - 0.42 * t); // arms punchier; whole disk dims outward
      const jig = 0.85 + rng() * 0.35;
      R *= bright * jig;
      G *= bright * jig;
      B *= bright * jig;

      let size = 0.4 + Math.pow(rng(), 3) * 2.4;
      if (!onArm) size *= 0.8;
      // A rare bright blue O/B supergiant sparkling along an arm.
      if (onArm && rng() < OB_CHANCE) {
        R = 0.75 * 1.7;
        G = 0.9 * 1.7;
        B = 1.75;
        size *= 2.3;
      }
      this.colors[i * 3] = R;
      this.colors[i * 3 + 1] = G;
      this.colors[i * 3 + 2] = B;
      this.sizes[i] = size;
    }

    // ── Bulge stars (indices diskCount … count-1) ───────────────────────────────────────────────
    // A dense, puffy, warm core packed inside rInner — the glowing centre. Many overlapping additive
    // points + bloom read as a continuous bulge rather than discrete dots.
    for (let i = diskCount; i < count; i++) {
      const u = rng();
      const rr = 0.5 + (rInner - 0.5) * Math.pow(u, 2.2); // strongly centrally concentrated, < rInner
      this.r[i] = rr;
      const c = 1 - (rr - 0.5) / (rInner - 0.5); // 1 at the very centre … 0 at the bulge edge

      this.phase[i] = rng() * TWO_PI; // no arms in the bulge
      this.omega[i] = Math.sqrt(M / (rr * rr * rr));
      const inc = (rng() - 0.5) * 1.0; // ±~0.5 rad — a puffy, near-spheroidal bulge
      this.setBasis(i, inc, rng() * TWO_PI);

      // Warm gold, brighter and redder toward the very centre.
      const jig = 0.85 + rng() * 0.3;
      this.colors[i * 3] = (1.15 + 0.55 * c) * jig;
      this.colors[i * 3 + 1] = (0.8 + 0.28 * c) * jig;
      this.colors[i * 3 + 2] = (0.45 + 0.12 * c) * jig;
      this.sizes[i] = (0.8 + c * 1.6) * (0.7 + rng() * 0.6);
    }

    // ── Planets: attach one to the first `planetCount` (disk) stars ─────────────────────────────
    for (let k = 0; k < planetCount; k++) {
      const idx = count + k;
      const star = k; // deterministic parent — the first planetCount disk stars each get one
      this.parent[idx] = star;
      const pr = 1.6 + rng() * 2.4; // small orbit about the star
      this.r[idx] = pr;
      this.phase[idx] = rng() * TWO_PI;
      this.omega[idx] = Math.sqrt(0.02 / (pr * pr * pr)); // a light star's field — a gentle planet rate
      const inc = (rng() - 0.5) * 0.9;
      this.setBasis(idx, inc, rng() * TWO_PI);
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
