import { Vector3 } from 'three';
import { smoothstep } from '../core/mathUtils';
import { SOFTENING2 } from '../physics/integrators';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import type { Body, BodyType } from './Body';
import { createBlackHole, type BlackHole } from './BlackHole';

const PRIMARY_MASS = 1; // gravitational mass of the hole (geometric units, = M)
const DEFAULT_STARS = 3; // the default load-in line-up (a fresh page + Galaxy-Mode exit)
const DEFAULT_PLANETS = 3;

/**
 * How many of a body type may be added, given how many black holes already orbit
 * (and, for holes, how many stars/planets are present). Black holes are the
 * budget — at most 4, but the fourth only when nothing else orbits (no stars or
 * planets), otherwise 3 — and the more holes there are the fewer stars/planets
 * are allowed (at 4 holes, nothing else).
 */
export function bodyCap(type: BodyType, holeCount: number, otherCount = 0): number {
  if (type === 'hole') return otherCount === 0 ? 4 : 3;
  if (holeCount >= 4) return 0;
  if (holeCount === 3) return 3;
  if (holeCount === 2) return 4;
  return 5; // 0–1 holes
}

// A companion is gone once it is flung far past the scene (escaped) or has fallen
// in to the centre (merged) — at which point its memory and slot are freed.
const ESCAPE_RADIUS = 300;
const MERGE_RADIUS = 3;
// Body-body contact (roadmap #8): two companions merge when their surfaces touch (× slack, so a
// grazing pass still catches). A hole always wins; otherwise the heavier body absorbs the lighter.
// Exported: the compile-ahead conjunction predictor (render/fullShaderNeed) measures predicted
// passes against this same contact distance, so the two can't drift apart.
export const CONTACT_FACTOR = 1.15;
// Seconds a merged companion spends being absorbed (held still, shrinking and
// redshifting in the shader) before it is finally freed — so it eases out of the
// scene rather than popping out of existence the instant it reaches the centre.
const ABSORB_DURATION = 0.6;
// Liquid coalescence (v0.101.0 — "at that size a collision should be more liquid, like two heavy
// drops"): two NON-hole bodies that touch no longer merge on the contact frame. They enter a
// **melding** window — glued to their common centre of mass (momentum-conserving), the gap between
// them easing closed while the renderer bridges their surfaces with a growing liquid neck — and
// the real merge (mass sum, TOV test, flash, dust) fires when the window completes. Wall-clock
// seconds, like the plunge/absorb clocks, so the coalescence reads the same at any Speed.
const MELD_DURATION = 1.1;
// By the end of the meld the centre gap has eased down to this fraction of the summed radii — a
// deep overlap (the neck has swallowed the waist), so the completion's absorb fade reads as the
// last of the smaller drop sinking into the remnant rather than a body vanishing.
const MELD_END_GAP_FRAC = 0.45;
// If a scrub/restore teleports the melding pair apart (beyond this × the contact distance), the
// meld is stale — drop it rather than yank the restored bodies back together.
const MELD_BREAK_FACTOR = 3;
// The merged drop rings — its fundamental l = 2 mode (prolate/oblate along the collision axis) —
// for this long (wall-clock) before it settles spherical. Purely cosmetic; see bodyUniforms.
const WOBBLE_DURATION = 2.2;
// Seconds the user-removed (− stepper) body's spiral takes to wind from its orbit
// down to the merge radius, where it hands off to the *same* absorption a natural
// merge uses. A long, graceful inspiral (the body reaches the centre in ~0.8 of
// this, then the absorption fade adds ~ABSORB_DURATION on top).
const PLUNGE_DURATION = 4.5;
// A companion BLACK HOLE's plunge is the overwhelming one (live review): nearly twice as long —
// a longer descent, roughly twice the fast horizon loops in the finale, a slower final dive —
// while its dragged accretion structure rips at 2.4× the arc (bodyUniforms' RIP_SCALE_HOLE) and
// the absorb fires the biggest, longest spacetime ripple (rippleStrengthForMass + the √strength
// ringdown stretch in background.ts).
const PLUNGE_DURATION_HOLE = 8;
// The − stepper's tap-guard: how far into a plunge the − button stays blocked (a fraction of
// PLUNGE_DURATION). It's a short debounce so rapid − presses can send bodies diving in quick
// succession — NOT an animation lock. Halved 0.12 → 0.06 (~0.54s → ~0.27s at PLUNGE_DURATION 4.5s)
// so bodies can be plunged roughly twice as fast (live review: the release still felt too slow).
const PLUNGE_GUARD_FRACTION = 0.06;
// The plunge spiral's spin comes from the *body's own motion* (its real angular rate at the
// moment − was pressed — direction and speed), accelerating as it falls like a true infall
// (Kepler sweep, ω ∝ r^{-3/2}): no visible kick at the start, a quickening dive. This floor on
// the *fractional* radius caps that acceleration (0.15^{-3/2} ≈ 17× the starting rate) — lowered
// from 0.22 so the finale's circular loops (below) whip around "really quickly".
const PLUNGE_KEPLER_FLOOR = 0.15;
// The plunge's three acts (fractions of PLUNGE_DURATION): a graceful DESCENT out of the orbit,
// then a **hold on a perfect circle** just above the horizon — the torn light-streak lingers and
// loops around a few fast times (the Kepler cap above sets how fast) — then the final DIVE through
// the merge radius into the absorption spark + ripple.
const PLUNGE_DESCEND_END = 0.5;
const PLUNGE_LOOP_END = 0.92;
// Radius of the finale loop, just above the merge radius (so the loop visibly hugs the horizon but
// the absorb — gated on reaching MERGE_RADIUS — waits for the final dive).
const PLUNGE_LOOP_RADIUS = MERGE_RADIUS * 1.25;
// "Plunge into" homing (click-select a body, then click another): the chaser is scripted straight at
// its target, accelerating, until their surfaces touch and the body-body merge fires — a way to
// stage a collision. Deliberately brisk so it lands within a second or two.
const CHASE_SPEED0 = 8; // starting homing speed (world units/s)
const CHASE_ACCEL = 42; // homing acceleration (world units/s²)
// The Tolman–Oppenheimer–Volkoff limit: the maximum mass a cold, non-rotating neutron star can hold
// against gravity — modern estimates put it at ~2.1–2.3 M☉ (we use the middle). When two NON-hole
// bodies merge with a combined `msun` above this, no equation of state can save the remnant: the
// merger COLLAPSES into a black hole (a distinct icy-white formation flash + a newborn hole with
// its own lensing + mini-disk), instead of leaving a bigger star.
const TOV_LIMIT_MSUN = 2.17;
// A star's solar mass is randomized in [0.9, 1.8) M☉ at creation — so a typical star+star merger
// (1.8–3.6 M☉ combined) usually collapses, while star+planet (planets carry ~0.001 M☉, a Jupiter)
// never does. A collapsed hole takes the ADDED-hole simulation mass/lensing (0.2) so it perturbs,
// captures, and lenses exactly like a hole the user adds — the toy's one consistent hole scale.
const STAR_MSUN_MIN = 0.9;
const STAR_MSUN_SPAN = 0.9;
const PLANET_MSUN = 0.001;
const COLLAPSED_HOLE_MASS = 0.2;
// Same visual radius as an added hole: at 1.2 the newborn's mini-disk (radius×1.7…5.5) was small
// enough to miss entirely at typical camera range — the capture read as "both bodies vanished".
const COLLAPSED_HOLE_RADIUS = 1.5;

/**
 * The scene graph: the primary black hole (body 0, fixed at the origin) plus any
 * orbiting companions, all driven by the N-body PhysicsEngine. Companions are
 * placed on circular orbits beyond the disk; `addStar` / `addPlanet` is the
 * single-call "add a body via the UI" the Phase 5 plan asks for.
 */
