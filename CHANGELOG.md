# Changelog

All notable changes to One Still Point, newest first. Dev notes and deep dives
live in [`docs/`](docs/) (intro script, recording findings, perf audits).

## 0.47.x — The worker path fails safe (from the first `?worker=1` field test)

- **0.47.1** — **Firefox is gated out of the worker path (the second field test).** The v0.47.0
  fail-safe held its side of the bargain — but Firefox's workers *answer* the WebGPU adapter
  probe, then wedge the GPU process a few seconds after the reveal anyway (12:42 recording,
  deployed v0.47.0 confirmed live: reveal at ~8.7s, dolly stalls, hard-frozen from ~12.5s).
  Meanwhile Firefox's **main-thread** WebGPU is proven smooth (the 07-02 measured reports). So
  `?worker=1` on Gecko now logs why and runs the main-thread renderer; **`?worker=force`**
  bypasses the gate so future Firefox releases can be re-tested without a build. `isGeckoUA` is
  pure + unit-tested (Gecko UAs on all platforms match; Chrome/Safari's "like Gecko" and WebKit
  FxiOS do not).
- **0.47.0** — **The worker path fails safe, and the splash's "double play" is gone — the two
  findings of the first three-browser `?worker=1` field test** (Chrome + Firefox + iOS recordings,
  frame-analyzed; full report in
  [`docs/perf-recording-2026-07-03.md`](docs/perf-recording-2026-07-03.md)). **(a) Fail-safe
  worker boot (protocol v4).** Firefox booted the worker path, revealed, stuttered, then
  hard-froze the tab at ~8s (force-restart territory): three's renderer had silently fallen back
  to **WebGL2 *inside* the worker** (Firefox exposes no `navigator.gpu` there) and the untested
  combo wedged the GPU process. The worker now **probes for a real WebGPU adapter before any
  renderer exists** (3s budget) and posts `capability` (also the "worker alive" heartbeat) then
  `unsupported` when the answer is no — WebGL2 stays a main-thread-only fallback, by policy. The
  host **falls back to the proven main-thread renderer** on `unsupported`, on any pre-`ready`
  error, or on watchdog timeout (10s no-signal / 45s no-ready): terminate the worker, drop its
  canvas, build the ordinary engine under the still-covering splash. A worker mishap can no longer
  strand the splash or cost a dead tab. **(b) The Chrome "double play of the splash" was the dust
  loop re-bursting in unison.** Frame analysis showed no second page load, creation, or merger —
  what replayed at ~3.6s was the **dust field**: every particle's re-breath cycle was a uniform
  ~1.7–1.86s (v0.43.1's loop), so on a boot long enough to reach the second breath (the worker's
  measured 1976ms compile + 1667ms prime) the whole field faded out and was reborn *together* — a
  synchronized re-burst reading as "the splash played twice." iOS (worker ready in <1s of dust
  time) showing a single play was the confirming control. Loop periods are now **per-particle**
  (`1.5 + R(0, 1.4)`s): rebirths spread over ~1.4s and decorrelate further every cycle, so the
  field thins and replenishes continuously. The authored first burst is untouched. Unit tests:
  the router's `unsupported` routing + the v4 protocol guards; 193 total.

## 0.46.x — The full engine runs off the main thread (OffscreenCanvas step 3c)

- **0.46.3** — **`.github/FUNDING.yml` mirrors the About modal's Donate row.** The repo's Sponsor
  button now offers the same three options as the app: **Venmo** (`venmo.com/portka`), **$BTC**,
  and **$ETH** — GitHub's `custom:` entries must be URLs, so the two addresses link to their block
  explorers (mempool.space / etherscan.io, address front-and-centre), matching what the in-app
  chips copy. `github: [cportka]` retained for GitHub Sponsors itself.
- **0.46.2** — **Plunge finale: a full halo ring, and a snappier − key (both from the live
  review).** **(a) "The final shape to be a full halo circle for a few revolutions before the
  end"**: the tear stream's arc now sweeps past a full turn (`STREAM_MAX_ARC` → 6.6 rad), and the
  trailing spiral **circularizes as the tear completes** (the spiral pitch fades with `tear`), so
  at full disruption the streak closes into a clean ring — a bright halo orbiting just above the
  horizon for the final fast revolutions, then the dive and spark. **(b) "The debounce is still
  too long"** (round 2): the − stepper's tap-guard now releases at 12% of the plunge (~0.54 s)
  instead of 50% — rapid multi-body removals chain nearly as fast as you can tap, while still
  absorbing an accidental double-tap. Unit tests updated: the new debounce timings, plus a
  loop-act sample asserting one constant radius (a perfect circle) above the merge radius with
  the azimuth wrapping past 2π. Also: [`docs/handoff.md`](docs/handoff.md) refreshed to current
  (it had last been updated at v0.43.1 — now covers the 0.44–0.46 arc: worker migration state,
  the `?worker=1` re-test ask, brand v2, and the worker/main dual-engine caveat).
- **0.46.1** — **About + panel chrome polish (from the live review).** **(a) The Donate rows
  compact into one row**: a "Donate" label with three chips — **$BTC** and **$ETH** copy their
  address on click (the same ✓ flash, now dead-centre on the chip; full address in the tooltip) and
  **Venmo ↗** opens `venmo.com/portka` in a new tab. **(b) The still Ember-Core mark rides the
  control panel's title row**, right-aligned beside "One Still Point" (it's the favicon, so it's
  already cached; decoration-only — the title button still folds the panel).
