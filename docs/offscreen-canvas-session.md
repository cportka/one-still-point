# The OffscreenCanvas side-session — evaluation + ready-to-run todo list

The answers to the three questions asked before committing (2026-07), then the session brief: a
PR-sized todo list for finishing the worker migration, and the separate community side-quest it
surfaced. Companion to [`offscreen-canvas.md`](offscreen-canvas.md) (the architecture + protocol).

## Q1 — What does the migration entail? Before 1.0.0?

**It's app work, in five PR-sized steps (below), roughly a focused multi-session project.** The
risky unknown is already retired: step 2 (v0.37.0) proved the real `WebGPURenderer` + the full
raymarch shader **running in a worker** on a transferred `OffscreenCanvas` behind `?worker=1`.
What remains is plumbing, not research: input/resize messages, the Controls/HUD/timeline channel,
Share/clip worker-side, then flipping the default with the main-thread path as permanent fallback.

**Recommended for 1.0.0: yes, as the robustness gate — but no longer as the perf emergency.** The
measured freezes all had app-side causes, now fixed (v0.40.3, v0.42.2 + the SmoothnessGate as
defense-in-depth). What the worker still uniquely buys: the render loop becomes **categorically
immune** to main-thread work (GC, panel mounts, share encoding, any future UI), which is the
difference between "tuned until smooth" and "cannot be made un-smooth" — the right guarantee to
ship 1.0 on, especially for mobile.

## Q2 — Does it require editing a third-party library?

**No.** three r184's `WebGPURenderer` works on an `OffscreenCanvas` today — proven in this repo
(`workerEngine.ts` compiles and presents the real shader in the worker). The migration touches only
app code: `src/worker/*`, `main.ts`, and message-channel shims for the UI surfaces. No fork, no
patch, no `patch-package`.

## Q3 — Fork the upstream repo as a community side-project?

**Not a maintained fork — upstream contributions.** A long-lived fork of three.js is a treadmill
(three ships monthly; the WebGPU internals move fast). But this project's *measured* findings did
expose three real, upstreamable gaps in three's WebGPU renderer — each would help every three
WebGPU app, and each is a well-scoped PR to `mrdoob/three.js` (a short-lived fork only as the
standard PR vehicle):

1. **Async compute-pipeline creation.** `GPUDevice.createComputePipelineAsync` appears **zero**
   times in the r184 build — every compute pipeline (bloom's internals included) compiles
   synchronously in the GPU process at first dispatch. Mirror of the existing render-pipeline
   promises plumbing (`Pipelines._getComputePipeline` → `WebGPUPipelineUtils.createComputePipeline`).
2. **An async compile path for post-processing.** `PassNode.compileAsync(renderer)` exists, but
   the quad passes (`RenderPipeline`/`PostProcessing` output, bloom's mips, the RTT node
   `convertToTexture` inserts) have none — the exact gap behind our measured ~2s reveal freeze.
   A `PostProcessing.compileAsync()` that walks its node graph would close it for everyone.
3. **A dynamic-import seam for the WebGL2 fallback backend.** `WebGPURenderer` statically imports
   `WebGLBackend` (~30% of the bundle) — roadmap #5's one real byte lever, upstreamable as an
   opt-in constructor flag or an entry-point split.

Suggested framing for the side session: do the app migration first (it needs nothing upstream);
file the three issues/PRs as their own track — they're valuable independently and the maintainers
may land #2 before we ever need to work around it again.

## The session todo list (each item = one Portka PR: branch → tests → CI green → merge)

**Session prerequisites:** Chromium available (worker WebGPU is exercised by the existing smoke
path); read `offscreen-canvas.md` (protocol) + `src/worker/*` (steps 1–2 code, all unit-tested).

- [x] **3a. Resize + DPR to the worker.** *(v0.45.0 — tier-scale + DPR-cap sizing worker-side)* Extend `protocol.ts` `resize` handling into
      `workerEngine` (drawing-buffer sizing = the `applySize` math, worker-side `ResolutionScaler`
      owns scale). Accept: `?worker=1` window resize re-renders sharp; router unit tests for the
      message.
- [x] **3b. Pointer/wheel → worker CameraRig.** *(v0.45.0 — ElementProxy + protocol v2; the
      OrbitControls-over-proxy seam is unit-tested on Node)* Capture on the canvas element (main), forward
      normalized events; `CameraRig`'s math runs worker-side (it's already DOM-free). Accept:
      orbit/zoom under `?worker=1` feels ≤1-frame behind; unit-test the event→message mapping.
