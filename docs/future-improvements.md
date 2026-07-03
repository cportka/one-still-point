# Future improvements — roadmap

A living backlog, **flattened into one loose roadmap** (top = next), aimed at a polished
**1.0.0**. It distills the development sessions — screen-recording reviews, perf audits,
feature asks — into a single ordered list rather than tiered buckets. **Item 1 (cold first-load lag)
is the one remaining *active problem*** (item 2, Share, shipped in v0.39.1); the rest run roughly fix
→ polish/brand → features → big physics, and the **[Road to 1.0.0](#road-to-100--the-sequence)** below
makes that sequence explicit.

The intro/splash is considered **fully tuned for now** — its remaining cost shows up only as
item 1 below (the engine takeover), not as more splash dialing. The **history scrub bar /
timeline** (former item 5) is **shipped** (v0.24.0 → v0.26.0: always-on, 2-min window, colour
key, start/current markers, DVR replay) and refined since (v0.38.0 a live edit while rewound commits
the timeline from that moment; v0.39.0 seeded bodies are absent in history before their birth tick) —
see the [CHANGELOG](../CHANGELOG.md).

Each item is annotated:

- **Effort** — a rough T-shirt size: **S** ≈ an afternoon · **M** ≈ a few sessions ·
  **L** ≈ a project of its own.
- **Risks / bugs** — where it's likely to bite.
- **Viz / perf** — what it changes for the look or the frame budget.
- **Notes** — anything else worth knowing, plus the files it *touches*.

This is a wish-list, not a commitment. When something here ships, move it to the
[CHANGELOG](../CHANGELOG.md) and delete it here.

---

## Road to 1.0.0 — the sequence

A suggested build order (the numbered items below detail each). The remaining **active problem**
(#1, the cold first-load lag) gates quality; **polish/brand** follows; then the new viz/physics
features run **cheap → expensive**, with **Kerr deliberately last** — it's the trophy, but it
*worsens* problem 1, so it waits until 1 is solved and gets its own step budget.

1. **Fix what's broken** — #1 engine-takeover lag (now **narrowed to the cold first-load compile**;
   the periodic post-load stutter is fixed, v0.36.1–.2) · ~~#2 Share → mp4~~ (✅ shipped v0.39.1, with
   a real-device check still owed). (Quality gates for any "1.0".)
2. **Polish + brand** — #3 theme/logo · #4 README live clip · #5 bundle (delivery done; the
   WebGL2-drop lever is optional).
3. **Cheap dramatic wins** — #6 merger ripple (✅ shipped v0.27–0.29) → #7 precession (the
   position-only r⁻³ route is low-risk and validatable).
4. **Bigger set pieces** — ~~#8 TDE~~ (✅ shipped v0.29–0.32: tear → stream → feed the disk →
   ringdown) → #9 swarm / galaxy (the GPU path's payoff).
5. **The trophy, last** — #10 Kerr, only after #1 is solved and behind its own step budget.

Net (from the items-8–11 review): with #8 and the #6 ripple now shipped, the remaining discipline
is all about **Kerr** — it's the one in active tension with problem 1. The other physics items are
tractable, and **#7/precession is genuinely low-risk once you keep the perturbation position-only**
(see its entry).

---

## 1. First-load lag as the physics visualizer takes over  ⚠️ active problem (narrowed)

The single biggest remaining problem — but now **narrowed to the cold first-load compile**, since the
*periodic post-load stutter* is fixed (v0.36.1–.2, below) and the latest review confirms it:
**desktop is completely smooth; mobile has only a slight stutter as it settles.** What remains is the
**first** splash→engine takeover: the camera dolly + disk ignition at the reveal (~1–2 s in) is the
heaviest the app ever is, and it lands on a cold, first-time pipeline. The tell is sharp — **"Replay
intro" is smooth and near-flawless** (the pipeline is already compiled and the GPU caches are warm),
while the *first* reveal hitches. The roadmap-#8 work (v0.29–0.32) grew the raymarch WGSL, lengthening
that first compile; the real fix is to move the renderer off the main thread (OffscreenCanvas, below).

