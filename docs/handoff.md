# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.81.0 (2026-07-09)._

## Where things stand

- **★ Collisions + selection + Galaxy dials (v0.79.0–v0.81.0, this session).** An interaction-feel run:
  - **v0.79.0 — dramatic collisions + a smoother first interaction.** Body-body smashes read as one
    body vanishing because the merge-flash `strength` scaled with mass and stars/planets are
    near-massless (~1e-3) → an invisible pop. Gave `strength` a **floor of 1.7** (`Scene.mergeCollisions`)
    and turned the flash into a real **collision burst** — a hot core pop that hands off to an expanding
    **shockwave ring** (`FLASH_EMIT` 3.5→5, `FLASH_SPEED` 22→26, `FLASH_TAU` 5.5→3.4, retire 1.2→**1.7s
    on both paths**, in `raymarch.ts` + main/worker loops). Also **pre-warm the full shader during idle**
    after the intro settles (`requestIdleCallback` → the non-blocking `compileAsync`, guarded by
    `fullWarmScheduled`) so the first collision/plunge/hole fires instantly — that was the perceived
    "little bit of lag after everything settles." **The reveal itself is healthy** (Firefox: 0 janks,
    p95 ~11ms, boot 330ms — better than earlier baselines), so this targets the *first-interaction*
    compile specifically.
  - **v0.80.0 — selection you can feel.** Pick hit-circle floor **22px → 34px** (+ more slack) on both
    paths — forgiving clicks. A new **hover** state (fine-pointer `pointermove` → `Scene.hovered`, a soft
    warm-white lift + pointer cursor) distinct from the **selected** state, now an other-worldly **neon
    halo** (a big HDR emissive boost so bloom throws a glow, a cool electric-blue sheen, a breathing
    pulse). Both drive the body's existing emissive — no shader change; knobs `HL_BOOST`/`HL_NEON`/
    `HOVER_BOOST` in `bodyUniforms.ts`.
  - **v0.81.0 — Galaxy Mode gets a settings menu.** The "Galaxy mode" Advanced row is now a
    **collapsible folder whose title carries the on/off toggle** (`galaxyFolder.ts`, mirrors
    `hudFolder.ts`), with live dials: **Rotation speed · Star brightness · Star size · Core glow** — each
    a multiplier on the authored default (1 = as-is). `GalaxyLayer` gained runtime setters
    (`setStarSize`/`setBrightness`/`setGlow`; brightness rides `material.color`, verified to live-update
    on the node material like `.opacity`). Dial values live on the main thread and are re-pushed
    (`applyGalaxyDials`) when the layer is disposed on exit / rebuilt on enter; no persistence across a
    hard refresh.
  - ⚠️ All three are render/interaction changes wanting a **real-device look** (flash brightness/size;
    halo intensity + hover feel; the galaxy dial ranges) — the maths/logic is verified + adversarially
    reviewed (all SHIP), the on-screen feel is not.
  - **Worker parity:** the shared `raymarch.ts` flash + the pick radius + the flash-retire window were
    mirrored into `workerEngine.ts`; still un-mirrored on the opt-in worker path (backlog): the
    **hover** handler, the **idle full-shader pre-warm**, and Galaxy Mode entirely.

