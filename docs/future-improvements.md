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
   ringdown) → #9 swarm / galaxy (🟡 **v2 shipped v0.73.0** — realistic spiral; open: bigger stars,
   lensing, worker parity) → ~~#12 dark matter / #13 dark energy~~ (✅ **shipped v0.75.0** — Advanced
   sliders; position-only so reversibility holds, zero shader cost; validated flat curve + turnaround.
   Open: a Galaxy-Mode rotation-curve version).
5. **The trophy, last** — #10 Kerr: a 🟡 **phenomenological "Kerr spin" first look shipped (v0.76.0)**
   (an experimental slider, spin 0 = exact Schwarzschild, validated shadow shift); the **exact metric**
   (frame-dragging from `g_tφ`, Carter constant, ergosphere) remains the L-effort trophy, behind its
   own step budget since it worsens #1.

Net (from the items-8–11 review): with #8 and the #6 ripple now shipped, the remaining discipline
is all about **Kerr** — it's the one in active tension with problem 1. The other physics items are
tractable, and **#7/precession is genuinely low-risk once you keep the perturbation position-only**
(see its entry).

---

## 1. First-load lag as the physics visualizer takes over  ✅ solved by first light (v0.68–0.71)

**RESOLVED (v0.71.0): first light is on by default.** The single biggest remaining problem — the
cold first-load compile freeze — is fixed for real users without the OffscreenCanvas worker. The fix
turned out to be far cheaper than the worker migration: the reveal renders on a **lean** raymarch
variant (`createBlackHoleNode({lean})` omits the four heaviest per-slot blocks, all no-op during the
seeded intro → **pixel-identical**), which compiles in a fraction of the time; the full shader swaps
in only when the scene first needs it (a hole/tear/merge). Measured Firefox: `bootToLoop 4372 →
1800ms` cold / **316ms warm**, reveal **janks 0, maxMs 22** (was 287) once the resolution-ceiling
**ramp** (v0.69.0) stopped the climb-back rebuilding pipeline targets bare at the reveal. Files:
`render/firstLight.ts` (`FIRST_LIGHT_DEFAULT`), `render/tsl/raymarch.ts` (the `lean` gate), `main.ts`
+ `worker/workerEngine.ts` (lean pass, deferred swap, the maxScale ramp).

**Consequence for the worker path (below):** first light solves the cold compile with **no threads**,
so the OffscreenCanvas worker's *intro* advantage collapses to spawn/transfer **overhead** — the
measured Chrome `?worker=1` compile+prime (~1000ms) is *slower* than the default main path's warm
boot. The worker stays opt-in for a possible future benefit (keeping the main thread free for input
during heavy interaction), but it is **no longer the fix for problem #1**, and `WORKER_DEFAULT`
should **not** flip on its intro merits alone. Historical narrowing below (still accurate context):

The problem was **narrowed to the cold first-load compile** — the *periodic post-load stutter* was
fixed (v0.36.1–.2, below). The **first** splash→engine takeover (camera dolly + disk ignition) was
the heaviest the app gets and landed on a cold, first-time pipeline (the tell: "Replay intro" was
smooth — warm caches — while the *first* reveal hitched). The roadmap-#8 work (v0.29–0.32) grew the
raymarch WGSL, lengthening that compile; first light (a lean reveal variant) is what finally cut it.

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
  big swing for 1.0 — not a patch. **Functionally COMPLETE behind `?worker=1` — steps 1–5 shipped
  (v0.45.0–v0.53.0), step-6 seam in place (v0.54.0), and only the default flip is staged.** With
  `?worker=1` the worker owns the whole engine on a transferred `OffscreenCanvas`: the real raymarch
  shader compiles **in the worker**, input/resize (3a/3b), the full sim + loop (3c), the control
  channel + worker panel (4a), HUD/orbit-map telemetry + the DVR/history (4b), and Share/clip
  encoding (5) all run off-thread. **The flip is one constant — `WORKER_DEFAULT` in
  `src/worker/capability.ts`** — gated only on the parity residue (panel Replay-intro melt across
  threads, shortcuts, settings persistence, touch tooltips), on-device `osp.perf` vs
  `osp.workerPerf` numbers (Mac + phone), and a real-device worker-path Share check. See
  [`offscreen-canvas-session.md`](archive/offscreen-canvas-session.md) for the checklist.

  **⚠️ The worker path can never help Firefox.** WebGPU-in-a-worker wedges Gecko's GPU process (the
  v0.47.1 crash), so the **Gecko gate** (`isGeckoUA` in `capability.ts`) forces Firefox onto the
  **main** path regardless of `?worker`. The "real fix" above therefore fixes the cold compile only
  for capable non-Gecko browsers — **on Firefox the compile+prime is inherent** (see below).

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
only honest before/after.