### What fixed the *periodic* stutter (v0.36.1–.2) — distinct from the first-load lag

A regular-cadence stutter *after* load was three things, all now fixed: (a) the **resolution scaler
hunting** up/down around the target — each change rebuilds the bloom+FXAA targets (a GPU hitch) —
rewritten to **converge-and-freeze** (`ResolutionScaler.ts`: settle a stable scale in a few steps,
then widen the acceptable band so only a large sustained deviation pays another resize, and discount
the rebuild-hitch frames so they can't trigger a resize→hitch→resize loop); (b) the **history bar**
rebuilding all its event ticks ~10×/s — now a reused node pool (`historyBar.ts`); (c) the **clip
recorder** at 30 fps drawImage+encode — dropped to 20 fps. The remaining item here is the *cold
compile*, not this cadence.

### Can we multi-thread the first download + load + render?

Mostly it's *already* multi-threaded — which is why "just thread it" isn't the quick fix:

- **Shader compile** — `createRenderPipelineAsync` (what our `compileAsync` pre-warm uses) compiles
  WGSL on the browser's **GPU-process worker threads**, off our main thread, already. Growing the
  shader (#8) lengthens that compile, but it's not blocking the main thread.
- **Download** — the engine chunk is code-split and HTTP/2-multiplexed, and v0.25.1 added a
  `prefetch` so the bytes land *during* the splash (item 5). Already parallel.
- **What's left on the single main thread** is JS module eval + scene/pipeline setup and the
  **first use** of each pipeline (the first draw can still stall while the driver finalises state).
  The real lever to move *that* off the main thread is **OffscreenCanvas + a Web Worker** — run the
  whole renderer in a worker so the main thread (splash, DOM, input) never blocks. three.js's WebGPU
  renderer supports OffscreenCanvas, but it's an **L-effort architectural change** (the renderer,
  loop, resolution scaler and every uniform write move to the worker; scene/UI state crosses a
  message boundary) and it risks the same render/sim desync a physics Worker would. It's the right
  big swing for 1.0 — not a patch. **In progress — step 2 of 6 done (v0.36.0 scaffold → v0.37.0 the
  renderer runs off-thread, proven).** With `?worker=1` the worker creates the `WebGPURenderer` on a
  transferred `OffscreenCanvas`, compiles the **real raymarch shader in the worker**, and presents a
  static view — confirmed in Chromium (`ready (webgpu)`), so the migration's riskiest unknown (WebGPU
  in a worker) is de-risked. Still off by default. **Next: steps 3–6 — input/resize, then the
  Controls/HUD/timeline message channel, then move Share/clip worker-side, then flip the default.**
  See [`offscreen-canvas.md`](offscreen-canvas.md) for the full scope, the typed main↔worker protocol,
  and the 6-step plan.

### The cheap masking lever (the reveal cut + haze) + the tuning dials, defined

Until the renderer moves off-thread, the reveal cost is *masked*: render the reveal **deep below
steady-state** and **hide the softness behind warm haze**. The pieces, so the next tuning pass has one
map (values are current as of v0.39.x — re-check the source, they drift):

- **Resolution cut — how deep.** Each tier carries an explicit `introScale` *below* its steady-state
  `minScale` (high `minScale 0.40 → introScale 0.22`, med `0.36 → 0.20`, low `0.30 → 0.18`;
  `quality.ts`). `armIntroScale` (`main.ts`) drops both the scale **and** the scaler's floor to it
  (plus `resetSmoothing()` so prior full-res frame-times don't drag it lower), so the reveal *holds*
  that low through the heavy frames; the floor is restored to the tier `minScale` in the loop once the
  scaler climbs back past it, so the deep cut belongs to the reveal alone.
- **How it sharpens — converge-and-freeze (rewritten v0.36.1).** The `ResolutionScaler` is no longer
  a fixed-rate ramp; it converges to a stable scale (down-steps `−0.12`, up-steps `+0.1`, `0.8 s`
  cooldown) and then **freezes** — once "settled" (`steady > 2.5 s`) it widens its acceptable
  frame-time band so only a large sustained deviation pays another resize, and it discounts the
  rebuild-hitch frames so a resize can't trigger another. (This is the periodic-stutter fix; it also
  governs the climb-back from `introScale`.)