/** A transient event worth marking on the scrub-bar timeline: a body added (by its
 *  type), absorbed at the centre, or flung clear of the scene. */
export type SceneEvent = BodyType | 'absorb' | 'escape' | 'rescue' | 'merge' | 'collapse';

/** The immutable identity of a body — enough to *revive* one the timeline rewinds back across an
 *  absorption/removal (its kinematics come from the History frame). Kept per id forever, so a body
 *  that fell in can be put back exactly where it was when you scrub before the merger. */
interface BodyTemplate {
  id: number;
  type: BodyType;
  mass: number;
  lensMass: number;
  radius: number;
  color: Vector3;
}

export class Scene {
  readonly blackHole: BlackHole;
  readonly physics: PhysicsEngine;
  bodies: Body[] = [];
  /** The currently *highlighted* companion (click-to-select): the shader brightens it (via a boosted
   *  emissive in `updateBodyUniforms`), and the next click resolves it — click it again to plunge it
   *  to the centre, or click another body to plunge this one into that one. `null` = nothing selected.
   *  Read by both render paths' `updateBodyUniforms`; each path owns its own selection. */
  selected: Body | null = null;
  /** The companion the pointer is currently hovering (a fine-pointer affordance — the host sets it on
   *  pointermove). The shader gives it a *soft* highlight — a gentle "you can click this" lift, milder
   *  than the click-{@link selected} state — via `updateBodyUniforms`. `null` = nothing hovered. */
  hovered: Body | null = null;
  private nextId = 1;
  /** Every movable body ever created, by id — so `restoreRoster` can revive absorbed/removed ones
   *  when the timeline rewinds across the event that took them out. */
  private readonly registry = new Map<number, BodyTemplate>();
  /** Fired when the body set changes during simulation (pruning), so the UI
   *  count can refresh. */
  onChange?: () => void;
  /** Fired to **centre the view** on a body (the "one still point" gesture): tap a body then tap it
   *  again → focus the camera on it (it tracks as it orbits); tap the central hole twice → `null`
   *  (re-centre on the origin/primary). The host wires this to `CameraRig.focusOn`. */
  onFocus?: (body: Body | null) => void;
  /** Fired for a transient event worth marking on the history timeline — a body
   *  added (by type), absorbed at the centre, or flung clear (escaped). The absorbed/added
   *  body is passed along (when there is one) so the host can scale the merger ripple by its
   *  mass — a black-hole merger rings harder than a star plunge (roadmap #6). */
  onEvent?: (event: SceneEvent, body?: Body) => void;
  /** Fired at a **companion-companion merge** (roadmap #8 body-body): a bright flash pops at the
   *  contact point. `kind` is `'hole'` when a black hole is the victor (blue-white, brighter) or
   *  `'body'` for a star/planet collision (warm white); `strength` scales with the combined mass.
   *  The host lights the merge-flash uniforms; distinct from `onEvent` (the timeline tick). */
  onMerge?: (x: number, y: number, z: number, kind: 'hole' | 'body' | 'collapse', strength: number) => void;
  /** Fired when a **drop coalescence completes** (two non-hole bodies — a collapse included): the
   *  impact throws a lingering **dust cloud** at the contact point. `(x,y,z)` the contact point,
   *  `(ax,ay,az)` the unit collision axis (the cloud splashes hardest in the plane ⊥ to it),
   *  `strength` an intensity scale, `r0` the summed pre-merge radii (the cloud's seed size). The
   *  host lights the dust uniforms; it long outlives the flash. */
  onDust?: (
    x: number, y: number, z: number,
    ax: number, ay: number, az: number,
    strength: number, r0: number,
    /** The remnant's centre-of-mass velocity (SIM units): debris carries the momentum of what made
     *  it, so the cloud DRIFTS with the survivor instead of hanging at the contact point. */
    vx: number, vy: number, vz: number,
  ) => void;
  /** Fired **at the start** of a user-initiated body edit (an add, or a − removal's first frame),
   *  *before* it takes effect — so the host can commit any in-progress history replay: a live edit
   *  while scrubbed makes the scrubbed moment the new live edge (the recorded future is discarded).
   *  Distinct from `onEvent` (which marks the moment *after*); the seeded line-up never fires it. */
  onUserEdit?: () => void;
  /** True while `seed()` populates the default / reseeded line-up, so those bulk adds
   *  don't each fire an `onEvent` (only user-driven adds are timeline events). */
  private seeding = false;
  /** The one in-flight liquid coalescence (see MELD_DURATION) — two touching drops glued to their
   *  COM while the gap closes; `performMerge` fires at t = 1. Ids (not references): the body list
   *  is live, and a stale reference after a scrub/restore must invalidate, not act. */
  private meld: { aId: number; bId: number; t: number; d0: number; axis: Vector3 } | null = null;
  // Scratch vectors for the per-frame meld constraint (no per-frame allocation).
  private readonly meldV = new Vector3();
  private readonly meldC = new Vector3();

  /** The in-flight coalescence for the renderer (the liquid neck bridging the pair), resolved to
   *  live bodies — `null` when nothing melds or a reference went stale. `t` is the meld's 0→1.
   *  The break-distance check lives HERE too (not just advanceMeld): a scrub/replay teleports
   *  bodies through History.restore without ever running prune, and without this the shader kept
   *  drawing the neck between the separated pair for the whole drag — then snapped them back
   *  together on resume (adversarial review #1). A broken meld heals on the very next read. */
  get melding(): { a: Body; b: Body; t: number } | null {
    const m = this.meld;
    if (!m) return null;
    const a = this.bodies.find((x) => x.id === m.aId);
    const b = this.bodies.find((x) => x.id === m.bId);
    if (!a || !b) return null;
    if (a.position.distanceTo(b.position) > Math.max(m.d0, a.radius + b.radius) * MELD_BREAK_FACTOR + 1) {
      this.meld = null; // self-heal: the pair was teleported apart — the meld is stale
      return null;
    }
    return { a, b, t: m.t };
  }

  /** Whether a body is one half of the in-flight coalescence — gestures must not fight the glue. */
  private isMeldMember(b: Body): boolean {
    return this.meld !== null && (this.meld.aId === b.id || this.meld.bId === b.id);
  }

  constructor() {
    this.blackHole = createBlackHole();
    this.bodies.push({
      id: 0,
      type: 'hole',
      mass: PRIMARY_MASS,
      lensMass: 0, // the primary is lensed exactly by the Schwarzschild metric, not weak-field
      fixed: true,
      position: new Vector3(0, 0, 0),
      velocity: new Vector3(),
      radius: 2,
      color: new Vector3(),
    });
    this.physics = new PhysicsEngine(this.bodies);
    this.seed(DEFAULT_STARS, DEFAULT_PLANETS, 0);
  }

  /** Seed a fresh set of companions on well-separated orbits: outer prograde
   *  stars (the load-in swoosh) + inner retrograde planets (the reverse swoosh).
   *  Used both for the default load and by `reseed` (Replay intro).
   *  ⚠️ Ring spacing (v0.94.1): the bands must not interleave — the old lay-out put star #1 at
   *  r=28 *between* planets at 27 and 32, so a prograde star and a retrograde planet orbited
   *  1 unit apart and genuinely collided mid-intro in ~40% of loads (random azimuths). Radial
   *  gap is a hard floor on 3D separation (||a|−|b| ≤ |a−b|), so with planets on 21/25.5/30 and
   *  stars on 35/41.5/48 the tightest counter-rotating gap is 5 — clear of both contact
   *  (~2.3–2.8) and the compile-ahead conjunction threshold (contact × 1.5).
   *  ⟳ Intro look: the counts/radii here shape the load intro — changing them
   *  substantially → update docs/intro-script.md (the master beats + tuning log). */
  private seed(stars: number, planets: number, holes: number): void {
    this.seeding = true; // a bulk line-up, not individual timeline events
    try {
      for (let i = 0; i < stars; i++) this.addStar(35 + i * 6.5);
      for (let i = 0; i < planets; i++) this.addPlanet(21 + i * 4.5);
      for (let i = 0; i < holes; i++) this.addBlackHole();
    } finally {
      this.seeding = false;
    }
  }