- [x] **3c. The render loop + sim in the worker.** *(v0.46.0 — full dynamics on vsync-paced worker
      rAF; the setTimeout free-run that crashed tabs is gone; revealReady/perf/error telemetry;
      History/Timeline defer to 4b where their consumer lands)* Move `Loop`/`TimeController`/`PhysicsController`
      /`FormationSequence`/`History`/`Timeline`/`BirthTicker` wiring from `main.ts` into
      `workerEngine` (they're DOM-free already); worker rAF drives it. Accept: the full intro plays
      under `?worker=1` (formation + swooshes + reveal states), main thread's only jobs are splash
      + input.
- [x] **4a. The generic `control {key, value}` channel.** *(v0.49.0 — `controlMap.ts` table
      worker-side: 22 keys across `bh.*` / `bg.*` / `bloom.*` / `time.*` / `render.*`, plus
      addBody/removeBody/clearBodies as commands with the − tap-guard enforced at the engine;
      `workerControls.ts` mounts the essentials panel on main under `?worker=1` — Filter,
      Background, Speed, ± steppers with status-fed counts, Clear, Pause, Quality, Frame cap,
      Bloom, About/version. The table-driven test walks every key.)* **Residue for 4b/6:**
      Replay (the melt spans threads), Share (5), HUD folder + history bar (4b), keyboard
      shortcuts, and settings persistence — full panel parity lands with the RenderHost seam.
- [x] **4b. `status`/`event` → HUD + history bar.** *(HUD half v0.51.0: per-tick `frame`
      telemetry — frame ms, res scale, camera + packed body positions for the orbit map —
      streamed **only while main's HUD is visible** (`command 'hudStream'`); `status` gained
      `timeScale`. History half v0.52.0: the worker owns the full DVR — `History` + `Timeline` +
      the exact main-path tick block (record on live, replay when scrubbed, ←/→ tape-walk,
      drag-freeze) + `BirthTicker` seeded-birth ticks; main renders the same scrub bar from
      message-fed mirrors (`timeline` marker numbers per-tick while the head moves, `event`
      ticks incl. the reserved `'drop'` for live-edit commits) and drives it with
      `command 'scrub'/'scrubbing'`. Protocol v6.)* **Residue for 6:** keyboard shortcuts +
      settings persistence + Replay (listed under 4a's residue too).
- [x] **5. Share/clip worker-side.** *(v0.53.0 — `createClipRecorder` is canvas-agnostic and
      runs in the worker against the render `OffscreenCanvas`; `command 'shareCapture'` →
      `share` message (bytes) → main wraps the `File` and `navigator.share`s it (user gesture
      stays on main). Floor: a still PNG via `convertToBlob` with the recorder's status as the
      reason — workers have no MediaRecorder/captureStream, so the main path's mid-tier live
      recording doesn't exist there, by platform.)* **Accept still owed on a real device**
      (this environment can't read the WebGPU canvas — same caveat as the main path's Share).
- [~] **6. The `RenderHost` seam + flip.** *(Seam shipped v0.54.0: `resolveRenderPath()` — one
      pure election over the URL param / UA (Gecko gate) / capability probe, with `?worker=0`
      as the standing escape hatch and the **flip staged behind `WORKER_DEFAULT`** (one
      constant, election matrix fully unit-tested including the flipped states). The de-facto
      hosts already exist: `tryStartWorkerRender()` (with its fail-safe bail) IS the worker
      host election, the main path below it IS the fallback.)* **To flip `WORKER_DEFAULT`:**
      (a) close the panel-parity residue — Replay intro (the melt spans threads), keyboard
      shortcuts, settings persistence, touch tooltips; (b) the on-device parity numbers —
      `osp.perf` (main) vs `osp.workerPerf` (worker) `maxMs`/`janks` on the Mac + a phone;
      (c) a real-device Share clip check on the worker path. Then set the constant to true.
- [ ] **Post-flip cleanup.** Move the reveal machinery (`SmoothnessGate`, `armIntroScale`,
      pre-warm) worker-side; keep `osp.perf` reporting through the `status` channel so on-device
      measurement survives the migration.

**Out of scope for the session:** the three.js upstream PRs (their own track, above); Kerr and the
swarm mode (both explicitly gated on this landing first — roadmap #9/#10).