- **How long the haze covers it.** The warm-fuzzy veil (`uniforms.fuzz` → `PostPipeline`) starts at
  `1` on the reveal and eases out over **`FUZZ_FADE_S = 5.0 s`** (`main.ts`), with a warmer grade +
  extra bloom glow (`PostPipeline.ts`), so the softer reveal reads as an intentional warm,
  out-of-focus look the whole way in.

**The dials, in one place:** how *deep* → `introScale` per tier (`quality.ts`); how *coarse the dust
march* → `revealVolumeStep` / `REVEAL_VOLUME_STEP_BOOST` (`quality.ts`, **shipped v0.39.4** — the
march-space companion to the screen-space cut, riding the haze clock); how it *sharpens* → the
converge-and-freeze bands/steps (`ResolutionScaler.ts`); how *long the haze masks it* → `FUZZ_FADE_S`
+ the veil strength (`PostPipeline.ts`). The screen-space dial-tuning is largely spent — the cut is
already deep and the haze long — but the **dust ramp** (v0.39.4) is a fresh march-space lever with a
single knob (`REVEAL_VOLUME_STEP_BOOST`) still to tune from real-device numbers, and the **pre-warm
now primes the *lit* disk** (v0.39.4) so the first lit-volume draw no longer lands on the first
visible frame. **Measure before dialing further:** `osp.perf.report()` (v0.39.3, `RevealProfiler.ts`)
exposes the real cold-reveal timings on the target device — the headless CI GPU can't, so this is the
only honest before/after. **The remaining lever for the *cold first compile* is the OffscreenCanvas
migration** (above), or pushing the dust ramp / a true **raymarch step budget** harder if `osp.perf`
shows the residual hitch is ALU-bound rather than compile/pipeline-bound.

- **Effort:** S for residual dial-tuning; **L** for the real fix (finish the OffscreenCanvas/Worker
  render, or a per-frame render-budget scheduler).
- **Risks / bugs:** device-dependent, hard to reproduce deterministically; pushing `introScale` lower
  trades the hitch for a visibly soft reveal (the haze must keep pace); the OffscreenCanvas move risks
  render/sim desync + message latency; restoring the scaler floor too eagerly can *pop* the resolution.
- **Viz / perf:** the highest-value perf win — it's the first impression.
- **Notes:** re-characterise with a *fresh* screen capture on the target Mac before more dialing (the
  *periodic* stutter is already fixed — focus a fresh capture on the **first reveal** only). Touches:
  `src/main.ts` (`armIntroScale`, the floor restore, `FUZZ_FADE_S`, the pre-warm sequence),
  `src/core/ResolutionScaler.ts`, `src/core/quality.ts` (`introScale`), `src/render/PostPipeline.ts`
  (the veil), `src/render/RaymarchPass.ts` (a possible step budget), `src/worker/` (the off-thread path).

## 2. Share saves a PNG, not an mp4 — ✅ shipped (v0.39.1)

Share no longer degrades to a still. **Diagnosis:** the rolling clip is a WebCodecs **mp4**, which
only materialises when the browser has an H.264/AV1 *encoder* **and** that encoder emits the `avcC`
decoder config — and on many real browsers neither holds (no H.264 encoder, or a hardware H.264
encoder that omits `avcC`), so `clip.ready` never turned true and Share silently shared a **PNG**.
**Fix (`src/ui/recordClip.ts`):** when the rolling mp4 isn't available, record a short clip straight
off the canvas with **`MediaRecorder` + `canvas.captureStream()`** — `captureStream` taps the
compositor (no fragile per-frame `drawImage` of the WebGPU canvas) and `MediaRecorder` muxes the
container itself (no `avcC` dependency). It yields an mp4 where the browser records H.264 (Safari /
iOS, modern Chrome), otherwise a WebM. The order is now: rolling WebCodecs mp4 → live-recorded clip →
PNG (last resort only). The recorder is exposed at **`osp.clip.status`** for on-device diagnosis.