  /** Re-seed the *current* composition on fresh orbits, so Replay intro shows
   *  the same kind of intro as a page load (identical for the default 3 + 3). */
  reseed(): void {
    const n = { star: 0, planet: 0, hole: 0 };
    for (const b of this.companions) n[b.type] += 1;
    this.clearCompanions();
    this.seed(n.star, n.planet, n.hole);
  }

  /** Reseed the **default** line-up — a fresh random 3 stars + 3 planets — regardless of the current
   *  composition. Used when exiting Galaxy Mode, which cleared every companion, so plain `reseed`
   *  (which mirrors the *current*, now-empty composition) would restore nothing. */
  reseedDefault(): void {
    this.clearCompanions();
    this.seed(DEFAULT_STARS, DEFAULT_PLANETS, 0);
  }

  /** Everything orbiting the primary — stars, planets, and any added black hole.
   *  The primary (body 0) is the only fixed body, so movability is the divide
   *  (a secondary hole is type 'hole' too, but it orbits and must render). */
  get companions(): Body[] {
    return this.bodies.filter((b) => !b.fixed);
  }

  /** Count of orbiting (non-primary) black holes. */
  private holeCount(): number {
    return this.bodies.filter((b) => !b.fixed && b.type === 'hole').length;
  }

  /** Pick an orbit radius in [min, max] that *prefers a stable orbit*: the middle of the widest
   *  radial gap between the companions already there (and the band's edges), plus a little jitter so
   *  repeated adds don't stack on one ring. Radial separation is what keeps a newcomer from an early
   *  close encounter (the thing that scatters orbits) — the seeded intro line-up already hand-picks
   *  separated radii, so this is for *user* adds, which used to land anywhere at random. */
  private openOrbitRadius(min: number, max: number): number {
    const taken = this.companions
      .map((b) => b.position.length())
      .filter((r) => Number.isFinite(r))
      .sort((a, b) => a - b);
    // Walk the sorted radii as gap edges (band edges included); track the widest gap's centre.
    let bestMid = (min + max) / 2;
    let bestGap = 0;
    let prev = min;
    for (const r of [...taken, max]) {
      const lo = Math.max(min, Math.min(max, prev));
      const hi = Math.max(min, Math.min(max, r));
      if (hi - lo > bestGap) {
        bestGap = hi - lo;
        bestMid = (lo + hi) / 2;
      }
      prev = Math.max(prev, r);
    }
    const jitter = bestGap * 0.15 * (Math.random() - 0.5); // stay well inside the gap
    return bestMid + jitter;
  }

  addStar(orbitRadius = this.openOrbitRadius(26, 48)): Body {
    const warm = Math.random() < 0.5;
    const tint = warm ? new Vector3(1.0, 0.84, 0.62) : new Vector3(0.7, 0.82, 1.0);
    // HDR colour → blooms; test-particle mass; too light to lens (lensMass 0).
    const star = this.addBody('star', orbitRadius, 1.2, tint.multiplyScalar(7), 1e-3, 0);
    star.msun = STAR_MSUN_MIN + Math.random() * STAR_MSUN_SPAN; // 0.9–1.8 M☉ — the TOV bookkeeping
    return star;
  }

  addPlanet(orbitRadius = this.openOrbitRadius(20, 44)): Body {
    // Planets orbit retrograde — the reverse-direction swoosh vs the stars. Size is slightly
    // randomized, and the size picks the surface family: big → a banded GAS giant
    // (Jupiter/Neptune/Uranus palette), small → mottled ROCK (Mars/Earth/regolith palette) —
    // so planets read as planets, distinct from the stars' bloomy emissive look.
    const radius = 0.45 + Math.random() * 0.35; // 0.45 … 0.8
    const look: 'gas' | 'rock' = radius >= 0.62 ? 'gas' : 'rock';
    const palette =
      look === 'gas'
        ? [new Vector3(0.85, 0.68, 0.45), new Vector3(0.32, 0.46, 0.95), new Vector3(0.55, 0.82, 0.85)] // Jupiter tan · Neptune blue · Uranus cyan
        : [new Vector3(0.85, 0.45, 0.28), new Vector3(0.36, 0.55, 0.75), new Vector3(0.62, 0.58, 0.52)]; // Mars rust · Earth blue · regolith gray
    // ×0.95 (was 1.2): the brighter base clipped toward white under bloom + tone mapping, washing
    // the surface pattern out (the screenshots' pale discs). The v2 two-tone tint carries contrast.
    const color = palette[Math.floor(Math.random() * palette.length)]!.clone().multiplyScalar(0.95);
    const planet = this.addBody('planet', orbitRadius, radius, color, 1e-5, 0, true);
    planet.look = look;
    planet.msun = PLANET_MSUN; // a Jupiter — never tips a merger over the TOV limit
    return planet;
  }

  /** A secondary black hole: heavy enough to perturb orbits and to lens light
   *  (lensMass = mass), rendered as a dark core ringed by a lensed photon ring.
   *  New holes are placed on well-separated radii (34, 39, 44, 49) so up to four
   *  stay clear of each other and the centre rather than quickly merging out. The
   *  mass is 0.2 (was 0.3) so an added hole scatters the lighter stars/planets
   *  less violently — they hold their orbits longer — while still clearly lensing. */
  addBlackHole(orbitRadius = 34 + this.holeCount() * 5): Body {
    return this.addBody('hole', orbitRadius, 1.5, new Vector3(0.02, 0.01, 0.0), 0.2, 0.2);
  }

  addBody(
    type: BodyType,
    orbitRadius: number,
    radius: number,
    color: Vector3,
    mass: number,
    lensMass: number,
    retrograde = false,
  ): Body {
    // A user-driven add while scrubbed back commits history from the scrubbed moment first (the host
    // discards the recorded future), so the new body — and the frames that follow — extend from there.
    if (!this.seeding) this.onUserEdit?.();
    const azimuth = Math.random() * Math.PI * 2;
    const inclination = (Math.random() - 0.5) * 0.6; // modest orbital tilt
    // Place the body *exactly* on the requested orbit radius: folding cos(incl)
    // into the horizontal components keeps |pos| === orbitRadius. The old form
    // (a bare sin(incl) on y) inflated the radius by √(1+sin²incl) — up to ~4% —
    // which scrambled the careful separations between added bodies.
    const ci = Math.cos(inclination);
    const pos = new Vector3(
      Math.cos(azimuth) * ci * orbitRadius,
      Math.sin(inclination) * orbitRadius,
      Math.sin(azimuth) * ci * orbitRadius,
    );
    // Circular-orbit speed in the primary's *softened* field (matching the
    // integrator's SOFTENING2): v = √(M·r² / (r² + ε²)^{3/2}). The bare √(M/r)
    // left a slight excess that opened the orbit into a slowly drifting ellipse —
    // part of why freshly added bodies wandered inward toward a merge.
    const r = pos.length();
    const speed = Math.sqrt((PRIMARY_MASS * r * r) / Math.pow(r * r + SOFTENING2, 1.5));
    const radial = pos.clone().normalize();
    const tangent = new Vector3().crossVectors(new Vector3(0, 1, 0), radial).normalize();

    const body: Body = {
      id: this.nextId++,
      type,
      mass,
      lensMass,
      fixed: false,
      position: pos,
      velocity: tangent.multiplyScalar(retrograde ? -speed : speed),
      radius,
      color,
    };
    // A *seeded* body starts **unborn**: it renders + orbits during the formation intro, but isn't
    // recorded onto the history timeline until its creation tick fires (BirthTicker → markBorn), so
    // rewinding before that tick shows it absent. A user-driven add is born at once (no flag).
    if (this.seeding) body.unborn = true;
    this.bodies.push(body);
    this.registry.set(body.id, { id: body.id, type, mass, lensMass, radius, color: color.clone() });
    this.physics.bodies = this.bodies;
    this.physics.reset();
    if (!this.seeding) this.onEvent?.(type); // a user-driven add → a timeline event
    return body;
  }