- **★ Click-to-focus + Galaxy render polish (v0.77.0–v0.78.0, prior session).**
  - **v0.77.0 — reworked click gestures + a bolder highlight.** The click-selected body brightens
    harder + **pulses** (`HL_BOOST` 2.3→3.4, `HL_WHITE` 0.35→0.55). The **central hole is now a tap
    target** (`pickBody(…, includeFixed)`): tap a body then the hole → **plunge it in**; tap a body
    then the *same* body → **centre the view on it** as the "one still point" (new
    `CameraRig.focusOn` follow-cam translates the camera *with* the tracked body — the change from the
    old tap-again-plunges); double-tap the hole → re-centre on the origin; tapping a **plunging** body
    still **rescues**, a *different* companion still stages a body-body collision. Gesture state
    machine (`Scene.clickBody`, `Scene.onFocus`) shared by both render paths; the view auto-recenters
    if the focused body leaves the scene, and flights/intro `recenter()` first so they can't frame
    off-centre. +1 test (256 total).
  - **v0.78.0 — zoom-scaled stars + a living core glow in Galaxy Mode.** The star field was a
    `THREE.Points` cloud (fixed 1px on WebGPU → stars never changed with zoom); it's now **one merged
    mesh of ~1760 camera-facing billboard quads** (`GalaxyLayer.writeCorners`: corners = centre ±
    right·h ± up·h from the camera's world basis, rebuilt each frame into a `DYNAMIC_DRAW` position
    buffer), so perspective grows/shrinks stars with zoom. Soft radial sprite + additive + a real
    `uv` (a mesh carries uv, unlike Points → the map finally works, no more invisible-stars trap);
    `DoubleSide` guards any winding mistake. The core glow **breathes** (two detuned sines on opacity
    + scale, off a real-seconds clock independent of Speed) so the bulge stops feeling "pasted on."
    Adversarial review verdict **SHIP** (math/winding/buffers/material all verified). Two tuning knobs
    at the top of `GalaxyLayer.ts` — `STAR_SCALE` 0.5, `BRIGHTNESS` 1.5.
  - ⚠️ **Both want a real-device look** — the camera-follow *feel* and the star size/brightness +
    glow-breath are eyeball dials; the gesture + billboard math is verified/reviewed, not the on-screen
    feel.
  - **Follow-up the review surfaced (added to the worker-parity backlog):** `GalaxyLayer.makeSoftSprite`
    calls `document.createElement('canvas')` — fine today (Galaxy Mode is main-path only, and the
    `try/catch` degrades gracefully to square stars), but when Galaxy Mode ports to the OffscreenCanvas
    worker it must guard `document` (`typeof document !== 'undefined' ? … : new OffscreenCanvas(64,64)`).