- **0.46.0** — **OffscreenCanvas step 3c: the complete dynamics run in the worker — and the
  `?worker=1` tab crash is fixed.** The crash: the step-2 proof loop self-drove on
  `setTimeout(16)`, submitting heavy raymarch frames with **no vsync pacing or presentation
  backpressure** — command buffers piled up in the GPU process until the tab died. The loop now
  runs on **`renderer.setAnimationLoop`** (real vsync-paced worker rAF) via the same `Loop` class
  as the main path. On top of that, the whole simulation moved across: the `Scene` + N-body
  physics, the formation dolly + staggered swooshes, the adaptive `ResolutionScaler` with the
  intro deep cut (pinned while covered), the fuzz/`volumeStep` reveal ramps, the mass-scaled
  ripple, the full measured pre-warm (correct-variant `post.compileAsync` + lit-disk prime + a
  real `onSubmittedWorkDone` drain), the `SmoothnessGate`, and the `RevealProfiler`. **The splash
  choreography stays on main** (protocol v3): the worker posts `revealReady` when its gate opens →
  main waits out the splash hold from the merger's first painted frame → hides the splash → sends
  `command('reveal')` → the worker runs the haze reveal. Debug telemetry for exactly the crash
  reports we need: worker `perf` (the reveal profiler, at `osp.workerPerf`), throttled `status`
  (`osp.workerStatus`), **rate-limited** uncaught-error relay, and — the adversarial review's
  major catch — the host now listens for the Worker *object's* `error` event, so a worker script
  404/eval failure surfaces instead of stranding the splash forever. Review fixes also: a resize
  during boot no longer gets clobbered by the init size; a worker error runs the reveal path once
  (never a stranded splash); perf-mark semantics match the main path (`smoothGate` ends at
  gate-open, `loopToReveal` spans loop→reveal); tap-to-skip dispatches to the camera *before*
  skipping (the skipping tap can't grab the camera), and the main path's skip is no longer a
  once-listener a guarded stray tap could consume. Adversarially reviewed (10 confirmed findings
  fixed or accepted-with-note, 2 refuted); 192 tests. Still `?worker=1` opt-in (flip is step 6).

## 0.45.x — The worker render path becomes interactive (OffscreenCanvas step 3)

- **0.45.1** — **The animated mark's motes render correctly in Firefox.** The Infall mark drew each
  stardust mote **twice** — a blurred glow copy under a sharp copy, both moved by `offset-path` —
  and each copy's SVG `filter` region is resolved from the element's bounding box *at the origin*;
  Gecko doesn't re-expand that region as the motes travel ~300px along the path (Chrome/WebKit do),
  so Firefox showed a bright object and a dark clipped ghost side by side. Fix: **one circle per
  mote, glow baked into a radial-gradient fill** (`#a-mote` — solid `#e9e3d5` core to ~42%, soft
  falloff, sized to the old core+glow stack) — **no filter on any animated element**, so there is
  nothing to desync in any engine. Applied to both copies (`assets/hero.svg` + the About card); the
  still mark is untouched (its filtered stars are static — the bug needs `offset-path` + `filter`
  together). The unused `a-dustglow` filter is dropped.
- **0.45.0** — **OffscreenCanvas migration, step 3 (input + resize): you can now orbit and zoom the
  off-thread view.** The `?worker=1` render path — until now a static formed proof — gets an
  **interactive camera running entirely in the worker**: a new
  [`ElementProxy`](src/worker/elementProxy.ts) implements exactly the DOM surface three's
  `OrbitControls` touches (audited from r184 source, which even routes its document listeners via
  `getRootNode()` "for offscreen canvas compatibility"), the real `CameraRig` instantiates over it
  unmodified (a new injectable `coarse` option replaces the `matchMedia` probe workers don't have),
  and the main thread captures pointer/wheel on the on-page canvas and replays them as plain
  messages (**protocol v2**: pointerId/pointerType/button for multi-touch, wheel
  deltaMode/ctrlKey for trackpad pinch; the real canvas does the pointer capture +
  `preventDefault`s, `attachWorkerInput` in `workerHost.ts`). Sizing is honest now too: the worker
  applies the **quality tier's scale + DPR cap** (tier resolved on main — workers can't probe), and
  resize re-derives the buffer + aspect. The worker also pre-warms via **`post.compileAsync()`**
  (the v0.42.2 correct-variant compile), entirely off-thread. **The riskiest seam is unit-tested on
  Node**: `elementProxy.test.ts` drives the *real* OrbitControls through the proxy — a replayed
  drag orbits the camera at constant radius, a replayed wheel dollies it, coarse framing pulls the
  home pose back. Router/protocol tests updated (19 worker tests). Session checklist 3a+3b ticked
  in [`offscreen-canvas-session.md`](docs/offscreen-canvas-session.md); next: **3c — the full
  dynamics (Scene/physics/formation/scaler) in the worker.** The default path is unchanged
  (`?worker=1` opt-in until step 6).

## 0.44.x — The monoline marks (branding v2)

- **0.44.0** — **Both logos updated to the monoline marks (roadmap #3, art pass v2).** The **still
  mark** — a monoline black hole on an opaque void tile: a bright photon halo hugging the
  event-horizon sphere, a thin accretion orbit tucking *behind* the halo at the back and riding *in
  front* across the body, three glowing dust stars — replaces `assets/logo.svg` and the favicon
  (`public/favicon.svg`). The **"Infall" animated mark** — the same monoline hole with stardust
  motes rising from behind the halo, sweeping over the top, and setting behind it (CSS
  `offset-path`, gated behind `@supports` + `prefers-reduced-motion` so it degrades to the still
  composition with the dust hidden) — replaces `assets/hero.svg` (the README hero) and the
  About-card art (`about.ts`, verbatim — the new mark carries no background tile). Art verbatim
  from the design pass; palette shifts from warm ember to the cooler monoline silver
  (`#c4beb2`/`#d8d1c4`, dust `#e9e3d5`).

## 0.43.x — The plunge finale: fast horizon loops before the spark

- **0.43.2** — **Docs: the OffscreenCanvas side-session brief + handoff.** Added
  [`docs/offscreen-canvas-session.md`](docs/offscreen-canvas-session.md) — the requested
  evaluation (the migration is app-only work, **no third-party edits**; a maintained three.js fork
  is *not* recommended — instead three well-scoped upstream PR candidates the measurements
  surfaced, incl. the async post-compile gap behind the v0.42.2 freeze and the never-used
  `createComputePipelineAsync`) plus the **PR-sized todo list** for the side session (steps 3a–6 +
  post-flip cleanup, each with acceptance criteria). Handoff current (v0.42.2 verified on-device:
  `maxMs` 92 vs 1523). No runtime changes.
- **0.43.1** — **The splash stays alive for as long as it has to cover a slow boot (the "lag"
  between splash end and the engine appearing, from the iOS + Firefox recordings).** The v0.42.2
  freeze fix verified on-device (`maxMs` 92 vs 1523, a real `prime` mark) — the remaining complaint
  was *perceived*: the splash dust **self-stopped 1.7s in** (an old GPU-saving cap) and every
  particle fades out by ~2s by design, so while a slow device (iOS ~2s, Firefox ~0.9s in the
  recordings) booted under cover, the splash sat **frozen-static** and the wait read as lag. The
  dust field now **loops** — each particle re-breathes on its own cycle (alpha is 0 across the
  wrap, no pop; each rebirth advances by the golden angle so paths never retrace) — until the
  engine actually dismisses the splash (the hide + 0.5s stop is unchanged; the old cap is now only
  a 60s never-booted safety ceiling). *"Nothing here is ever truly still."* On a fast device the
  first cycle is all that shows — visually identical to before. Verified with the headless
  `npm run verify:intro` beats harness.

- **0.43.0** — **The − plunge ends in fast, perfect horizon loops; the gravity ripple is 20%
  smaller; the − debounce releases at half the plunge (all from the 07-02 plunge review).**
  **(a) The loop-and-dive finale.** The plunge now plays in three acts (`Scene.prune`): a graceful
  **descent** out of the orbit (first 50%), then a **hold on a perfect circle** just above the
  horizon (`PLUNGE_LOOP_RADIUS = MERGE_RADIUS × 1.25`, 50→92%) — the radial rate is exactly 0
  through the hold, so the torn light-streak lingers and **wraps ~2–3 clean fast rings** (the
  Kepler sweep floor lowered `0.22 → 0.15` ⇒ the loop spins at ~17× the body's own starting rate)
  — then the final **dive** through the merge radius into the same absorption spark + ripple as
  ever. Unit-tested: through the hold the radius stays constant to <0.01 above `MERGE_RADIUS` and
  the wind wraps > 2π; the dive then absorbs. **(b) Ripple −20%** (review: "20% too large"):
  `RIPPLE_SPEED 0.72 → 0.58`, `RIPPLE_WARP 0.09 → 0.072` (`background.ts`). **(c) − debounce
  halved:** `Scene.removing` now releases once the in-flight plunge is **half** done (was: the full
  plunge + absorption), so the next − fires while the previous body finishes its finale — tested.

## 0.42.x — The Ember Core mark (branding, roadmap #3)

- **0.42.3** — **Docs: the second recording analysis + handoff refresh (the overnight batch).**
  Added [`docs/perf-recording-2026-07-02.md`](docs/perf-recording-2026-07-02.md) — the Chrome +
  Firefox cold-load evidence, the verified wrong-pipeline-variant mechanism behind the ~2s freeze,
  the v0.42.2 fix, and the on-device verification scoreboard for the morning (expect `maxMs` < 100,
  `janks ≈ 0`, a real `prime` mark, a gliding reveal). Handoff brought current (as of v0.42.2):
  brand landed, ringdown reworked, OffscreenCanvas demoted from *urgent* to the 1.0 robustness play
  if v0.42.2 verifies. No runtime changes.
- **0.42.2** — **The cold reveal's real culprit, found and fixed: the pre-warm compiled the *wrong
  pipeline variant*, and the reveal gate couldn't tell (roadmap #1, measured on Chrome + Firefox).**
  The fresh Chrome/Firefox recordings + `osp.perf` showed a single **1.5–2s page-wide freeze** at
  loop start (`maxMs ≈ loopToReveal − 5 frames` on both), the splash hold expiring *during* it → an
  abrupt hard-cut reveal. Verified against stock three r184 source: `renderer.compileAsync(scene,
  camera)` compiles against the **default framebuffer**, but the raymarch actually renders into the
  post `pass()`'s HalfFloat render target — and the RT's color format is part of the pipeline cache
  key, so the pre-warm warmed a variant `render()` never uses. The real one — plus ~9 post-chain
  pipelines (bloom's 7, a hidden RTT that `fxaa()` inserts, the output quad) — compiled
  **synchronously in the GPU process** at first submit (the normal render path never uses
  `createRenderPipelineAsync`; only `compileAsync` does), stalling presentation and freezing every
  rAF on the page (the splash dust too) while main-thread JS stayed runnable. Three fixes: **(a)**
  the pre-warm now calls **`PassNode.compileAsync(renderer)`** (exposed as `post.compileAsync()`) —
  binds the pass's RT so the *correct* raymarch variant compiles async; **(b)** the two covered
  priming renders are followed by **`device.queue.onSubmittedWorkDone()`** (guarded for the WebGL
  fallback) — the old awaited rAF resolved while ~2s of queued sync compiles were still pending, so
  the debt landed on the first live frames; now it genuinely drains under the splash (new `prime`
  perf mark); **(c)** the 5-raw-frames reveal gate is replaced by a **`SmoothnessGate`**
  (`src/core/SmoothnessGate.ts`): the crossfade schedules only after **6 consecutive inter-tick gaps
  < 50ms** (widened under a cinematic frame cap; 4s ceiling so a slow device is never stranded) — a
  stall resets the streak, so the reveal can never again fire into a freeze, whatever causes it
  (Firefox-internal compiles, GC, the first lit march). Re-armed on Replay. Unit-tested
  (`SmoothnessGate.test.ts`, 8 cases incl. the measured 2s-stall scenario). Verify on-device:
  `osp.perf` should show a small `prime`, `maxMs` well under 100, `janks ≈ 0`, and a `smoothGate`
  mark ≈ the streak length.
- **0.42.1** — **The ringdown reads as an actual gravitational wave, not a fog (roadmap #6, from the
  plunge recording).** The post-absorption ripple was dominated by its glow band — a huge, diffuse
  milky whiteness swallowing the sky (exactly what the review called "washed-out vibration / vague
  spread whiteness"). A real wave *displaces*, it barely glows — so the signal is now the
  **distortion**: `RIPPLE_WARP 0.022 → 0.09` (the sky visibly drags as the front passes), the profile
  is **asymmetric** — a sharp, crisp leading edge (`RIPPLE_W2_LEAD 0.012`) with a longer trailing
  wake of ringing crests (`RIPPLE_W2_TRAIL 0.1`, `RIPPLE_FREQ 26` ⇒ ~2–3 visible crests decaying
  behind the front — the ringdown) — the front sweeps faster (`RIPPLE_SPEED 0.55 → 0.72`) and rings
  a touch longer (`RIPPLE_TAU 2.2 → 2.6`), and the glow is cut to a faint cool glint on the leading
  edge only (`RIPPLE_GLOW 0.07 → 0.015`, and it no longer rides the whole wake). Still globally
  applied, still mass-scaled (`rippleStrength`), still a no-op when idle. **Blind-tuned — verify
  against the next plunge recording**; all dials at the top of `background.ts`.
- **0.42.0** — **The new logo lands: the "Ember Core" mark, static + animated (roadmap #3).** The
  art-directed mark — a tilted warm-silver accretion ring (`#c3bcab`/`#d2cab6`) wrapping an
  ember-lit event-horizon sphere (`#ffd2a6` embers), with the ring passing *behind* the globe (the
  far side masked + faded) and *in front* with a black occlusion cut — replaces the previous
  wireframe mark everywhere: **(a)** the static mark ships as [`assets/logo.svg`](assets/logo.svg)
  and as the app's **first-ever favicon** (`public/favicon.svg`, linked from `index.html` — the app
  had none); **(b)** the animated mark (stardust spiralling inward along the ring via CSS
  `offset-path`, settling still under `prefers-reduced-motion`) replaces
  [`assets/hero.svg`](assets/hero.svg) (the README hero) **and** the About-card art (`about.ts`,
  with the background tile stripped so it sits transparent on the card). The mark's warm-silver
  palette is now the brand reference for the remaining #3 theme unification (roadmap updated). No
  engine/runtime changes.

## 0.41.x — Body life-cycle feel: stable adds, a plunge that falls from its own motion

- **0.41.1** — **Docs: the recording analysis report + the two-scripts policy.** Added
  [`docs/perf-recording-2026-07-01.md`](docs/perf-recording-2026-07-01.md) — the full frame-by-frame
  analysis of the Firefox/Mac cold-load recording + `osp.perf` (evidence, the ~800ms two-stall
  diagnosis fixed in v0.40.3, the Firefox WebGPU pacing finding, options A/B/C weighed with
  pros/cons, and the next measurements). Added
  [`docs/physical-script.md`](docs/physical-script.md) — **the physical script** that now rides
  alongside the art-directed [`intro-script.md`](docs/intro-script.md) (what's honest physics vs
  phenomenological vs theatre, beat by beat), codifying the **reversibility covenant**: irreversible
  physics allowed during the intro window only; the settled sim stays bit-exact reversible
  (Step-back / DVR). Handoff refreshed. No runtime changes.
- **0.41.0** — **Adds prefer a stable orbit; the − plunge dives from the body's own motion; the tear
  reads more spaghettified.** Three body-lifecycle refinements from the live review. **(a) The − spin
  kick is gone.** The removal plunge used a fixed wind (4 turns / 4.5s) regardless of the body's real
  motion — an instant whip-up at the press, and a *retrograde* body visibly reversed. The spiral now
  winds **from the body's own captured angular rate** (signed, converted to wall-clock via the physics
  time scale — exactly the spin the eye is tracking, so there is no visible acceleration at the start)
  and **quickens as it falls like a true infall** (Kepler sweep, ω ∝ (r/r₀)^{-3/2}, floored at
  `PLUNGE_KEPLER_FLOOR = 0.22` ⇒ ≤ ~9.7× the starting rate at the finale) — beautiful *and*
  physically-shaped. New per-body `plungeOmega`/`plungeAngle` state (cleared on timeline rewinds).
  **(b) Adding a body prefers a stable orbit.** A + add with no explicit radius now lands in the
  **widest open radial gap** between the companions already there (`openOrbitRadius`, with a little
  jitter), instead of anywhere at random — radial separation is what prevents the early close
  encounters that scatter orbits. The seeded intro line-up (hand-picked radii) is untouched, so the
  intro is byte-identical. **(c) More spaghettified.** The torn-stream gas is brighter and wispier
  (`STREAM_EMIT 0.12 → 0.17`, `STREAM_EXT 0.25 → 0.21`, dials at the top of `raymarch.ts`) so the tear
  reads clearly against the disk — **verify against the next screen recording** and dial from there.
  Unit-tested (plunge keeps the body's direction + rate at the press; gap placement lands mid-gap).

## 0.40.x — Companion orbits precess (a relativistic-looking apsidal drift)

- **0.40.3** — **Kill the ~800ms freeze at the splash→engine reveal (roadmap #1, measured).** A
  Firefox/Mac screen recording + `osp.perf` (analyzed frame-by-frame with the Portka
  `video-bug-analyzer`) caught the reveal freezing solid for ~800ms (motion 0.00 from ~4.9–5.7s, two
  discrete stalls; `maxMs 394`, 31 janks, 2 reveal-window resizes) — **main-thread JS blocks, not GPU
  load**. Two causes, two fixes. **(a) The control panel was mounting mid-reveal:** the old
  `requestIdleCallback(timeout 2.5s)` fired its ~54KB chunk fetch + heavy synchronous lil-gui DOM
  build inside the crossfade. It now waits for **the formation to settle** (`formation.onDone` — the
  moment "control returns to the audience", where a panel belongs anyway; a tap-skip mounts it
  early), then mounts on the next idle slice. The rolling share-clip recorder starts there too.
  **(b) The scaler was resizing at the dismiss moment:** fast covered frames let it climb (resize #1),
  and the re-arm at dismiss dropped it back (resize #2 — a bloom/FXAA pipeline rebuild landing
  exactly on the reveal). `armIntroScale` now **pins the ceiling** (`maxScale = introScale`) while
  covered, released at dismiss — zero reveal-window rebuilds; the climb-back belongs to the
  haze-masked settle. Re-measure with a fresh recording + `osp.perf` (the `resizes` counter should
  read 0). Brought
  [`docs/handoff.md`](docs/handoff.md) current (now _as of v0.40.1_): recorded the intro-timing tweaks
  (v0.39.6), the precession (#7, v0.40.0), and the mass-scaled ripple (#6, v0.40.1), and surfaced the
  two open decisions left for a deliberate call — the `PRECESSION_K` look intent, and #6's two-hole
  inspiral fork (scripted vs a dissipative drag). The active-problem note now also asks for a screen
  recording alongside `osp.perf.report()` on the next cold-reveal pass. No runtime changes.
- **0.40.1** — **A black-hole merger rings harder than a star plunge (roadmap #6 — the ringdown
  cue).** The spacetime ripple (the expanding, decaying sky-warp fired when a body falls into the
  hole, shipped v0.27–0.29) was identical for a dust speck and a black-hole coalescence. It now scales
  with the absorbed body's mass: a new `rippleStrength` uniform multiplies the ripple envelope in
  `rippleWarp` (`render/tsl/background.ts`), set on the `absorb` event from
  `rippleStrengthForMass(body.mass)` (`render/rippleStrength.ts` — GW strain ∝ mass, so linear and
  clamped). A star/planet plunge stays at **1×** (the unchanged baseline — no regression for the
  common case), a secondary hole rings at **~2.6×** (a visibly stronger distortion + brighter
  wavefront glow). **Zero intro / default-scene cost:** the strength is one extra multiply on the
  already-gated, once-per-ray sky path (idle ⇒ envelope 0 ⇒ no-op), and the default scene seeds no
  holes, so a stronger merger only fires for a hole the user added. Unit-tested
  (`rippleStrength.test.ts`: baseline / hole-louder / clamp / monotonic). The bigger half of #6 — the
  two-hole **inspiral dynamics** (so holes spiral in and merge rather than slingshot) — is a separate,
  larger piece with a real design choice (scripted vs a dissipative drag that trades the bit-exact
  reversibility), left for a deliberate decision.
- **0.40.0** — **Relativistic-*looking* perihelion precession (roadmap #7), the reversibility-safe
  way.** A companion's pull from the primary now carries one extra **position-only** inverse-cube
  term, so the central force is `f(r) = M/r² + k/r³` (`PRECESSION_K = 0.3`, `integrators.ts`). That
  force precesses the ellipse *analytically* — apsidal angle `Φ = π√(1 + k/r)`, so the orbit advances
  `Δφ = 2π(√(1 + k/r) − 1)` per turn (≈ 2–3°/orbit at these radii) — reproducing the GR perihelion
  advance's `~1/r` falloff with a single constant. The key choice: it is a pure function of position
  (a gradient of `U = −kM/(2r²)`), **not** a velocity-dependent 1PN term, so velocity-Verlet stays
  symplectic and **bit-exact time-reversible** — Step-back and the DVR timeline are untouched
  (`integrators.test.ts` proves the reverse run returns, which now also guards this term). It's a
  *look* dial, not a geodesic (literal weak-field GR is `k = 6M`, a fast rosette here); `0.3` is a
  slow, on-theme drift, most visible once an orbit is eccentric (e.g. after a scattering). Gated to
  the companion↔primary pull only (never companion↔companion), and **zero intro cost** — it's CPU
  N-body (~6 extra flops/frame at the default N = 7), touches no shader/per-ray path, so the cold
  splash→engine reveal is unaffected. Validated: `scripts/validate-orbit.mjs` now asserts the measured
  apsidal advance matches the closed form (within 12%, isolating the physical rate from the
  integrator's discretisation via a `k = 0` control); circular orbits stay bounded + energy-conserving
  against the *true* energy (incl. the precession potential). The unreachable GPU N-body path
  (`GPUPhysicsEngine.accelAt`) is documented as intentionally omitting the term.

## 0.39.x — Bodies are absent in history before they're born

- **0.39.6** — **Intro timing: a longer black hold to pre-warm under, and the model revealed a hair
  earlier.** Two small dial tweaks in the intro timeline (`introTimeline.ts` ↔ the inline
  `__ospDials` mirror in `overlay.html`, kept in lockstep by the `introTimeline.test.ts` guard).
  **(a)** `initialBlackMs` **500 → 600**: the engine bundle's boot (`__ospBoot()`) already fires at
  the *very start* of the intro, so every extra ms of opening black is download + parse + WebGPU init
  + `compileAsync` pre-warm paid **before the splash even paints** (its first frame anchors the reveal
  countdown) — i.e. the added 0.1s is spent warming the cold pipeline, not idling. **(b)**
  `splashHoldMs` **600 → 590**: the live model — whose event horizon is aligned with the splash's —
  now begins showing through the crossfade ~10ms sooner, without visibly shortening the merger. Both
  are cold-load wins; on a warm replay they're just a slightly longer hold / slightly earlier reveal.
- **0.39.5** — **Docs: handoff + roadmap refresh after the cold-reveal session.** Brought
  [`docs/handoff.md`](docs/handoff.md) current (now _as of v0.39.4_): recorded the reveal
  instrumentation (`osp.perf`, v0.39.3) and the two masking wins (the dust-march ramp + the pre-warm
  lit-disk prime, v0.39.4), and rewrote the active-problem note so the **next step is concrete** —
  capture `osp.perf.report()` on the real Mac + a phone and let the numbers pick the next lever
  (compile/pipeline-bound → pre-warm / OffscreenCanvas; ALU-bound → push the dust ramp or a raymarch
  step budget). Added the matching open caveats (the masking wins want a real-device feel-check). Also
  updated [`docs/future-improvements.md`](docs/future-improvements.md) #1's "dials" list to include
  `revealVolumeStep` and the `osp.perf` measurement surface. No runtime changes.
- **0.39.4** — **Two low-risk masking wins for the cold first-load reveal (roadmap #1).** Both are
  hidden by the existing warm haze and both land *exactly* on steady state once it lifts, so neither
  leaves a permanent quality cut. **(1) A dust-march ramp.** After the geodesic, the dominant per-step
  cost is the in-slab volume sampling; the reveal now starts with a **coarser** `volumeStep` (`+60 %`
  at the peak, `revealVolumeStep` in [`quality.ts`](src/core/quality.ts)) and eases it back to the
  tier value on the **same clock** as the haze (`fuzz` 1→0) — a march-space companion to the existing
  screen-space `introScale` cut, so three levers (resolution, dust, haze) now converge together
  instead of resolution carrying the reveal alone. **(2) Prime the *lit* disk in the pre-warm.** The
  two covered `post.render()`s under the splash ran with `formation = 0` (FormationSequence's
  `apply(0)`), and since the shader multiplies disk density by `formation`, they warmed only a *dark*
  disk — the first time the lit volume-compositing path ran was the first *visible* frame. They now
  render the formed state (`formation = 1`, restored immediately so the ignition still animates from
  0), moving that first-use cost under the splash where the rest of the pre-warm already lives.
  Unit-tested (`quality.test.ts`: the ramp's peak / settle / monotonic ease / clamp). Tune both from
  the new `osp.perf` numbers (v0.39.3) on a real device.
- **0.39.3** — **Instrument the cold first-load reveal so it can be *measured* on a real device
  (roadmap #1 groundwork).** The splash→engine hitch only exists on real hardware — this project's
  CI GPU is headless (swiftshader), renders black, and can't capture the WebGPU canvas by any method
  — so every prior judgement about the reveal has been *inferred* from reading curves, never profiled.
  Added [`src/core/RevealProfiler.ts`](src/core/RevealProfiler.ts), a pure (timestamp-in) profiler
  wired into `main.ts` and exposed at **`osp.perf`**. It captures: named span durations
  (`rendererInit`, `compile`, `bootToLoop`, `loopToReveal`); the **true, unclamped** inter-frame
  interval over the first 120 live frames (mean / p50 / p95 / max / jank count — measured directly,
  not via the loop's `frameDelta`, which is clamped to 100 ms and would hide the worst hitches); and
  the count of resolution-scaler resizes during the reveal window (each rebuilds the bloom/FXAA
  targets — a GPU hitch). On a cold load the loop logs `osp.perf.report()` to the console once the
  window fills; it's also readable any time. **Zero behavioural change — measurement only**; the next
  tuning pass picks its lever from these numbers instead of from inference. Unit-tested
  (`RevealProfiler.test.ts`).
- **0.39.2** — **Docs: roadmap + handoff refresh for the next session.** Brought the roadmap
  ([`docs/future-improvements.md`](docs/future-improvements.md)) up to date — item 2 (Share) marked
  shipped with the real-device caveat; item 1 (lag) **narrowed to the cold first-load compile** now
  that the periodic stutter is fixed, with the stale `ResolutionScaler` dials corrected to the
  converge-and-freeze rewrite (and the matching stale comment in `quality.ts`), the `introScale`/
  `FUZZ_FADE_S` values refreshed, and the OffscreenCanvas progress (step 2) reflected; the Road-to-1.0
  sequence and testing-coverage notes updated; and the `offscreen-canvas.md` switchover note corrected
  (the `RenderHost` seam is the step-6 refactor, not step 2). Added a living
  [`docs/handoff.md`](docs/handoff.md) — a "you are here" snapshot (recently shipped, the one active
  problem, the in-flight worker migration, open caveats, what's blocked/out-of-scope, how we work) —
  and a pointer to it from `CLAUDE.md`. No runtime changes.
- **0.39.1** — **Share no longer falls back to a still PNG — it records a live clip instead
  (roadmap #2).** The rolling share clip is a WebCodecs **mp4**, which only materialises when the
  browser has an H.264/AV1 *encoder* **and** that encoder emits the `avcC` decoder config — and on
  many real browsers neither holds (no H.264 encoder, or a hardware H.264 encoder that omits `avcC`),
  so the clip never became ready and Share silently shared a **still PNG** on both mobile and desktop.
  Now, when the rolling mp4 isn't available, Share records a short clip straight off the canvas with
  **`MediaRecorder` + `canvas.captureStream()`** (`recordClip.ts`): `captureStream` taps the
  compositor (no fragile per-frame `drawImage` of the WebGPU canvas) and `MediaRecorder` muxes the
  container itself (no `avcC` dependency), so it produces an **animation** where the encoder path
  can't — an mp4 where the browser records H.264 (Safari / iOS, modern Chrome), otherwise a WebM. A
  still PNG is now only the *last* resort (a platform that can't record the canvas at all). The
  recorder is also exposed at `osp.clip.status` so the exact fallback reason is checkable on a real
  device. *Verified headless: `recordCanvasClip` produces a real animated WebM (honest mp4→WebM MIME
  selection); the WebGPU-canvas `captureStream` itself can't be exercised on this headless GPU
  (swiftshader) but is a standard API on real hardware.*



- **0.39.0** — **Rewinding before a body's creation tick now shows it *absent*, not still orbiting.**
  The seeded line-up (3 stars + 3 planets) is created at load, but its creation marks are dropped
  *later*, staggered, as each body swooshes in during the formation intro — so rewinding to *before*
  those marks used to still show the bodies orbiting, contradicting the timeline. Now a seeded body
  starts **unborn**: it renders and orbits during the intro as before, but is **excluded from
  `History.record`** until its creation tick fires (`BirthTicker` now hands the host the body itself,
  which `Scene.markBorn` flips to born). So the recorded roster grows body-by-body in lockstep with
  the ticks, and scrubbing back across a mark drops that body (the roster restore already revives /
  drops bodies across a change). Verified headless: the recorded window opens with an empty pre-birth
  span, and a rewind to the start shows **zero** companions, returning to six at the live edge.

## 0.38.x — Editing while rewound rewrites history from here

- **0.38.0** — **A body change made while you're rewound now commits the timeline from that moment —
  the recorded "future" is discarded and new history builds from here.** Before, if you scrubbed back
  and added or removed a body, the change applied but the old recorded frames ahead of the marker
  lingered — scrubbing forward replayed a future that no longer matched. Now any user edit (a `+`
  add, a `−` removal, or **Clear companions**) made while the scrub bar is rewound treats the current
  moment as the new live edge: `Timeline.commit()` truncates the recorded future (`History.truncate`),
  the orphaned event ticks past it are dropped (`EventLog.dropFrom`), and the sim plays on live from
  there — so a removal's plunge, for instance, animates forward from exactly where you were watching.
  A new `Scene.onUserEdit` hook fires at the *start* of an edit (before it applies) to drive this; at
  the live edge (the common case) it's a no-op and history extends as before.

## 0.37.x — OffscreenCanvas: the renderer runs off-thread (roadmap #1)

- **0.37.0** — **The renderer now runs in a Web Worker on an OffscreenCanvas — proven end-to-end
  (step 2, off by default).** This is the real fix for the cold-start lag: with the WebGPU renderer +
  the heavy raymarch in a worker, the main thread keeps only the DOM / UI / input, so the splash and
  first frames never block it. Step 2 lands the **render path** behind a flag (`?worker=1`):
  `createRenderer` now accepts a transferred canvas; `workerEngine` builds the **real raymarch + post**
  on it and renders a static formed view; a pure message **`router`** (unit-tested with an injected
  engine) drives it; and `workerHost` (main side) transfers the canvas and relays `ready`/`error`.
  `main()` early-returns into the worker path **only** when `canUseOffscreenRendering` says so — the
  default main-thread path is byte-for-byte unchanged. **Verified in Chromium**: with `?worker=1` the
  worker creates the renderer, compiles the raymarch shader *in the worker*, and posts `ready
  (webgpu)` — i.e. three.js WebGPU + the heavy shader run off the main thread in this environment,
  de-risking the whole migration. *Next (steps 3–6): move Scene/physics/loop in, wire input +
  Controls + the history bar over the protocol, move Share/clip readback worker-side, then flip the
  default.*

## 0.36.x — OffscreenCanvas foundation (roadmap #1)

- **0.36.2** — **Less periodic main-thread work in the history bar (the stutter shows on desktop
  too).** The scrub bar rebuilt **all** its event ticks from scratch every refresh —
  `replaceChildren()` + new `<div>`s + an array allocation, **~10×/s** — i.e. DOM churn + a container
  reflow on a regular cadence, on *every* platform (the resolution-scaler resize from 0.36.1 is the
  GPU-bound half; this is the main-thread half). Now it **reuses a pool of tick nodes** (updates the
  live ones in place, parks the surplus with `display:none` — no create/destroy on the hot path) and
  refreshes them **~5×/s** instead of 10 (the ticks drift sub-pixel per frame as the 2-min window
  scrolls, so there's nothing to gain from refreshing every frame). New reuse test. *The deeper fix
  for the cold-start lag is still the OffscreenCanvas move — in progress.*

- **0.36.1** — **Fixed the periodic post-load stutter — the dynamic-resolution scaler was thrashing
  the pipeline rebuild.** Every scale change calls `applySize()`, which resizes the drawing buffer
  *and rebuilds the post-pipeline targets* (bloom + FXAA) — a real GPU hitch on a phone. The old
  scaler hunted up/down around the target (measured **~10 resizes in 8 s**, and on a GPU-bound device
  it oscillates near the floor indefinitely), so that rebuild fired on a **regular cadence** — the
  stutter. Now the scaler **converges and freezes**: once it has held a scale for a moment it widens
  its acceptable frame-time band (only a large, sustained change pays another resize), and it
  **excludes the post-resize frames from its average** (the rebuild hitch must not read as "too slow"
  and trigger another resize — a feedback loop). Measured **10 → 1 resizes** over the same window.
  Also **removed the intro `maxScale` ramp**: it forced ~a resize per climb step *and* did nothing on
  a GPU-bound phone (no headroom to climb), so it was pure churn — the deep `introScale` cut + the
  haze still smooth the reveal, and the scaler now climbs naturally and settles (so your hunch that
  the ramp "wasn't doing anything" was right). And **dropped the rolling-clip capture 30 → 20 fps**
  (each capture is a GPU read-back + encode on the main thread — a second periodic cost; the real fix
  moves it into the render worker). New convergence test. *The deeper fix for the cold-start lag is
  the OffscreenCanvas move (roadmap #1) — continuing.*

- **0.36.0** — **Scaffolding for the OffscreenCanvas + Web Worker render path** — the real fix for
  the first-load takeover lag (the resolution/haze dial-tuning only *masks* it). Moving the renderer
  + engine into a worker drawing to an `OffscreenCanvas` takes the heavy first-frame work off the
  main thread, so the splash / DOM / input never block. This lays the foundation, **off by default**
  and purely additive — the live app still renders on the main thread, zero behaviour change:
  - **`docs/offscreen-canvas.md`** — the full scope: the architecture (what moves to the worker vs
    stays on main), the message protocol, the risks (the Controls surface, canvas readback for
    Share/clip, input latency, fallback), and a **6-step incremental migration plan** ending in a
    one-line clean switchover behind a `RenderHost` seam.
  - **`src/worker/protocol.ts`** — the versioned, typed main↔worker message contract (init / resize /
    pointer / wheel / control / command / dispose ↔ ready / status / event / error) + runtime guards.
  - **`src/worker/capability.ts`** — `probeOffscreenEnv` + `canUseOffscreenRendering` (the master
    gate: false until explicitly enabled *and* fully supported, with a `forceMain` override).
  - **`src/worker/renderWorker.ts`** — a worker entry **stub** that completes the init → ready
    handshake (and flags a protocol mismatch), ready for the engine to be moved in.
  - Unit tests for all three (protocol guards, the capability matrix, the handshake) — the testing
    system the incremental build grows against (139 tests total).

  *Next: step 2 — construct the renderer + raymarch on the transferred canvas in the worker, behind
  the flag, A/B against the main-thread path.*

## 0.35.x — the rip wraps the horizon

- **0.35.1** — **Codebase tune-up.** A read-through audit found the codebase already clean (no dead
  code, no stray TODOs, exports documented), so this is a focused **DRY** pass: the CPU-side
  `smoothstep` was hand-copied in both `Scene.ts` and `bodyUniforms.ts`, and `clamp01` in
  `Timeline.ts` — all unified into one shared, unit-tested `core/mathUtils.ts` (`clamp` / `clamp01` /
  `smoothstep`), so the plunge curve, the formation `appearFor`, and the timeline scrub can't drift
  apart. No behaviour change — the formulas are identical and every existing test still passes (+ new
  `mathUtils` tests).

- **0.35.0** — **The torn stream now wraps along the orbital circle around the hole, not a radial
  spike.** v0.34.0 pointed the stream along the body's velocity, but late in a plunge that velocity
  curves radial — so the rip still shot straight out from the hole. Now the stream is a hot **arc of
  gas swept along the body's orbital circle**: a new `streamArcHit` primitive (`bodies.ts`) — a tube
  that starts at the body and **trails behind it** (opposite its motion) by an arc that grows with
  `tear` (up to ~260°), wrapping the hole and spiralling gently outward, staying in the orbital
  plane. The body **core shrinks** as it dissolves into the stream, and the stream renders as
  **additive, semi-transparent glowing gas** (composited front-to-back like the dust) — blue-white
  hot nearest the hole, redshifting as it's taken in. At zero tear the arc collapses to a single
  point → a plain sphere, so live bodies are unchanged. (Removed the now-unused `segmentHitsStretched`
  ellipsoid test.) The arc geometry is numerically verified and compiles in Chromium; the wrapping
  look is art-directed (the Roche trigger remains the only checkable number). Dials:
  `STREAM_MAX_ARC` / `STREAM_SPIRAL` (`bodies.ts`), `STREAM_EMIT` / `STREAM_EXT` (`raymarch.ts`).

## 0.34.x — the rip follows the plunge

- **0.34.1** — **More contrast in the settled disk — less milky wash.** The soft gradient was fine but
  the disk settled to a low-contrast, too-bright haze. Pulled back the three things flooding it:
  the cheap diffuse **scatter** fill (`scatterStrength 0.2 → 0.12`, `BlackHole.ts`), the **bloom**
  strength (`0.6 → 0.45`, `PostPipeline.ts`), and the reveal **veil's extra glow** (`1.1 → 0.8`) so
  the settling haze doesn't read as bright. The bright photon ring still blooms; the darks stay dark
  — more range between the darkest dark and the lightest light. All three are live-tunable dials.

- **0.34.0** — **The torn stream now trails along the spiral plunge path, not radially.** On the
  recording, the end of a plunge showed the spaghettified body as a bright spike pointing **toward
  *and* away from** the hole (two redshifted streaks flanking the shadow). That symmetric radial
  spike *is* the literal tidal stretch — the near side falls faster, the far side lags, so the body
  is drawn out radially both ways — but it reads oddly and isn't the more dramatic (and also real,
  at late times) look: debris **sheared along the orbit**, trailing the body as it spirals toward the
  horizon. So the stream now stretches **along the body's velocity** (its path) and **trails behind**
  it — the hot leading tip at the body, nearest the hole and being devoured, with the torn debris
  streaming out behind along the inspiral. Wired by a new per-body `streamAxis` (`bodyUniforms`, the
  unit velocity direction) used as the stretch axis in the raymarch, with the ellipsoid offset back
  along it so the body sits at the leading edge (0 offset for a live body → still a plain sphere); the
  − plunge drives `body.velocity` along the **analytic spiral tangent** (tangential early, curving
  inward as it dives) so that axis is meaningful, and natural mergers use their physics velocity — so
  both read the same. Verified in Chromium: the stream axis is now ~77° off radial (was exactly
  radial). *(Aesthetic, not accretion modelling — the Roche-gated trigger remains the only checkable
  number.)*

## 0.33.x — intro polish: anti-aliasing + a longer, deeper reveal

- **0.33.0** — **Anti-aliased render, a deeper + longer intro reveal, and staggered creation ticks.**
  Three intro/quality passes off the latest screen recording:
  - **Anti-aliasing.** The raymarch renders below native (dynamic resolution, then CSS-upscaled), so
    the photon ring and shadow rim stair-stepped — a low-res "pixel" look at the settled view. Added
    an **FXAA** pass to the post pipeline (`PostPipeline.ts`): one cheap full-screen luma-edge blend
    that smooths those edges (and softens the reveal too).
  - **Deeper + longer reveal.** The splash→engine takeover is the heaviest the app gets and the lag
    was still showing. Cut the reveal resolution **deeper** (high `introScale 0.30 → 0.22`, med
    `0.27 → 0.20`, low `0.24 → 0.18`) and — instead of letting the scaler snap back to full the
    instant frames have headroom — **ramp the ceiling** (`scaler.maxScale`) from the deep cut up to
    native **over ~10 s** with an ease-in, so the image sharpens *gradually* across the whole
    takeover, masked by the (now `2 → 8 s`) warm-fuzzy haze. The reveal owns the deep cut;
    steady-state is unchanged.
  - **Staggered creation ticks.** The seeded stars (and planets) share an appear window, so their
    birth ticks landed on the same frame and stacked into one mark. The `BirthTicker` now spaces them
    ~`0.22 s` apart, so the first stars and planets read as **separate events** on the history bar.
  - Verified in Chromium: the FXAA pipeline compiles, the reveal ceiling ramps `0.22 → 1` over ~10 s,
    and the six births land at six distinct frames.

## 0.32.x — the stream feeds the disk (roadmap #8)

- **0.32.1** — **Smoother first-load reveal + plunge fine-tuning.** Two tuning passes:
  - **Boot:** the splash→engine takeover had gotten choppy again — the roadmap-#8 shader growth
    lengthened the first-load compile and made each frame a touch heavier (*Replay* stays smooth
    because the pipeline's already warm). Cut the reveal resolution **deeper**: each tier now starts
    at an explicit `introScale` *below* its steady-state floor (high `0.40 → 0.30`, med `0.36 →
    0.27`, low `0.30 → 0.24`), the scaler's floor following the reveal down and restored once it
    climbs back — and **upped the warm-fuzzy haze** that masks it (warmer grade + more glow, fade
    `2.0 → 3.0 s`). The boot picture and the resolution-ramp / haze **tuning levers** are now written
    up in the roadmap (item 1) — including why "just multi-thread it" isn't a quick fix (the browser
    already threads the WGSL compile and the download; the real lever is **OffscreenCanvas + a Web
    Worker**, an L-effort 1.0 change).
  - **Plunge:** longer and stretchier — `PLUNGE_DURATION 3.5 → 4.5 s`, `PLUNGE_TURNS 3.5 → 4`, and the
    torn-stream elongation `~9× → ~12×` (a touch thinner across). The ringdown **glow was too
    intense** — dialed down to **a quarter** (`RIPPLE_GLOW 0.28 → 0.07`).
  - Housekeeping: roadmap #8 (TDE) marked **shipped** end-to-end and the Road-to-1.0.0 sequence updated.

- **0.32.0** — **The torn stream now feeds the accretion disk — real mass exchange.** Until now the
  spaghettified stream was a self-contained body effect; the disk it was falling into didn't react.
  Now a star/planet shedding mass within the Roche radius **dumps it into the accretion flow**: a new
  `streamFeed` (`render/tsl/medium.ts`) adds a hot, semi-dense **streak** to the disk at the tearing
  body's azimuth — banded from the disk's inner edge out to the body, tapered by how near the body is
  to the disk plane — so the torn stream visibly *connects* to the disk and brightens it, the hotspot
  tracking the body as it spirals in. (Bodies tear within the Roche radius 14→3, which overlaps the
  disk's 6→20 span, so the streak lives right in the disk.) The whole sweep is gated on a new
  `feedingActive` flag (set in `bodyUniforms` when anything is tearing), so it costs a single branch
  per disk sample whenever nothing is being torn — the default scene pays nothing. New `feedingActive`
  unit tests; verified in Chromium — the flag lights up while a removed body tears through the disk
  (`tidal` 0→1) and clears once it's absorbed, and the modified shader compiles. Tunable dials at the
  top of `medium.ts` (`FEED_DENSITY` / `FEED_FLARE` / `FEED_WEDGE` / `FEED_COLOR`) for the fine-tune
  pass. *Roadmap #8 is now end-to-end: tear → stream → feed the disk → absorb → ringdown.*

## 0.31.x — creation marked on the timeline

- **0.31.0** — **The first stars and planets now mark the history scrub bar where they're born.**
  The default line-up is *seeded silently* (a bulk reseed isn't a user action, so it fires no
  events), which meant the timeline opened blank even though six bodies are **created** right there
  in the intro. A new `BirthTicker` (`core/BirthTicker.ts`) watches the formation and drops a
  creation tick for each seeded body as it swooshes in — keyed off the same `appearFor` curve that
  fades it in — so the stars mark first (a gold cluster) and the planets a moment later (a blue
  one), exactly when they appear. It re-arms on Replay (the formation restarting from the top with
  a fresh line-up). New `BirthTicker` unit tests; verified end-to-end in Chromium — the intro fires
  3 star + 3 planet creation ticks, stars before planets, at their appropriate positions.

## 0.30.x — the torn stream (roadmap #8)

- **0.30.0** — **The torn stream is now dramatic — a long, thin, tidally *heated* filament.** The
  spaghettification was underwhelming: a modest ~5.5× radial blob that only stretched at the merge
  and never changed colour, so a doomed star just looked a bit oval. Now a star/planet is drawn out
  into a genuine **stream** as it falls in — elongated up to **~9×** and thinned right down across
  (`render/tsl/raymarch.ts`) — and, crucially, it is **tidally heated**: the part of the stream
  nearest the hole (the end being devoured) glows **brighter and blue-white hot**, cooling to the
  body's own colour along its trailing length, then redshifting as it is finally taken in. The heat
  gradient is graded by the ray sample's distance from the hole (free — no extra hit-test), so it
  runs the length of the stream. Verified end-to-end in Chromium: send a body in with **−** and it
  spirals in, tears (the `tidal` factor ramps to 1), heats, then absorbs and is freed — the modified
  shader compiles and the whole sequence runs. *Next on #8 (documented): the stream **feeding the
  disk** — coupling the torn mass into `medium.ts` as real mass exchange.*

## 0.29.x — deeper spaghettification (roadmap #8 begins)

- **0.29.2** — **The − button now sends a body on a long, graceful inspiral — and absorbs it exactly
  like a natural merge.** The old removal was a quick (~1.5 s), fairly direct dive that ramped its own
  fade far out, so it didn't read like the real thing. Now − winds the body in on a smooth, eased
  spiral over ~3.5 turns (`PLUNGE_DURATION 1.5 → 3.5`, `PLUNGE_TURNS 1.75 → 3.5`, smoothstep descent),
  and — crucially — it now just *delivers the body to the merge radius* and **falls through to the
  identical natural-merge absorption** from there. So − and a physics-driven merger now tear (the
  Roche-gated `tidal` stream, radius-gated off the live position), drop the same `absorb` timeline
  tick, fire the same ringdown ripple, and fade the same way — one code path, no special-casing.
  Updated the plunge test to assert it's still spiralling partway through and freed once the whole
  inspiral + absorption completes.

- **0.29.1** — **The ringdown ripple is now the same on every background, and ~10× subtler.** It was
  a Lattice-only grid distortion that went enormous on a plunge; the *background* shouldn't change
  the merger effect. So the ripple now warps the **sampled sky direction globally** (in
  `background()`), so every sky — Stars, Nebula, Filaments, Lattice — lenses through the same
  expanding ring, plus a faint cool glow on the wavefront. Dialed right down (warp `0.22 → 0.022`,
  glow `2.8 → 0.28`, ~a tenth of the old Lattice look) per feedback. Backgrounds can still be tuned
  for their own contrast, but they no longer alter the plunge/merger effects. Verified it fires on
  the default Stars background now; tune `RIPPLE_WARP`/`RIPPLE_GLOW` further to taste.

- **0.29.0** — **Roche-gated tidal disruption — stars now spaghettify on the way in, not just at the
  merge.** Previously a body only stretched during the brief absorption fade *at* the centre, so you
  barely saw it. Now a new per-body `tidal` factor ramps 0→1 as a star/planet falls within a **Roche
  radius** (`render/bodyUniforms.ts`, tunable `[ROCHE, MERGE]`), and the raymarch drives the existing
  prolate-ellipsoid stretch from the *stronger* of `tidal` and `absorb` — so a doomed body tears into
  a long radial **stream** (up to ~5.5× elongation) well before it's taken in, then redshifts + fades
  as it merges. Black holes are compact, so they never tear. Trigger it on demand: send a body in with
  the **−** stepper and watch it stretch. New `bodyUniforms` tidal tests; shader compiles + the factor
  ramps on approach (verified in Chromium). *Next on #8 (documented): the torn stream **feeding the
  disk** — a real mass-exchange coupling into `medium.ts`.*

## 0.28.x — rewind across mergers (full-history scrub)

- **0.28.1** — **Ringdown ripple: much bolder, and it fires on the − button too** (tunes the
  v0.27.0 cue). The first pass was barely visible and only fired on a *natural* merge (a body the
  physics carried to the centre), so there was no on-demand way to see it. Now the dials are cranked
  up (grid-warp ×3, glow ×2, wider + slower wavefront, longer ringdown) so the **outward** ring from
  the hole reads clearly, and **removing a body with the − stepper also fires it** (and drops an
  `absorb` tick on the timeline) — so on the **Lattice** background you can trigger the cue whenever
  you like. *(To be clear: it's an **outward** ring radiating from the hole / merger point, not an
  inward one.)* Tune the six dials at the top of `render/tsl/background.ts` to taste.

- **0.28.0** — **The scrub bar can now rewind *across* an absorption — a body that fell in comes
  back.** Previously the rewind limit jumped to the last body-set change (you couldn't scrub before
  an absorption/add). Now the **whole recorded window is restorable**: each restored frame rebuilds
  the **roster as well as the kinematics** — reviving bodies that were absorbed or removed since (from
  a per-id registry of their identity) and dropping ones added since — so scrubbing before a merger
  shows the line-up exactly as it was, and replaying forward re-enacts the absorption. The start
  marker now sits at the true start of the buffer; the "locked event" dimming from v0.26.2 simply
  stops triggering (nothing is locked any more). Implemented via `Scene.restoreRoster(ids)` + a
  registry; `Timeline` now restores through an `applyFrame` hook (roster + kinematics + GPU resync).
  New `Scene` + `Timeline` tests; verified in real Chromium (remove a star → scrub back → it revives).

## 0.27.x — the ringdown ripple (roadmap #6 begins)

- **0.27.0** — **A spacetime ringdown ripple on the Lattice (first pass, for tuning).** When a body
  reaches the centre (an `absorb` event — a merger), a decaying ring now radiates outward from the
  hole across the **Lattice** background: it drags the lat/long grid radially and trails a soft glow,
  then rings down over ~1.5 s. This is the cheap, dramatic first half of roadmap #6 (the merger /
  gravitational-wave cue) — the two-hole *inspiral dynamics* come later. Implemented as a `ripple`
  uniform (seconds since the event, aged in wall-clock and capped so it's a no-op when idle) read by
  `lattice()` in `render/tsl/background.ts`, with six clearly-marked **tuning dials** (wavefront
  speed, ringdown time, band width, ringing frequency, grid-warp amount, glow) to dial in against
  the look on real hardware. Only the Lattice sky reads it; the other backgrounds are untouched.

## 0.26.x — scrub-bar markers + DVR replay

- **0.26.2** — **Scrub bar: make "where history begins" obvious (no-history vs history).** Frequent
  absorptions/escapes bump the History generation, so the **rewind limit** often sits far to the
  right — you can't scrub before the last body-set change, and the faint start marker made that
  confusing. Now the contrast does the talking: the **scrubable span glows warm and brighter** (the
  history you can rewind into), the **older span dims to a cool grey** (no scrubable history there),
  the **start marker is a clear cool boundary**, and **event ticks before the limit are dimmed +
  shortened** (locked — shown as a record, but you can't scrub to them). Behaviour is unchanged —
  this is purely making the existing limit legible. (Rewinding *across* a body-set change — actually
  restoring the old roster — remains future work; see roadmap.)

- **0.26.1** — **Docs: roadmap rewrite toward 1.0.0.** `docs/future-improvements.md` gains a
  **Road to 1.0.0** sequence and folds in an external review of the physics items (8–11): the
  now-shipped scrub bar is retired from the list; the merger-ringdown, precession, and TDE items
  are reordered cheap→expensive with the review's sharper engineering notes (precession via a
  reversibility-preserving position-only **r⁻³** term; the TDE "feeds the disk" coupling gap; the
  ringdown's irreversible-but-consistent inspiral); and **Kerr is deliberately sequenced last** —
  highest payoff, highest cost, and in active tension with problem #1, so it waits behind its own
  step budget. Docs only — no code change.

- **0.26.0** — **The scrub bar grows two markers and a DVR-style replay.** The recorded history is
  now a proper timeline you can rewind into and watch play back — all without touching Pause:
  - **Start marker.** A cool tick fades in with the bar at the **rewind limit** — the oldest frame
    the current body layout can restore. **Scrubbing *and* Step-back are clamped to it** (you can't
    rewind before it; adding/removing a body moves it up, since the recorded "future" is then a
    different layout).
  - **Current marker + replay.** Scrub (or Step-back) to a past moment and a warm **current marker**
    parks there. If the sim is running it then **replays the recorded frames forward**, the marker
    walking back toward the **live edge** (a soft pulse at the bottom-right, where new history
    accrues) — then live simulation + recording resume. Paused, the marker just holds. The Pause
    state is never changed either way.
  - Under the hood: a new, unit-tested [`Timeline`](src/core/Timeline.ts) owns a single DVR
    `offset` into `History`; `TimeController` now emits a discrete `step` (in recorded frames) so
    ←/→ walks the tape (Step-back clamped to the rewind limit) instead of reverse-integrating.

## 0.25.x — the scrub bar, always on

- **0.25.2** — **Scrubbing no longer changes the Pause state.** Grabbing the history bar (click
  or drag) used to *pause* at the picked frame (and light the Pause button); now it only freezes
  the sim for the **duration of the grab** and leaves Pause untouched. Release while running and
  the sim plays on from the scrubbed frame (the playhead rides back to the live edge); release
  while paused and it stays paused there (the playhead holds). To hold a moment, pause first, then
  scrub. (Reverts the v0.25.0 auto-pause-on-scrub; the redundant-`setVisible` playhead fix stays.)

- **0.25.1** — **Prefetch the engine chunk for a faster first load (roadmap #6).** A thorough
  bundle investigation found the engine bytes are at three.js's floor (~808 KB raw / ~222 KB
  gzip) with no *safe* shrink — so instead of trimming bytes, this speeds their *delivery*: a
  lowest-priority `<link rel="prefetch">` for the three.js vendor chunk (`prefetchEngineChunk()`
  in `vite.config.ts`) downloads it during the splash's idle network time and caches it, so it's
  already local when the deferred `__ospBoot` import fires. It is **not** `modulepreload` — no
  early compile, so the carefully-tuned splash timing is untouched. The benefit is
  connection-dependent (verify on real hardware; `vite preview` sends `no-cache`, so reuse only
  shows on a cacheable host like GitHub Pages). `docs/future-improvements.md` #6 now records the
  full investigation: every rejected approach (core dedupe → no-op; `manualChunks` → conserves
  bytes; terser ≈ esbuild; the WebGL2 fallback statically baked into the prebuilt bundle) and the
  one real byte lever left (dropping the WebGL2 fallback, ~30% — an L-effort product call).

- **0.25.0** — **The history scrub bar is now always on, tracks the last 2 minutes, and the info
  popover gets a colour key.** The bar no longer waits for Pause — it rides along the bottom the
  whole time the control panel is up, its playhead tracking the live edge as the sim plays:
  - **De-coupled from Pause.** It now shows/hides *with the dropdown panel* (mounts with it,
    hidden during a Replay intro and brought back once the replayed intro settles). A new `tick()`
    drives a live rolling window — events scroll, the playhead rides "now" — so you can watch the
    timeline fill without freezing the scene.
  - **A 2-minute window.** `History`'s ring buffer grows from ~10 s to **~2 min** (capacity
    `600 → 7200` at 60 fps); older frames are still lost past the edge.
  - **Scrub pauses at that moment.** Grabbing the bar (click *or* drag) now pauses at the picked
    frame so it stays on screen and inspectable — and lights the **Pause** button (→ "Resume") so
    it's clear time is held. You resume from there; the bar then rides the live edge again.
  - **Colour key.** The shortcuts overlay is reframed as a general **info popover** (still `?`)
    and gains a **Timeline events** colour key — a swatch per transient (star/planet/hole added,
    absorbed, escaped) sharing one palette with the bar's ticks (single source of truth).
  - Fixes a redundant `setVisible(true)` (panel mount *and* `formation.onDone` both fire it on
    first load) that would reset the playhead off a scrub — `setVisible` is now idempotent, with
    a regression test. Plus the new `History` capacity test and the always-on wiring.

## 0.24.x — the history scrub bar

- **0.24.0** — **A history scrub bar along the bottom (on Pause).** Pause the sim and a soft,
  **warm-neon** line appears along the *exact bottom* of the screen — the last ~10 s of
  simulation as a rolling window (`History`, a bounded ring buffer, so the oldest is lost):
  - **Click** jumps to that moment; **click-and-drag** scrubs through time. Each position
    restores that frame's kinematics onto the bodies (the paused render shows it); scrubbing is
    clamped to the span the current body layout can still restore.
  - **Colour-coded transient-event ticks** rise from the line — a body **added** (gold/blue/violet
    by type), **absorbed** at the centre (warm red), or **escaped** (teal) — each glowing in its
    own hue, tagged to its moment so it holds position as the window scrolls.
  - A glowing **playhead** marks the scrub position; a brighter fill shows the restorable span.
  - Built on the v0.18.0 `History` foundation (new `recorded` / `restorableLength` queries) +
    a small `EventLog`. New tests cover both, plus the `Scene` transient-event hooks.

## 0.23.x — warm-fuzzy reveal + leaner intro

- **0.23.2** — **Hide the control panel during a Replay.** Triggering **Replay intro** now
  collapses *and* hides the lil-gui panel for the whole replayed intro, so it doesn't float over
  the black/splash/dolly. It reappears — folded — only once the replayed intro has finished
  settling, driven by a new `FormationSequence.onDone` hook (fired at the end of the dolly, or on
  a skip). No-op on first load (the panel is already shown).
- **0.23.1** — **Share actually produces an mp4 on the desktop (the PNG fallback bug).**
  - **Root cause #1 (Chrome): `latencyMode: 'realtime'`.** It biased the encoder toward a
    *hardware* H.264 path that, on desktop, frequently omits the `avcC` decoder config from its
    chunk metadata — so the recorder never had what `mp4-muxer` needs, never became `ready`, and
    Share silently fell back to a still PNG. Dropped it; the default software path reliably emits
    `avcC` (a 5s clip doesn't need realtime latency, and `takeClip()` still flushes to end at ~now).
  - **Root cause #2 (Chromium): no H.264 encoder at all.** Plain Chromium ships without the
    proprietary codec, so H.264 encode is simply unavailable. Added an **AV1 fallback** — still an
    `.mp4`, and playable on modern OSes. *Verified end-to-end in real Chromium:* the recorder now
    emits a valid `onestillpoint.mp4` (AV1, correct `ftyp`/`avcC`) instead of a PNG.
  - **No more silent PNG.** When a share *does* fall back to a still (no encoder at all, or the
    clip isn't buffered yet), the reason is logged to the console and exposed on the recorder's new
    `status` snapshot (`reason` · `codec` · `hasMeta` · `frames` · `ready`).

## 0.22.x — HUD & controls polish
  - **Warm-fuzzy reveal (smoother engine takeover).** The live engine now reveals at a much lower
    resolution — every quality tier bottoms out at its `minScale` floor for the first ~2s
    (`INTRO_SCALE_DROP` 0.2 → 0.45), so the heaviest moment (the camera dolly + disk ignition as
    the splash lifts) is far cheaper to draw. That softness is *masked, and made intentional,* by a
    new **warm-fuzzy veil** ([`uniforms.fuzz`](src/render/uniforms.ts) →
    [`PostPipeline`](src/render/PostPipeline.ts)): a warm tint + soft bloom glow at full strength
    the instant the engine appears, easing to nothing over the settle as the `ResolutionScaler`
    climbs back — so the scene **comes into focus** rather than stuttering in sharp. A no-op once
    settled (`fuzz = 0`).
  - **Removed the intro tuning scaffolding.** The dev-only **intro lab** (`intro-lab.html`,
    `src/intro/lab.ts`, the lab screenshot) and the "Tuning the intro" / tuning-log prose (in the
    README, `docs/intro-script.md`, and `src/intro/README.md`) are gone — the intro is considered
    tuned. The intro itself — the dials, overlay, timeline, melt, and the CI guards — is unchanged
    and stays well-documented.

## 0.22.x — HUD & controls polish

- **0.22.1** — **Adopt the Portka standard workflow + gate physics validation by path.**
  - **CI: physics validation is now path-gated.** Split the maths validation scripts (geodesic ·
    disk · orbit · lensing) out of `ci.yml` into their own
    [`validate-physics.yml`](.github/workflows/validate-physics.yml) that runs **only when physics
    or shader-maths files change** (`src/physics/**`, `src/render/tsl/**`, `src/scene/**`,
    `scripts/validate-*.mjs`). `ci.yml` keeps lint · typecheck · unit tests on every PR — so a
    UI/docs/CSS change no longer pays for the geodesic/orbit/lensing checks.
  - **Portka standard workflow.** Committed [`.claude/CLAUDE.md`](.claude/CLAUDE.md) encoding the
    standing process — update `main` → branch per change → tests + CI → PR → merge on green → hand
    back the PR link the user deletes as confirmation — so each session stays on the code, not the
    process.
  - **Version sync, enforced.** New [`src/version.test.ts`](src/version.test.ts) asserts
    `package.json` ↔ `src/version.ts` ↔ `CHANGELOG.md` agree (the repo-native form of the Portka
    SemVer triplet); CI runs it so they can't drift.
- **0.22.0** — **Automated GPU, a clearer HUD, and the first branding de-saturation.**
  - **GPU physics is now automatic.** Removed the **GPU physics** checkbox — the CPU/GPU
    integrator is chosen for you by body count
    ([`PhysicsController.autoSelect`](src/physics/PhysicsController.ts)). For every count the
    app can currently reach (`MAX_BODIES` is 14) that's the exact, faster **CPU** path; the GPU
    compute path only switches in past ~256 bodies (a future "swarm" mode). The HUD's CPU/GPU
    readout shows which path the selector picked — handy for debugging.
  - **HUD readout, clarified.** Dropped the static **WebGPU/WebGL2** label from the detail line.
    The **CPU/GPU** token is now **colour-coded** — a cool-slate dot for CPU, warm amber for GPU
    — so the one-letter C/G difference registers at a glance. And the body count is now an
    **S/P/B breakdown**: e.g. `3/2/1 bodies` = 3 stars, 2 planets, 1 (orbiting) black hole,
    mirroring the Bodies panel.
  - **De-saturated checkboxes.** The panel's checkboxes were a bright confirm-green; they're now
    a neutral, barely-warm **silver** (the new `--osp-check` variable) — quiet chrome, not a
    status colour. The first step of a wider branding/theme pass.
  - **"Click outside closes" moved to the top** of Advanced settings (it was last in the list).
  - New tests cover the `autoSelect` CPU/GPU decision and the HUD detail line.

## 0.21.x — modular intro + the intro lab

- **0.21.4** — **Share a real mp4 of the *recent* view, + camera tweaks.**
  - **Real .mp4.** The Share clip is now true H.264 mp4 (encoded with **WebCodecs** and muxed
    by **mp4-muxer**), so macOS can preview/AirDrop it — instead of the WebM that just
    downloaded as an unplayable file. Where there's no native file share (desktop Chromium),
    Share now **downloads the mp4**; the OS share sheet is still preferred on mobile/Safari.
    (Browsers can't put a video on the clipboard, so a download is the honest hand-off.)
  - **Fixed the clip content.** It's now the *actual previous ~5 seconds, ending at your
    current view*, with a correct duration. The old recorder kept a stale "header" chunk, so
    every clip began near the start of formation rather than what you were looking at.
  - Where H.264 can't be encoded (rare — e.g. some Linux Chrome), Share falls back to a still
    PNG rather than a WebM.
  - **Camera.** Doubled the maximum zoom-out distance (120 → 240), and **disabled panning** —
    there's no re-centre control yet, so a pan could strand the hole off-screen with no way back.
- **0.21.3** — **Share the last 5 seconds as a clip, + panel polish.**
  - **Share → a rolling clip.** The Share button now captures the **previous ~5 seconds**
    of the live view as a short, **square 720p, looping** video (mp4 where the platform can
    record it, else WebM) instead of a still PNG. A lightweight recorder
    ([`src/ui/clipRecorder.ts`](src/ui/clipRecorder.ts)) continuously buffers the canvas
    (centre-cropped to a square, started after the intro) so the recent moment is always
    ready. Sharing prefers the **native share sheet** (with the text `onestillpoint.app`),
    then the clipboard, then a download — falling back to a still PNG where canvas video
    can't be recorded.
  - **One-line confirmation.** The Share button's confirmation no longer wraps, and reads
    **"Shared ✓"** for the native share sheet vs **"Copied ✓"** / **"Saved ✓"** for the
    fallbacks.
  - **Checkboxes line up.** Every panel toggle is now the same native green checkbox,
    **right-justified into one clean vertical column** (the row toggles and the Display-HUD
    title box now match and align).
  - **Removed the Privacy link** from the About dialog (PRIVACY.md still lives in the repo).
- **0.21.2** — **Make the intro a self-contained, forkable unit (+ fix a latent keyframe
  collision).** The intro's stylesheet is split out of the app's into its own
  [`src/intro/intro.css`](src/intro/intro.css) (linked separately by `index.html` and on
  its own by `intro-lab.html`), so the whole intro — the moment of creation, the splash,
  the Replay melt, the sequencing, and now its styles — lives as one cohesive unit under
  [`src/intro/`](src/intro/). A new [`src/intro/README.md`](src/intro/README.md) documents
  the integration contract (`window.__osp*` + the `__ospBoot` hook) and a `git filter-repo`
  recipe + minimal scaffold for lifting it into its own repo. Splitting surfaced a **real
  bug**: the splash's merger-flash keyframe was named `osp-flash`, the *same* as the app's
  stepper-button flash — so the later definition silently won and the merger flash animated
  with the **wrong keyframe** (a stray `translateY` + wrong scale arc). Renamed to
  `osp-splash-flash`. The intro now ships as one `<link>` the lab can load *without* the
  full 1200-line app stylesheet. No app behaviour change; new tests guard the split.
- **0.21.1** — **Smooth the splash→engine handoff (an intro resolution ramp).** A phone
  recording caught the intro stuttering for ~1.5 s right as the splash lifts (~1.3 s):
  a couple of multi-hundred-ms hitches, then a choppy 20–30 fps recovery before it
  settles. The WGSL compile is already paid *under* the splash (`compileAsync` + priming
  renders), so this isn't a compile hitch — it's **sustained full-resolution raymarch
  load** at the heaviest moment (the camera dolly + disk ignition at the reveal), and the
  adaptive `ResolutionScaler` only fixed it *reactively* (starting sharp, then creeping
  down). Now the reveal starts **already cheap** — `introResolutionScale()` drops the
  starting drawing-buffer scale 0.2 below the device tier (floored at its `minScale`) for
  the pre-warm, the covered frames, and the reveal — and the scaler climbs *back up* to
  full quality as the scene calms (`ResolutionScaler.resetSmoothing()` keeps the prior
  heavy frames from dragging it down first). Same steady-state quality the scaler always
  seeks, just reached from below (smooth) instead of above (stuttering), masked by the
  crossfade; re-armed on **Replay**. See
  [`docs/perf-frame-rate.md`](docs/perf-frame-rate.md).
- **0.21.0** — **Modularize the intro, add a dev "intro lab", and two recording fixes.**
  The whole intro — the moment-of-creation markup, the splash markup, and the inline boot
  script that sequences them — now lives in **one source of truth**,
  [`src/intro/overlay.html`](src/intro/overlay.html). A small Vite plugin (`introOverlay()`
  in [`vite.config.ts`](vite.config.ts)) inlines it into both the app (`index.html`) and a
  new dev-only **intro lab** (`intro-lab.html`), so the lab previews the *exact* intro the
  site ships and can't drift. The lab ([`src/intro/lab.ts`](src/intro/lab.ts) — `npm run
  dev` → `/intro-lab.html`) loops the intro behind a panel of **sliders bound live to every
  dial** (`window.__ospDials`): adjust the visual sequence, watch it loop (or hit **Replay
  now**), then **Copy values** and paste the snippet back into the source. It isn't part of
  the production build (`intro-lab.html` isn't a Vite input) but is typechecked/linted with
  `src`, and a new README **"Tuning the intro"** section documents it. Two fixes from a
  screen recording: (1) **Replay intro now plays the moment of creation** — the burst's CSS
  animations finished on first load, and a parent reflow doesn't restart reused children, so
  Replay jumped straight to the splash; the burst is now genuinely restarted
  (`animation:'none'` → reflow → `''`), so Replay matches the first-load sequence exactly.
  (2) **The splash lands earlier** — the creation beat is now **240 ms** (was 340), so the
  splash is fully revealed by ~0.95 s and the **~1.0–1.14 s black gap is gone**.

## 0.20.x — the intro prelude (black → test pattern → birth)

- **0.20.7** — **Explicit intro dials + three splash fixes.** Every intro timing/speed is
  now an explicit, named dial in one place — `window.__ospDials` (inline) mirrored by
  `INTRO_DIALS` ([`src/intro/introTimeline.ts`](src/intro/introTimeline.ts)), kept in
  lockstep by a test: opening-black length, the split-second black, moment-of-creation
  **speed**, splash **speed**, the creation→splash crossfade **overlap + speed**, and the
  splash→engine crossfade **hold + speed** (speeds drive CSS `calc()` durations via custom
  properties). Three fixes from a recording: (1) the **engine bundle now boots at the
  *start* of the intro**, so its ~860 kB parse runs *under the black hold* instead of when
  the splash plays — that parse was **freezing the dust canvas** (~0.5 s) and lagging the
  splash's first paint (the "0.1 s black gap"); the splash now plays on a free thread.
  (2) The creation→splash crossfade defaults to **−80 ms overlap** (was a gap). (3) The
  splash **event horizon grows bigger** (`--core-d` 28 → 38 vmin, accretion ring 33 → 44
  vmin) so the dark circle ≈ the engine shadow at the crossfade — no size jump.
- **0.20.6** — **Separate the beats; bring back the twirling orbs.** v0.20.5 over-merged
  the moment of creation into the splash — they blurred together and the splash's
  **twirling orbs were hidden** (the splash played *under* the burst, so they finished
  off-screen). Now the beats are distinct: interference pattern → a deliberate
  **split-second of black** → the **moment of creation as its own beat** (~0.34s) →
  *then* the prebuilt splash plays **as the creation fades**, so the orbs play fresh and
  **visible**. (Reverses the "start the splash way earlier" overlap from 0.20.4–0.20.5 —
  separation reads better.)
- **0.20.5** — **Test pattern hands straight to the lit creation (no black flash).** A
  recording showed the black + test pattern looking great, but then briefly going **back
  to black** before the moment of creation — because the burst was fired *as* the pattern
  lifted, so its ~50ms fade-in (the core/flash/rays ramp up from zero) read as a black
  gap. Now `--go` fires **while the pattern is still up** (the opaque bands hide the
  burst's ramp), and the pattern is lifted ~45ms later once the burst is lit — so the
  interference pattern leads *directly* into a bright moment of creation. `verify:intro`
  now also freezes the burst at the lift instant and asserts it's lit (luma ≫ black).
- **0.20.4** — **Longer black + a seamless creation→splash crossfade.** The black hold
  is now **0.5 s** (was 0.25 s), and the splash **starts way earlier**: it's **prebuilt
  during the black hold** (on an idle thread, hidden under the opaque creation) and then
  **plays on the very frame the creation burst fires**, so it crossfades straight out of
  the moment of creation with **no black gap** (a recording showed the splash arriving
  ~0.3 s after the creation had already faded to black). This required fixing the **same
  `animation-play-state` shorthand-cascade bug on the splash** that the burst had in
  0.20.3 (`#osp-splash:not(--go) .osp-splash__stage > *`), so a prebuilt splash stays
  frozen until it's played. `__ospSplash(true)` prebuilds; `__ospSplashPlay()` plays.
  Verified by computed-style guards (creation *and* splash paused-before-`--go`) plus a
  prebuild/play integration check.
- **0.20.3** — **The actual intro-order fix (a CSS cascade bug).** The black still
  wasn't going first: the moment-of-creation burst played the instant the page loaded,
  *then* the screen went black. Root cause (missed in 0.20.1–0.20.2): each burst
  element uses the `animation:` **shorthand**, which resets `animation-play-state` to
  its initial **`running`** — overriding the `paused` on `.osp-cr`, so the burst never
  actually waited for `--go`. Fixed with a higher-specificity rule
  (`#osp-creation:not(.osp-creation--go) .osp-cr { animation-play-state: paused }`) that
  beats the shorthand, so the burst genuinely holds until the black hold + test pattern
  have played. Now verifiable for real: `npm run verify:intro` reads the **computed
  play-state** (paused before `--go`, running after) — a guard the earlier screenshot
  checks couldn't catch (headless virtual-time doesn't advance CSS animations, so they
  looked black either way). Order is finally **black → test pattern → creation → splash**.
- **0.20.2** — **Intro fix + tuning + docs de-cruft.** A screen recording (analysed
  with the Portka `video-bug-analysis` workflow) caught the live intro playing its
  beats **out of order** — the creation burst on the very first frame, the test pattern
  *after* it, then a **~0.5 s black void** before the splash — because the 860 kB engine
  bundle parsed on the main thread *during* the cheap CSS prelude, starving its timers
  and the splash's first paint. The bundle is now **deferred behind a dynamic `import()`
  (`window.__ospBoot`)** that the splash calls once it's covering, so the prelude runs
  **unstarved** (black is first again, beats in order, no black gap) and the heavy parse
  + WebGPU compile happen under the splash (verified: the built site is uniform black at
  150 ms, content only after). The **"Display HUD"** title checkbox moved to the
  **right** of its label. Docs **de-crufted**: four stale point-in-time notes
  (`intro-description`, `perf-audit-v0.15`, two `video-findings`) compressed into one
  [`docs/archive.md`](docs/archive.md), and Tier 1 of the roadmap refreshed.
- **0.20.1** — The README now shows the **moment of creation** as a looping GIF
  ([`assets/creation.gif`](assets/creation.gif)), a sibling to the splash GIF. It's
  captured straight from the running CSS burst by the new `npm run capture:creation`
  ([`scripts/capture-creation.mjs`](scripts/capture-creation.mjs)) — a single
  deterministic pass per frame (fire `--go`, freeze every animation via the Web
  Animations API, screenshot, stitch with ffmpeg).
- **0.20.0** (Phase 20) — A new two-beat **prelude** opens the intro: **0.25 s of
  black**, then a **single frame** of 40 px white/black **test-pattern bands**, before
  the moment-of-creation burst and the splash. The **intro story** (everything but the
  live physics model) now targets **200 fps** — uncapped, past the limit of human
  flicker detection. **Replay intro** is reborn: the live view **melts inward** toward
  the One Still Point over ~2 s (scaling + spinning down to a point, blurring to black),
  then replays the whole intro from the black screen. The **HUD** section is more
  compact: the **"Display HUD"** *folder title itself* now carries the on/off checkbox
  (off + collapsed by default), with **Frame-time graph** + **Detail** as children that
  are **on by default** — so the first time you turn the HUD on it shows everything. The
  intro is fully storyboarded — a master moment-by-moment table, a **screenplay**, and a
  short story — in [`docs/intro-script.md`](docs/intro-script.md), with shared timing in
  `src/intro/introTimeline.ts`. New unit tests (melt · timeline · HUD folder · an inline
  drift-guard) plus a **headless visual test** of the prelude beats
  (`npm run verify:intro`).

## 0.19.x — moment of creation, settings, share, rich HUD

- **0.19.1** — **Cinematic frame cap**: a new **Cap frame rate** toggle + the
  **Target FPS** slider now reaching **24** (Advanced → Quality) render at most that
  rate, locking to the nearest display divisor so the pacing stays even (full
  evaluation, incl. the 24-on-60Hz judder caveat, in
  [`docs/perf-frame-rate.md`](docs/perf-frame-rate.md); default stays uncapped).
  The **moment of creation** now overlaps the splash **earlier** (splash starts at
  ~0.05s). HUD: **"Display FPS" → "Display HUD"**, now a **collapsible HUD section**
  (collapsed by default) with the child toggles inside; the **resolution shows next
  to the FPS** (where the backend was), the backend moved into the detail line, and
  the redundant "HUD resolution" toggle is gone.
- **0.19.0** (Phase 19) — A new **"moment of creation"** opens the intro (beat 0,
  ~0–0.18s): a full-screen CSS firework — flash, neon beams, reverberating shock
  rings — that's a *separate, deliberately cheap* mechanism from the splash (no
  canvas), so it's instant and consistent on every device; the splash overlaps it
  from ~0.1s. The three intro **beats** are now documented explicitly. **Settings
  persistence**: every panel control (Filter, Background, Speed, all Look /
  Animation / Bloom / Quality / HUD knobs, toggles) now auto-saves to one
  `localStorage` profile and auto-loads on start; **Advanced settings defaults
  off**. New **Share** button (top row): captures the view and throws to the OS
  share sheet on mobile, or copies the image to the clipboard (✓) on desktop. A
  rich lower-left **HUD** — frame-time graph + resolution % + a bodies/speed/physics
  detail line, with Advanced toggles — augments the FPS readout. A witty
  [**privacy statement**](PRIVACY.md) linked from About. Bundle: **GPU physics**
  lazy-loads now too.

## 0.18.x — load smoothness + Tier-2 foundations

- **0.18.0** (Phase 18) — **Fresh-load smoothness**: a recording put the live splash
  at ~21 fps vs the captured GIF's steady 25 — the CSS+canvas splash was competing
  with the bundle parse and the **lil-gui panel build** for the main thread. The
  control panel is now a **lazy `import()`** (its own ~52 kB chunk) **mounted at idle
  after the splash**, so the heavy DOM build is off the critical path and the initial
  bundle is smaller. A documented **longer-term plan** (a hardware-decoded
  `<video>`/WebM splash) is in [`docs/future-improvements.md`](docs/future-improvements.md)
  if that isn't enough. **Tier-2 foundations**: a zero-allocation **history ring
  buffer** ([`src/core/History.ts`](src/core/History.ts)) records the bodies each
  frame — the groundwork for a scrub bar (no UI yet). **Tests**: first **UI smoke
  test** (jsdom `keybindings`) + a `History` suite; the suite was reviewed (lean, no
  cruft) — 50 tests.

## 0.17.x — intro robustness + Tier-1 polish

- **0.17.2** — Splash cohesion: the dust is now one **continuous breath** per
  particle (no separate inward/burst/drift beats), each turning at its own
  **staggered** time through an **annulus** — never the centre — so it stops piling
  into the **static central clot** seen before the cut, and a constant drift keeps
  everything moving. The flash starts earlier + lingers and the orbs dissolve into
  it, so the beats overlap rather than pop. New **assets/** folder (the logo moved
  here) and an auto-capture system — `npm run capture:splash`
  ([`scripts/capture-splash.mjs`](scripts/capture-splash.mjs)) renders the live
  splash to a looping **`assets/splash.gif`**, shown in a new README **Splash**
  section.
- **0.17.1** — Splash → engine handoff: the dust now **drifts gaseously** past the
  burst and fades *through* the crossfade (with a constant angular drift so nothing
  is ever momentarily static), so space no longer empties to a **black void** before
  the stars take over; the live disk is revealed a touch earlier over a gentler fade
  so it overlaps the expanding splash rings. **Tier 1.1 pre-warm**: the heavy
  raymarch WGSL is now **`compileAsync`-compiled** under the splash, cutting the
  fresh-load hitch. The **`?` shortcut also accepts `/`** (no Shift), and its
  cheat-sheet is now a **translucent top-left panel** (like the control dropdown),
  not a modal. README reframed like the About dialog (tagline above/below, byline
  framing the animated mark).
- **0.17.0** (Phase 17) — **Mobile splash fix**: the merger animation now starts on
  the **first painted frame** (it was on a parse-time timeline, which mobile Safari
  ran through before its first paint, so the splash was never seen). The crossfade
  waits for that first paint + holds over the first few rendered frames, so the
  shader-compile hitch hides under the splash. The **gas/dust ring forms earlier and
  holds**, bridging to the real disk. **Replay intro** now covers the old scene
  **instantly** (no fade-in) and plays the same as a fresh load. New **keyboard
  shortcuts** — `?` (cheat-sheet overlay), **R** Replay, **C** Clear, **F** FPS — on
  top of Esc / Space / arrows. README gains an **animated hero** (the About mark).
  Intro [ideal/reality docs](docs/intro-script.md) refreshed.

## 0.16.x — spaghettification, binary-merger splash, controls

- **0.16.5** — **Step back**: rewind time — one frame (paused) or a ~1 s jump
  (running) — with the new button or the <kbd>←</kbd> key. The orbits reverse
  exactly because the velocity-Verlet integrator is time-reversible (now unit
  tested); irreversible events (absorbed/removed bodies, the intro) don't come
  back. Started a **[roadmap](docs/future-improvements.md)** and logged the intro
  notes from this session's recordings (fresh-load stutter + the looser — but, per
  the user, "pretty great" — Replay-intro alignment) as future refinements.
- **0.16.4** — Splash, shorter + warmer: the whole binary merger now plays in
  ~0.6s (was ~1s). The two orbs are a **warm white-gold + amber** pair (no more
  pink/blue), with plumes/flash/jet/dust all warm, and the surrounding dust
  **spirals from the very first frame** (was an ease-in crawl that read as static).
  The neon is concentrated where it's wanted: the reverberating **shock rings now
  shimmer through an animated hue-shift**, joined by bright **neon streaks**. New
  **keyboard shortcuts**: <kbd>Esc</kbd> About · <kbd>Space</kbd> Pause/Resume ·
  <kbd>→</kbd> Step forward · <kbd>↑</kbd>/<kbd>↓</kbd> double / halve Speed.
- **0.16.3** — Splash: the dust is now **small, mostly-warm and lightly
  saturated** (was clownish rainbow) and **spirals** coherently in and back out;
  the canvas is capped-resolution with smaller sprites, so it's much **smoother**.
  **Replay intro** now replays the load splash too. Removing a body **spirals**
  into the centre instead of falling straight in. **Step** → **Step forward**. The
  **FPS** readout fades + pulses in/out so it's easy to spot.
- **0.16.2** — Fixed the two orbs briefly flying apart mid-inspiral on
  Safari/WebKit (keyframes now rotate < 180°/step, so every browser takes the same
  arc). Dust moved to a canvas particle field; render pipeline **pre-warmed** under
  the splash to cut the reveal hitch. **FPS** readout trimmed to just the number.
  **Pause** colours corrected (red running / green stopped). Background presets
  retuned.
- **0.16.1** — A **colourful binary-merger splash**: two orbs (cool + warm) twirl
  together, then a flash, tilted jet, colour plumes and reverberating shock rings
  burst at the merger before the event horizon settles. **Pause** shows state by
  colour; each **Background** loads its own look preset on selection.
- **0.16.0** (Phase 16) — **Spaghettification**: an absorbed body is tidally
  stretched along the line to the hole and thinned across it (a prolate ellipsoid
  in the raymarch — `segmentHitsStretched`), then redshifts and fades. **Pause** is
  a real toggle button; a new **Advanced → Background** folder post-processes the
  selected sky (Brightness · Saturation · Tint). **Lattice** re-tinted greener.

## 0.15.x — performance pass + instant load splash

- **0.15.1** — Splash sized in `vmin` so the forming horizon lines up with the
  real shadow; varied body/dust sizes. About logo full-width then moved below the
  byline. GPU auto-switch investigated and documented
  ([`docs/archive.md`](docs/archive.md)): not worth it below
  ~150–300 bodies, so it stays a manual toggle.
- **0.15.0** (Phase 15) — **N-body sim back on the CPU by default** (the GPU
  compute path's per-frame read-back stalled the pipeline for ≤14 bodies); removed
  a per-frame allocation in the render loop. A **load splash** paints before the
  WebGPU shader compiles and crossfades into the scene, which now ignites fast.
  **Step** also works while running (~1 s jump); add de-bounce; full-width About
  logo.

## 0.14.x — backgrounds, orbits & absorption

- **0.14.6** — Adding bodies is solid again: the GPU integrator now reads
  **velocities** back (not just positions), so an add no longer re-seeds bodies
  onto wrong orbits; a readback↔rebuild race is closed; substep size is bounded.
  Animated **About logo**; deeper-orange Nebula. See
  [`docs/archive.md`](docs/archive.md).
- **0.14.5** — Adds rate-limited to 1/s; removing a body **plunges** it into the
  centre with the absorption fade. Fixed an **all-black-screen** bug (a non-finite
  body position poisoning the lensing uniforms, never pruned) — see
  [`docs/archive.md`](docs/archive.md). Longer ✓/✗
  flash; Nebula reverted to its punchy orange.
- **0.14.4** — A 4th black hole only when nothing else orbits; added bodies last
  longer (exact radius + softened circular speed); absorbed bodies fade rather than
  pop (groundwork for collision animations). Richer dark-orange Nebula.
- **0.14.3** — Intro performance: geodesic escapes at the scene radius; DPR capped
  ≤ 1.5; cleaner Nebula ramp; About tagline frames the dialog.
- **0.14.2** — More background contrast; ± buttons disable at caps; added holes
  spread onto separated orbits; Replay re-seeds on fresh orbits.
- **0.14.1** — Nebula re-tuned for punch; About gains a BTC donation + the shared
  tagline; escaped/merged companions are pruned (and GPU buffers disposed).
- **0.14.0** (Phase 14) — Background revamp: Eagle-palette **Nebula**, cosmic-web
  **Filaments**, finer **Lattice**. Intro *reality* doc (since folded into
  [`docs/archive.md`](docs/archive.md)) beside the *ideal*
  ([`docs/intro-script.md`](docs/intro-script.md)).

## 0.5–0.13 — foundations

- **0.13** — Selectable **Background** dropdown (all lensed); first video-driven
  intro tuning (default scene seeds 3 stars + 3 planets, earlier entrance); Portka
  Tools `video-bug-analyzer` wired in.
- **0.12** — Bodies **− N + steppers** with a black-hole budget (`bodyCap`);
  **About** modal; panel reorg.
- **0.11** — Each added black hole gets its **own compact accretion disk**
  (`secondaryDisk.ts`); frame-rate-targeted auto-resolution; panel polish.
- **0.10** — UX polish (panel reorder, flush-right, opaque tooltip); reduced-motion
  intro hardening for mobile.
- **0.9** — Performance auto-tuning (quality tiers); cheaper companion lensing
  (weak-field deflection shared across RK4 stages); panel restyle.
- **0.8** — Choreographed entrance (retrograde planets swoosh in after the stars);
  panel reorg (Filter / Advanced settings); secondary-hole render fix.
- **0.7** — Formation sequence: camera dolly + disk **ignition**, skip/replay,
  reduced-motion aware; long-press tooltips; slow-motion Speed.
- **0.6** — **Time acceleration** with representation crossfade (you can't
  brute-force sub-second dynamics at huge scales, so the representation crossfades).
- **0.5** — **Gravitational body simulator**: N-body `PhysicsEngine` (CPU
  velocity-Verlet), companions raymarched inside the curved spacetime so they lens
  and occlude for free. `0.5.1–0.5.3`: tests + CI; weak-field lensing of secondary
  masses; opt-in WebGPU compute N-body kernel; hover tooltips.
- **0.0–0.4** — Scaffold (renderer + WebGL2 fallback + fullscreen TSL pass) →
  Schwarzschild geometry (photon geodesics, shadow, photon ring, lensed starfield)
  → static accretion disk (Shakura–Sunyaev → blackbody, Doppler, redshift) →
  animated volumetric dust → look UI + bloom/tone-map + adaptive resolution.

## Phase map

| Phase | Theme |
| ----- | ----- |
| 0–4 | Renderer, Schwarzschild geometry, accretion disk, volumetric dust, look UI + perf |
| 5–6 | N-body companions; time acceleration |
| 7–8 | Formation intro; choreographed entrance + panel reorg |
| 9–11 | Perf auto-tuning; UX polish; secondary black-hole disk |
| 12–14 | Body steppers + caps + About; selectable backgrounds; background revamp |
| 15–16 | CPU-physics perf pass + load splash; spaghettification + background controls |
| 17 | Intro robustness (mobile first-paint splash) + Tier-1 polish (shortcuts, hero) |
| 18 | Load smoothness (lazy panel / code-split) + Tier-2 foundations (history buffer, UI tests) |
| 19 | Moment-of-creation intro beat; full settings persistence; Share button; rich HUD |
