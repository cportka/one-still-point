# OffscreenCanvas + Web Worker render path — scope & migration plan

**Status:** step 2 — the **renderer runs off-thread, proven** (v0.37.0). With `?worker=1` the worker
creates a `WebGPURenderer` on the transferred `OffscreenCanvas`, compiles the **real raymarch shader
in the worker**, and renders a static formed view — confirmed in Chromium (`ready (webgpu)`). So
three.js WebGPU + the heavy shader run off the main thread here; the migration is de-risked. Still
**off by default**; the main-thread path is unchanged until the worker reaches parity and we flip the
switch.

## Why

The single biggest remaining problem is [roadmap item 1](../future-improvements.md#1-persistent-lag-as-the-physics-visualizer-takes-over--active-problem):
the **first-load splash→engine takeover hitches**. The browser already compiles WGSL on its own
worker threads and the bytes are prefetched, so what's left on the **single main thread** is JS
module eval, scene/pipeline setup, and the first pipeline *use* (the first draws). While that runs,
the main thread can't service the splash, DOM, or input — so the reveal stutters.

Moving the **renderer + engine into a Web Worker, drawing to an `OffscreenCanvas`**, takes all of
that off the main thread. The main thread then only owns the DOM (splash, panel, history bar),
input capture, and resize — it stays responsive no matter how heavy the first frames are. This is
the real fix the dial-tuning (deeper reveal cut + haze) only *masks*.

## Architecture

```
            main thread                          worker thread
  ┌─────────────────────────────┐      ┌──────────────────────────────────┐
  │ index.html splash           │      │ WebGPURenderer → OffscreenCanvas  │
  │ HUD · Controls · historyBar │      │ Scene · PhysicsController         │
  │ pointer / wheel / resize ───┼─msg─▶│ RaymarchPass · PostPipeline       │
  │ Share / clip (canvas read)  │◀─msg─┤ Loop · TimeController · CameraRig │
  │ RenderHost (main | worker)  │      │ ResolutionScaler · bodyUniforms   │
  └─────────────────────────────┘      │ History · Timeline · BirthTicker  │
                                        └──────────────────────────────────┘
```

- **Main keeps:** the inline splash (`index.html`), `ui/hud`, `ui/Controls` (lil-gui), the history
  scrub bar (`ui/historyBar`, DOM), Share/clip (they read canvas pixels — see Risks), and the
  pointer/wheel/resize **event capture** on the canvas element. It transfers canvas control to the
  worker with `canvas.transferControlToOffscreen()`.
- **Worker owns:** the `WebGPURenderer` (on the `OffscreenCanvas`) and the whole simulation+render
  stack. These modules are already DOM-free maths/three (`Scene`, `physics/*`, `render/tsl/*`,
  `core/Loop`, `TimeController`, `ResolutionScaler`, `core/CameraRig` math, `History`, `Timeline`,
  `BirthTicker`), so they port to a worker as-is; only their **inputs** change from DOM events to
  protocol messages.

## Message protocol (`src/worker/protocol.ts`)

A versioned, typed, discriminated union both sides import. `WORKER_PROTOCOL_VERSION` guards against a
stale worker bundle.

- **main → worker:** `init` (transfers the `OffscreenCanvas` + size/dpr/quality) · `resize` ·
  `pointer` · `wheel` · `control` (a settings change from the panel, `{key, value}`) · `command`
  (a discrete action — pause / replay / scrub / add-body / remove-body) · `dispose`.
- **worker → main:** `ready` (engine booted, shader compiled) · `status` (fps / ms / resScale /
  body counts / gpu — drives the HUD) · `event` (a timeline tick for the history bar) · `error`.

## Risks / open questions

1. **Controls surface.** Every panel control becomes a `control`/`command` message + a worker-side
   handler. This is the **bulk of the work** — it's mechanical but broad. Mitigation: a single
   generic `control {key, value}` channel mapping to the existing uniforms/scene setters, rather
   than a bespoke message per control.
2. **Share / clip read the canvas.** `clipRecorder` and the PNG share read pixels from the on-page
   canvas; with the canvas owned by the worker, readback must happen **in the worker** (it has the
   `OffscreenCanvas` + GPU) and transfer the encoded blob back. The `mp4-muxer`/WebCodecs path can
   run in a worker. Plan: move `clipRecorder` worker-side, post the `File`/`Blob` to main for the
   Web Share call.
3. **Input latency.** Pointer events are captured on main and applied in the worker — one message
   hop (≈1 frame). For orbit/zoom this is imperceptible; verify on the merger replay.
4. **Feature detection + fallback.** `OffscreenCanvas` + module `Worker` + `transferControlToOffscreen`
   aren't universal (older Safari). `canUseOffscreenRendering()` gates it; the **main-thread path
   stays the permanent fallback** (and the `?worker=0` override forces it).
5. **Testing headless.** The worker bundle must boot under the Chromium smoke harness; WebGPU in a
   worker is supported in the target Chromium. Protocol + capability are unit-tested on Node now.

## Migration plan (incremental, behind the flag)

1. **Scaffolding** *(v0.36.0, ✅)* — the protocol, the capability probe, a worker entry stub that
   completes the `init`/`ready` handshake, and their tests. The live path is untouched.
2. **Render loop in the worker** *(v0.37.0, ✅)* — `createRenderer` takes a transferred canvas;
   `workerEngine` builds the real raymarch + post on it and renders a static formed view; a pure
   `router` (unit-tested) drives it; `workerHost` transfers the canvas + relays `ready`/`error`;
   `main()` early-returns into it behind `?worker=1`. **Verified in Chromium** — the worker compiles
   the raymarch shader off-thread and posts `ready (webgpu)`. (Worker loops on `setTimeout`; smooth
   vsync via main-thread ticks comes with input in step 3.)
3. **Input + resize** — wire `pointer`/`wheel`/`resize` to the worker `CameraRig` + sizing.
4. **Controls + HUD + timeline** — the generic `control`/`command` channel ↔ the panel; `status` +
   `event` back to the HUD and history bar.
5. **Share / clip** — move the recorder worker-side; post blobs back.
6. **Verify + flip** — smoke + perf parity on the target Mac, then default `enabled = true` (capable
   devices) with the main-thread fallback retained.

## Clean switchover

Step 2 took the **minimal seam**: `main()` early-returns into `tryStartWorkerRender()` (behind
`?worker=1`), which spins up `workerHost.ts` (transfer canvas → `init` → relay `ready`/`error`). The
fuller `RenderHost` abstraction — `init(canvas, opts)`, `resize`, `dispose`, an event sink, with two
implementations (`MainThreadHost` wrapping today's `main.ts` wiring, `WorkerHost` posting the
protocol) and a `pickRenderHost()` chooser — is the **step 6** refactor that makes flipping the
default a one-line change with the fallback intact. It's deferred until steps 3–5 have moved the
input, Controls, and Share surfaces across, so the seam is drawn once around the finished shape.
