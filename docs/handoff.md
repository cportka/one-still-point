# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.57.0 (2026-07-03, night)._

## Where things stand

- **This round (v0.55–0.57, all live-review asks):** a visible **Keys** button (top row) for the
  shortcuts overlay; the HUD defaults to **just the Orbit map** (fps + resolution folded into
  Detail); the **audio scaffold** shipped (roadmap **#11**: manifest + tested rotation picker +
  gesture-unlocked, muted-by-default `AudioDirector` — wiring lands with the first assets; the
  open item is sourcing/licensing); and the **black-hole plunge is now the overwhelming one** —
  holes were hard-coded to zero tear; now their dragged accretion structure rips at 2.4× arc
  from much further out, over an 8s clock (vs 4.5), ending in a 4.2×-strong, √strength-longer
  ringdown. **Blind-tuned (recordings held this round)** — the next plunge clip judges
  `RIP_SCALE_HOLE` / `PLUNGE_DURATION_HOLE` / `RIPPLE_MASS_GAIN`.
- **Everything formerly "post-1.0" is now a 1.0 prerequisite** (user directive): the flip
  residue, palette (#3), README clip (#4), inspiral design (#6), swarm (#9), Kerr (#10), audio
  assets (#11) all sit before the 1.0.0 tag.
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
  [`offscreen-canvas-session.md`](offscreen-canvas-session.md).
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

- [`offscreen-canvas-session.md`](offscreen-canvas-session.md) — the migration checklist (1–5 ✅,
  6 seam ✅ / flip staged + criteria).
- [`future-improvements.md`](future-improvements.md) — the roadmap to 1.0.0.
- [`intro-script.md`](intro-script.md) · [`physical-script.md`](physical-script.md) — the two
  scripts + the reversibility covenant.
- [`perf-recording-2026-07-01/02/03.md`](perf-recording-2026-07-03.md) — the measured
  investigations. [`perf-frame-rate.md`](perf-frame-rate.md) · [`archive.md`](archive.md).
