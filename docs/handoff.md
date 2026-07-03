# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.46.2 (2026-07-03)._

## Where things stand

- **The OffscreenCanvas migration is the active project and the 1.0 gate** — the user's call after
  the 07-02 recordings: *"it can't be released as is with this lag."* Steps 1–3c are DONE; the
  full engine (Scene + N-body physics, formation, ResolutionScaler + intro deep cut, fuzz/step
  reveal ramps, measured pre-warm, SmoothnessGate, RevealProfiler) runs **in the worker** behind
  `?worker=1` (v0.46.0). Splash choreography stays on main (protocol v3: `revealReady` out →
  `command('reveal')` in). **Next: 4a** (control channel: Controls/GUI → worker), **4b**
  (status/event → HUD + history), **5** (Share/clip worker-side), **6** (RenderHost flip +
  default-on). Plan + checklist: [`offscreen-canvas-session.md`](offscreen-canvas-session.md).
- **The `?worker=1` tab crash is diagnosed and fixed (v0.46.0).** The user's crash report on the
  step-2 proof: the loop free-ran on `setTimeout(16)` with **no vsync pacing or presentation
  backpressure**, piling command buffers into the GPU process until the tab died. Now
  `renderer.setAnimationLoop` (worker rAF) through the shared `Loop`. Debug telemetry shipped for
  the *next* report: `osp.workerPerf` (reveal profiler), `osp.workerStatus` (throttled), a
  rate-limited uncaught-error relay, and a Worker-*object* `error` listener (script 404 can't
  strand the splash). **Ask the user to re-test `onestillpoint.app/?worker=1`** and read those.
  3c was adversarially reviewed (10 confirmed findings fixed, 2 refuted) — see CHANGELOG 0.46.0.
- **Plunge choreography is landing well** ("I love the orbiting plunge animation, keeps getting
  better"). Current form (v0.43.0 → v0.46.2): winds from the body's **own** rate (no spin kick,
  direction preserved), three acts (descend → **perfect-circle loop** at `MERGE_RADIUS×1.25` →
  dive), and now a **full halo ring finale** — `STREAM_MAX_ARC 6.6` with the trailing spiral
  circularizing as the tear completes, so the streak closes into a ring for the last revolutions
  before the spark. − debounce released twice by review: now a **~0.54s tap-guard**
  (`plunging < 0.12`), not an animation lock.
- **Roadmap #1 (intro lag), the record so far:** main-thread stalls (v0.40.3) → the definitive
  wrong-pipeline-variant GPU-process freeze, fixed 3 ways (v0.42.2: `post.compileAsync` +
  `onSubmittedWorkDone` prime + SmoothnessGate) → perceived lag from the splash dust self-stopping
  (v0.43.1: dust loops until dismissal) → **verified on-device** (07-02 Firefox: `maxMs` 92
  vs 1965). Residual architectural lag is what the worker migration finishes off. Evidence docs:
  [`perf-recording-2026-07-01.md`](perf-recording-2026-07-01.md),
  [`perf-recording-2026-07-02.md`](perf-recording-2026-07-02.md).
- **Brand v2 "Infall" landed (v0.44.0, Firefox fix v0.45.1).** Monoline still mark →
  `assets/logo.svg` + `public/favicon.svg`; animated Infall (motes riding an offset-path over the
  halo) → `assets/hero.svg` + the About card. The Firefox "two motes" bug was Gecko not
  re-expanding SVG **filter regions** under offset-path motion — animated motes are now single
  gradient-fill circles (no filters on any animated element). The still mark also rides the
  control panel's title row (v0.46.1).
- **About modal polish (v0.46.1):** Donate is one compact row — `$BTC` / `$ETH` copy chips (✓
  flash, full address in tooltip) + `Venmo ↗` new-tab link.
- **User adds prefer stability (v0.41.x line):** `openOrbitRadius` places new bodies in the widest
  open gap; destruction stays beautiful *and* physical (two-scripts policy below).
- **The two-scripts policy is standing** — [`physical-script.md`](physical-script.md) alongside the
  art-directed [`intro-script.md`](intro-script.md), incl. the **reversibility covenant**:
  irreversible physics during the intro window ONLY, never after settle.
- **Repo rename to `one-still-point`:** answered — safe (GitHub redirects old URLs, remotes keep
  working); the user renames in Settings, then we do one in-repo reference-update PR
  (README/About/CHANGELOG links + `GITHUB` const in `src/ui/about.ts`).

