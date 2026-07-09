# Cold-load analysis — Firefox / MacBook recording, 2026-07-01

The first *measured* look at roadmap #1, from a private-window Firefox load on the target MacBook
("the ideal system"): a 720p screen recording analyzed frame-by-frame with the Portka
**video-bug-analyzer** (`--probe` / `--cadence` / `--motion` / contact sheets), paired with the
in-app `osp.perf.report()` (v0.39.3 instrumentation). This report is the evidence, the verdict, the
pros/cons of the paths forward, and what shipped in response.

## The numbers

**`osp.perf.report()` (the app's own view):**

| Metric | Value | Reading |
| --- | --- | --- |
| `rendererInit` | 4 ms | WebGPU device request — trivial. |
| `compile` | 532 ms | The raymarch WGSL build — **fully paid under the splash.** The covered pre-warm works. |
| `bootToLoop` | 682 ms | Everything before live frames — covered. |
| `loopToReveal` | 444 ms | Loop start → splash lift — the reveal fired on schedule. |
| frames `meanMs` / `p50Ms` | 25.97 / 26 | **~38 fps cadence** over the first 120 frames — see "the Firefox factor". |
| `p95Ms` / `maxMs` | 44 / **394** | One ~400 ms frozen frame — the headline stall. |
| `janks` | **31** / 119 | A quarter of the first-two-seconds' frames dropped ≥ 1 vsync. |
| `resizes` | 2 | Two reveal-window pipeline-target rebuilds (decoded below). |

**The recording (video-bug-analyzer):** capture 1280×844, nominal 60 fps, effective ~39 fps.
Timeline (video clock): navigation ~2.9s → black hold ~3.2s → creation burst 3.83s → splash merger
4.0–4.5s → reveal window 4.6–5.2s. The `--motion` series is decisive:

```
3.8–4.8s   motion 5–49    creation burst + splash play SMOOTHLY
4.9–5.7s   motion 0.00    ≈800 ms FROZEN — two discrete stalls (~300 ms + ~400 ms,
                          one moved frame between) exactly as the crossfade completes
5.8s →     motion 16+     the dolly resumes and plays on
```

## The verdict

1. **The pre-warm architecture works.** 532 ms of shader compile and all of boot landed invisibly
   under the black + splash. The splash itself plays smoothly. The +0.1s black hold (v0.39.6) is
   doing its job.
2. **The remaining hitch was two main-thread JS blocks, not GPU load.** Frozen frames (motion
   0.00) at two discrete moments — a GPU-bound reveal would show slow-but-*moving* frames. Decoded
   against source:
   - **The control panel mounted mid-reveal.** `requestIdleCallback(timeout 2500ms)` from
     `loop.start()` landed the ~54KB Controls chunk fetch + synchronous lil-gui DOM build inside
     the crossfade. → **Fixed in v0.40.3** (mounts after the formation settles).
   - **The scaler resized at the dismiss moment.** Fast covered frames let it climb (resize #1);
     the re-arm at dismiss dropped it back (resize #2) — each a bloom/FXAA render-target rebuild,
     the second landing exactly on the reveal. → **Fixed in v0.40.3** (ceiling pinned while
     covered; `resizes` should now read 0).
3. **The ~26 ms cadence is the Firefox factor.** A steady p50 of 26 ms (~38 fps) on a Mac that
   idles this scene — Firefox's macOS WebGPU is young and paces conservatively. This is *not*
   something app dials fix, and it inflates every other number (31 "janks" against a 33 ms bar
   partly reflects a 26 ms base cadence, not only app stalls). **Action: record one Chrome (and,
   if available, Safari Technology Preview) load on the same Mac** — if those hold ~16 ms, the
   residual smoothness ceiling on Firefox is upstream, and "the ideal system" for judging the
   app's own cost is Chrome/Safari today.

## Options weighed — pros / cons

**A — Targeted fixes from measurement** *(chosen; shipped as v0.40.3)*
- ✅ Pros: surgical, cheap, addressed the *actual measured* stalls; zero visual regression; panel
  now appears when "control returns to the audience" (arguably better UX).
- ❌ Cons: can't fix stalls it didn't cause (a browser GC pause can still land anywhere); can't
  raise Firefox's base cadence; the reveal still renders on the same thread as all DOM/UI work.
- **Verify:** fresh cold recording + `osp.perf` — expect `resizes: 0`, `maxMs` well under 100,
  janks sharply down. If the freeze persists → it's GC/driver → B is the answer.

**B — Finish the OffscreenCanvas worker migration** *(committed as the follow-through; steps 3–6)*
- ✅ Pros: the *categorical* fix — the render loop becomes immune to main-thread stalls (GC, panel
  mounts, DOM, share encoding); helps every browser and especially mobile; steps 1–2 (the risky
  WebGPU-in-worker proof) are already done; it's the roadmap's stated real fix for #1.
- ❌ Cons: L-effort, multi-session (input/resize → Controls/HUD/timeline channel → Share/clip →
  flip); +1 frame of input latency (imperceptible here); a render/sim message boundary to keep
  honest; Firefox's base WebGPU pacing still applies (B fixes *stalls*, not *cadence*).
- **Trigger:** either the post-v0.40.3 recording still shows discrete stalls, or by default as the
  1.0 quality gate — the user has committed to B if A proves insufficient.

**C — More masking (deeper cut / longer haze)** *(held in reserve, "a little more" authorized)*
- ✅ Pros: instant, no architecture; the levers exist (`REVEAL_VOLUME_STEP_BOOST`, `FUZZ_FADE_S`,
  `introScale`).
- ❌ Cons: masking can't hide a *frozen* frame (the failure mode measured here was stalls, which
  no amount of blur covers); each step trades visible softness; diminishing returns — the cut is
  already deep.
- **Use:** only if the next recording shows the reveal *moving but strained* (GPU-bound signature)
  rather than frozen.

## What shipped off the back of this analysis

- **v0.40.3** — the two measured stalls fixed (panel mount deferred to settle; scaler ceiling
  pinned while covered). PR [#96](https://github.com/cportka/onestillpoint/pull/96).
- **v0.41.0** — the live-review feel items: − plunge winds from the body's own motion (no spin
  kick, Kepler-quickening dive), + adds prefer the widest open orbital gap, brighter torn-stream
  spaghettification. PR [#97](https://github.com/cportka/onestillpoint/pull/97).
- **The two-scripts policy** — [`physical-script.md`](../physical-script.md) now rides alongside the
  art-directed [`intro-script.md`](../intro-script.md), including the **reversibility covenant**
  (irreversible physics allowed during the intro window only).

## Next measurements (the ask)

1. **One fresh cold Firefox recording + `osp.perf.report()`** after v0.40.3 — the A/B for the
   stall fixes (`resizes: 0`, `maxMs`, `janks` are the scoreboard).
2. **One Chrome load on the same Mac** — separates app cost from Firefox WebGPU pacing.
3. **One − removal clip** — verifies the new plunge feel + the brighter spaghettification (both
   tuned blind; dials are `PLUNGE_KEPLER_FLOOR`, `STREAM_EMIT`, `STREAM_EXT`).

## Capture caveats (honesty box)

The screen recorder itself ran at ~39 fps effective, so sub-frame timing is read through that
grid; late-clip "low fps" windows partly reflect capture dedup of subtle motion (a slow dark scene
changes few pixels), not necessarily app hitching — the in-app `osp.perf` numbers are the ground
truth for cadence, the video for *where* stalls land. Analysis tooling: Portka `video-bug-analyzer`
1.2.0 over ffmpeg 6.1.1.