  /** Mark a seeded body as **born** — it now appears on the recorded timeline (its creation tick has
   *  fired). Driven by the {@link BirthTicker} as each seeded body swooshes in during the intro. */
  markBorn(body: Body): void {
    body.unborn = false;
  }

  /** Make the movable roster *exactly* match `ids` (in order): revive any that were absorbed/removed
   *  (from the registry) and drop any added since, so the timeline can restore a frame from **before**
   *  a merger — not just kinematics, the whole line-up. Returns whether anything changed (so the
   *  caller can rebuild the GPU buffers). Kinematics are written by the History restore that follows. */
  restoreRoster(ids: Int32Array): boolean {
    const want = Array.from(ids);
    const current = this.companions;
    // Already the right set in the right order? (the common case during replay → no rebuild)
    if (current.length === want.length && current.every((b, i) => b.id === want[i])) return false;
    const byId = new Map(current.map((b) => [b.id, b]));
    const primary = this.bodies.filter((b) => b.fixed);
    const movable: Body[] = [];
    for (const id of want) {
      const existing = byId.get(id);
      if (existing) {
        // Rewound to a moment this body was live — clear any absorption/plunge animation state.
        delete existing.absorbing;
        delete existing.absorbAnchor;
        delete existing.plunging;
        delete existing.plungeFrom;
        delete existing.plungeOmega;
        delete existing.plungeAngle;
        movable.push(existing);
      } else {
        const tmpl = this.registry.get(id);
        if (tmpl) movable.push(this.reviveBody(tmpl)); // back from the dead at its recorded slot
      }
    }
    this.bodies = [...primary, ...movable];
    this.physics.bodies = this.bodies;
    this.physics.reset();
    this.onChange?.(); // the count changed → refresh the Bodies panel
    return true;
  }

  /** Re-create a body from its template (placeholder kinematics — the History restore sets them). */
  private reviveBody(t: BodyTemplate): Body {
    return {
      id: t.id,
      type: t.type,
      mass: t.mass,
      lensMass: t.lensMass,
      fixed: false,
      position: new Vector3(),
      velocity: new Vector3(),
      radius: t.radius,
      color: t.color.clone(),
    };
  }

  clearCompanions(): void {
    this.selected = null; // nothing left to keep highlighted
    this.hovered = null;
    this.bodies = this.bodies.filter((b) => b.fixed); // keep only the primary hole
    this.physics.bodies = this.bodies;
    this.physics.reset();
  }

  /** Whether the − stepper should still be blocked by an in-flight removal. A short tap-guard
   *  only (~0.27s of the plunge — PLUNGE_GUARD_FRACTION, halved so the − re-enables twice as fast):
   *  rapid − presses send bodies diving in quick succession, overlapping finales and all. */
  get removing(): boolean {
    return this.bodies.some((b) => b.plunging !== undefined && b.plunging < PLUNGE_GUARD_FRACTION);
  }

