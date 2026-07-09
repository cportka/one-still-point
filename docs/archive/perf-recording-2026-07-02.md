# Cold-load analysis #2 — Chrome + Firefox recordings, 2026-07-01 (22:37 / 22:38)

The follow-up to [`perf-recording-2026-07-01.md`](perf-recording-2026-07-01.md). Two fresh
1080p cold-load recordings (Chrome + Firefox on the target MacBook) with their
`osp.perf.report()`s, analyzed with the Portka `video-bug-analyzer` and then verified
**line-by-line against stock three r184 source** — ending in the definitive diagnosis of roadmap
#1's freeze and the fix that shipped as **v0.42.2**. A plunge recording in the same batch drove the
gravitational-wave ringdown rework (**v0.42.1**).

## The numbers, side by side

| Metric | Chrome | Firefox | Reading |
| --- | --- | --- | --- |
| `compile` | 1951.6 | 1666 | **3× the prior session** — the shader source changed (v0.40–41), invalidating the **driver shader cache**. The earlier 532ms was warm-cache; this is true cold. |
| `loopToReveal` | 1998.2 | 1562 | ≈ `maxMs` + ~35ms on **both** — the smoking gun (below). |
| frames p50 | **10.4** | 15 | Once running: excellent (v0.40.3's main-thread fixes worked). |
| `maxMs` | **1965.3** | **1523** | ONE giant inter-tick gap. |
| `janks` | **1** | 18 | Chrome: a single one-shot stall, otherwise near-perfect. |

**The videos:** the splash plays smoothly → a **1.5–2.6s page-wide freeze** (motion 0.00; even the
splash's 2D dust canvas stops) → an abrupt hard-cut reveal. Chrome froze ~3.6–5.5s (video time),
Firefox ~2.25–4.9s.

## The mechanism (verified in `three.webgpu.js`, byte-identical to registry r184)

1. **The pre-warm compiled the wrong pipeline variant.** `renderer.compileAsync(scene, camera)`
   compiles against the **default framebuffer** — but the raymarch actually renders into the post
   `pass()`'s **HalfFloat render target**, and the RT's color format is **part of the pipeline
   cache key**. The warmed variant is never used at runtime.
2. **The real work compiled synchronously in the GPU process.** The normal render path creates
   pipelines with the sync `device.createRenderPipeline` (only `compileAsync` ever reaches
   `createRenderPipelineAsync`). First submit therefore paid, cold: the true raymarch variant +
   ~9 post-chain pipelines (bloom's 7 internal passes, a hidden RTT node `fxaa()` inserts, the
   output quad).
3. **The freeze was GPU-process presentation backpressure, not a main-thread block.** The two
   priming renders *enqueued* the debt nearly free on the JS timeline (`bootToLoop − compile ≈
   114ms`); the awaited rAF resolved because the swap chain lets the CPU run ahead. At
   `loop.start()` presents stalled and **every rAF on the page froze** — the loop, the dust
   canvas, everything — while main-thread JS stayed runnable. This is why v0.40.3's (correct)
   main-thread fixes could not kill it.
4. **The gate couldn't tell.** Five *raw* warm frames + a wall-clock splash-hold countdown: the
   countdown expired during the freeze, the fifth tick landed the instant it lifted → an immediate
   hard cut. Hence `maxMs ≈ loopToReveal − 5 frames` in both browsers.

## The fix (v0.42.2)

- **`post.compileAsync()`** → `PassNode.compileAsync(renderer)` — binds the pass's RT so the
  **correct** raymarch variant compiles async, under the splash.
- **`device.queue.onSubmittedWorkDone()`** after the covered priming renders — genuinely drains
  the queued compile debt before `loop.start()` (new `prime` perf mark measures it); guarded for
  the WebGL fallback.
- **`SmoothnessGate`** replaces the raw frame count: the crossfade schedules only after **6
  consecutive inter-tick gaps < 50ms** (auto-widened under a cinematic frame cap; 4s ceiling so a
  slow device is never stranded). A stall resets the streak — the reveal can never again fire into
  a freeze, *whatever* causes it. Re-armed on Replay.

**Defense in depth:** even if a future three upgrade changes pipeline caching, or Firefox stalls
internally, or a driver update cold-starts the cache — the gate holds the splash (a calm, designed
pose) until the loop actually flows.

## What to verify on-device (the morning scoreboard)

Cold load, both browsers (a fresh private window; the *honest* cold test also clears the GPU/driver
shader cache, e.g. a Chrome profile without prior visits):

1. `osp.perf.report()` → expect a real `prime` mark (the drained debt), **`maxMs` well under 100,
   `janks ≈ 0–2`**, `smoothGate` ≈ ~100–200ms, and the reveal **gliding** instead of cutting.
2. Note the reveal now waits for smoothness: on a stone-cold cache the splash may hold a beat or
   two longer than before — that's the design (a held splash beats a frozen half-faded cut). The
   4s ceiling bounds it.
3. One plunge clip → judge the new **gravitational-wave ringdown** (v0.42.1: crisp warping front +
   trailing crests, no white fog) and the v0.41.0 plunge/spaghettification, all still blind-tuned.

## Capture caveats

Both 1080p captures ran ~29–30fps effective (heavier than the earlier 720p run), so cadence is read
through that grid; `osp.perf` remains ground truth for cadence, the videos for *where* stalls land.
Firefox's steady-state motion decays lower than Chrome's late-clip — consistent with the earlier
finding that Firefox's macOS WebGPU paces conservatively; Chrome remains the reference for the
app's own cost.
