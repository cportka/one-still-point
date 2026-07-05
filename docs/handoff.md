# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.68.0 (2026-07-05)._

## Where things stand

- **This round (v0.66–0.68, the 07-05 live-review asks):**
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
  the compact `rOuter` 64, star `size` 3 / `BRIGHTNESS` 1.6). All set by eye — the next Chrome +
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