**Measured cold Firefox (07-05, v0.65.0):** `compile 1703ms`, `prime 2661ms`, `bootToLoop 4372ms` —
and a Portka video-bug-analyzer `--cadence` pass on the same recording localises **two main-thread
freezes** (`~1.55s @1.68s`, `~2.57s @3.23s`) that map almost exactly onto those two marks. So on
Firefox the splash *covers* ~4s of cold compile+prime but the GPU-saturation freeze is real, not
masked away. **The only lever that has ever moved that number is shrinking the raymarch WGSL**
(v0.64.0 dropped the `atan` m=2 buckle + a param from the 14×-unrolled `secondaryDisk` loop); the
worker migration — the "real fix" above — is **Gecko-gated off Firefox**, so it cannot help here. The
next real reductions for the main (Firefox) path, in order of value: **(1)** the *progressive
first-light compile* — **started v0.68.0, staged behind `?firstlight` (default off)**: the reveal
renders on a **lean** raymarch variant (`createBlackHoleNode({lean})` omits the 4 heaviest per-slot
blocks — `streamFeed`, merge flash, `streamArc`, `secondaryDisk`, all no-op during the intro, so
lean ≡ full for the reveal), then the full shader compiles off the critical path and swaps in
(`render/firstLight.ts`; `osp.perf.fullCompile` times it) — **next: measure `?firstlight=1` vs
default on-device, watch for a swap hitch, then flip `FIRST_LIGHT_DEFAULT`**; **(2)** more
raymarch-WGSL trimming / a lower `MAX_BODIES` unroll; **(3)** a true raymarch step budget if `osp.perf`
shows the residual hitch is ALU- rather than pipeline-bound. Dust-ramp/screen-space dialing is spent.

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

**The logo is locked (v0.42.0, refined to the monoline v2 mark v0.44.0)** — warm-silver ring,
ember-lit horizon — shipping as the static `assets/logo.svg` (served as the favicon,
`public/favicon.svg`) and the animated `assets/hero.svg` (README hero + the About-card art in
`about.ts`). Its **cooler** silver palette (`#c4beb2` / `#d8d1c4` ring, `#e9e3d5` dust — the v0.44.0
values, *not* the earlier Ember-Core `#c3bcab`/`#ffd2a6`) is the brand reference the remaining theme
work should align to.

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
proper *merger* cue: the amplitude **scales with the absorbed body's mass** (`rippleStrengthForMass`,
the `rippleStrength` uniform). Retuned in the v0.57.0 overwhelming-plunge pass — `RIPPLE_MASS_GAIN`
is now **16** with a **4.5×** cap (`rippleStrength.ts`), so a companion **black-hole** plunge rings
**~4.2×** a common star plunge (was ~2.6×), plus a √-strength longer **ringdown** stretch.

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

## 9. Swarm / galaxy mode → let the GPU path finally pay off  🟡 v2 shipped (v0.73.0)