  /** Remove the most recently added companion of a type (the − stepper button) by
   *  sending it on a graceful *inspiral* down to the merge radius, where it is
   *  absorbed exactly as a natural merger is (see prune) — rather than deleting it
   *  instantly. It is freed when that completes. Returns whether one was sent in. */
  removeOne(type: BodyType): boolean {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      if (!b.fixed && b.type === type && b.plunging === undefined && b.absorbing === undefined) {
        this.startPlunge(b);
        return true;
      }
    }
    return false;
  }

  /** Send one *specific* body plunging (the click-to-plunge gesture via {@link clickBody}, or the
   *  − stepper — same fate). */
  plungeBody(body: Body): boolean {
    if (body.fixed || body.plunging !== undefined || body.absorbing !== undefined) return false;
    if (this.isMeldMember(body)) return false; // mid-coalescence: the plunge script would fight the glue (review #2)
    if (!this.bodies.includes(body)) return false;
    this.startPlunge(body);
    this.onChange?.(); // the − steppers' tap-guard state changed — refresh the panels
    return true;
  }

  /**
   * Save a plunging body (tapping it via {@link clickBody}): cancel the plunge and set it back on a
   * **relatively stable orbit** — its current direction from the hole, radius clamped into the
   * comfortable band, on the circular-orbit speed for that radius, still turning the way it was.
   * Too late once absorption has begun (it crossed the merge radius — one-way, per the covenant).
   */
  rescueBody(body: Body): boolean {
    if (body.plunging === undefined || body.absorbing !== undefined) return false;
    if (!this.bodies.includes(body)) return false;
    this.onUserEdit?.(); // a rescue while scrubbed also rewrites the future from here
    const spin = Math.sign(body.plungeOmega ?? 1) || 1; // keep turning the way it was
    delete body.plunging;
    delete body.plungeFrom;
    delete body.plungeOmega;
    delete body.plungeAngle;
    delete body.eaterId; // saved — nothing is consuming it anymore
    // Lift it onto the stable band along its current direction (snatched from the brink: a body
    // deep in the dive pops back out to the band's floor).
    const r = Math.min(48, Math.max(18, body.position.length()));
    const dir = body.position.clone();
    if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
    dir.normalize();
    body.position.copy(dir).multiplyScalar(r);
    // Circular-orbit speed in the softened central field (addStar parity), tangential in the
    // horizontal plane, preserving the body's original sense of rotation about the vertical.
    const v = Math.sqrt((r * r) / Math.pow(r * r + SOFTENING2, 1.5));
    const t = new Vector3(-dir.z, 0, dir.x); // +angle tangent about the vertical
    if (t.lengthSq() < 1e-9) t.set(1, 0, 0);
    t.normalize().multiplyScalar(v * spin);
    body.velocity.copy(t);
    this.onEvent?.('rescue', body); // a save is a timeline moment of its own
    this.onChange?.();
    return true;
  }

  /**
   * The single-click gesture state machine. `picked` is the body under the cursor (from `pickBody`,
   * which now includes the central hole), or `null` for empty space:
   *   • click a plunging companion   → **rescue** it (snatch it back), clear the selection
   *   • click empty space            → clear the selection
   *   • click a body, none selected  → **select** it (soft highlight; the central hole too)
   *   • click the *same* target again → **centre the view on it** (the "one still point"): a companion
   *                                     becomes the tracked focus; the central hole re-centres on the origin
   *   • selected a companion, click the **central hole** → **plunge that companion into the centre**
   *   • selected a companion, click a *different* companion → **plunge it into that one** (collision test)
   * Shared by both render paths — the host just calls this with the pick result.
   */
  clickBody(picked: Body | null): void {
    // A plunging *companion* is always rescued on click (no select step — it's mid-action).
    if (picked && !picked.fixed && picked.plunging !== undefined && picked.absorbing === undefined) {
      this.selected = null;
      this.rescueBody(picked);
      return;
    }
    // Ignore clicks on a body already being absorbed (one-way).
    if (picked && picked.absorbing !== undefined) return;
    if (!picked) {
      // Clicked empty space → deselect.
      if (this.selected) {
        this.selected = null;
        this.onChange?.();
      }
      return;
    }
    const prev = this.selected;
    const validPrev =
      prev && this.bodies.includes(prev) && prev.absorbing === undefined && prev.plunging === undefined;
    if (!validPrev) {
      // Nothing (valid) selected yet → highlight this target (a companion or the central hole).
      this.selected = picked;
      this.onChange?.();
      return;
    }
    // A prior selection exists — resolve the two-tap gesture. Drop the highlight first.
    this.selected = null;
    this.onChange?.();
    if (picked === prev) {
      // Same target twice → centre the view on it. The fixed primary re-centres on the origin (null);
      // a companion becomes the tracked "one still point".
      this.onFocus?.(picked.fixed ? null : picked);
    } else if (picked.fixed) {
      // A companion was selected, then the central hole was clicked → plunge that companion in.
      this.plungeBody(prev!);
    } else if (prev!.fixed) {
      // The hole was selected, then a companion was clicked → just move the highlight to the companion.
      this.selected = picked;
      this.onChange?.();
    } else {
      // Two different companions → plunge the selected one into the other (a collision test).
      this.plungeInto(prev!, picked);
    }
  }

  /**
   * Send body `a` homing straight into body `b` — the click-select-then-click-another gesture, a
   * way to stage a body-body collision. `a` is scripted at `b` (accelerating) in `prune`, and the
   * existing surface-contact merge takes it from there. Falls back to a normal centre plunge if `b`
   * vanishes first. Records like a plunge (a one-way user edit).
   */
  plungeInto(a: Body, b: Body): boolean {
    if (a.fixed || a.plunging !== undefined || a.absorbing !== undefined || a.chaseId !== undefined) return false;
    // Mid-coalescence, either side: a chase at a melding body can never resolve (mergeCollisions
    // excludes meld members), so its script would teleport the chaser into the blob every frame
    // and bleed unconserved momentum through the COM glue (adversarial review #2). The blob is
    // busy fusing for ~1 s — the gesture is simply refused.
    if (this.isMeldMember(a) || this.isMeldMember(b)) return false;
    if (!this.bodies.includes(a) || !this.bodies.includes(b) || a === b) return false;
    this.onUserEdit?.(); // a homing chase, like a plunge, rewrites the future from here
    a.chaseId = b.id;
    a.chaseSpeed = CHASE_SPEED0;
    // Chasing a black hole → it becomes the consumer: the tidal tear + torn stream wrap around IT
    // (the central-hole look, relocated) as the chaser closes in.
    if (b.type === 'hole') a.eaterId = b.id;
    this.onChange?.();
    return true;
  }

  /** Clear the highlight if the selected body is no longer a live, orbiting companion (absorbed,
   *  plunging, merged away, or the roster was cleared) — called after any body-set change. */
  private clearStaleSelection(): void {
    const s = this.selected;
    if (s && (!this.bodies.includes(s) || s.absorbing !== undefined || s.plunging !== undefined)) {
      this.selected = null;
    }
    // Drop a hover that points at a body that has left the scene (it's re-set on the next pointermove).
    const h = this.hovered;
    if (h && !this.bodies.includes(h)) this.hovered = null;
  }

  /** The shared plunge kickoff (− stepper + click-to-plunge). */
  private startPlunge(b: Body): void {
    // Like an add: a − while scrubbed commits history here first, so the plunge plays out *live*
    // from the scrubbed moment (the recorded future, and anything it would have replayed, is gone).
    this.onUserEdit?.();
    // A centre plunge supersedes any in-flight chase — clear it AND the chase's eater, or the tear
    // would keep measuring from the old target and the marquee central spaghettification would
    // silently vanish (adversarial review: reachable by plunging a mid-chase body from the UI).
    delete b.chaseId;
    delete b.chaseSpeed;
    delete b.chaseFrom;
    delete b.eaterId;
    b.plunging = 0;
    b.plungeFrom = b.position.clone();
    // The spiral winds *from the body's own motion*: capture its signed angular rate about the
    // vertical (sim rad/s, positive = the path's +angle rotation) from its real velocity, so the
    // plunge starts at exactly the spin the eye is already tracking — no visible kick, and a
    // retrograde body keeps falling retrograde instead of reversing.
    const rxz2 = Math.max(b.position.x * b.position.x + b.position.z * b.position.z, 1e-6);
    b.plungeOmega = (b.position.x * b.velocity.z - b.position.z * b.velocity.x) / rxz2;
    b.plungeAngle = 0;
  }

  /** Free companions that have escaped far past the scene or finished being
   *  absorbed at the centre — drop them from the body list (and so the render
   *  slots and the count). A companion that reaches the merge radius is *not*
   *  removed at once: it begins an `absorbing` 0→1 fade (held still at its anchor,
   *  shrinking and redshifting in the shader) and is freed only when that
   *  completes. `frameDelta` is wall-clock seconds, so the fade runs at a steady
   *  rate at any Speed. Returns whether anything was freed, so the GPU buffers can
   *  rebuild. */
  prune(frameDelta = 0): boolean {
    this.advanceMeld(frameDelta); // the in-flight coalescence owns its pair (may complete a merge)
    this.mergeCollisions(); // body-body contact first, so a merged loser then absorbs below
    for (const b of this.bodies) {
      if (b.fixed) continue;
      // Age the merged-drop ring-down (cosmetic; see WOBBLE_DURATION / bodyUniforms).
      if (b.wobbleT !== undefined) {
        b.wobbleT += frameDelta;
        if (b.wobbleT >= WOBBLE_DURATION) {
          delete b.wobbleT;
          delete b.wobbleAxis;
        }
      }
      // "Plunge into" homing: a body chasing another is scripted straight at it (accelerating), held
      // on that path so the physics can't move it, until their surfaces touch (mergeCollisions above
      // catches it next frame). If the target has vanished (already merged/absorbed), the chaser
      // falls into a normal centre plunge instead, so the click always resolves to *something*.
      if (b.chaseId !== undefined && b.absorbing === undefined && b.plunging === undefined) {
        const target = this.bodies.find(
          (t) => t.id === b.chaseId && !t.fixed && t.absorbing === undefined && t.plunging === undefined,
        );
        if (!target) {
          delete b.chaseId;
          delete b.chaseSpeed;
          delete b.chaseFrom;
          delete b.eaterId; // the hole it was chasing is gone — the centre consumes it instead
          this.startPlunge(b); // target gone — resolve as a centre plunge
        } else {
          b.chaseSpeed = (b.chaseSpeed ?? CHASE_SPEED0) + CHASE_ACCEL * frameDelta;
          // WALL-CLOCK + ABSOLUTE, like the plunge (adversarial review): the integrator also
          // drifts the chaser by its velocity × timeScale (×80 at the default Speed), so any
          // incremental step still hit contact in ~2 frames — the capture's "near-instant
          // collision from a distance". The scripted anchor (`chaseFrom`) advances by the wall
          // step and OVERWRITES the body position, discarding the drift; the homing now visibly
          // flies for a second or two before impact at any sim Speed.
          const from = b.chaseFrom ?? (b.chaseFrom = b.position.clone());
          const to = target.position.clone().sub(from);
          const dist = to.length();
          if (dist > 1e-9) to.multiplyScalar(1 / dist);
          else to.set(1, 0, 0);
          // Velocity in SIM units (÷ timeScale): it feeds the torn-stream axis (direction), the
          // history recording, and — crucially — the merge's momentum blend, where a wall-clock
          // magnitude would launch the survivor at ×timeScale after contact.
          b.velocity.copy(to).multiplyScalar(b.chaseSpeed / Math.max(this.physics.timeScale, 1e-6));
          // Clamp the step to the distance so a fast chase can't tunnel *past* the target in one
          // frame (it would then never touch it — the merge is a per-frame contact test).
          const step = Math.min(b.chaseSpeed * frameDelta, dist);
          from.addScaledVector(to, step);
          b.position.copy(from);
          continue; // scripted this frame — skip the plunge/absorb/escape handling below
        }
      }
      // User-initiated removal: spiral the body gracefully inward — the controlled
      // "approach" — winding several turns on a smooth (eased) descent, *until it
      // reaches the merge radius*, where it falls through to the exact same
      // absorption a natural merge uses below. So − tears (tidal, radius-gated),
      // ripples and fades identically; it just delivers the body there itself.
      // Wall-clock driven (steady at any Speed); the body is held on this path so
      // the physics can't move it.
      if (b.plunging !== undefined && b.plungeFrom && b.absorbing === undefined) {
        // A black hole's plunge runs nearly twice as long (the overwhelming one — see the
        // PLUNGE_DURATION_HOLE note); the act fractions are unchanged, so the longer clock
        // stretches every act: a statelier descent, ~2× the fast finale loops, a slower dive.
        const dur = b.type === 'hole' ? PLUNGE_DURATION_HOLE : PLUNGE_DURATION;
        b.plunging = Math.min(1, b.plunging + frameDelta / dur);
        const t = b.plunging;
        const f = b.plungeFrom;
        // Three acts (radial as a fraction of the start radius): DESCEND eases 1 → the loop radius;
        // LOOP holds a **perfect circle** just above the horizon (radial' = 0 → the velocity below
        // is purely tangential, so the torn light-streak lingers and wraps clean fast rings); DIVE
        // drops through the merge radius into the absorption spark. `loopFrac` is per-body (the
        // loop radius is absolute; the fraction depends on where the plunge started).
        const r0 = Math.max(f.length(), PLUNGE_LOOP_RADIUS + 1e-6);
        const loopFrac = Math.min(0.9, PLUNGE_LOOP_RADIUS / r0);
        let radial: number;
        let radialP: number; // d(radial)/dt, wall-clock — 0 through the loop (a true circle)
        if (t < PLUNGE_DESCEND_END) {
          const k = t / PLUNGE_DESCEND_END;
          const e = smoothstep(0, 1, k);
          radial = 1 + (loopFrac - 1) * e;
          radialP = ((loopFrac - 1) * 6 * k * (1 - k)) / (PLUNGE_DESCEND_END * dur);
        } else if (t < PLUNGE_LOOP_END) {
          radial = loopFrac;
          radialP = 0;
        } else {
          const k = (t - PLUNGE_LOOP_END) / (1 - PLUNGE_LOOP_END);
          const e = smoothstep(0, 1, k);
          radial = loopFrac * (1 - e);
          radialP = (-loopFrac * 6 * k * (1 - k)) / ((1 - PLUNGE_LOOP_END) * dur);
        }
        // Wind at the body's own captured rate (`plungeOmega`, sim rad/s → wall-clock via the
        // physics timeScale so it matches the spin the eye was tracking), accelerating as it falls
        // like a real infall — Kepler sweep ω ∝ (r/r₀)^{-3/2}, floored so the final wind stays sane.
        // At the loop radius the floor rules, so the finale rings at ~17× the starting rate.
        // Integrated per frame (the rate varies), accumulated on the body.
        const sweep = Math.pow(Math.max(radial, PLUNGE_KEPLER_FLOOR), -1.5);
        const omega = (b.plungeOmega ?? 0) * this.physics.timeScale * sweep; // wall-clock rad/s
        b.plungeAngle = (b.plungeAngle ?? 0) + omega * frameDelta;
        const angle = b.plungeAngle;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const rx = f.x * c - f.z * s; // f rotated by the wind angle, in the xz-plane
        const rz = f.x * s + f.z * c;
        b.position.set(rx * radial, f.y * radial, rz * radial);
        // Point velocity along the **analytic spiral tangent** (tangential early, a pure circle
        // through the loop, curving inward on the dive), at a sane orbital magnitude. The render
        // reads `body.velocity` for the torn-stream axis, so this is what makes the stream trail
        // along the plunge path rather than spike radially. (A finite difference fails here — the
        // physics pre-step moves the body first, and its gravity-driven velocity is ~radial.) Both
        // derivative terms are per wall-clock second, so the direction mix is honest.
        const tx = rx * radialP - rz * omega * radial;
        const ty = f.y * radialP;
        const tz = rz * radialP + rx * omega * radial;
        const tl = Math.hypot(tx, ty, tz) || 1;
        const speed = Math.sqrt(PRIMARY_MASS / Math.max(b.position.length(), 2));
        b.velocity.set((tx / tl) * speed, (ty / tl) * speed, (tz / tl) * speed);
        if (b.position.length() > MERGE_RADIUS && t < 1) continue; // still approaching → keep spiralling
        // Reached the merge radius (or fully wound in) → fall through to the natural merge.
      }
      // Natural merge (and the tail of a − plunge, identical from here): a body
      // carried to the centre begins the in-place absorption fade rather than
      // vanishing the instant it arrives.
      if (b.absorbing === undefined && b.position.length() <= MERGE_RADIUS) {
        b.absorbing = 0; // just reached the centre — begin the absorption fade
        b.absorbAnchor = b.position.clone();
        this.onEvent?.('absorb', b); // a body fell in — mark the moment (+ its mass scales the ripple)
        // THE ACCRETION FLARE (v0.102.1). The central hole is `fixed`, and mergeCollisions skips
        // fixed bodies — so for the whole life of the project a body consumed by the PRIMARY (every
        // − plunge, every natural infall: by far the commonest collision in the app) fired no flash
        // and no dust whatever. It simply shrank at its anchor, which read exactly as the report:
        // "the collision does not cause an explosion — it seems to push the objects together."
        // Physically this is the most energetic event the scene has: matter arriving at the
        // innermost stable orbit gives up its gravitational binding energy — several percent of
        // mc², the process that makes quasars the brightest things in the universe. It should
        // outshine a body-body smash, not be silent. The impact is fired at the anchor with the
        // infall direction as its axis, so the flare and its outflow splash off the horizon.
        this.impactAt(b, b.absorbAnchor);
      }
      if (b.absorbing !== undefined) {
        b.absorbing = Math.min(1, b.absorbing + frameDelta / ABSORB_DURATION);
        if (b.absorbAnchor) b.position.copy(b.absorbAnchor); // hold still while absorbing
      }
    }
    this.clearStaleSelection(); // drop the highlight once the selected body plunges / absorbs / merges

    const gone = (b: Body): boolean => {
      if (b.fixed) return false; // never the primary
      // A non-finite position (a rare close-encounter integration blow-up) would
      // poison every ray's geodesic and black out the whole render, and it never
      // escapes (NaN ≥ R is false) — so drop it at once.
      if (!Number.isFinite(b.position.x + b.position.y + b.position.z)) return true;
      if (b.absorbing !== undefined) return b.absorbing >= 1; // freed once fully absorbed
      return b.position.length() >= ESCAPE_RADIUS; // flung clear of the scene
    };
    // Scan first — mark escapes (an absorbed body already fired 'absorb' when it
    // reached the centre), then only rebuild the list when something is actually out.
    let anyGone = false;
    for (const b of this.bodies) {
      if (!gone(b)) continue;
      anyGone = true;
      if (b.absorbing === undefined && Number.isFinite(b.position.x + b.position.y + b.position.z)) {
        this.onEvent?.('escape'); // flung clear of the scene
      }
    }
    if (!anyGone) return false;
    this.bodies = this.bodies.filter((b) => !gone(b));
    this.physics.bodies = this.bodies;
    this.physics.reset();
    this.onChange?.();
    return true;
  }

  /**
   * Body-body collisions (roadmap #8): when two *live* companions touch, they merge in a
   * momentum-conserving, inelastic way — a hole always the victor (it captures), else the heavier
   * body. The victor keeps its motion adjusted for conservation, gains the loser's mass (and, for
   * holes, lensing) and grows in volume; the loser begins the same absorption fade a central merge
   * uses, anchored to the **contact point** (so it tears + fades right where they met), and a
   * bright merge flash pops there. A hole capturing a body echoes the central plunge (toned); a
   * star/planet pair makes a single larger star/planet. O(n²) over the ≤ ~11 companions — trivial.
   */
  private mergeCollisions(): void {
    let merged = false;
    for (let i = 0; i < this.bodies.length; i++) {
      const a = this.bodies[i]!;
      if (a.fixed || a.absorbing !== undefined) continue;
      for (let j = i + 1; j < this.bodies.length; j++) {
        const b = this.bodies[j]!;
        if (b.fixed || b.absorbing !== undefined) continue;
        // A melding pair is owned by the coalescence clock (advanceMeld) — and a third body
        // grazing a half-fused drop waits the ~1 s out rather than merging into it mid-meld.
        if (this.meld && (a.id === this.meld.aId || a.id === this.meld.bId || b.id === this.meld.aId || b.id === this.meld.bId)) continue;
        // A body already plunging (user −) can still be struck; skip only the absorbed.
        const dist = a.position.distanceTo(b.position);
        if (dist > (a.radius + b.radius) * CONTACT_FACTOR) continue;

        // LIQUID COALESCENCE (v0.101.0): two touching DROPS — no hole on either side, neither on
        // a scripted plunge path — don't merge on the contact frame. They enter the melding
        // window: glued to their COM while the gap eases closed (and the renderer bridges their
        // surfaces with a growing neck); the real merge fires when it completes (advanceMeld).
        // A chase reaching contact is this window's front door — its script is terminal here, so
        // clear it before it can fight the glue. One meld at a time (it has one render slot); a
        // simultaneous second contact takes the instant path below, as every merge used to.
        if (a.type !== 'hole' && b.type !== 'hole' && a.plunging === undefined && b.plunging === undefined && !this.meld) {
          delete a.chaseId;
          delete a.chaseSpeed;
          delete a.chaseFrom;
          delete b.chaseId;
          delete b.chaseSpeed;
          delete b.chaseFrom;
          // …and any chase residue eater (a drop that was chasing a HOLE, grazed this drop en
          // route, and melds instead): a stale eaterId would leave the survivor spuriously
          // spaghettifying near that hole forever (review #4). An absorbing body can't meld, so
          // any eaterId here is by definition chase residue — safe to clear.
          delete a.eaterId;
          delete b.eaterId;
          const axis = new Vector3().subVectors(a.position, b.position);
          if (axis.lengthSq() > 1e-12) axis.normalize();
          else axis.set(1, 0, 0);
          this.meld = { aId: a.id, bId: b.id, t: 0, d0: dist, axis };
          this.applyMeldConstraint(a, b, 0); // glue immediately — no first-frame fling
          continue;
        }

        this.performMerge(a, b);
        merged = true;
        break; // a is now merged-into or the victor; move on (b handled next scan if needed)
      }
    }
    if (merged) this.physics.reset(); // masses changed → rebuild the integrator's acceleration cache
  }

  /** Advance the in-flight coalescence: validate the pair, hold the glue (COM velocity, the gap
   *  easing closed), and fire the real merge at t = 1. Wall-clock, like the plunge/absorb clocks;
   *  under pause the loop never steps, so the meld freezes with everything else. */
  private advanceMeld(frameDelta: number): void {
    const m = this.meld;
    if (!m) return;
    const a = this.bodies.find((x) => x.id === m.aId);
    const b = this.bodies.find((x) => x.id === m.bId);
    // Stale: a member vanished or began absorbing elsewhere, or a scrub/restore teleported the
    // pair apart — drop the meld rather than yank restored bodies back together.
    if (!a || !b || a.absorbing !== undefined || b.absorbing !== undefined) {
      this.meld = null;
      return;
    }
    // A non-finite member (a rare close-encounter blow-up) must drop the meld: the COM glue would
    // propagate the NaN into the healthy partner, silently destroying BOTH bodies where the
    // per-slot finiteness guard would have lost only one (review #4).
    if (!Number.isFinite(a.position.x + a.position.y + a.position.z + b.position.x + b.position.y + b.position.z)) {
      this.meld = null;
      return;
    }
    // The break distance is floored by the summed radii: a pair that first touched deeply
    // overlapped (d0 ≈ 0) legitimately eases OUT to the end gap — only a genuine teleport
    // (a scrub/restore) exceeds radii × factor.
    if (a.position.distanceTo(b.position) > Math.max(m.d0, a.radius + b.radius) * MELD_BREAK_FACTOR + 1) {
      this.meld = null;
      return;
    }
    m.t = Math.min(1, m.t + frameDelta / MELD_DURATION);
    this.applyMeldConstraint(a, b, m.t);
    if (m.t >= 1) {
      const axis = m.axis.clone();
      this.meld = null;
      this.performMerge(a, b, axis);
      this.physics.reset(); // masses changed → rebuild the integrator's acceleration cache
    }
  }

  /** The melding glue: both drops take the pair's COM velocity (recomputed each frame — gravity
   *  may have nudged them since, and the mass-weighted blend conserves momentum regardless), and
   *  their positions are pinned astride the COM with the centre gap easing from the contact
   *  distance down to the deep-overlap end gap. The COM itself keeps flying the pair's shared
   *  trajectory, so the coalescing blob still orbits naturally. */
  private applyMeldConstraint(a: Body, b: Body, t: number): void {
    const m = this.meld!;
    const total = a.mass + b.mass;
    const wa = a.mass / total;
    const wb = b.mass / total;
    this.meldV.copy(a.velocity).multiplyScalar(wa).addScaledVector(b.velocity, wb);
    a.velocity.copy(this.meldV);
    b.velocity.copy(this.meldV);
    // Axis from the live positions (falls back to the stored axis when fully overlapped).
    const d = a.position.distanceTo(b.position);
    if (d > 1e-6) m.axis.copy(a.position).sub(b.position).multiplyScalar(1 / d);
    this.meldC.copy(a.position).multiplyScalar(wa).addScaledVector(b.position, wb);
    const ease = t * t * (3 - 2 * t);
    const gap = m.d0 + (MELD_END_GAP_FRAC * (a.radius + b.radius) - m.d0) * ease;
    a.position.copy(this.meldC).addScaledVector(m.axis, gap * wb);
    b.position.copy(this.meldC).addScaledVector(m.axis, -gap * wa);
  }

  /**
   * The accretion flare + outflow of a body reaching the CENTRAL hole (v0.102.1). Fires the same
   * flash/dust channels a body-body collision uses, so the primary's consumption finally has an
   * impact event of its own.
   *
   * Strength scales with the infalling mass over a generous floor — stars and planets are
   * near-massless in the toy's units (m ≈ 1e-3), so a mass-only scale would leave the commonest
   * plunge invisible, which is the bug being fixed. A HOLE falling in is the heavyweight: a
   * black-hole merger is the most violent event available, and it reads bluest.
   */
  private impactAt(b: Body, at: Vector3): void {
    const isHole = b.type === 'hole';
    const strength = Math.min(4.0, (isHole ? 2.6 : 1.9) + b.mass * 3.5);
    this.onMerge?.(at.x, at.y, at.z, isHole ? 'hole' : 'body', strength);
    // The outflow: real accretion at a high rate drives a wind off the inner disk, so the flare
    // comes with a puff of ejecta. It is deliberately smaller than a collision's shell (the hole
    // keeps most of what it eats) and splashes along the infall direction — radially off the
    // horizon. The cloud is launched at rest: what escapes here is a wind, not a thrown remnant.
    const r = at.length() || 1;
    this.onDust?.(
      at.x, at.y, at.z,
      at.x / r, at.y / r, at.z / r,
      Math.min(1.6, (isHole ? 1.0 : 0.6) + b.radius * 0.25),
      Math.max(1, b.radius * (isHole ? 2.2 : 1.6)),
      0, 0, 0,
    );
  }

  /** The merge itself — victor election, conservation, TOV/ignition transforms, the flash and the
   *  timeline ticks, and (for drop pairs) the dust cloud + remnant wobble. Callers own
   *  `physics.reset()`. `meldAxis` is the coalescence's collision axis; instant merges derive it
   *  from the pair's relative position. */
  private performMerge(a: Body, b: Body, meldAxis?: Vector3): void {
    // Captured before any mutation below: whether this was a DROP pair (a collapse still throws
    // dust — the envelope blown off as the remnant implodes), the summed pre-merge radii (the
    // dust cloud's seed size), and the collision axis (the cloud splashes in the plane ⊥ to it).
    const wasDrops = a.type !== 'hole' && b.type !== 'hole';
    const r0 = a.radius + b.radius;
    let axis = meldAxis;
    if (!axis) {
      axis = new Vector3().subVectors(a.position, b.position);
      if (axis.lengthSq() > 1e-12) axis.normalize();
      else axis.set(1, 0, 0);
    }

    // Victor: a hole captures; otherwise the heavier body (tie → the earlier one, a).
    const aWins = a.type === 'hole' ? true : b.type === 'hole' ? false : a.mass >= b.mass;
    const win = aWins ? a : b;
    const lose = aWins ? b : a;

    // The contact point (mass-weighted, so it sits toward the heavier body) — the flash site
    // and the loser's fade anchor.
    const m = win.mass + lose.mass;
    const wx = (win.position.x * win.mass + lose.position.x * lose.mass) / m;
    const wy = (win.position.y * win.mass + lose.position.y * lose.mass) / m;
    const wz = (win.position.z * win.mass + lose.position.z * lose.mass) / m;

    // Momentum conservation (inelastic): the victor takes the combined momentum ÷ combined
    // mass. It keeps its position (no teleport artifact); mass + lensing accumulate; the
    // radius grows so *volume* adds (r³ sums) — a visibly larger body.
    win.velocity.set(
      (win.velocity.x * win.mass + lose.velocity.x * lose.mass) / m,
      (win.velocity.y * win.mass + lose.velocity.y * lose.mass) / m,
      (win.velocity.z * win.mass + lose.velocity.z * lose.mass) / m,
    );
    win.mass = m;
    win.lensMass += lose.lensMass;
    win.radius = Math.cbrt(win.radius ** 3 + lose.radius ** 3);
    win.msun = (win.msun ?? 0) + (lose.msun ?? 0);

    // The Tolman–Oppenheimer–Volkoff test: two NON-hole bodies whose combined solar mass tops
    // the TOV limit can't remain a star — the remnant COLLAPSES into a black hole. The victor
    // transforms in place: near-black, lensing on, the added-hole simulation mass (the toy's one
    // consistent hole scale — it now perturbs/captures/lenses like any added hole), a newborn
    // stellar-mass radius, and its compact accretion disk ignites via the render's lensMass
    // path. The flash below fires icy blue-white at collapse strength.
    const collapsed = win.type !== 'hole' && lose.type !== 'hole' && (win.msun ?? 0) >= TOV_LIMIT_MSUN;
    if (collapsed) {
      win.type = 'hole';
      win.color.set(0.02, 0.01, 0.0);
      win.mass = COLLAPSED_HOLE_MASS;
      win.lensMass = COLLAPSED_HOLE_MASS;
      win.radius = COLLAPSED_HOLE_RADIUS;
      // The registry (orbit map + history restore identity) must reflect the new nature.
      this.registry.set(win.id, {
        id: win.id,
        type: 'hole',
        mass: win.mass,
        lensMass: win.lensMass,
        radius: win.radius,
        color: win.color.clone(),
      });
    }

    // Stellar ignition (v0.97.0): two PLANETS that smash together don't stay a rocky lump —
    // the toy's escalation ladder lights the remnant as a small STAR (planets → star; heavy
    // stars → hole via the TOV test above). The victor transforms in place: the warm seeded-star
    // HDR tint (so it blooms like any star, on lean too), a compact stellar radius, star-scale
    // simulation mass and TOV bookkeeping (so its future mergers count toward collapse), and
    // the planet-only surface `look` cleared. The timeline gets a 'star' tick — a star was born.
    const ignited = !collapsed && win.type === 'planet' && lose.type === 'planet';
    if (ignited) {
      win.type = 'star';
      win.color.set(1.0, 0.84, 0.62).multiplyScalar(7);
      win.mass = 1e-3; // the addStar test-particle mass
      win.radius = Math.max(win.radius, 1.0); // a small star (seeded stars are 1.2)
      win.msun = STAR_MSUN_MIN;
      delete win.look;
      this.registry.set(win.id, {
        id: win.id,
        type: 'star',
        mass: win.mass,
        lensMass: win.lensMass,
        radius: win.radius,
        color: win.color.clone(),
      });
    }

    // Contact resolves EVERY chase on both sides (adversarial review: the winner kept its
    // chaseId pointing at the now-absorbing loser — prune's "target vanished" branch then
    // centre-plunged the SURVIVOR, including a newborn TOV-collapse hole: the capture's "both
    // bodies vanished"). The merge is the chase's terminal state — nothing left to home at.
    delete win.chaseId;
    delete win.chaseSpeed;
    delete win.chaseFrom;
    delete lose.chaseId;
    delete lose.chaseSpeed;
    delete lose.chaseFrom;

    // The loser begins the absorption fade at the contact point, plunge state cleared. A HOLE
    // victor also becomes the loser's **eater** (its `tidal` is then measured from the hole, so
    // the loser spaghettifies around it — the central-hole consumption look, relocated); a
    // star/planet victor sets no eater, so the smash reads as a classic Newtonian impact: the
    // flash + shockwave + the loser crushing into the winner, with **no** wrapping tear stream.
    delete lose.plunging;
    delete lose.plungeFrom;
    if (win.type === 'hole' && !win.fixed) lose.eaterId = win.id;
    lose.absorbing = 0;
    lose.absorbAnchor = new Vector3(wx, wy, wz);

    // The flash + the timeline tick. A hole capture rings brighter/bluer than a rocky smash;
    // strength scales with the combined mass (clamped) so a hole-hole merger is the biggest.
    // The floor is generous (1.7): stars/planets are near-massless (m ≈ 1e-3), so a mass-only
    // strength left their collisions almost invisible — the whole point of the flash is to *mark*
    // the impact, so even a light smash pops. Holes (mass 0.2) still ring hardest, up to the cap.
    // A TOV collapse outranks them all: the icy-white formation flash at the hardest strength.
    const kind: 'hole' | 'body' | 'collapse' = collapsed ? 'collapse' : win.type === 'hole' ? 'hole' : 'body';
    const strength = collapsed ? 4.2 : Math.min(3.6, 1.7 + m * 3.5);
    this.onMerge?.(wx, wy, wz, kind, strength);
    this.onEvent?.('merge', lose);
    if (collapsed) this.onEvent?.('collapse', win); // the birth of a black hole — its own timeline mark
    if (ignited) this.onEvent?.('star', win); // the birth of a star — the 'star' tick marks it

    // The liquid aftermath (v0.101.0), drop pairs only — a hole capture swallows, no splash:
    // the impact throws a lingering DUST cloud at the contact point (bigger drops throw more; a
    // collapse blows off its envelope hardest), and a surviving star/planet remnant RINGS — the
    // merged drop's damped l = 2 wobble (a newborn collapse hole is no drop — it doesn't ring).
    if (wasDrops) {
      const dustStrength = Math.min(2, 0.75 + r0 * 0.3) * (collapsed ? 1.4 : 1);
      // The ejecta rides the remnant's momentum (win.velocity is already the conserved COM blend).
      this.onDust?.(wx, wy, wz, axis.x, axis.y, axis.z, dustStrength, r0, win.velocity.x, win.velocity.y, win.velocity.z);
      if (win.type !== 'hole') {
        win.wobbleT = 0;
        win.wobbleAxis = axis.clone();
      }
    }
  }

  step(frameDelta: number): void {
    this.physics.step(frameDelta);
  }
}
