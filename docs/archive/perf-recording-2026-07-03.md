# Recording analysis — 2026-07-03 (the first `?worker=1` field test, three browsers)

Three cold `onestillpoint.app/?worker=1` loads recorded after the 3c ship (v0.46.0), analyzed
frame-by-frame with the Portka video-bug-analyzer (probe / contact / motion / blackdetect /
cadence passes per clip). One Chrome `osp.workerPerf` report accompanied them. Verdicts first:

| Clip | Verdict |
| :-- | :-- |
| iOS Safari (portrait) | **Clean.** Single intro, smooth ~56–60fps reveal at ~2.5s — the worker compiled so fast the splash only had to cover ~0.9s. |
| Chrome (Mac) | **Works, two blemishes.** ~1s grey pre-paint ("weird loading"), and a *perceived second splash play* at ~3.6s. |
| Firefox (Mac) | **Fatal.** Boots, reveals at ~3.5s, stutters (1.25s, 2.25s stalls), then hard-freezes at ~8.0s forever — the tab (and eventually the browser) needs a force restart. |

## Chrome — the "double play of the splash" was the dust loop re-bursting in unison

The frame record is unambiguous: **one** page load (the omnibox stop→reload flip happens exactly
once), **one** creation burst, **one** orb spiral-in + merger. What plays "again" at 3.6–4.9s has
*no orbs, no merger flash, no shock rings* — it is a fresh **dust field** erupting from the
settled ring.

A parallel code trace supplies the negative proof: the merger choreography can only restart via a
stage rebuild (`stage.innerHTML` in `__ospSplash`) or a full page re-execution — class churn can't
do it (all splash animations are `forwards`-filled; the pause rule only toggles play-state) — and
nothing on the worker path calls either. With the CSS ruled out, only the dust canvas can re-emit.

That is the v0.43.1 dust *loop*. Every particle's re-breath cycle was `mg + 1.5` with
`mg ∈ [0.2, 0.36]` — i.e. **all ~320 particles shared a ~1.7–1.86s period**, and all started
together at the merger (that part is the authored art). So on any boot long enough to reach the
second breath, the whole field fades out together (the clip shows it fully empty by ~3.5s) and is
reborn together — a synchronized re-burst that reads as "the splash played twice." The main path
never showed it because its reveal lands *before* the first rebirth (~1.9s); the worker path's
measured compile+prime (1976ms + 1667ms in the accompanying `osp.workerPerf`) sails past it.
**iOS didn't show it either — its worker was ready in under a second of dust time**, which is the
cleanest confirmation that the trigger is simply "covered longer than one dust cycle."

**Fix (this PR):** per-particle loop periods — `cy = 1.5 + R(0, 1.4)` so rebirths spread over
~1.4s *and* the differing periods decorrelate further every cycle. The field now thins and
replenishes continuously instead of pulsing. First-cycle art (the merger burst) is untouched.

Also seen, accepted for now:
- **~1s grey before first paint** — Chrome's dark-theme pre-paint background while the navigation
  completes (network/TTFB), before the app's instant-paint black takes over. Not app time; a
  server/CDN concern if we chase it at all.
- **The covered dust froze for ~1.3s at 5.05–6.4s** (motion exactly 0, splash still up) — the
  compositor-level stall while the worker's prime drains the GPU queue. This is precisely what the
  splash + SmoothnessGate exist to cover (the gate opened *after* it; post-reveal frames measured
  p95 40ms, max 44ms, no stall). With the dust desynced this brief pause is far less conspicuous.

## Firefox — boots, then wedges: WebGL2-in-a-worker must never be reached again

The clip shows the worker path *working* — full intro, reveal at ~3.5–3.7s, formation swooshes —
then two long stalls (~1.25s at 4.5s, ~2.25s at 5.75s, the dolly advancing in discontinuous
jumps between them) and a **permanent freeze at 8.0s** (zero page motion for the remaining 9.4s;
browser chrome still painting, no crash page, no dialog). That is a GPU-process wedge, not a JS
hang, and it matches three's `WebGPURenderer` having silently fallen back to its **WebGL2 backend
inside the worker** (Firefox doesn't expose `navigator.gpu` to workers), then compiling/submitting
the raymarch through a path no one has ever hardened: each new pipeline variant stalls longer
until the GPU process stops servicing the tab entirely.

**Fix (this PR), fail-safe boot (protocol v4):**
- The worker now **probes for a real WebGPU adapter before any renderer exists** and reports
  `capability`; without one it reports `unsupported` — the WebGL2 fallback is main-thread-only,
  by policy. (`workerEngine.init`, 3s probe budget.)
- Main **falls back to the proven main-thread renderer** on `unsupported`, on any pre-`ready`
  error, or on watchdog timeout (10s with no signal at all; 45s without `ready`): terminate the
  worker, drop its canvas, build the ordinary engine. The splash is inline-driven and simply keeps
  covering until the main path's own reveal choreography takes over. A worker mishap can no longer
  strand the splash or cost a dead tab.
- On Firefox specifically: `navigator.gpu` is absent in its workers, so the probe fails in
  milliseconds and the page quietly runs the main-thread path — which the 07-01/07-02 recordings
  already verified smooth there.

**Re-test ask (Firefox):** load `?worker=1` once more. Expected console lines:
`worker capability probe: webgpu=false` → `worker render path bailed — falling back…` and then a
normal main-path load. If instead the probe reports `webgpu=true` and the wedge still happens,
that's Firefox's worker-WebGPU being broken-but-present — the next belt is a Gecko `forceMain`
gate, one line in `canUseOffscreenRendering`.

## iOS — the good baseline (and a note)

Single play of everything, reveal at ~2.5s, ~56–60fps through the reveal window, mild dips to
~36–44fps during the formation flight (expected under the intro deep cut on a phone). One real
observation: the worker path was ready so fast that the splash-hold, not the compile, set the
reveal time — the architecture is doing exactly what it was built for on the platform that
previously lagged hardest. The single-frame stripe test pattern (beat B) is visibly captured at
1.17s — by design.

## Scoreboard

| Signal | Chrome (this round) | Target |
| :-- | :-- | :-- |
| compile / prime (worker, covered) | 1976ms / 1667ms | any — it's covered |
| smoothGate / loopToReveal | 55.7ms / 56.8ms | < 200ms |
| post-reveal frames | mean 14.2ms · p95 40.2ms · max 43.8ms · 12 janks/120 | no >50ms frame ✓ |
| splash plays perceived | 2 → **1** (dust desync) | 1 |
| Firefox outcome | dead tab → **clean fallback to main path** | never wedge |