**v2 (v0.73.0) — a realistic spiral, and the lag is gone.** The overlay-on-raymarch design (galaxy =
raymarch + overlay = *more* work) is replaced: once the galaxy blooms in, a camera-locked opaque
backdrop lets the host **skip the raymarch entirely** (physics/timeline freeze too — "regular mode
stops"). The pure `Galaxy` core is now a three-population spiral — a warm-gold **bulge** filling the
centre, blue-white **arms** on a density-wave-biased two-arm log spiral, a reddish outer **halo** —
with two additive core-glow billboards; exit replays the intro (a page-refresh-like reset). **Open for
v3:** genuinely *bigger/softer* stars (WebGPU draws `THREE.Points` at a fixed 1px — needs three's
instanced-Sprite `PointsNodeMaterial` path); lensing the galaxy through the hole; worker-path parity;
a real-device look/perf pass (esp. mobile); and the mutual-gravity **swarm** variant below (this is the
*test-particle* galaxy). The **dark-matter halo (#12)** slots naturally on top of this.

**v1 history — superseded by v2 above.** **v1 (v0.63.0), framed + brightened (v0.65.0):** Galaxy Mode shipped behind an Advanced toggle
(now the *first* item under Advanced, v0.66.1) — ~1000 stars (some with a planet) orbiting the
central hole, rendered as an additive `THREE.Points` overlay (`src/galaxy/`). The stars are **test
particles** in the central potential (no mutual gravity, so no O(N²) cost), each on its own inclined
Kepler orbit — so the initial two-arm spiral shears and winds as a real differentially-rotating disk
does. The mode transition is a **bloom** (`reveal` scales every orbit from the centre out + a fade).
**v0.65.0 fixed the v1 "too small to see" caveat:** the camera **auto-frames** the whole disk on
enter (`CameraRig.flyToFrame`, a 3/4 fly-out; flies back on exit), the disk is **compacted**
(`rOuter` 140 → 64) to fit the dolly reach, and the stars are **fixed screen-space size + brighter**.
The pure orbital core is unit-tested. **Open for v2:** worker-path parity (Galaxy is main-path only —
zero `src/worker/**` references); lensing the galaxy points through the hole (they composite in front
today); a denser GPU-compute particle path if we push the count; and the "swarm" N-body variant
below (this v1 is the *test-particle* galaxy, not the mutual-gravity swarm).

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

## 10. Kerr (spinning) black hole — the trophy, deliberately last  🟡 experimental first look (v0.76.0)

**Experimental first look shipped (v0.76.0):** an Advanced **Kerr spin** slider (a/M, 0 = Schwarzschild)
drives a *phenomenological* frame-dragging term in the geodesic — `a_drag = K·spin·(ŷ×pos)/r⁵`, an
azimuthal push around the spin axis (`frameDragAccel` in `schwarzschild.ts`). It reproduces the visual
signature (the shadow shifts / one-sided ring — the **D-shape**), **CPU-validated** in
`validate-geodesic.mjs` (spin 0 recovers `b_crit = 3√3·M`; spin 0.9 → ~17% prograde/retrograde shift).
It is **not** the exact metric (see below) and is gated so **spin 0 is byte-exact Schwarzschild** — the
term is full-shader-only (never the lean reveal) and returns 0 at spin 0, so problem #1 and the default
look are untouched. The control is now a **plain on/off toggle (v0.85.0)** — Off = 0, On = near-extremal
**a/M 0.99** — and the strength was raised (`KERR_FRAME_DRAG_K` 2.6→6) so the effect is finally **bold**:
at 0.99 the prograde `b_crit` shrinks **~51%** below retrograde (CPU-validated 3.35M vs 5.99M; empirically
stable at coarse shader resolution — a review checked 4000 rays, 0 NaN), a strong D-shape + one-sided
ring. **Deferred out of 1.0.0 (user's call):**
the exact metric stays the **first post-1.0 project** — the phenomenological spin is 1.0.0's "Kerr". The
prize remains the **exact Kerr metric** below (frame-dragging from `g_tφ`, the Carter constant, the
ergosphere, the true D-shaped shadow, off-equatorial θ-motion) — the L-effort item this always was;
it directly worsens problem #1's per-ray cost, so it takes its own step budget after the stable tag.

The headline scientific upgrade: a spin parameter brings frame-dragging, an ergosphere, the
off-centre **D-shaped** shadow, and the one-sided photon ring — the most impressive thing on the
list. The metric is **Schwarzschild-only** today (the v0.76.0 slider is a *look* approximation, not the
metric). **Sequenced last on purpose: highest payoff *and* highest cost, and the exact version
directly worsens active problem #1.**

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

## 11. Audio — rotating background tracks + event sound design  ◐ music shipped (v1.0.0); SFX open

Sound turns the page from a visualization into a place: a pool of **background tracks in an
endless random rotation** (never the same one twice in a row), and **one-shot effects** for the
moments the app already marks — the intro's creation burst and merger, the reveal, each body's
arrival swoosh, escapes, absorptions, and (biggest of all) a **black-hole merger**. The
**scaffolding shipped in v0.56.0**: `src/audio/` holds the typed manifest (empty until assets
land in `public/audio/`), the pure rotation picker (`createRotation`, unit-tested: full coverage
per cycle, no back-to-back repeats across seams), and the gesture-unlocked `AudioDirector`
(two-bus WebAudio — music + SFX — muted by default, per-asset dB trims, clean no-op over the
empty manifest).

**The music half shipped in v1.0.0.** `public/audio/OneStillPoint.m4a` — the score written for the
piece — plays from the panel's Ember-Core mark: logo at rest, **play** on hover, **pause** while
running, looping for the life of the page (`src/ui/musicMark.ts`). Two decisions worth keeping:
music **streams from an `<audio>` element** (three minutes through `decodeAudioData` is ~70 MB of
PCM held for the session), while SFX keep the WebAudio buses where one-shots must overlap; and the
mark is a **sibling** of lil-gui's `$title`, because that title is itself a `<button>` and buttons
can't nest. `MUSIC_TRACKS` holds one entry, so the element loops natively — adding a second turns
the existing shuffle rotation back on via the `ended` handler, no other change.

**What's left here is the SFX half** (plus the panel's Audio folder and the About credit): the
one-shot map in `manifest.ts` is still empty, and nothing calls `sfx()` yet.

- **Effort:** S for the remaining SFX wiring; the real work is **sourcing/authoring the assets**
  (a licensing decision: original, commissioned, or CC — the About card should credit either way).
- **Risks / bugs:** autoplay policy (already handled: the context exists only after `unlock()`
  from a real gesture); worker-path parity (the SFX triggers are scene events — on the worker
  path they arrive as the 4b `event` messages, so main-side wiring covers both paths); asset
  weight (stream `<audio>` vs decode-in-full — pick per track length).
- **Viz / perf:** none on the render loop; decode happens off the hot path and is cached.
- **Notes:** the music mark already calls `unlock()` + `setMuted(false)` on its click, so the
  gesture and the context exist the moment anyone asks for sound — SFX wiring is `sfx()` from the
  event stream plus assets in the manifest. Still wanted: an Audio folder in the panel (volume
  slider; the mark covers play/pause) and a credit line. Touches: `src/audio/**`, `src/main.ts`,
  `src/ui/Controls.ts` + `workerControls.ts`, `src/ui/about.ts` (credits).

## 12. Dark matter — a flat-rotation-curve halo (the reversibility-safe physics add)  ✅ shipped (v0.75.0)

**Shipped (v0.75.0):** an Advanced **Dark matter** slider (0..1) adds the halo term below to the
CPU N-body — orbits tighten and the rotation curve flattens (validated in `validate-orbit.mjs`:
~5% drop r→2r vs Kepler's ~29%; 4 integrator tests incl. reversibility). Position-only, so Step-back
/ DVR stay exact; zero shader cost. **✅ Galaxy-Mode follow-up shipped (v0.82.0):** the test-particle
rate now carries the halo — `Ω² = M/r³ + A/r² − Λ` (`Galaxy.omegaAt`/`setDark`, unit-tested), **dark
matter ON by default (0.55)** so the arms persist, with Dark matter / Dark energy dials in the Galaxy
menu. This item is now **fully done** (regular N-body + Galaxy Mode).

The engine models visible mass only, so orbital speed falls off Keplerian (`v ∝ 1/√r`). Real
galaxies don't: their **rotation curves stay flat** out to large radius, the classic fingerprint of
an extended **dark-matter halo** whose enclosed mass keeps growing (`M(r) ∝ r`, i.e. density
`ρ ∝ 1/r²` — the singular isothermal sphere — or the ΛCDM-standard **NFW** profile
`M(r) = M₀[ln(1+x) − x/(1+x)]`, `x = r/rₛ`). The **adjustment** is a single extra **radial
acceleration** from that halo profile, added to the central force `f(r) = M/r² + k/r³` (→ `+ g_halo(r)`).

**Why this is the clean one:** it's a **pure function of position** (the gradient of a static
potential), so velocity-Verlet stays **symplectic and bit-exact reversible** — the very property
#7/precession was careful to keep and #6b/radiation-reaction sacrifices (Step-back / DVR stay
intact). And it's **CPU N-body only (a few flops/frame), zero shader cost**, so unlike Kerr it does
**not** worsen problem #1.

**Where it reads:** most legibly in **Galaxy Mode** (v0.73.0) — the test-particle rate becomes
`Ω = √((M/r³) + g_halo(r)/r)`, so outer stars orbit *faster* than Kepler, the differential shear
weakens, and the two-arm spiral **winds more slowly / persists longer**. A **toggle** turns it into a
genuine interactive "with vs without dark matter" demo — the single most recognizable dark-matter
result, made watchable.

- **Effort:** S–M for the orbital halo (one radial term + a Galaxy-Mode toggle + a validation
  assertion); **+M** if you also add the halo to the raymarch deflection (dark matter *lenses* light —
  how it's actually mapped — but that's render-side, the higher-risk half).
- **Risks / bugs:** picking a halo normalization/scale that's *visible* at the app's compact `rOuter`
  (~64 M) without destabilizing orbits. **Keep it opt-in / Galaxy-Mode-scoped** — never fold it into
  the default `seed(3,3,0)` intro (same guardrail as #6), so the cold reveal is unchanged. The CPU
  N-body and the (unreachable) GPU N-body must carry the term consistently, as #7 documents.
- **Viz / perf:** a watchable rotation-curve flattening / longer-lived spiral; CPU-cheap, no render cost
  (until the optional lensing half).
- **Science:** a real, recognizable result. The *shape* (flat curve) is honest; the specific halo mass
  is a toy normalization — frame it that way.
- **Notes:** validate with a rotation-curve assertion in `scripts/validate-orbit.mjs` (`v(r)` flat with
  the halo vs `1/√r` without). Touches: `src/physics/integrators.ts` (the radial term),
  `src/galaxy/Galaxy.ts` (`Ω` with the halo), `src/ui/Controls.ts` (toggle),
  `scripts/validate-orbit.mjs`; optionally `src/render/tsl/` (halo lensing).

## 13. Dark energy — a cosmological-constant repulsion (`Λ ∝ +r`)  ✅ shipped (v0.75.0)

**Shipped (v0.75.0):** an Advanced **Dark energy** slider (0..1) adds the outward `Λ·r` term to the
CPU N-body — past the turnaround radius `r_ta = (M/Λ)^⅓` the outer bodies unbind and drift away
(validated in `validate-orbit.mjs`: inward below r_ta, outward above). Position-only (reversible),
zero shader cost, exaggerated for visibility. **✅ Galaxy-Mode version shipped (v0.82.0):** a Dark
energy dial subtracts Λ from the test-particle Ω², so the outer arms slow and freeze (fixed radii
can't advect/unbind — the honest test-particle limit, as noted). Full radial advection is still a
possible future refinement but out of scope for the demo.

The natural companion to #12: the cosmological constant Λ acts locally as a **repulsion that grows
with distance**, `a = +(Λc²/3)·r` (the de Sitter term). Added as a static radial force `∝ +r` it is —
like the halo — **position-only, so still symplectic and reversible**, and CPU-cheap with no shader
cost. The two form a tidy pair: an **attractive** halo (#12) and a **repulsive** Λ, both one-line
additions to the same central force `f(r)`.

**Where it reads:** a **turnaround radius** `r_ta = (M/Λ_eff)^{1/3}` appears where the repulsion
overtakes gravity; beyond it, distant companions / the galaxy's outer arms become **unbound and drift
away** — cosmic expansion in miniature.

- **Effort:** S (one `+Λ_eff·r` radial term + a knob).
- **Risks / bugs:** a `+r` force is **unbounded** → bodies run away to the domain edge and fire a lot
  of "escaped" events; it needs **clamping and opt-in** (best scoped to Galaxy Mode). **Do it as a
  static force, not a velocity-space "Hubble drift"** (`ȧ/a·r` added to velocities) — the drift is
  time/velocity-dependent and would **break the reversibility covenant**, exactly the trap #6b names.
- **Viz / perf:** a dramatic "everything recedes" mode; CPU-cheap.
- **Science:** the **sign and the `∝ r` law are physically right**, but to be visible at the app's
  scale `Λ_eff` must be exaggerated *enormously* above any real value — a purely **illustrative** knob.
  Say so plainly (an About/credit note), the way #8's accretion and #6's inspiral are framed.
- **Notes:** validate the turnaround radius against the closed form `r_ta = (M/Λ_eff)^{1/3}`. Touches:
  the same files as #12 (`integrators.ts`, `Galaxy.ts`, `Controls.ts`, `validate-orbit.mjs`).

---

## 14. Consumption debris + polar jets (the reference footage's last beat)

The ESO tidal-disruption reference (frame-analyzed 2026-07-15) ends with two beats v0.89.0's
spaghettification v2 deliberately left out: a **diffuse unbound-debris fan** (roughly half a real
TDE's stream is ejected, not accreted — the broad glowing spray drifting away opposite the wrap) and
a hint of **polar jet** as the hole feeds. Cheap first passes: a debris fan as a second, wider,
low-alpha cone-tube in `streamArcHit` fed by `tear` (same gating, ~30% more arc cost), and a jet as a
brief two-lobed emissive puff along ±ŷ at absorb, driven off the existing merge-flash clock.

- **Effort:** S–M (both are additive gated blocks in the existing tear/flash machinery).
- **Risks / bugs:** more unrolled-loop growth (see the #16 hoisting note first); the jet must not
  read as the merge flash (different color/shape).
- **Viz / perf:** completes the reference look; zero cost when nothing tears (same gates).

---

## 15. Origin/deploy hygiene (Portka site-evaluator findings, 2026-07-15)

A live `--url` + shipping-HTML `--html` evaluator pass scored the HTML 100/100 (SEO/social/brand/
AI-readiness) after v0.91.1's meta-description + `data-nosnippet` fix, but flagged **origin-side**
gaps, all host/deploy-level:

- **Verify the deploy serves `public/`** — the live origin 404'd `robots.txt`/`sitemap.xml` even
  though both ship in `public/` (a stale deploy, a path config issue, or possibly the sandbox
  proxy's artifact — check from a real network and redeploy if genuine).
- **Security headers** at the host: `Strict-Transport-Security`, a `Content-Security-Policy`
  (report-only first), `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- **`/.well-known/security.txt`** (RFC 9116) — the About modal already has the contact info.
- **Richer JSON-LD** — a `FAQPage` block from the About content is a cheap AEO win.
- **A Lighthouse pass on the live URL** for real LCP/CLS/INP numbers (the evaluator only hints).
- After the v0.91.1 re-crawl lands, spot-check the Google snippet (Search Console → URL inspection →
  Request indexing accelerates it).

- **Effort:** S (each item is minutes once at the host config).

---

## 16. Deferred engineering notes (2026-07-15 adversarial reviews)

Non-blocking debts the session's reviews surfaced, parked deliberately:

- **`streamArcHit` uniform hoisting** — ~40% of its ops (basis vectors, arc lengths, tube radii) are
  uniform-only yet re-emitted inside the 512-step loop ×14 slots. If full-shader compile time or GPU
  cost ever bites, precompute them as per-slot CPU uniforms (est. −10% loop-body text).
- **History doesn't snapshot `chaseId`/`eaterId`** (like `absorbing` before them) — a rewind across
  a capture loses the tear's anchor on replay. Cosmetic; fold into any future History field pass.
- **Kerr-ON ring/pick error** — with spin 0.99 the frame-drag twists photon paths out of the launch
  plane, so `apparentScreenPos` (Schwarzschild-exact) can be tens of px off near the shadow. Goes
  with the exact-Kerr follow-up (#10's second phase).

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