**⚠️ Still needs a real-device check.** This headless GPU (swiftshader) **can't read the WebGPU
canvas by any method** (`drawImage` *and* `captureStream` both deliver zero frames), so neither the
original bug nor the `captureStream`-from-WebGPU fallback could be exercised in CI — only the
mechanism over a 2D canvas (verified: a real animated WebM, honest mp4→WebM MIME selection).
`captureStream` is a standard API on real GPUs, but **confirm on the actual Mac + a phone** that the
live clip records (read `osp.clip.status` if Share still falls back). Touches: `src/ui/recordClip.ts`,
`src/ui/share.ts`, `src/main.ts` (`captureShare`).

## 3. Finish the branding / theme pass — 🟡 logo landed (v0.42.0), palette unification open

**The logo is locked (v0.42.0): the "Ember Core" mark** — warm-silver ring, ember-lit horizon —
ships as the static `assets/logo.svg` (served as the app's first-ever favicon, `public/favicon.svg`)
and the animated `assets/hero.svg` (README hero + the About-card art in `about.ts`, background-tile
stripped there). Its warm-silver palette (`#c3bcab` / `#d2cab6` ring, `#ffd2a6` embers) is now the
brand reference the remaining theme work should align to.

Remaining: unify the other accent greens that are *chrome* rather than *status* (the version-copied
check, the HUD appear-pulse, the About-copied check) into the palette; **keep the semantic greens
that mean "success / go"** (the ✓ add-flash, the Resume/running state) — unless the new palette
defines its own success hue; align the share/HUD accents. (The CPU/GPU HUD tokens are deliberately
*functional* slate/amber, not branding.)

- **Effort:** S–M — mostly CSS + asset work once the palette and logo are locked.
- **Risks / bugs:** low; the trap is over-applying neutral silver to status colors and
  flattening their meaning. A fuller theme wants a small **token set** (accent,
  success, warn, danger), not just the one `--osp-check` knob.
- **Viz / perf:** pure visual identity; no perf impact.
- **Notes:** target palette is "neutral silver to barely warm, subtle, elegant."
  Touches: `src/style.css`, `src/intro/intro.css`, `src/ui/about.ts` (logo SVG),
  `assets/`.

## 4. A captured live-engine clip for the README

v0.17.2 added a captured looping **splash** GIF; a short clip of the **live engine** —
a lensed companion swinging past the disk — would round out the README hero. The
splash harness (`scripts/capture-splash.mjs`) is splash-specific (a deterministic
freeze under virtual time); a live clip needs a real-time grab.

- **Effort:** S (a capture script + a README section); **M** if a clean, deterministic
  live capture proves fussy.
- **Risks / bugs:** headless virtual-time does **not** advance CSS animations (the
  documented two-pass trick); a live clip is non-deterministic, so the seed + framing
  need pinning; mind GIF size vs a short mp4/webm.
- **Viz / perf:** marketing / first-impression; no runtime impact.
- **Notes:** the new `clipRecorder` (mp4) could back an in-app "record this" path and
  double as the capture source. Touches: `scripts/`, `README.md`, `assets/`.

## 5. Shrink the bundle further

*Progressed in v0.18–0.19* (the control panel + GPU physics engine are lazy `import()`s) and
**investigated in depth in v0.25.1.** The conclusion: **the engine bytes are at three.js's
floor — ~808 KB raw / ~222 KB gzip — and no *safe* change shrinks them.** What v0.25.1 shipped
instead is a **first-load latency** win (prefetch, below). The remaining byte lever is a product
decision (drop the WebGL2 fallback), not a quick patch.

### What the bytes actually are

`import { WebGPURenderer } from 'three/webgpu'` resolves to a **prebuilt bundle**
(`node_modules/three/build/three.webgpu.js`, ~2 MB unminified) — not the granular `src/` tree.
It is one tightly-interconnected module that Rollup can neither split nor tree-shake meaningfully,
and it **statically `import`s the WebGL2 fallback backend** (`WebGPURenderer.js` →
`webgl-fallback/WebGLBackend.js`), so the fallback ships whether or not WebGPU is used.

### What shipped (v0.25.1): prefetch the engine chunk

The engine bundle is loaded *late on purpose* — the inline `window.__ospBoot` (see `index.html`)
only `import()`s it once the splash is up, so the ~800 KB parse + WebGPU compile happen under
cover instead of starving the cheap CSS prelude. Correct, but it also delays the *download* to
the splash hand-off (a serial entry → main → three waterfall on a cold connection). A
`rel="prefetch"` for the three chunk (`prefetchEngineChunk()` in `vite.config.ts`) fills the
network's idle time *during* the splash at lowest priority and parks the bytes in cache —
**without** `modulepreload`'s compile, so it can't steal main-thread time from the prelude. Net:
same tuned execution timing, engine bytes already local when boot fires. **Verify on real
hardware** — the benefit is connection-dependent, and `vite preview` sends `Cache-Control:
no-cache` so the prefetch isn't reused there (a preview artifact; GitHub Pages serves hashed
assets cacheable, so production reuses it as a single download).