- **★ Physics sliders + panel tidy (v0.74.0–v0.76.0, prior session).** A run of Advanced-panel work:
  - **v0.74.0 — panel tidy + fresh-session defaults.** Speed moved **under Advanced** (before Look);
    **"Clear companions" removed** (button + `C` key + Keys-overlay entry + worker button — Replay
    intro already restores the line-up); **settings no longer persist across page loads** — a fresh
    open / hard refresh restores *all* defaults (Advanced collapsed), while within a session the live
    panel keeps tweaks and Galaxy Mode / Replay intro preserve them (neither rebuilds the panel). The
    `localStorage` blob + `src/ui/settings.ts` are gone.
  - **v0.75.0 — the dark sector (#12/#13).** Advanced **Dark matter** + **Dark energy** sliders, each
    a **position-only** radial term on the N-body central force (so reversibility holds; zero shader
    cost): a halo (inward `A/r` → flat rotation curve) and Λ (outward `Λ·r` → turnaround radius
    `(M/Λ)^⅓`). Validated in `validate-orbit.mjs`; 4 integrator tests. Sliders (not toggles) so the
    effect builds visibly. **Regular-mode N-body**; a Galaxy-Mode rotation-curve version is a follow-up.
  - **v0.76.0 — experimental Kerr spin (#10).** An Advanced **Kerr spin** slider (a/M, 0 =
    Schwarzschild) drives a *phenomenological* frame-drag in the geodesic (`frameDragAccel`,
    `a_drag = K·spin·(ŷ×pos)/r⁵`) → the shadow shifts (D-shape). **spin 0 is byte-exact Schwarzschild**
    (the term returns 0; full-shader-only, never the lean reveal → problem #1 untouched).
    CPU-validated (`validate-geodesic.mjs`: b_crit = 3√3·M at spin 0; ~17% prograde/retrograde shift
    at 0.9) + an adversarial review confirmed no NaN path. ⚠️ **The *visual* still needs a real-device
    look** (I can't render WebGPU here); the **exact Kerr metric** (`g_tφ`, Carter constant,
    ergosphere, off-equatorial θ) remains the L-effort trophy (roadmap #10).
  - **Worker-parity backlog (grew this session):** Galaxy Mode (v0.63/0.73), the **dark-sector
    sliders** (v0.75), and the **Kerr spin** slider (v0.76) are all **main-path only** — no
    `src/worker/**` wiring (control-map keys, `workerControls` sliders, and the `workerEngine`
    `needsFull` twin of the spin trigger). Not live regressions (`WORKER_DEFAULT = false`), but they
    join the panel-parity list that gates the eventual worker-default flip.
- **Docs reorg (this session):** `docs/` now holds only the 5 living docs; everything historical moved
  into [`docs/archive/`](archive/README.md) (its README is the folder index).

- **★ Galaxy Mode v2 — a real spiral galaxy, and no longer laggy (v0.73.0).** The old mode overlaid
  the ~1000-point cloud **on top of** the full raymarch (galaxy = raymarch + overlay = *more* work),
  and read as "pinpoints of white around a dark centre." Rework:
  - **Lag fix + "regular mode stops":** once the galaxy blooms in, a camera-locked dark **backdrop**
    (in `GalaxyLayer`) goes opaque and `main.ts` **skips `post.render()` entirely** (`skipRaymarch =
    galaxyMode && galaxyFade > 0.85`); physics/timeline also freeze while `galaxyMode` (gated in the
    loop's tick block). Galaxy Mode is then just the cheap point cloud.
  - **Realistic three-population spiral** in the pure `Galaxy` core (unit-tested): a dense puffy
    **warm-gold bulge** (30%, inside `rInner`, fills the old dark centre) + disk stars pulled onto a
    **two-arm log spiral** (density-wave bias) coloured **blue-white** with rare O/B supergiants +
    an older warmer inter-arm disk reddening to a **dim halo**. Kepler shear still winds the arms.
  - **Warm core glow + denser coloured stars.** Two additive **core-glow billboards** (soft sprite
    over a `PlaneGeometry`) fill the centre; the star cloud is denser (~1600) and palette-coloured.
    ⚠️ **WebGPU draws `THREE.Points` at a fixed 1px** regardless of `size` (confirmed in three's
    source), so the stars are 1px on the primary path — do **not** put a `.map` on the Points
    material (it samples the missing `uv` at (0,0) = the sprite's transparent corner → *invisible*
    stars; a review caught this pre-merge). **Bigger/softer stars = a tested follow-up** via three's
    instanced-Sprite `PointsNodeMaterial` path (the docstring's pattern; honors `sizeNode` + a uv).
  - **Exit replays the whole intro** (page-refresh-like reset): `galaxyExitReplay` → `replaySplash`
    melts the galaxy inward, then under the black splash it drops the mode, `scene.reseed()`s, and
    `formation.restart()`s. Controls tucks the panel away for it (like Replay intro). Replay/R while
    in Galaxy Mode routes through the exit (else it'd replay invisibly under the opaque backdrop).
  - **Defensive on every exit path:** a failed lazy build **or** a mid-session render throw now
    **reseeds** the default scene (it was cleared on enter) instead of stranding an empty frozen view,
    and the Controls toggle only hides the panel when `isGalaxyMode()` (so a desynced-off state can't
    strand it). All caught by an adversarial pre-merge review (5 findings, all fixed).
  - **Still main-path only** (unchanged): the worker path has no galaxy wiring. **Open follow-ups:**
    lens the galaxy through the hole; worker parity; a real-device look/perf check (esp. mobile).
    (**Bigger/softer, zoom-scaled stars — done in v0.78.0** via billboard quads, above; the
    fixed-1px `THREE.Points` note below is the *why*, now superseded.)
- **UI round (v0.72.0):** tap-to-select interaction (tap = highlight; tap again = plunge; tap
  another = plunge the first *into* it, a homing body-body collision; tap a plunging body = rescue),
  replacing the double-click plunge; distinct timeline hues (absorb red / escape cyan / rescue green
  / merge magenta). Shared `Scene.clickBody`/`plungeInto`, both render paths. (PR #144.)
- **★ First light is ON by default (v0.71.0) — roadmap #1 (the cold-start lag) is SOLVED.** The
  second-recording numbers cleared the flip: Firefox `?firstlight=1` re-measured `bootToLoop 316ms`
  warm, reveal **janks 0, maxMs 22** (was 287); Chrome `?worker=1` smooth too (janks 0, maxMs 16).
  So `FIRST_LIGHT_DEFAULT = true` — every main-path load renders the reveal on the lean shader and
  swaps to full only on first-need. **Strategic upshot:** first light fixed the cold compile with no
  threads, so the OffscreenCanvas worker's *intro* advantage is now just spawn/transfer overhead
  (Chrome `?worker=1` compile+prime ~1000ms > the default warm boot). **`WORKER_DEFAULT` should NOT
  flip on intro merits** — the worker stays opt-in for a possible future non-intro benefit. See
  future-improvements #1 (marked solved).
- **Prior round (v0.69–0.70, the 07-08 intro-smoothness pass — measured, first light validated):**
  - **First light WORKS (Firefox `?firstlight=1` measured):** `bootToLoop 4372 → 1800ms` (compile
    1703→481, prime 2661→1311), background `fullCompile` swap only 210ms, lean ≡ full confirmed (the
    "magenta ring" mid-reveal is just the splash's designed neon shock-burst, `#ff1f9e`/`#14e3ff`).
    **Still staged (`FIRST_LIGHT_DEFAULT = false`)** pending one more round's confirmation that the
    reveal is now smooth (below), then flip. Chrome `?worker=1` measured compile 1688 / prime 2988.
  - **The reveal stops freezing** (v0.69.0): a Portka `--cadence` pass found a ~1s main-thread freeze
    right after the splash lifts on *every* path. Cause (parallel code audit): the SmoothnessGate
    opens on the cheap pre-ignition frames, so `dismissSplash` snapped `scaler.maxScale=1` right as
    the disk ignited → the scaler's climb-back rebuilt bloom/FXAA/pass targets **all at once, bare**.
    Fix: **ramp `maxScale` introScale→1 over the `FUZZ_FADE_S` haze fade** (rebuilds spread + masked;
    scaler self-paces so no forced thrash). Also **defer the first-light lean→full swap** from
    `formation.done` to the first frame the scene needs full (a hole/tear/merge — a dramatic beat).
  - **Worker path black splash fixed** (v0.70.0): Chrome `?worker=1` showed a ~2s **black** splash —
    the worker's full-shader compile+prime saturates Chrome's *shared* GPU process during the covered
    merger window (compositor can't paint it). Fix: the worker builds its reveal on the **lean**
    shader too (short compile → splash animates), swaps to full on first-need, + the same maxScale
    ramp. `?worker=1` is now usable to evaluate the `WORKER_DEFAULT` flip.
  - **✅ Resolved this round:** `?firstlight=1` re-tested smooth → `FIRST_LIGHT_DEFAULT` flipped on
    (v0.71.0, above). `?worker=1` splash now animates, but the worker is *slower* than the default
    first-light main path (overhead), so `WORKER_DEFAULT` stays off — not worth flipping for the
    intro. (Open question for later: does the worker help anything *else* — e.g. input latency under
    heavy interaction — enough to justify it? No evidence yet.)
- **Prior round (v0.66–0.68, the 07-05 live-review asks):**
  - **The suck is a hurricane** (v0.66.0): a per-frame `hurricane` signal in `bodyUniforms` (full on
    tear/absorb, partial when a body is swept in close) winds the primary disk into log-spiral
    rainbands + faster spin + accelerated inflow + deeper contrast (`flow.ts`/`medium.ts`). 0 at
    rest (default orbits sit past the ~18M trigger band), computed in the shared `updateBodyUniforms`
    (both paths), primary disk compiles ×1 → negligible cold-compile cost.
  - **Panel tidy** (v0.66.1): Galaxy mode moved *into* Advanced as its first item (it used to jump
    from after-Advanced to below-Bloom); Display HUD moved *out* to the regular menu, under Step back.
  - **Share is one clean card** (v0.67.0): shares **only the URL** (`navigator.share({ url })`) so it
    unfurls the single OG card (the `og.png` logo), instead of GIF image + tagline + card. Desktop
    copies the link. (The old "Share needs a real-device check" caveat is largely moot — no canvas
    read, no attached file.)
  - **First light — STARTED (v0.68.0, staged behind `?firstlight`, default off)** — the roadmap-#1
    fix. `createBlackHoleNode({lean})` omits the 4 heaviest per-slot blocks (`streamFeed`, merge
    flash, `streamArc`, `secondaryDisk`) at build time; all no-op during the intro, so lean ≡ full
    for the reveal but compiles far faster. Reveal renders lean → full compiles off-critical-path and
    swaps in (invisible), timed by a new `osp.perf.fullCompile` mark. `resolveFirstLight` +
    `FIRST_LIGHT_DEFAULT` = the one-constant flip. **Next: measure `?firstlight=1` on-device (compile
    / prime / bootToLoop / fullCompile) vs the default, watch for a swap hitch, then flip.**
  - **Intro lag — measured cold Firefox (v0.65.0):** compile 1703 + prime 2661 = bootToLoop 4372ms;
    Portka `--cadence` pins two main-thread freezes (~1.55s @1.68s, ~2.57s @3.23s) onto those marks.
    Firefox is permanently main-path (Gecko gate) so the worker path can't help it — first light
    (above) is the fix that reaches it. `?worker` is a no-op on Firefox.
- **Prior round (v0.63.1–0.65.0, the 07-04 live-review asks):**
  - **Sponsor button** — `.github/FUNDING.yml` gains `buy_me_a_coffee: chrisportka` (renders as a
    first-class Sponsor-menu button beside GitHub Sponsors + the Venmo/$BTC/$ETH custom links) —
    v0.63.1.
  - **The plunge sucks *inward* now** (was "spinning around in place"): `secondaryDisk` elongates
    the mini-disk toward the primary (the origin), twirls faster + brightens with `tear`; the m=2
    buckle is gone. Dropping the buckle + a param also trims the **14×-unrolled** raymarch, easing
    the **cold-compile** behind the first-load intro (the "considerable lag during the intro
    transition" was cold compile+prime delaying loop-start, not frame jank) — v0.64.0.
  - **Galaxy Mode you can actually see** (was "too small to see"): the camera **auto-frames** —
    enter saves the view + `flyToFrame`s out/up to a 3/4 angle fitting the disk; exit flies back.
    Disk compacted (`rOuter` 140→64) to fit the dolly reach; stars are **fixed screen-space size +
    brighter** so the far edge and inner bulge both read — v0.65.0.
- **Prior round (v0.58–0.63, all live-review asks + roadmap):**
  - **Double-click** a body to plunge it, double-click a plunging body to **rescue** it onto a
    stable orbit (`core/pick.ts` shared hit-test, both paths; green "Rescued" tick) — v0.58.0.
  - **Orbit-map orbits are now real Kepler conics** from the state vectors (ellipses, apoapsis-fit
    extent, inclination-correct), not circles — v0.59.0 (protocol v8 carries full state).
  - **Share sends the brand**: the animated Infall **GIF** (`public/share.gif`, ~107 KB, via
    `npm run generate:share-gif`) + "to the stars ~ onestillpoint.app". The rolling clip recorder
    is retired from **both** render loops (a per-frame GPU→CPU readback gone); protocol v9 — v0.60.0.
  - **The plunging hole drags a warped, brightening mini-disk** (stretch along motion, m=2 buckle,
    faster spin, ×3.5 emission — all `tear`-driven) — v0.61.0.
  - **Companion-companion mergers** (the "collisions" from the recording were pass-throughs):
    momentum-conserving, hole-always-captures, volume-additive growth, a bright **merge flash**
    shader term, pink "Bodies merged" tick — v0.62.0.
  - **Galaxy Mode v1** (roadmap #9): Advanced toggle → ~1000 test-particle stars (+ planets) on
    inclined Kepler orbits around the central hole, additive Points overlay, a bloom transition.
    Pure core tested; render layer lazy + defensive. Main-path only; no lensing yet — v0.63.0.
- **Prior round (v0.55–0.57):** Keys button; HUD defaults to just the Orbit map; the **audio
  scaffold** (roadmap **#11** — manifest + tested rotation + muted-by-default `AudioDirector`;
  open item: sourcing/licensing the tracks); the **overwhelming black-hole plunge** (holes rip at
  2.4× arc from further out, 8s clock, 4.2×/√-longer ringdown).
- **The parity numbers are flip-quality (07-03 night, same device):** worker vs main —
  compile 447/455, prime 536/533, p95 36/35ms; only maxMs differs (71 vs 42). This is the
  data that clears the `WORKER_DEFAULT` flip once the panel-parity residue is closed.
- **Everything formerly "post-1.0" is now a 1.0 prerequisite** (user directive): the flip
  residue, palette (#3), README clip (#4), inspiral design (#6), **Galaxy v2** (worker parity +
  lensing), Kerr (#10), audio assets (#11) all sit before the 1.0.0 tag.
- **Blind-tuned dials awaiting the next clips:** the overwhelming hole plunge
  (`RIP_SCALE_HOLE`/`PLUNGE_DURATION_HOLE`/`RIPPLE_MASS_GAIN`), the **new** inward-suck mini-disk
  (the `toCenter` stretch factor + tear twirl/brighten gains in `secondaryDisk`), the merge flash,
  and Galaxy Mode's **new** framing (`CameraRig.flyToFrame` distance factor 2.35 + the 3/4 angle,
  the compact `rOuter` 64; star sizing is now billboard-quad `STAR_SCALE` 0.5 / `BRIGHTNESS` 1.5
  + the glow-breath amplitudes, v0.78.0 — the old `size` 3 is retired). All set by eye — the next Chrome +
  Firefox recordings are the check on whether the suck-and-twirl reads right and the galaxy frames
  well on a real screen (esp. mobile portrait).
- **Both browsers verified good (the 14:33/14:35 recordings + perf objects).** Firefox: the
  Gecko gate works — clean main-path load, `prime` 522ms covered, gate 80ms, maxMs 63. Chrome
  `?worker=1`: warm-cache compile 146ms, prime 145ms, post-reveal p95 36ms. The standing
  baselines.
- **The OffscreenCanvas migration is functionally COMPLETE behind `?worker=1`** — steps 1–5 all
  shipped, 6's seam in place, only the default flip staged:
  - **4a** (v0.49.0): the control channel + worker panel (22-key `controlMap`, table-tested).
  - **4b** (v0.51.0 + v0.52.0): the HUD (incl. the new orbit map) streams from the worker
    (`frame` telemetry, gated by `command 'hudStream'` — hidden HUD = zero messages), and the
    **full DVR lives worker-side** (History + Timeline + the exact main-path tick block +
    BirthTicker); main renders the same scrub bar from message-fed mirrors, scrubs round-trip as
    commands. Protocol v6.
  - **5** (v0.53.0): Share — `createClipRecorder` is canvas-agnostic and encodes the rolling mp4
    **in the worker**; `command 'shareCapture'` → `share` bytes → main wraps the File for the
    share sheet (gesture stays on main). Floor: still PNG via `convertToBlob` with the recorder's
    status as the stated reason (workers have no MediaRecorder — no mid-tier there). Protocol v7.
  - **6 seam** (v0.54.0): `resolveRenderPath()` — one pure, fully-tested election; `?worker=0`
    escape hatch; **the flip is one constant, `WORKER_DEFAULT` in `src/worker/capability.ts`**.
- **To flip `WORKER_DEFAULT` (the last migration act):** (a) panel-parity residue — Replay intro
  (the melt spans threads), keyboard shortcuts, settings persistence, touch tooltips; (b)
  on-device parity numbers (`osp.perf` main vs `osp.workerPerf` worker: maxMs/janks, Mac +
  phone); (c) a real-device worker-path Share check. Checklist:
  [`offscreen-canvas-session.md`](archive/offscreen-canvas-session.md).
- **The HUD grew a live overhead orbit map (v0.50.0, a live-review ask):** central hole, typed
  companion dots riding their current orbit circles (true predicted ellipses = the feature's
  iteration two), plunging bodies draw hot, and a camera chevron (rim-riding when outside the
  extent). Works on BOTH paths (worker via the 4b telemetry). Pure projection helpers are
  unit-tested; "Orbit map" toggle in the Display-HUD folder.
- **Earlier this day:** Firefox wedge diagnosed twice → fail-safe boot (v0.47.0) + Gecko gate
  (v0.47.1); Chrome "double splash" = dust-loop unison rebirth → per-particle desync (v0.47.0);
  site evaluation F/50 → A*/93 (v0.48.0: share cards + generated og.png, robots/sitemap/canonical,
  JSON-LD, manifest, llms.txt, security.txt, rename refs to `one-still-point`).

## ⚠️ Open caveats — read before touching these

- **Real-device asks outstanding:** (1) Chrome/iOS `?worker=1` — exercise the panel + HUD/orbit
  map + scrub bar + Share (each is new since the last device pass); (2) the flip's parity numbers
  (above); (3) main-path Share on a phone (the v0.39.1 caveat still stands — this environment
  cannot read the WebGPU canvas at all).
- **Worker/main dual-engine drift:** until `WORKER_DEFAULT` flips and the main path's duplicate
  wiring is retired (post-flip cleanup), changes to Scene/formation/reveal/HUD dials must land in
  BOTH `src/main.ts` and `src/worker/workerEngine.ts`. The DVR tick block is deliberately
  copy-exact between them.
- **CHANGELOG editing hazard:** the version test only checks the current version's entry — after
  any edit run `grep -n '^\- \*\*0\.' CHANGELOG.md` and eyeball the sequence.

## The road to 1.0.0 (roadmap distilled)

1. **Flip `WORKER_DEFAULT`** after the parity items above (roadmap #1's finish line).
2. **Post-flip cleanup** — reveal machinery fully worker-side, retire duplicate main wiring.
3. **#3 palette unification** (warm-silver theme pass) · **#4 README live clip** (needs a real
   device capture) · **#6 inspiral dynamics** (open design call) — polish tier.
4. **#9 swarm/galaxy** (the GPU path's payoff) · **#10 Kerr** (the trophy, last, own step budget).
5. Launch: Show HN / r/threejs / r/webgpu / three.js showcase / Product Hunt — the share cards
   (v0.48.0) were the prerequisite.

## How we work here (the essentials)

- **Portka SOP:** sync `main` → branch → tests + CI green → PR → merge on green → short PR link.
- **SemVer triplet enforced:** package.json ↔ src/version.ts ↔ CHANGELOG entry (version test).
- **CI:** `ci.yml` every PR; `validate-physics.yml` only on physics/shader-maths paths.
- **Measure, don't guess:** recordings (Portka video-bug-analyzer) + on-device `osp.perf` /
  `osp.workerPerf`; the user supplies both on request.

## Map of the docs

The living docs (this folder): **`handoff.md`** (here) · [`future-improvements.md`](future-improvements.md)
(the roadmap to 1.0.0) · [`intro-script.md`](intro-script.md) · [`physical-script.md`](physical-script.md)
(the two scripts + the reversibility covenant).

Everything historical now lives in [`archive/`](archive/README.md) — the migration checklist
([`offscreen-canvas-session.md`](archive/offscreen-canvas-session.md), 1–5 ✅, 6 seam ✅ / flip staged),
the OffscreenCanvas design, the measured screen-recording investigations
([`perf-recording-*`](archive/perf-recording-2026-07-03.md)), and the frame-rate notes.
