# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.43.1 (2026-07)._

## Where things stand

- **Roadmap #1: v0.42.2 VERIFIED on-device (07-02 Firefox report: `maxMs` 92 vs 1523, real
  `prime` mark, `smoothGate` 108ms).** The remaining "lag between splash end and the engine" on
  iOS/Firefox was *perceived* — the splash dust self-stopped at 1.7s and faded out, so slow boots
  sat under a frozen splash. Fixed v0.43.1: the dust **loops** until the splash is actually
  dismissed. Next verification: one cold iOS + Firefox load each — the wait should now read as a
  living, turning dust field; residual watch-item is the occasional brief splash stutter during the
  covered `prime` (GPU-queue backpressure, much reduced, documented).
- **The plunge review landed (v0.43.0):** the − finale now holds **fast perfect horizon loops**
  (~2–3 rings at ~17× the body's own rate) before the dive + spark; the gravity ripple is 20%
  smaller; the − debounce releases at half the plunge. All still recording-verified art — judge on
  the next plunge clip.
- **The OffscreenCanvas side-session is scoped and ready** —
  [`offscreen-canvas-session.md`](offscreen-canvas-session.md): the evaluation (no third-party
  edits needed; fork not recommended — three upstreamable three.js gaps instead, incl. the async
  post-compile gap we measured) + the PR-sized todo list (steps 3a–6 + cleanup). Recommended as
  the 1.0 robustness gate, no longer the perf emergency.
- **Roadmap #1's earlier definitive diagnosis (v0.42.2), for the record.** The second
  measurement round (Chrome + Firefox cold recordings + `osp.perf`) caught a single **1.5–2s
  page-wide freeze** at loop start that hard-cut the reveal. Verified against stock three r184
  source: the pre-warm compiled the raymarch against the **default framebuffer**, but it renders
  into the post `pass()`'s HalfFloat RT — a **different pipeline-cache variant** — so the real one
  (+ ~9 post-chain pipelines) compiled **synchronously in the GPU process** at first submit,
  freezing every rAF on the page (not a main-thread block; that's why v0.40.3 couldn't kill it).
  Fixed three ways: `post.compileAsync()` (`PassNode.compileAsync` — the correct variant, async),
  `onSubmittedWorkDone()` drains the primed debt under the splash (new `prime` mark), and a
  **`SmoothnessGate`** (6 consecutive gaps < 50ms, 4s ceiling, re-armed on Replay) so the reveal
  can never again fire into a freeze, whatever causes one. Full evidence + morning scoreboard:
  [`perf-recording-2026-07-02.md`](perf-recording-2026-07-02.md).
- **The brand landed (v0.42.0).** The **Ember Core** mark: static → `assets/logo.svg` + the app's
  first favicon (`public/favicon.svg`); animated → `assets/hero.svg` (README) + the About card.
  Its warm-silver palette is the reference for the remaining roadmap-#3 theme unification.
- **The ringdown is now a gravitational wave, not a fog (v0.42.1).** From the plunge recording:
  glow cut to a glint (`RIPPLE_GLOW 0.015`), the warp is the signal (`RIPPLE_WARP 0.09`),
  asymmetric front (sharp leading edge, ringing trailing wake). **Blind-tuned — verify on the next
  plunge clip**, together with v0.41.0's plunge feel + spaghettification dials.
- **The two-scripts policy is standing** — [`physical-script.md`](physical-script.md) alongside the
  art-directed [`intro-script.md`](intro-script.md), incl. the **reversibility covenant**
  (irreversible physics during the intro window only). #6's inspiral fork (scripted vs dissipative)
  and the `PRECESSION_K` look intent remain the two open design calls.
- **OffscreenCanvas (option B) is no longer *urgent* if v0.42.2 verifies** — the freeze had a
  precise, app-side cause, now fixed with defense-in-depth. It remains the right 1.0 robustness
  play (render immune to any main-thread work) and the in-flight plan is unchanged: steps 1–2 done,
  next is step 3 (input + resize) — see [`offscreen-canvas.md`](offscreen-canvas.md).
- **Earlier this arc:** `osp.perf` (v0.39.3), dust ramp + lit-disk pre-warm (v0.39.4), intro timing
  (v0.39.6), #7 precession (v0.40.0), #6 mass-scaled ripple (v0.40.1), main-thread reveal stalls
  (v0.40.3), body life-cycle feel (v0.41.0).
- **The big in-flight project** is the **OffscreenCanvas + Worker render path** — see
  [`offscreen-canvas.md`](offscreen-canvas.md). Steps 1–2 done; **next is step 3 (input + resize to
  the worker)**, then Controls/HUD/timeline (4), Share/clip worker-side (5), and the flip (6).

## ⚠️ Open caveats — read before touching these

- **Share (v0.39.1) needs a real-device check.** This remote environment's headless GPU (swiftshader)
  **cannot read the WebGPU canvas by any method** — `drawImage` *and* `captureStream` both deliver
  zero frames — so neither the original PNG bug nor the new `captureStream` fallback could be
  exercised in CI (only the fallback mechanism over a 2D canvas, which works). On the actual Mac + a
  phone, confirm Share produces a **clip**, not a PNG. If it still falls back, open the console and
  read **`osp.clip.status`** (exposed for exactly this) — it says why (no encoder / no avcC / no
  frames). Files: `src/ui/recordClip.ts`, `src/ui/clipRecorder.ts`, `src/main.ts` (`captureShare`).
- **Roadmap #1 is now about the *first compile*, not the cadence.** Don't re-chase the periodic
  stutter (fixed). A fresh screen capture should target the **first reveal only** — and now there are
  **numbers** to pair with it: read `osp.perf.report()` (v0.39.3) on the target device.
- **The reveal masking wins (v0.39.4) want a real-device feel-check.** The dust-march ramp
  (`REVEAL_VOLUME_STEP_BOOST = 0.6` in `quality.ts`) and the pre-warm lit-disk prime are masked by the
  warm haze and revert to steady state at `fuzz = 0`, so they're low-risk — but their *benefit* (and
  whether `+60 %` is the right coarsening) can only be felt on real hardware. Confirm the reveal still
  reads clean (no visible dust banding under the haze) on the Mac + a phone, and tune the one dial
  from the `osp.perf` before/after on the same device.

