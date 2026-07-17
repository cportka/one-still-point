# Handoff — current state for the next session

A short, living "you are here" for whoever picks this up next. Pairs with the durable docs:
[`CLAUDE.md`](../.claude/CLAUDE.md) (how we work), [`CHANGELOG.md`](../CHANGELOG.md) (what happened),
[`future-improvements.md`](future-improvements.md) (what's next). **Update this when you finish a
session.**

_As of v0.98.0 (2026-07-17)._

## Where things stand

- **★ The title fits, holes read as holes, the suck goes towards first, Share grows three
  pathways (v0.97.4–v0.98.0, PRs #201–#204).** Driven by three captures (Firefox intro 720p +
  collisions 480p, iOS collisions 480p) and a clean reveal-perf object with `marksAt`:
  - **v0.97.4 — the About title fits without the dots** (version ≤9.5px, byline ≤10.5px, fluid) —
    #201, which also **deflakes the "no spin kick" plunge test**: the star+planet pair spawned at
    a shared radius 30, and a close azimuth draw put them inside contact (~2.3 units) where
    `mergeCollisions` — which deliberately lets a plunging body be struck — knocked the planet off
    the parametric path (~1-in-100 CI failures). Radii 40/28 now.
  - **v0.97.5 — lean hole halo v2** (#202): the v0.95.3 bare emissive shell made iOS holes read
    as "a big star" (fuzzy grey ball). The halo now carries an **impact-parameter mask**
    (`rim = 1 − c²`, c = cos of the ray↔to-centre angle) so core-bound rays go dark and only
    grazing rays keep the rim, plus a thinner shell (σ ~0.16 at radius×1.55, emit 1.1). Black
    disk + crisp warm ring.
  - **v0.97.6 — stream v4, towards first then around** (#203): v3's infall was a linear φ/2π
    ease, so the Firefox capture read as circling. Now `inward = 1 − e^(−1.1·φ)`
    (`STREAM_INFALL_RATE`) front-loads ~63% of the body→disk dive into the first radian, and the
    disk wrap reaches its ring radius within the first half-lap (`fracIn = smoothstep(0, 0.45,
    frac)`) — around is the *peak*, not the whole journey.
  - **v0.98.0 — the Share modal** (#204): Share opens a dialog with three pathways — **Link**
    (copies the branded line), **Screenshot** (captured at open, live preview, share sheet on
    mobile / PNG download on desktop), **Record 10** (a red pulsing "Start Record 10" pill
    upper-left; while armed a rolling ≤1 s MediaRecorder take restarts every second so the second
    *before* the click opens the clip; "Recording 9→0"; ~10 s mp4-preferred clip via share sheet
    or download, site link riding along). New `recordTen.ts` engine (unit-tested with fake
    recorders + timers); both panels pass their canvas (worker path hands the placeholder).
  - **Intro-lag verdict (the Firefox 720p intro capture + its perf object):** the instrumented
    run is *clean* — compile 206 / prime 291 / bootToLoop 507, every mark lands 2.2–2.8 s (under
    the splash), reveal janks 0, p95 27 ms. The capture still shows a 592 ms freeze at 0.68 s
    (boot work under the splash — invisible live) and a ~48 fps median — the *recorder's* cost,
    not the app's. More initial black time buys nothing: the pipeline is fully compiled before
    the reveal already. If slight lag still reads live (no recorder running): try the Advanced →
    Frame cap 30 for recordings, or re-measure with the new in-app **Record 10** (captureStream
    skips the OS recorder). The mid-session ~1 s freeze from earlier sessions stays unattributed —
    still wants a capture + a `marksAt` object of the same run.
  - ⚠️ **Device looks wanted:** iOS hole after halo v2 (dark disk + rim, not a ball); a desktop
    collision after stream v4 (dive at the eater, not a tangential fling); the whole **Share
    modal** on iOS Safari (share sheet with image/video files), desktop (downloads), and
    `?worker=1` (placeholder-canvas capture is per-spec, browsers vary — the row degrades to
    "not available" if refused).

- **★ Stars are born, the flash breathes, About shrinks, marks learn when (v0.96.1–v0.97.0).**
  Driven by the compact-About screenshot, an iOS collision capture, a 2-part desktop "everything"
  session + its reveal-perf object, and a smooth iOS intro capture (no console available on
  iPhone Safari — the user may try Chrome iOS for a workaround):
  - **v0.96.1 — About compacts** (shortcuts + events side-by-side, one-word wording, Hole →
    Blackhole, mark capped 300px, title/byline left-aligned) **+ `osp.perf.marksAt`**: every mark
    now records WHEN it finished (seconds since load) — the desktop captures showed mid-session
    ~1s freezes (43.7s + 44.7s into the session) on a *calm* scene that pixels can't attribute;
    the next perf object will line up against video freeze timestamps directly. Suspects for
    those freezes: the on-demand full compile or a scaler rebuild — **unresolved, needs the
    marksAt-bearing object**. Also noted: `compile: 871` (lean, up from ~450 baseline — the
    v0.92–v0.95.3 lean growth: planets v2 + budget flash + halo; watch it).
  - **v0.97.1 — About finesse**: title + byline share one line; the mark's transparent glow apron
    absorbed via negative margins (title→mark and mark→shortcuts gaps close); "Esc ? / — Dialog"
    one line; event dot + label tucked toward each other.
  - **v0.96.2 — the lean flash pops, moves, leaves**: faster decay (τ 5 vs 3.4), sustained core
    tail halved, a second slower shockwave shell chasing the first (the iOS capture read as ~4s
    of parked whiteout).
  - **v0.97.0 — planet + planet IGNITES a star**: warm HDR star tint (blooms on lean/iOS),
    stellar radius + star `msun` bookkeeping (its future mergers count toward TOV collapse), a
    'Star' timeline tick. The escalation ladder: planets → star → (heavy mergers) → black hole.
  - **Portka Tools feedback filed**: claude-plugins#96 (mobile-chrome auto-crop; multi-part
    session `--t0`/`--concat` timeline offsets — this session split "first 30s"/"rest" needed
    manual offset arithmetic).
  - ⚠️ **Wanted next:** a fresh-session perf object WITH `marksAt` alongside its recording (the
    mid-session freeze attribution); iOS collision re-check (flash duration + the two-shell
    movement); a planet+planet collision (the ignition; note planets are small — tap-select one,
    then tap the other to stage the chase).

- **★ iOS gets its show back, the stream finds the ring, About holds everything (v0.95.3–v0.96.0).**
  - **v0.95.3 — lean collision visuals.** The iOS-family gate meant collisions there showed
    NOTHING (the merge flash was full-shader-only; a newborn TOV hole was a dark spot). The lean
    shader now carries a **budget flash** (core pop + one clean shell — no blotch/ejecta) and a
    **hole halo** (a thin emissive spherical shell that integrates into a bright rim circle — a
    photon-ring read, ~a dozen ops). Desktop pre-upgrade merges benefit too. ⚠️ Lean compile grew
    slightly — wants one fresh-session reveal-perf check.
  - **v0.95.4 — the stream tapers to the horizon ring** (the ESO reference's last beat): both
    tubes thin to 45% at the tail (`TUBE_TAPER`); the wrap's target radius descends with settle
    to ~35% of diskMid (`RING_DESCEND`) — the filament joins the bright circle at the shadow;
    `STREAM_EMIT` 0.22→0.18 and the drain softened so the tail-ring stays lit.
  - **v0.96.0 — About absorbs Keys + the version chip.** Top row = About · Share. Shortcuts +
    the event colour key (names shortened to one word) render under the animated logo; ? and Esc
    both open About; the title line is "One Still Point v…" as one click-to-copy button (✓
    confirm). `shortcuts.ts`/`versionBadge.ts` retired; worker panel parity.
  - ⚠️ **Device looks wanted:** iOS collision (flash → crush → bigger star / dark hole with a
    bright rim); desktop BH plunge (thin tapering filament joining the horizon ring, no fat beam);
    the About card (shortcut/legend legibility, title-copy).

- **★ The crash card grows roots, iOS stops dying, the stream learns to flow (v0.95.1–v0.95.2).**
  The user's first on-device round with v0.95.0 + a new BH-plunge capture drove three fixes:
  - **v0.95.1 — the card stays and explains itself.** iOS WebKit *reloads the tab on its own*
    after a GPU death — the v0.95.0 card "flashed" and vanished with the DOM. The crash record now
    persists in sessionStorage; `restoreCrashScreen()` (boot, before the engine) re-shows it
    ("restored after reload") with a **Dismiss** revealing the safe-mode app underneath; only the
    card's Reload/Dismiss clear the record. A **legend** on the card names the tint and ties the
    band layout to the station code. And the real iOS fix: **`isIOSFamilyUA`** (capability.ts,
    the Gecko gate's sibling — catches iPadOS-as-macOS via touch points) keeps iOS-family devices
    on the **lean shader permanently** — v0.95.0's safe mode only armed *after* a first crash, so
    every fresh session's first plunge/add-hole/body→body still killed the GPU. On iOS now:
    orbits/plunges/absorbs/lensing work; tears/merge-flash/mini-disk wait on a **mobile-budget
    full-shader variant** (open roadmap item).
  - **v0.95.2 — spaghettification v3 (stream dynamics).** The BH-plunge capture showed the launch
    beam pushing *away* from the hole (v2's `STREAM_SPIRAL` drifted the trail outward) and the
    arcs closing into a rigid 2π hoop that rode the plunging body's azimuth for the whole ~8 s
    descent ("twirling and twirling"). v3 rules in `streamArcHit`: the trail falls **inward**
    toward the eater's disk middle (`STREAM_INFALL 0.55`); arcs cap at **85% of a lap**
    (`ARC_CAP` — a permanent moving gap keeps head+tail visible, so it reads as flow); the wrap
    **drains** past `tear 0.8` (`WRAP_DRAIN 0.6`) as the mass accretes.
  - Process note: a `no-useless-assignment` lint error slipped to CI because lint was piped
    through `tail` (masking its exit code) — run gates un-piped.
  - ⚠️ **Device looks wanted:** iOS — plunge/add-a-hole should now *work* (lean visuals, no
    crash), and if anything still dies the card should stay up with a station code; desktop — a
    BH plunge should read as suck-in → flowing partial wrap → drain, no hula-hoop.

- **★ Crashes get a face, the plunge loses its bulge (v0.94.2–v0.95.0, latest batch).** Driven by
  five new captures (Firefox: BH plunge with a wrong "persistent far-side bulge" + body plunges +
  a healthy general run; iOS: two "−"-button GPU crashes + an intro that runs ~2× long):
  - **v0.94.2 — the far-side bulge.** The companion mini-disk's tear stretch was a *symmetric*
    metric scale (an equal phantom lobe pointing away from the primary) and its ~12-unit reach
    could extend straight past the origin — a gray lobe parked on the shadow's far side all
    descent. Now one-sided (toward-primary only) + a central clearance (density → 0 within ~6 of
    the primary's axis; the wrapping stream owns that leg). Quiet companions (orbit ≥ 26) unchanged.
  - **v0.95.0 — the crash screen.** The iOS captures showed the failure mode: "−" → plunge →
    on-demand **full-shader compile → GPU process dies** → permanently black canvas over a live
    panel (the *lean* intro survives every time). Now: `ui/crashScreen.ts` — the intro's beat-B
    test pattern **iterated**, pure DOM/CSS. Band tint = crash kind (amber gpu / magenta error
    storm / cyan worker / violet boot); band offsets = FNV-1a of the message (distinct crash →
    visibly distinct iteration); the hash prints as a **station code** (`GPU-7F3A`) + message,
    phase, version, uptime, Reload/Copy-details. Wired: `device.lost` (main + worker relay), boot
    failure (old `showFatalError` box removed), error storms (3-in-10s; GPU-flavoured messages
    immediate), post-commit worker errors; the loop stops on `osp-crash`. **Lean safe mode**: a
    GPU loss arms a per-tab sessionStorage flag → next load never runs the full-shader upgrade.
  - **iOS diagnosis, open:** (1) the "−" crash *cause* is the full compile itself — safe mode is
    the mitigation, a real fix needs an iOS-lean full variant or staged compile (needs on-device
    `osp.perf` + a crash-screen station code to confirm); (2) the intro runs ~12 s vs 6.5 (panel
    mounts at 12 s; 6+ s parked ultra-close in gray haze reads as "the merger replayed") — need
    the iOS reveal-perf object to see which mark eats the time; (3) planets read as "pinwheel
    beach balls" up close on mobile (v0.92.0 surfaces want a contrast/frequency pass at close range).
  - Deflake: the v0.94.1 seed test's merge pin is now intro-window-scoped (CI caught the settle
    window's genuine small tail).

- **★ The collision/merger reality pass (v0.91.2–v0.94.1, latest batch).** The second video round —
  two planet screenshots, a BH→BH merger capture, a body-body collision capture, and two fresh-session
  Firefox openings with their reveal-perf objects (`fullCompile: 330/335` landing mid-intro) — plus a
  batch adversarial review drove five merged PRs (#178–#182):
  - **v0.91.2 — the compile-ahead misfire at boot.** My own #173-review "fix" had raised the approach
    radius to 24, overlapping the planet orbit band (min 20): a *seeded planet* tripped the full-shader
    compile at boot, landing the one-shot freeze inside the intro (the captures' marks). Radius back
    below the band (19) + the trigger gated on `formation.done` in both hosts; the late fallbacks
    (feeding/flash/lensing) stay ungated as the net.
  - **v0.92.0 — planets v2, actual solar-system looks.** The v0.91.0 surfaces washed out (base ×1.2
    clipped under bloom) and pinched at the poles (lat/lon pattern, un-rotated). Now: `cheapNoise3`
    (two-octave 3D sine plaids, ~25 ops — deliberately not MaterialX fbm, protecting the lean compile)
    drives gas **belts** (Jupiter-family) or rock **continents + polar ice caps** (Mars/Earth-family);
    the *normal itself* rotates (no pole pleats); palette ×0.95; branchless tint (stars/holes byte-identical).
  - **v0.93.0 — the BH→BH merger reads like the ESO reference.** The plunging hole's tear was a huge
    blown-out ellipse and the wrap was invisible against it. Stream vs core colours split (the hole's
    silhouette stays dark while its *stream* glows hot ×3.5), emission/shrink/dim retuned, secondaryDisk
    stretch 1.4→0.45 with depletion — the hot stream now visibly loops behind the central hole.
  - **v0.94.0 — body-body collisions get travel time, an explosion, and a survivor.** The review's two
    blockers fixed: the chase now scripts position from an absolute `chaseFrom` anchor (the integrator
    was *adding* velocity×Speed(×80) on top of every scripted step — contact at frame ~2, the "no travel
    time"), with velocity kept in sim units for the merge's momentum; and `mergeCollisions` clears BOTH
    sides' chase state (a winning chaser's stale `chaseId` centre-plunged the survivor — "both bodies
    vanished"). Plus a real explosion (noise-blotched core, expanding debris shell) instead of a
    floodlight, and TOV-newborn holes at radius 1.5. Two real-pipeline tests (step+prune at ×80) pin it.
  - **v0.94.1 — the seed stops colliding with itself + a conjunction predictor.** The old line-up put a
    prograde star at r=28 one unit from a retrograde planet at r=27 → a genuine hidden merge inside the
    intro in **~41% of loads**. New bands: planets 21/25.5/30, stars 35/41.5/48 (tightest counter-rotating
    gap 5; 160 measured intros: 0 merges). And the compile-ahead's blanket "any pair within 8 units"
    (fired first-frame-after-intro every session) is now a **conjunction predictor** — circular-arc
    propagation per live body, 2.5 s wall-clock horizon, Speed-aware, fires only when a *predicted*
    separation dips near contact (`(ra+rb)·CONTACT_FACTOR·1.5`, the factor exported from Scene).
  - **Known behavior, not a bug:** the seeded 7-body system slowly *heats up* — close passes pump
    eccentricity, rings wobble 1–2 units within a minute — so a small tail of sessions sees a genuine
    near-contact pass (and the one-shot compile correctly firing) within the first minute. What's gone
    is the every-session misfire and the mid-intro merge.
  - ⚠️ **Device looks wanted:** a fresh-session intro (should be smooth, `fullCompile` mark absent
    until real drama); planets close-up + pole-on; the BH→BH wrap behind the hole; a staged body-body
    chase (travel time → explosion → one survivor); a heavy pair's TOV collapse (newborn hole visible).
  - **Portka Tools 1.9.0** (upgraded per the user) analyzed all captures; its new verdict line + VFR
    honesty came from this project's earlier feedback — follow-up feedback filed (claude-plugins#94:
    suggest `--marks` sidecar correlation).

- **★ The video-driven animation overhaul (v0.87.0–v0.91.1, prior).** Three user captures
  (an ESO tidal-disruption reference + a choppy/smooth OSP collision pair) were frame-analyzed with
  the Portka video-bug-analyzer and drove seven merged PRs (#170–#176):
  - **v0.87.0 + v0.88.1 — the ring/clicks land on the *lensed* image.** Video-measured: the neon
    ring drifted 20–70px toward the hole beside the disk (lensing — the raymarch bends body light).
    `apparentScreenPos` (core/pick.ts) inverts the shader's own geodesic (same ODE/RK4/steps, secant
    + bisection on the launch angle); shared by the ring and `pickBody` on both paths. The first cut
    had a root-finder converging to the shadow edge (adversarial review caught it, FIX-FIRST) —
    v0.88.1 rebuilt the objective (radial miss at the body's polar-angle crossing, monotone through
    the root) with a **two-sided anchor test**: an independent fine-step march must pass through the
    body from the returned screen position. Kerr-ON error near the shadow documented (roadmap #16).
  - **v0.88.0 — the choppy collision fixed.** `--stutter` found a 1133ms freeze exactly at the first
    tear: the on-demand lean→full compile firing ON the dramatic beat, then a scaler spiral.
    `dramaImminent` (fullShaderNeed.ts) now compiles when a plunge/chase starts or a body crosses
    the approach radius — seconds of calm notice; `resetSmoothing()` after; worker gains the same
    trigger PLUS the compile-time resize freeze it never had. *(Retuned since: r 24→19 + intro-gated
    in v0.91.2; the pairwise check became the conjunction predictor in v0.94.1 — newest block.)*
  - **v0.89.0 — spaghettification, the reference cut** (adversarially reviewed; FIX-FIRST findings
    fixed in-PR): the tear is two blended tubes — the fresh rip on the body's orbit handing off to a
    **wrap that settles into the eater's disk plane and closes a full lap** (azimuths unwrapped to
    [0, 2π) — atan's range had silently capped every arc at half a lap); the core **shrinks 93% +
    dims 60%** (bloom had hidden the old shrink); Roche 14→18 (shedding visible through the descent);
    the wrapping stream gates on `tidal` only, so **star-on-star merges read Newtonian** (flash +
    shockwave + crush, no spaghetti); and a per-slot **eater** (position + disk-mid radius) gives a
    **companion hole the central hole's consumption look** — tear around IT, its mini-disk fed,
    central hurricane/feed unaffected. Lifecycle: set on capture/chase, cleared on rescue/plunge/
    vanish; an absorbing eater still anchors.
  - **v0.90.0 — the TOV limit.** Stars carry hidden solar masses (0.9–1.8 M☉; planets ~0.001). A
    non-hole merger above **~2.17 M☉** collapses into a black hole: icy white-blue formation flash
    (strength 4.2), the victor transforms in place (lensing + mini-disk ignite), the loser is eaten
    by the newborn hole, a new icy `collapse` history-bar mark. Sub-TOV pairs merge Newtonian.
  - **v0.91.0 — planets look like planets.** Randomized size (0.45–0.8) picks the family: big →
    banded gas giant (Jupiter/Neptune/Uranus palettes), small → mottled rock (Mars/Earth/regolith);
    limb darkening + slow spin; branchless (stars/holes shade exactly as before), no measurable cost.
  - **v0.91.1 — Google's snippet fixed.** The live result stitched the hidden h1 + noscript + HUD fps
    text; now a rich meta description (synced to OG/Twitter/JSON-LD) + `data-nosnippet` on all UI
    chrome. Takes effect on re-crawl. Site-evaluator origin findings → roadmap #15 (robots.txt 404s
    live despite shipping in `public/` — check the deploy; HSTS/CSP/nosniff; security.txt).
  - ⚠️ **Device looks wanted:** the full-lap wrap + shrinking knot; a fresh-session collision (hitch
    should now precede the drama); a sub-TOV star smash (Newtonian) vs a heavy one (collapse); a
    companion-hole capture; planet close-ups; the ring hugging bodies near the disk.
  - **Held per the user:** SemVer stays pre-1.0 (they tag 1.0.0); the **palette unification (#3)**
    remains theirs ("wait for my signal").

- **★ Panel + selection polish (v0.85.1–v0.86.0, prior).** Reading the panel and reading the scene:
  - **v0.85.1 — the mode switch is an escape hatch.** It lives behind Advanced (its "same-position"
    slot), but that meant turning Advanced off *in Galaxy* hid the return button. Now it always shows
    in Galaxy regardless of Advanced (no strand). *(Superseded by v0.86.0, which drops Advanced in
    Galaxy entirely — the switch is just always visible there.)*
  - **v0.86.0 — a neon selection ring + a flatter Galaxy menu + a snappier −.**
    - **Neon selection ring** (`src/ui/selectionRing.ts`): a crisp screen-space ring drawn around the
      hovered / selected body — *faint + thin* on hover, *bold* cyan double-stroke + slow pulse on
      select — on top of the (kept) emissive halo, which alone wasn't explicit enough. Reuses the
      pick projection (`ringFor`, unit-tested), a 2D overlay canvas at z-index 5 (`.osp-selring`),
      drawn in the main loop; nulls during intro / Galaxy. **Main path only** (needs the live camera +
      bodies); the worker path keeps just the emissive halo. Clicking blank space deselects (ring
      clears) — already the case in `Scene.clickBody(null)`, now visibly confirmed.
    - **Galaxy menu flattened:** no Advanced gate in Galaxy (every Galaxy control is just visible); the
      "Galaxy settings" sub-folder is gone — the six dials are **flat** on the root; **Speed** sits
      right under the "Singularity mode" return button. `advCtrl` is now Singularity-only; the registry
      gates advanced *only in Singularity* (`advOk = inGalaxy || !advanced || prefs.advanced`).
    - **− tap-guard halved:** `PLUNGE_GUARD_FRACTION` 0.12 → 0.06 (~0.54s → ~0.27s) so bodies plunge in
      quicker succession.
    - ⚠️ **Wants a device look:** the ring (hover vs selected legibility), the flattened Galaxy menu +
      Speed placement, and that a near-centre "blank" click can still land on the forgiving central-hole
      pick radius (which plunges a selected body in — the intended select→hole gesture) rather than
      deselecting; genuinely empty space deselects fine.

- **★ Two modes, a Galaxy HUD, and a bold Kerr (v0.83.0–v0.85.0, prior batch this session).** The
  Galaxy vs Singularity split became a first-class thing:
  - **v0.83.0 — mode-aware settings.** "Galaxy mode" is now a **switch button** (same slot, first under
    Advanced) that relabels **Galaxy mode ↔ Singularity mode**. A visibility registry (`{advanced,
    mode}`) shows each control only in its mode: **Singularity-only** (Filter · Background · Bodies ·
    Replay · Pause · Step · Kerr · regular dark sector · Look · Animation · Bloom · Quality · Background)
    hides in Galaxy; the **Galaxy settings** folder (`createGalaxyDials`) hides in Singularity; Speed /
    Display HUD / Click-outside / Advanced are in both. Re-syncs on every mode change (`refreshModeUI`
    on enter + `formation.onDone`). Adversarial review: SHIP. *(The "mode button hides under Advanced
    in Galaxy" caveat is resolved in v0.85.1 → v0.86.0: Galaxy has no Advanced gate at all now.)*
  - **v0.84.0 — the HUD orbit map speaks Galaxy.** In Galaxy Mode the scene is cleared, so the map now
    draws the **star field as a downsampled top-down dot cloud** (~500 of 1600 stars, low-alpha →
    density-by-overlap) with **no per-star orbit rings**; core marker + camera chevron shared with the
    Singularity map. Reused buffer, no hot-path alloc. `OrbitMapInfo.galaxy` added.
  - **v0.85.0 — Kerr is a real on/off toggle, and finally visible.** Off = Schwarzschild; **On =
    near-extremal a/M 0.99.** The frame-drag calc was *correct* (recovers `b_crit = 3√3·M` at spin 0)
    but under-tuned — `KERR_FRAME_DRAG_K` 2.6→6, so at 0.99 the prograde `b_crit` shrinks **~51%** below
    retrograde (CPU-validated 3.35M vs 5.99M): a bold **D-shape** + one-sided ring, ~3× the old shift,
    stable at coarse shader resolution (reviewer empirically checked 4000 rays: 0 NaN, no blow-up). The
    true ergosphere / **photon torus** needs the **exact Kerr metric** — still the deferred follow-up.
  - **Held per the user:** SemVer stays as-is (no 1.0.0 until they say); the **palette unification (#3)**
    is paused for the user's own pass ("wait for my signal"). ⚠️ All three want a **device look** (mode
    switching, the Galaxy HUD cloud, the Kerr D-shape).
  - **Worker-parity backlog (unchanged + one add):** the mode-aware panel, the Galaxy HUD, and the Kerr
    control are all main-path only; the worker `needsFull` now includes `spin > 0` (future-proof, but
    unreachable — no worker Kerr control yet).

- **★ Firefox crash fix + a dark-matter galaxy + Kerr-as-select (v0.81.1–v0.82.1, prior batch).**
  Stabilizing toward **1.0.0** ("ship when it's stable for a while" — the user tags it, once baked):
  - **v0.81.1 — fixed a Firefox black-screen crash (the 1.0.0 blocker).** The v0.79.0 idle full-shader
    **pre-warm** fired the lean→full swap ~1.5s after settle, *while the resolution scaler was still
    resizing*: `scenePass.compileAsync` binds the pass RT's **depth texture** across frames, and a
    concurrent `renderer.setSize` (in `applySize`) destroyed+recreated it mid-compile → `"Texture with
    'depth' label has been destroyed"`, device lost. Fix: **removed the pre-warm** (full shader upgrades
    **on-demand only** again — stable across every prior release; the reveal was already 0-jank) **and**
    **froze the auto-resolution scaler for the one-shot compile** (every resize funnels through the one
    guarded `applySize`, deferred + applied once after) so the remaining on-demand swap can't race a
    resize either. Adversarially reviewed (SHIP). ⚠️ **Wants a confirming Firefox pass on device.**
  - **v0.82.0 — a dark-matter galaxy by default.** The Galaxy core's test-particle rate now carries the
    dark sector: `Ω² = M/r³ + A/r² (halo) − Λ`. **Dark matter defaults ON (0.55)** → a flatter rotation
    curve, so the arms **persist** instead of shearing into a smooth disk (a realistic spiral). New
    **Dark matter / Dark energy** dials in the Galaxy menu; `Galaxy.omegaAt(r)` is public + unit-tested
    (halo flattens, Λ stalls the edge, monotonic). Closes the roadmap #12/#13 Galaxy-Mode follow-up.
  - **v0.82.1 — Kerr spin is a named select**, not a slider: Off (Schwarzschild) / Slow (0.5) / Fast
    (0.9). Off = byte-exact Schwarzschild. Signals the **post-1.0 direction: a full rotating (exact
    Kerr) metric** — deferred out of 1.0.0 on the user's call (L-effort, ~2–4× per-ray, re-opens the
    intro-lag tension; the phenomenological spin is 1.0.0's "Kerr").
  - **Road-to-1.0.0 status:** the crash blocker is fixed; the Galaxy dark sector + Kerr-select are in.
    **Remaining tractable polish before the tag (optional, user-steered):** #3 palette unification (safe
    CSS), and #7's precession-visible seed (⚠️ changes the *tuned default intro* orbits — do only if the
    user wants it). Then **bake** and tag 1.0.0. Exact-Kerr (#10) is the first post-1.0 project.

- **★ Collisions + selection + Galaxy dials (v0.79.0–v0.81.0, prior batch this session).** An interaction-feel run:
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