## ⚠️ Open caveats — read before touching these

- **`?worker=1` needs a real-device re-test** (post-crash-fix). Ask for: does it still crash? Then
  console: `osp.workerPerf`, `osp.workerStatus`, any `[worker]`-relayed errors. That's the data 4a+
  decisions want.
- **Share (v0.39.1) still needs a real-device check.** This environment's headless GPU cannot read
  the WebGPU canvas by any method, so Share's clip path has never been exercised end-to-end. On
  real hardware read **`osp.clip.status`** if it falls back to PNG. Files: `src/ui/recordClip.ts`,
  `src/ui/clipRecorder.ts`, `src/main.ts` (`captureShare`).
- **Worker path is opt-in and one engine behind by design.** Until step 6 (RenderHost flip), the
  worker engine (`src/worker/workerEngine.ts`) duplicates main-path behavior; changes to
  Scene/formation/reveal dials must be mirrored there or the two paths drift. Keep diffs small and
  check both.
- **CHANGELOG editing hazard:** the version test only checks the *current* version's entry —
  replacing a bullet's opening line without re-including it silently orphans older bodies. After
  any CHANGELOG edit run `grep -n '^\- \*\*0\.' CHANGELOG.md` and eyeball the sequence.

## Out of session scope (for now)

- **three.js upstream PR candidates** (from the migration evaluation, all measured here): async
  compute-pipeline creation; `PostProcessing.compileAsync`; dynamic-import the WebGL2 fallback.
  Filed in [`offscreen-canvas-session.md`](offscreen-canvas-session.md) §evaluation.
- **Portka Tools dogfooding loop is live** — `cportka/claude-plugins` is now in-scope; the
  video-bug-analyzer (v1.3.0: `--probe/--motion/--cadence/--contact`) did the recording analyses;
  feedback filed upstream as issues (#64 fixed in 1.3.0, #66 open).

## How we work here (the essentials)

- **Portka SOP** (from `CLAUDE.md`): for every change — sync `main`, branch, update tests + keep CI
  green, open a PR, **merge on green**, hand back a short PR link. Never commit to `main` directly.
- **SemVer triplet, enforced.** `package.json` `version` ↔ `src/version.ts` `VERSION` ↔ a
  `**MAJOR.MINOR.PATCH**` `CHANGELOG.md` entry must agree — `src/version.test.ts` fails the build
  otherwise. Bump every change (MAJOR breaking / MINOR feature / PATCH fix+docs).
- **CI.** `ci.yml` (`check`: lint · typecheck · test) runs on every PR. `validate-physics.yml`
  (`validate`: the geodesic/disk/orbit/lensing maths) runs **only** when `src/physics/**`,
  `src/render/tsl/**`, `src/scene/**`, or `scripts/validate-*.mjs` change — so UI/docs PRs skip it.
- **Measure, don't guess.** Perf work pairs a screen recording (analyzed with the Portka
  video-bug-analyzer) with the on-device `osp.perf.report()` / `osp.workerPerf` numbers. The user
  supplies recordings + reports on request.
- **Verifying in a real browser (headless).** Playwright + the pre-installed Chromium can boot the
  app; `window.osp` exposes `{ renderer, scene, physics, history, timeline, events, clip, … }` for
  inspection (the sim runs even though the headless render is black). Caveat above: the WebGPU
  canvas isn't *capturable* here. Verify scripts live in `scripts/` (`verify:intro`, `capture:*`).

## Map of the docs

- [`CLAUDE.md`](../.claude/CLAUDE.md) — standing workflow + versioning conventions.
- [`future-improvements.md`](future-improvements.md) — the roadmap to 1.0.0 (top = next).
- [`offscreen-canvas-session.md`](offscreen-canvas-session.md) — the worker migration: evaluation +
  live checklist (3a–3c ✅, next 4a). [`offscreen-canvas.md`](offscreen-canvas.md) — original scope.
- [`intro-script.md`](intro-script.md) · [`physical-script.md`](physical-script.md) — the two
  scripts (art ∥ reality) + the reversibility covenant.
- [`perf-recording-2026-07-01.md`](perf-recording-2026-07-01.md) ·
  [`perf-recording-2026-07-02.md`](perf-recording-2026-07-02.md) — the measured lag investigations.
- [`perf-frame-rate.md`](perf-frame-rate.md) · [`archive.md`](archive.md) — perf notes + shipped history.
