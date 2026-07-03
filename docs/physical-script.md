# The physical script — what the engine *actually* computes

The counterpart to [`intro-script.md`](intro-script.md). **We keep two scripts, always:**

- **The art-directed script** ([`intro-script.md`](intro-script.md)) — the agreed, high-level
  storyboard: beats, motion toward ⊙, colour, overlap. It says what the audience *sees* and is the
  contract for how the opening should *feel*.
- **The physical script** (this file) — the reality: what the engine computes at each moment, which
  parts are honest physics, which are phenomenological, and which are pure theatre. It says what is
  *true*, so "make it look more physical" always has a reference for what *physical* would be.

When the two disagree, that's not a bug — it's a documented artistic choice. Change either
deliberately, and keep both current.

## The reversibility covenant

The standing policy for how physical the dynamics may get (set 2026-07):

- **During the intro window** (from load until the formation settles — `FormationSequence.done`),
  **irreversible physics is allowed**: dissipation, radiation-reaction drag, scripted energy loss.
  The intro is theatre staged once; nothing in it is ever rewound (History only accumulates from
  birth ticks, and Replay re-seeds from scratch).
- **After the intro settles**, the live simulation must stay **bit-exact time-reversible**: every
  force position-only (velocity-Verlet KDK identity — `integrators.test.ts` proves it), because
  Step-back and the DVR timeline depend on it. The two sanctioned irreversible events — absorption
  at the merge radius and the − plunge — are *one-way lifecycle transitions*, not forces, and the
  timeline handles them by roster restore (`Scene.restoreRoster`), not by reversing them.
- Practical consequence: a **dissipative two-hole inspiral** (roadmap #6's remaining half) may run
  as an *intro set piece* or behind an explicit user action, but a drag force must never act on the
  steady-state N-body after settle.

## Beat by beat — the truth under the theatre

| Beat (art script) | What the engine actually does | Honest / phenomenological / theatre |
| --- | --- | --- |
| **A · Black** (0–0.6s) | `import()` of the ~860KB engine chunk fires at intro start; parse + `WebGPURenderer.init()` (device/adapter) + raymarch TSL build run under the black. Nothing renders. | Theatre (cover for real work) |
| **B · Lines** (1 frame) | Pure CSS. No engine involvement. | Theatre |
| **C · Creation** (~0.3s) | Pure CSS. Meanwhile `compileAsync` builds the raymarch WGSL on browser GPU-process threads; two covered `post.render()`s prime the **lit** disk (`formation` forced to 1, then restored) and the bloom chain. | Theatre over real pre-warm |
| **D · Splash merger** | CSS + a 2D canvas dust field. **The merger is faked** — no dynamics. The engine loop starts under it (`loop.start()`), the formation clock begins, physics steps the seeded bodies. | Theatre; sim already live beneath |
| **E · Engine takeover** | The splash crossfades out `splashHoldMs = 590ms` after its first painted frame. The renderer is at the deep `introScale` cut (0.18–0.22, scaler ceiling pinned while covered), `volumeStep` coarsened (`revealVolumeStep`), the warm haze (`fuzz = 1`) masking both as they ease back over `FUZZ_FADE_S = 5s`. | Real render, art-directed degradation |
| **The settle** (6.5s) | Camera dollies 2.6× home → home (ease-out cubic; a *camera* move, not physics). The disk "ignition" is the `formation` factor 0 → 1 multiplied into the dust density — the disk doesn't form dynamically, it fades in. Companions swoosh via the per-body `appear` curve; their *orbits* are real (already integrating). | Camera + fade = theatre; orbits honest |

## The steady state — what is honest physics

- **Photon geodesics**: per-pixel Schwarzschild null geodesics, RK4 integration of
  `a = −3M·h²·x/r⁵` (`schwarzschild.ts`) — validated against the exact photon-sphere and shadow
  numbers (`validate-geodesic.mjs`). **Honest** (exact metric, static observer).
- **Companion orbits**: Newtonian softened N-body, velocity-Verlet (KDK), symplectic + reversible
  (`integrators.ts`), plus the **position-only r⁻³ precession term** (`PRECESSION_K = 0.3`) — the
  GR *observable* (apsidal advance, `Δφ = 2π(√(1+k/r)−1)`, `validate-orbit.mjs`) by a Newtonian
  mechanism. **Right observable, wrong mechanism, by design.**
- **Companion lensing**: weak-field deflection `a = −2m·d/|d|³` per massive companion
  (`validate-lensing.mjs`). **Honest to leading order**; a fidelity mismatch against the exact-Kerr
  future (roadmap #10) is documented there.
- **The disk**: an art-directed emissive volume (blackbody ramp + Doppler beaming + turbulence),
  *not* a solved accretion flow. Doppler/beaming factors are physical; densities are painted.
- **Tidal disruption** (the tear → stream → feed): Roche-*gated* (the trigger radius is checkable
  physics) but the stream itself is an art-directed arc (`streamArcHit`), with dials
  (`STREAM_EMIT = 0.17`, `STREAM_EXT = 0.21`, tops of `raymarch.ts`/`medium.ts`).
  **Phenomenological.**
- **The − plunge**: a scripted spiral, but it now *starts from the body's own captured angular
  rate* (no kick; retrograde stays retrograde) and quickens as it falls with a Kepler sweep
  (ω ∝ (r/r₀)^{−3/2}, floored — `PLUNGE_KEPLER_FLOOR`). The *shape* is honest infall behaviour;
  the radial schedule (`PLUNGE_DURATION = 4.5s` ease) is authored. **Phenomenological, physically
  shaped.**
- **Absorption + ripple**: absorption is one-way (consistent with the covenant); the ringdown
  ripple is a *metaphorical* sky-warp whose amplitude scales with the absorbed mass
  (`rippleStrengthForMass` — GW strain ∝ mass, clamped) and whose decay time stretches with
  √strength (ringdown time grows with the final mass). **Metaphor with a physical scaling.**
- **The black-hole plunge (the overwhelming one)**: a companion *hole* cannot itself be tidally
  disrupted — it is a horizon, not matter. What rips in its plunge is read as its **dragged
  accretion structure** being stripped (`rip` scale in `bodyUniforms`/`streamArcHit`: the tear
  starts further out, wraps ~2.4× the arc, thicker tube), over a longer clock
  (`PLUNGE_DURATION_HOLE = 8s`), ending in the strongest, longest ringdown. The *hierarchy* is
  honest — BH–BH coalescence is the most energetic event class we know — while the stripped-halo
  visual is art-directed. **Phenomenological, physically ranked.**

## Where "more physical" goes next (per the covenant)

1. **Two-hole inspiral** — allowed as an intro-window set piece or user-staged event with real
   dissipation (radiation-reaction–shaped drag); must not touch the settled N-body. Scripted path
   remains the reversibility-safe alternative for post-settle use.
2. **Seeded eccentricity** — a small e on user adds/seeds would make the (already real) precession
   visible on default orbits; position-only, covenant-clean.
3. **Kerr** (roadmap #10) — the honest-metric upgrade; gated on roadmap #1 being closed.