### Approaches measured and rejected (so we don't re-derive them)

- **Dedupe three's core** (`from 'three'` vs `from 'three/webgpu'`) — *no-op.* Both prebuilt
  bundles re-export a shared `three.core.js`, which Rollup already includes **once**. An exact
  `^three$ → three/webgpu` alias produced a **byte-identical** chunk (same hash). No duplication
  exists.
- **`manualChunks`** to split three apart — *conserves bytes.* It only moves the ~25 KB of core
  primitives between `main` and the vendor chunk (e.g. `main` 82 → 57 KB, three 808 → 833 KB);
  total ~890 KB raw either way. A caching nicety at best; three is already its own chunk.
- **terser instead of esbuild** — *no change* (808.5 vs 808.3 KB). three's own
  `three.webgpu.min.js` is smaller (~623 KB) only because three's build mangles its internal
  module properties before publishing; we can't replicate that on the consumed bundle.
- **Split the WebGL2 fallback out of the initial load** — *not possible without forking three.*
  It's statically imported and inlined into the prebuilt `three.webgpu.js`.
- **`modulepreload` the chunk earlier** — *rejected.* It would fetch **and compile** the module
  early — exactly the main-thread contention `index.html`'s boot comment guards against
  (starving the prelude's timers / first paint). `prefetch` (download-only) was chosen instead.

### The one real byte lever left (a product call)

**Drop / lazy-load the WebGL2 fallback (~30% of the engine).** This is the only change that
meaningfully shrinks the bytes, and it's an **L-effort, fragile** bet: it needs three patched so
`WebGLBackend` is a dynamic `import()` (or excluded), and **non-WebGPU browsers** then lose the
app or depend on an untested lazy path — contradicting the Phase-0 acceptance that *both* paths
render (see `Renderer.ts`, the `?webgl` force). A granular `three/src` tree-shake is the other
theoretical path, but three's package `exports` don't expose `src`, and `WebGPURenderer`'s static
fallback import means even that wouldn't auto-split. Either way: **not a quick patch**, and the
prize trades against browser reach.

- **Effort:** the byte win is **L** (fork/patch three, double the path test matrix); the shipped
  prefetch was **S**.
- **Risks / bugs:** dropping the fallback breaks WebGL2-only browsers; granular `src` imports can
  break the raymarch / bloom node graph and aren't a supported entry point.
- **Viz / perf:** faster first load (cold/mobile), feeding **problem 1** (less competing with the
  intro). The prefetch helps delivery; only the WebGL2 drop helps the byte/parse cost. No visual
  change.
- **Notes:** the build's chunk report names the target (`three.tsl`). Touches: `vite.config.ts`,
  `Renderer.ts` (the fallback path), the `three` import surface.

## 6. Merger ringdown / gravitational-wave cue — 🟡 ripple cue done, inspiral dynamics open

The splash *fakes* a binary merger; the live scene could show a real one — two holes that
inspiral, merge, and ring down, with a spacetime-ripple cue. **Most of it is already built**: the
two-hole *render* (a secondary hole + `secondaryDisk` + weak-field lensing) and the **ripple cue**
itself both ship.

**What's shipped:** the **spacetime ripple** — an expanding, decaying sky-warp radiating from the
hole, fired on any absorption — landed v0.27–0.29 (`rippleWarp` in `background.ts`, applied
*globally* across every sky, not just the Lattice grid; idle ⇒ envelope 0 ⇒ no-op). v0.40.1 made it a
proper *merger* cue: the amplitude now **scales with the absorbed body's mass**
(`rippleStrengthForMass`, the `rippleStrength` uniform), so a black-hole merger rings ~2.6× a star
plunge while the common plunge stays at the baseline.

**What's open — the two-hole inspiral *dynamics*** (the only real remaining work):

- **The fork (needs a decision).** Newtonian gravity at close separation *slingshots* (and
  `SOFTENING2` keeps it from merging cleanly), so a believable spiral-in needs either (a) a
  **scripted** inspiral path — low risk, keeps the integrator's bit-exact reversibility intact — or
  (b) a **dissipative radiation-reaction drag** — more physical, but velocity-dependent, so it
  *breaks* the KDK reversibility identity (Step-back / DVR). The roadmap blessed (b) as "consistent
  with the existing model" (absorption is already one-way), **but** that trades a property `#7`
  deliberately preserved, and tightening a close binary makes NaN close-encounter blow-ups more
  likely — so it's a genuine design call, not an implementation detail.
- **Guardrail:** any "stage a merger" affordance must stay **opt-in** (a body added after load) —
  never seeded into the default `seed(3,3,0)`, which would turn `lensingActive` on during the cold
  intro reveal and make it heavier (active problem #1).
- **Viz / perf:** the inspiral is just the N-body already run; the cost is a per-step drag term (CPU,
  cheap). The render is already there.
- **Science:** phenomenological — a scripted / drag-driven inspiral, not a real waveform. Frame it
  honestly.
- **Notes:** Touches: `src/scene/Scene.ts` (inspiral / merge + a staging affordance),
  `scripts/validate-orbit.mjs` (an inspiral-rate assertion), `src/ui/Controls.ts` (the staging
  control, if added).

## 7. Relativistic companion orbits (perihelion precession) — ✅ shipped (v0.40.0)

Done via the **position-only inverse-cube** route (the one that sidesteps the reversibility trap). A
companion's pull from the primary carries one extra `k/r³` term (`PRECESSION_K = 0.3`,
`integrators.ts`), so the central force `f(r) = M/r² + k/r³` precesses the ellipse *analytically* —
apsidal angle `Φ = π√(1 + k/r)`, advance `Δφ = 2π(√(1 + k/r) − 1)` per orbit (~2–3°/orbit here),
reproducing the GR advance's `~1/r` falloff with one constant. Because it's a pure function of
position (gradient of `U = −kM/(2r²)`), velocity-Verlet stays symplectic and **bit-exact reversible**
(Step-back / DVR timeline intact — `integrators.test.ts` guards it); the literal weak-field GR match
is `k = 6M`, so `0.3` is a deliberately slow, on-theme drift (most visible once an orbit is
eccentric). Validated against the closed form in `scripts/validate-orbit.mjs`. Zero intro cost (CPU
N-body, ~6 flops/frame, no shader path). The unreachable GPU N-body path omits the term (documented).

**Open follow-ups (small):** `PRECESSION_K` is a single look-dial — raise it for a bolder rosette, or
seed a slight orbital eccentricity so the drift is visible on the *default* near-circular orbits (the
seed is left circular for now, so precession mainly shows after a scattering). Touched:
`src/physics/integrators.ts`, `scripts/validate-orbit.mjs`, `src/physics/integrators.test.ts`,
`src/physics/GPUPhysicsEngine.ts`.

## 8. Deeper spaghettification / tidal disruption event — ✅ shipped (v0.29.0–v0.32.0)

Done end-to-end (see the [CHANGELOG](../CHANGELOG.md)). In four steps: a **Roche-gated `tidal`**
factor (v0.29.0) tears a star into a **long, blue-hot, tidally-heated stream** (v0.30.0) as it falls
within the Roche radius; the **−** removal was reworked into a graceful **inspiral** that absorbs
exactly like a natural merge (v0.29.2); and the stream now **feeds the disk** — `streamFeed` in
`medium.ts` adds a hot, semi-dense feeding streak (gated on `feedingActive`), i.e. the *honest*
**(b)** "procedural stream source grafted into the disk" route from the original note, not the faked
separate volume (v0.32.0). The whole arc reads as one event: **tear → stream → feed the disk →
absorb → ringdown ripple.** Tuning dials live at the tops of `raymarch.ts` and `medium.ts`.

**What's still open (a smaller future item, if wanted):** the *honest* accretion is still
art-directed — the **Roche trigger** is the only checkable number, and the stream is a radial streak,
not a true **particle/zone stream that wraps** the hole before feeding it. A wrapping stream + real
mass bookkeeping would be its own project; the current look is the intended phenomenological one.

## 9. Swarm / galaxy mode → let the GPU path finally pay off

With CPU/GPU now chosen **automatically** by body count (v0.22.0 —
`PhysicsController.autoSelect`, threshold `GPU_AUTO_BODIES = 256`), the missing half is
a mode that raises `MAX_BODIES` (currently **14**) into the hundreds. At that scale the
selector flips to the GPU compute path on its own and it finally beats the CPU's O(N²).
The switch is already wired — this item is now *"raise the cap + author the mode,"* not
*"add a toggle."*

- **Effort:** M–L.
- **Risks / bugs:** the GPU engine's storage-buffer slot count and the render path's
  per-body uniforms must scale together (`MAX_BODIES` is shared); **lensing is per-body
  in the raymarch**, so hundreds of *lensing* bodies is a render problem, not just a
  physics one — a swarm likely means cheap, non-lensing point bodies; the auto-selector's
  first cross-threshold enable lazy-loads the GPU engine + builds buffers (a one-time
  hitch); hand-placed orbit radii don't scale — a swarm needs a seeded distribution.
- **Viz / perf:** exactly what the GPU compute path was built for; a galaxy/swarm is a
  striking new mode. Watch the **render** budget (lensing N), not just the sim — the same
  per-body-lensing ceiling that gates #10/Kerr.
- **Notes:** Touches: `src/render/bodyUniforms.ts` (slot count), `src/scene/Scene.ts`
  (seeding), `src/physics/PhysicsController.ts` (threshold), `src/render/tsl/bodies.ts`
  (a cheap-body path).

## 10. Kerr (spinning) black hole — the trophy, deliberately last

The headline scientific upgrade: a spin parameter brings frame-dragging, an ergosphere, the
off-centre **D-shaped** shadow, and the one-sided photon ring — the most impressive thing on the
list. The metric is **Schwarzschild-only** today. **Sequenced last on purpose: highest payoff
*and* highest cost, and it directly worsens active problem #1.**

- **Effort:** L — and it's **render-engine** risk, not physics-engine: it lives in
  `schwarzschild.ts` → a new `kerr.ts`; the CPU N-body is untouched.
- **Risks / bugs:** today's geodesic is *almost free* — a tiny central force with a single
  conserved `h²` per ray. **Kerr kills that trick:** the full geodesic RHS (or the Hamiltonian
  form with `E`, `Lz`, and the **Carter constant**), frame-dragging from the off-diagonal `g_tφ`,
  and **stiffer steps near the ergosphere** — more per-ray state, more per-step math, no clean
  conserved scalar to lean on. It **invalidates `validate-geodesic`**; you'd write Kerr analogues
  (prograde / retrograde photon-orbit radii, the asymmetric shadow boundary).
- **Viz / perf:** **the worst on the list — realistically 2–4× the per-ray cost of the dominant
  pass**, which is the very pass that hitches at takeover (problem 1). **Do not ship until problem
  #1 is solved, and gate it behind its own step budget / quality tier.**
- **Science:** a big real gain — **but only if companion lensing is upgraded too.** Companions
  lens in the **weak field**; an exact-Kerr primary ringed by Newtonian-approx companions is a
  fidelity mismatch.
- **Notes:** Touches: `src/render/tsl/schwarzschild.ts` (→ `kerr.ts`), `src/render/tsl/disk.ts`,
  `src/render/tsl/raymarch.ts`, `src/render/tsl/bodies.ts` (companion lensing), the validation
  scripts.

---

## 11. Audio — rotating background tracks + event sound design

Sound turns the page from a visualization into a place: a pool of **background tracks in an
endless random rotation** (never the same one twice in a row), and **one-shot effects** for the
moments the app already marks — the intro's creation burst and merger, the reveal, each body's
arrival swoosh, escapes, absorptions, and (biggest of all) a **black-hole merger**. The
**scaffolding shipped in v0.56.0**: `src/audio/` holds the typed manifest (empty until assets
land in `public/audio/`), the pure rotation picker (`createRotation`, unit-tested: full coverage
per cycle, no back-to-back repeats across seams), and the gesture-unlocked `AudioDirector`
(two-bus WebAudio — music + SFX — muted by default, per-asset dB trims, clean no-op over the
empty manifest).

- **Effort:** M for the wiring + panel UI; the real work is **sourcing/authoring the assets**
  (a licensing decision: original, commissioned, or CC — the About card should credit either way).
- **Risks / bugs:** autoplay policy (already handled: the context exists only after `unlock()`
  from a real gesture); worker-path parity (the SFX triggers are scene events — on the worker
  path they arrive as the 4b `event` messages, so main-side wiring covers both paths); asset
  weight (stream `<audio>` vs decode-in-full — pick per track length).
- **Viz / perf:** none on the render loop; decode happens off the hot path and is cached.
- **Notes:** wiring lands with the first assets: `AudioDirector.unlock()` on first pointerdown,
  `sfx()` from the event stream, `startMusic()` + an Audio folder in the panel (mute default ON,
  volume slider, "credit" line). Touches: `src/audio/**` (exists), `src/main.ts`,
  `src/ui/Controls.ts` + `workerControls.ts`, `src/ui/about.ts` (credits).

---

## Notes

**Testing structure (reviewed v0.18.0; still lean — no cruft).** Physics/maths is the
deepest coverage (`integrators` incl. reversibility, `Scene`, `TimeController`,
`GPUPhysicsEngine` packing, `FormationSequence`, `ResolutionScaler`, `quality`,
`bodyUniforms`), with `tagline` guarding the README mirror, plus UI smoke tests
(`keybindings`, `hudFolder`, `historyBar` markers) and the `History` suite. v0.22.0 added
`PhysicsController.autoSelect` (the CPU/GPU decision) and a `hud` detail-line suite (the S/P/B
breakdown + compute token); v0.26.0 added the `Timeline` (DVR scrub / step / replay clamp) suite
and rewrote the `TimeController` step tests around the new discrete `step`. Since then: v0.37.0 the
worker `router` (mock-engine message routing, no three import); v0.38.0 `History.truncate` +
`Timeline.commit` + `EventLog.dropFrom` (commit-on-edit-while-rewound); v0.39.0 `History` unborn-skip
+ the now-generic `BirthTicker` emit-the-body; v0.39.1 `recordClip` (MIME preference + capability
guard). Default env is Node (fast); DOM tests opt in per-file with `// @vitest-environment jsdom`.
Next gaps worth covering: `stepper` add/remove caps and the `Controls` speed/clamp math.

**Headless splash capture.** Headless *virtual-time* does **not** advance compositor
CSS animations — freeze them with a Web-Animations `currentTime` (the canvas, on
main-thread rAF, *does* advance under virtual time). `scripts/capture-splash.mjs`
relies on this two-pass trick; remember it for the next splash tweak.