## Blocked / out of session scope

- **Update Portka Tools to 1.2.0 / clone `cportka/claude-plugins`.** The marketplace repo
  `cportka/claude-plugins` is **outside this session's authorized scope** — the git proxy 403s it, the
  GitHub MCP is scoped to `cportka/onestillpoint` only, and the `list_repos` / `add_repo` tools aren't
  present this session, so scope can't be widened from inside. Fix is environment-side: add
  `cportka/claude-plugins` to the session's repo scope (Claude Code web/app), then it clones normally.

## How we work here (the essentials)

- **Portka SOP** (from `CLAUDE.md`): for every change — sync `main`, branch, update tests + keep CI
  green, open a PR, **merge on green**, hand back a short PR link. Never commit to `main` directly.
- **SemVer triplet, enforced.** `package.json` `version` ↔ `src/version.ts` `VERSION` ↔ a
  `**MAJOR.MINOR.PATCH**` `CHANGELOG.md` entry must agree — `src/version.test.ts` fails the build
  otherwise. Bump every change (MAJOR breaking / MINOR feature / PATCH fix+docs).
- **CI.** `ci.yml` (`check`: lint · typecheck · test) runs on every PR. `validate-physics.yml`
  (`validate`: the geodesic/disk/orbit/lensing maths) runs **only** when `src/physics/**`,
  `src/render/tsl/**`, `src/scene/**`, or `scripts/validate-*.mjs` change — so UI/docs PRs skip it.
- **Verifying in a real browser (headless).** Playwright + the pre-installed Chromium can boot the
  app; `window.osp` exposes `{ renderer, scene, physics, history, timeline, events, clip, … }` for
  inspection (the sim runs even though the headless render is black). Caveat above: the WebGPU canvas
  isn't *capturable* here. Verify scripts live in `scripts/` (`verify:intro`, `capture:*`).

## Map of the docs

- [`CLAUDE.md`](../.claude/CLAUDE.md) — standing workflow + versioning conventions.
- [`future-improvements.md`](future-improvements.md) — the roadmap to 1.0.0 (top = next).
- [`offscreen-canvas.md`](offscreen-canvas.md) — the in-flight worker migration (scope + 6-step plan).
- [`intro-script.md`](intro-script.md) — the load-intro beats + tuning log.
- [`perf-frame-rate.md`](perf-frame-rate.md) · [`archive.md`](archive.md) — perf notes + shipped history.
