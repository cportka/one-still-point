import { CameraRig } from './core/CameraRig';
import { isCoarsePointer, prefersReducedMotion } from './core/device';
import { FormationSequence } from './core/FormationSequence';
import { History, type HistoryFrame } from './core/History';
import { Timeline } from './core/Timeline';
import { Loop } from './core/Loop';
import { meltInward } from './intro/melt';
import { INTRO_DIALS, MELT_MS, SPLASH_COVERS_AT_MS } from './intro/introTimeline';
import { createRenderer } from './core/Renderer';
import { detectQualityTier, introResolutionScale, QUALITY_TIERS, revealVolumeStep, type QualityTier } from './core/quality';
import { ResolutionScaler } from './core/ResolutionScaler';
import { RevealProfiler } from './core/RevealProfiler';
import { SmoothnessGate } from './core/SmoothnessGate';
import { TimeController } from './core/TimeController';
import { PhysicsController } from './physics/PhysicsController';
import { createBodyUniforms, updateBodyUniforms } from './render/bodyUniforms';
import { BirthTicker } from './core/BirthTicker';
import { createPostPipeline } from './render/PostPipeline';
import { RaymarchPass } from './render/RaymarchPass';
import { createBlackHoleNode } from './render/tsl/raymarch';
import { resolveFirstLight } from './render/firstLight';
import { rippleStrengthForMass } from './render/rippleStrength';
import { createUniforms } from './render/uniforms';
import { Scene } from './scene/Scene';
import type { Body } from './scene/Body';
import { createHud, showFatalError, type HudInfo } from './ui/hud';
import { createHistoryBar, EventLog } from './ui/historyBar';
import { pickBody } from './core/pick';
import { isGeckoUA, probeOffscreenEnv, resolveRenderPath } from './worker/capability';
import { BODY_STRIDE, BODY_TYPE_BY_CODE } from './worker/protocol';

declare global {
  interface Window {
    /** Builds (and on later calls, rebuilds) the load splash; defined inline in
     *  index.html so it paints before this bundle loads. */
    __ospSplash?: () => void;
    /** Plays the whole intro from the top: a black hold, a single-frame test pattern,
     *  the "moment of creation" burst, then the splash overlapping. The initial-load
     *  entry point and what the melt-then-replay path re-runs. */
    __ospIntro?: () => void;
    /** Timestamp (performance.now) of the splash's first *painted* frame, set by the
     *  inline script and reset to undefined at the start of each __ospIntro. The
     *  crossfade waits MIN_SPLASH_MS past this so the merger is always seen — even
     *  when a heavy mobile load defers the first paint, or on replay. */
    __ospSplashStart?: number;
  }
}

/**
 * Bootstrap. The shape here is the spine of every phase:
 *
 *   uniforms ── written by ── CameraRig (camera) + Loop (time) + resize (size)
 *      └── read by ── RaymarchPass colour node ── drawn each frame by ── Loop
 *
 * Phase 4 adds the lil-gui panel and dynamic resolution: the drawing-buffer size
 * is driven directly each frame (ResolutionScaler) and the canvas CSS upscales,
 * so the heavy volume march stays interactive across GPUs.
 */
/** Boot watchdogs for the worker render path (fail-safe, v4): if the worker never even says
 *  hello (`capability`), or says hello but never becomes `ready`, the main thread stops waiting,
 *  terminates it, and falls back to the main-thread renderer — a worker mishap must never again
 *  cost the user a dead tab or a stranded splash. Boot covers spawn + module-graph evaluation +
 *  the adapter probe; ready additionally covers the (multi-second, measured ~3.6s) compile+prime. */
const WORKER_BOOT_WATCHDOG_MS = 10_000;
const WORKER_READY_WATCHDOG_MS = 45_000;

/**
 * The OffscreenCanvas worker render path (off by default — `?worker=1` to opt in; see
 * `docs/offscreen-canvas.md`). When enabled *and* supported it transfers the canvas to a worker that
 * runs the renderer off the main thread, and `main()` returns early — the main-thread engine below
 * never builds. Step 3c: the **full dynamics** (scene, physics, formation, scaler, reveal ramps)
 * run in the worker on vsync-paced worker rAF; this side keeps only the splash choreography (the
 * same hold + smoothness discipline as the main path, answering the worker's `revealReady` with
 * `command('reveal')`), input capture, resize, and debug telemetry relay.
 *
 * Fail-safe (v4): resolves only once the worker is committed (`ready`) — `true` — or bailed —
 * `false`, after which the caller builds the ordinary main-thread engine. Bail paths: the worker's
 * own `unsupported` verdict (no WebGPU adapter in the worker — e.g. Firefox), any error before
 * `ready`, or a watchdog timeout. The splash is inline-driven and keeps playing throughout, so a
 * bail simply hands the still-covered stage to the main path's own reveal choreography.
 */
async function tryStartWorkerRender(): Promise<boolean> {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const worker = params.get('worker');
  // The step-6 seam: one pure election over the URL param, the UA (the Gecko gate — Firefox's
  // worker WebGPU answers the probe but wedges the GPU process; its main-thread WebGPU is proven
  // smooth), and the OffscreenCanvas capability probe. `?worker=0` is the standing escape hatch.
  const path = resolveRenderPath(worker, navigator.userAgent, probeOffscreenEnv());
  if (path !== 'worker') {
    if (worker === '1' && isGeckoUA(navigator.userAgent)) {
      console.info(
        '[onestillpoint] worker render path is gated off on Firefox (its WebGPU-in-worker wedges the GPU process; ' +
          'the main-thread renderer is used instead). Re-test a future Firefox with ?worker=force.',
      );
    }
    return false;
  }

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block' });
  document.body.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio, 2);
  const size = () => ({ width: Math.max(1, Math.floor(window.innerWidth * dpr)), height: Math.max(1, Math.floor(window.innerHeight * dpr)), dpr });

  const { startWorkerHost, attachWorkerInput } = await import('./worker/workerHost'); // lazy — keeps the worker out of the default load

  // The splash plays out exactly as on the main path: once the worker's loop proves smooth
  // (`revealReady`), wait out the merger's minimum on-screen time from its first painted frame,
  // then crossfade and tell the worker to run its reveal ramps (fuzz + the deep-cut climb).
  let revealed = false;
  const revealWhenPlayed = (): void => {
    if (revealed) return;
    const started = window.__ospSplashStart;
    if (started === undefined) {
      requestAnimationFrame(revealWhenPlayed); // splash hasn't painted yet — re-check next frame
      return;
    }
    window.setTimeout(() => {
      if (revealed) return;
      revealed = true;
      document.getElementById('osp-splash')?.classList.add('osp-splash--hide');
      host.command('reveal');
    }, Math.max(0, started + INTRO_DIALS.splashHoldMs - performance.now()));
  };

  let host!: import('./worker/workerHost').WorkerHost;
  let panelStatus: ((s: import('./worker/protocol').StatusMessage) => void) | null = null; // set once the 4a panel mounts
  let hudFrame: ((f: import('./worker/protocol').FrameMessage) => void) | null = null; // set once the 4b HUD mounts
  let lastStatus: import('./worker/protocol').StatusMessage | undefined;
  // The scrub bar's message-fed mirrors (4b history half): the worker owns the DVR; these are
  // just what the bar reads on its own rAF.
  const historyMirror = { length: 0, recorded: 0 };
  const timelinePos = { current: 1, start: 0 };
  const workerEvents = new EventLog();
  const debug: { workerHost?: import('./worker/workerHost').WorkerHost; workerPerf?: unknown; workerStatus?: unknown } = {};
  const committed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const onResize = (): void => host.resize(size().width, size().height, dpr);
    const bail = (reason: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(bootTimer);
      window.clearTimeout(readyTimer);
      console.warn(`[onestillpoint] worker render path bailed — falling back to the main-thread renderer: ${reason}`);
      window.removeEventListener('resize', onResize);
      host.dispose(); // terminate — a wedging worker must stop submitting GPU work
      canvas.remove(); // its control was transferred; the main path builds its own canvas
      resolve(false);
    };
    const bootTimer = window.setTimeout(
      () => bail(`no signal from the worker within ${WORKER_BOOT_WATCHDOG_MS}ms (spawn/eval hung or died silently)`),
      WORKER_BOOT_WATCHDOG_MS,
    );
    const readyTimer = window.setTimeout(
      () => bail(`worker never became ready within ${WORKER_READY_WATCHDOG_MS}ms (engine boot wedged?)`),
      WORKER_READY_WATCHDOG_MS,
    );

    // The worker can't probe the environment (no matchMedia) — resolve tier/coarse/motion here.
    host = startWorkerHost(
      canvas,
      { ...size(), quality: detectQualityTier(), coarse: isCoarsePointer(), reducedMotion: prefersReducedMotion() },
      {
        onCapability: (webgpu) => {
          window.clearTimeout(bootTimer); // the worker is alive and evaluating — compile may take seconds
          console.info(`[onestillpoint] worker capability probe: webgpu=${webgpu}`);
        },
        onUnsupported: (reason) => bail(reason),
        onReady: (workerBackend) => {
          settled = true;
          window.clearTimeout(bootTimer);
          window.clearTimeout(readyTimer);
          console.info(`[onestillpoint] worker engine booted (${workerBackend})`);
          resolve(true);
        },
        onRevealReady: revealWhenPlayed,
        onPerf: (report) => {
          console.info('[onestillpoint] worker reveal perf', report);
          debug.workerPerf = report; // readable at osp.workerPerf
        },
        onStatus: (s) => {
          debug.workerStatus = s; // latest worker telemetry, readable at osp.workerStatus
          lastStatus = s; // the HUD detail row reads the throttled stats between frames (4b)
          panelStatus?.(s); // …and the ± steppers' live counts, once the panel is up (4a)
        },
        onFrame: (f) => hudFrame?.(f), // per-tick HUD telemetry — only streamed while the HUD shows
        onTimeline: (t) => {
          // The DVR mirror: the scrub bar reads these on its own rAF (4b history half).
          historyMirror.recorded = t.recorded;
          historyMirror.length = t.length;
          timelinePos.current = t.currentPos;
          timelinePos.start = t.startPos;
        },
        onEvent: (event, frame) => {
          if (event === 'drop') workerEvents.dropFrom(frame); // a live edit rewrote the future
          else workerEvents.add(event as import('./scene/Scene').SceneEvent, frame);
        },

        onError: (message) => {
          console.error('[onestillpoint] worker render error:', message);
          // Before commitment the main path is still available — fall back to it rather than
          // revealing a dead canvas. After commitment, never strand the user behind an opaque
          // splash: run the reveal path once (if the worker is alive it gets the proper haze
          // reveal; if it's dead the command is moot but the failure is visible/reportable).
          if (!settled) {
            bail(`worker error during boot: ${message}`);
            return;
          }
          if (!revealed) {
            revealed = true;
            document.getElementById('osp-splash')?.classList.add('osp-splash--hide');
            host.command('reveal');
          }
        },
      },
    );
    attachWorkerInput(canvas, host); // orbit/zoom (and tap-to-skip): captured here, applied worker-side
    window.addEventListener('resize', onResize);
  });
  if (!committed) return false; // the main path below takes over (osp.* is its debug surface)

  // The 4a control panel + the 4b HUD: lil-gui on main, every change posted over the
  // control/command channel (lazy import — the main path never pays for it). Mounted
  // post-`ready`; the splash covers both until the reveal, exactly like the main panel.
  const { createWorkerControls } = await import('./ui/workerControls');
  const hud = createHud();
  const panel = createWorkerControls(host, hud); // Share sends the brand GIF from main (ui/share.ts)
  panelStatus = (s) => panel.status(s);
  // Decode the worker's per-tick telemetry into a HUD frame (the packed body positions become
  // the orbit map's dots — only decoded while the map is actually on screen).
  hudFrame = (f) => {
    let mapInfo: HudInfo['map'];
    if (hud.wantsMap) {
      const a = new Float32Array(f.bodies);
      const mapBodies = [];
      for (let i = 0; i < f.count; i++) {
        const o = i * BODY_STRIDE;
        mapBodies.push({
          x: a[o] ?? 0,
          y: a[o + 1] ?? 0,
          z: a[o + 2] ?? 0,
          vx: a[o + 3] ?? 0,
          vy: a[o + 4] ?? 0,
          vz: a[o + 5] ?? 0,
          type: BODY_TYPE_BY_CODE[a[o + 6] ?? 0] ?? 'star',
          falling: a[o + 7] === 1,
        });
      }
      mapInfo = { bodies: mapBodies, camX: f.camX, camZ: f.camZ };
    }
    hud.update(f.ms / 1000, {
      resScale: f.resScale,
      stars: lastStatus?.stars,
      planets: lastStatus?.planets,
      holes: lastStatus?.holes,
      timeScale: lastStatus?.timeScale,
      gpu: lastStatus?.gpu,
      map: mapInfo,
    });
  };

  // The history scrub bar (4b history half): the same bar the main path mounts, fed by the
  // mirrors above; scrubs post commands to the worker's Timeline. It ticks on its own tiny rAF
  // (there's no main-thread render loop on this path).
  const workerBar = createHistoryBar({
    history: historyMirror,
    events: workerEvents,
    scrubTo: (pos01) => {
      const clamped = Math.max(pos01, timelinePos.start); // the worker clamps too — this keeps the drag honest
      host.command('scrub', [clamped]);
      timelinePos.current = clamped; // optimistic — corrected by the next `timeline` message
      return clamped;
    },
    currentPos: () => timelinePos.current,
    startPos: () => timelinePos.start,
    onScrub: (active) => host.command('scrubbing', [active ? 'on' : 'off']),
  });
  workerBar.setVisible(true); // rides with the panel (the splash covers both until the reveal)
  const barTick = (): void => {
    workerBar.tick();
    requestAnimationFrame(barTick); // ~0.05ms of DOM updates — negligible on the freed-up main thread
  };
  requestAnimationFrame(barTick);

  debug.workerHost = host;
  Object.assign(globalThis, { osp: debug });
  return true;
}

async function main(): Promise<void> {
  if (await tryStartWorkerRender()) return; // off by default; the main-thread path below is unchanged

  // Profile the cold first-load reveal (roadmap #1). Headless CI can't render/capture the WebGPU
  // canvas, so the splash→engine frame-times only exist on a real device — this exposes them at
  // `osp.perf` (read `osp.perf.report()` in the console on the target Mac/phone; the loop also logs
  // it once the first-frames window fills). Zero behavioural effect — measurement only.
  const perf = new RevealProfiler();
  perf.begin('bootToLoop', performance.now());

  const uniforms = createUniforms();
  const scene = new Scene();
  const blackHole = scene.blackHole;
  const bodyUniforms = createBodyUniforms();

  perf.begin('rendererInit', performance.now());
  const { renderer, backend } = await createRenderer();
  perf.end('rendererInit', performance.now());
  document.body.appendChild(renderer.domElement);

  const rig = new CameraRig(uniforms, renderer.domElement);
  // First light (roadmap #1, staged behind `?firstlight` — default off): render the reveal on the
  // lean raymarch variant (compiles fast → the splash lifts to a live scene sooner), then compile
  // the full shader off the critical path once the intro settles and swap it in. The lean variant is
  // pixel-identical during the intro (no tears/merges/secondary holes in the seed), so the swap is
  // invisible. Off → the pass is the full shader exactly as before.
  const firstLight = typeof location !== 'undefined' ? resolveFirstLight(location.search) : false;
  const pass = new RaymarchPass(createBlackHoleNode(uniforms, blackHole, bodyUniforms, { lean: firstLight }));
  const post = createPostPipeline(renderer, pass.scene, pass.camera, uniforms.fuzz);
  let fullShaderPending = firstLight; // one-shot: swap in the full shader once the reveal has settled
  let fullWarmScheduled = false; // one-shot: idle pre-warm of the full shader after the intro settles
  const upgradeToFullShader = async (): Promise<void> => {
    try {
      const t0 = performance.now();
      pass.setColorNode(createBlackHoleNode(uniforms, blackHole, bodyUniforms, { lean: false }));
      await post.compileAsync(); // the full variant, off the critical path (the reveal is already up)
      perf.record('fullCompile', performance.now() - t0);
    } catch (e) {
      console.warn('[onestillpoint] first-light: full-shader upgrade failed, staying on lean:', e);
    }
  };
  const loop = new Loop(renderer);
  const time = new TimeController();
  const physics = new PhysicsController(scene, renderer);
  // The CPU/GPU integrator choice is now automatic (PhysicsController.autoSelect).
  // The CPU path is exact and trivially cheap for this app's body counts (≤14) and
  // avoids the GPU path's per-frame position+velocity read-back (a CPU↔GPU sync
  // that stalls the pipeline), so the selector stays on CPU for every count the app
  // can reach today — flipping to GPU only if a future swarm raises the cap into the
  // hundreds. Tell it whether the WebGPU compute path is even available.
  physics.gpuAvailable = backend === 'webgpu';
  const scaler = new ResolutionScaler();
  const hud = createHud();

  // The art-directed intro: dolly in from far while the disk ignites.
  const formation = new FormationSequence(rig, uniforms.formation, {
    reducedMotion: prefersReducedMotion(),
  });
  // Tap / click anywhere on the scene to skip straight to the formed view. Persistent (not a
  // once-listener): a stray tap inside the 0.5s skip guard must not consume skippability — skip()
  // itself no-ops until the guard passes and after the intro is done, so this stays cheap.
  // Single-click (tap) gestures (live review — replaces the old double-click plunge): tap a body to
  // **highlight** it, tap it again to **plunge** it to the centre, tap a *different* body to plunge
  // the highlighted one **into** it (a collision test); tap a plunging body to **rescue** it, tap
  // empty space to deselect. All routed through `scene.clickBody`. A tap is a press+release that
  // barely moves (else it's an orbit drag) and only counts once the intro has settled (the press
  // still skips the intro; `wasDone` guards the release so the skip-tap doesn't also select).
  const TAP_SLOP = 6; // px of movement still counted as a tap, not a drag
  const TAP_MS = 500; // max press duration for a tap
  let tapStart: { x: number; y: number; t: number; wasDone: boolean } | null = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    tapStart = { x: ev.clientX, y: ev.clientY, t: performance.now(), wasDone: formation.done };
    formation.skip();
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const s = tapStart;
    tapStart = null;
    if (!s || !s.wasDone) return; // ignore the release of the intro-skipping tap
    if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) > TAP_SLOP || performance.now() - s.t > TAP_MS) return; // a drag
    const rect = renderer.domElement.getBoundingClientRect();
    // includeFixed: true — the central hole is a pick target now (select a body then tap the hole to
    // plunge it in; double-tap the hole to re-centre the view on it).
    const picked = pickBody(scene.bodies, rig.camera, ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height, 22, true);
    scene.clickBody(picked);
  });

  // Drawing-buffer size = CSS size × capped DPR × adaptive scale. The canvas is
  // forced to fill the viewport in CSS, so a smaller buffer simply upscales. The
  // DPR cap is the biggest single lever on a high-DPR phone, so the quality tier
  // sets it (below) alongside the starting resolution and the dust step.
  let dprCap = Math.min(window.devicePixelRatio, 2);
  const applySize = (): void => {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const w = Math.max(1, Math.floor(cssW * dprCap * scaler.scale));
    const h = Math.max(1, Math.floor(cssH * dprCap * scaler.scale));
    renderer.setSize(w, h, false);
    post.resize();
    rig.setAspect(cssW / cssH);
    uniforms.resolution.value.set(w, h);
  };
  window.addEventListener('resize', applySize);

  // Auto-detect a quality tier for this device and apply it (resolution, dust
  // step, DPR cap). Re-appliable from the Quality panel (Auto / Low / Med / High).
  const autoTier = detectQualityTier();
  let activeQuality = QUALITY_TIERS[autoTier]; // the tier in force — its minScale is the steady-state floor
  const applyQuality = (tier: QualityTier): void => {
    const q = QUALITY_TIERS[tier];
    activeQuality = q;
    scaler.scale = q.scale;
    scaler.minScale = q.minScale;
    blackHole.volumeStep.value = q.volumeStep;
    dprCap = Math.min(window.devicePixelRatio, q.dprCap);
    applySize();
  };
  applyQuality(autoTier);

  // ── Galaxy Mode (roadmap #9) ────────────────────────────────────────────────────────────────
  // A small full galaxy (~1000 stars + planets) orbiting the central hole, rendered as an additive
  // Points overlay (GalaxyLayer) over the post output. Toggled from Advanced; the transition is a
  // bloom: `galaxyReveal` scales every orbit from the centre outward while the layer fades in, and
  // the companion system is cleared on enter / reseeded once the disk has collapsed on exit. Lazy
  // (the layer builds on first enable — the default load never pays for it) and defensive (a build
  // failure disables the mode, never the app).
  let galaxyLayer: import('./galaxy/GalaxyLayer').GalaxyLayer | null = null;
  let galaxyMode = false;
  let galaxyReveal = 0; // 0 = collapsed at the centre, 1 = full disk
  let galaxyFade = 0; // overlay opacity 0..1
  let galaxyReseeded = true; // whether the companion roster has been restored after an exit
  let galaxyExitReplay: (() => void) | null = null; // wired once replaySplash exists (below)
  const GALAXY_RATE = 0.9; // transition speed (per second) — ~2s to bloom / collapse
  // The galaxy orbits at the *same* rate the N-body sim uses (physics.timeScale = orbitMul, capped),
  // scaled down for a calm, majestic spin. Previously it used the raw `time.timeScale` (1 by default)
  // — 80× slower than the sim's orbitMul, so it looked frozen, and cranking Speed uncapped it into
  // per-frame aliasing (still "frozen"). orbitMul is capped (ORBIT_CAP), so this never aliases.
  const GALAXY_SPIN = 0.3;
  const setGalaxyMode = async (on: boolean): Promise<void> => {
    if (on === galaxyMode) return;
    if (on) {
      galaxyMode = true;
      galaxyReseeded = false;
      scene.clearCompanions(); // a clean galaxy around the central hole — regular mode stops here
      physics.syncBodies();
      if (!galaxyLayer) {
        try {
          const { GalaxyLayer } = await import('./galaxy/GalaxyLayer');
          galaxyLayer = new GalaxyLayer();
          if (!galaxyLayer.ok) galaxyLayer = null;
        } catch (e) {
          console.warn('[onestillpoint] Galaxy Mode failed to load:', e);
          galaxyLayer = null;
        }
      }
      if (galaxyLayer) {
        // Frame the whole disk: fly out+up so the spiral fills the view (it's vastly wider than the
        // home framing — the reason it read "too small to see" from home).
        rig.flyToFrame(galaxyLayer.galaxy.rOuter);
      } else {
        // Build failed (a stale lazy chunk, offline, or a GPU-build throw). We already cleared the
        // companions on enter — undo that so the user keeps a populated scene instead of an empty,
        // frozen view, and drop back out of the mode. (The panel/checkbox stay usable; the box
        // self-corrects on the next click — see the guarded toggle in Controls.)
        galaxyMode = false;
        galaxyReseeded = true;
        scene.reseed();
        physics.syncBodies();
        scene.onChange?.();
      }
    } else {
      // Exit = a full reset that replays the intro (like a page refresh), per the ask. The galaxy
      // keeps rendering through the ~2s melt; the reseed + galaxy teardown run under the black splash
      // (galaxyExitReplay, wired below once replaySplash exists).
      galaxyExitReplay?.();
    }
  };
  const isGalaxyMode = (): boolean => galaxyMode;
  const renderGalaxyOverlay = (frameDelta: number): void => {
    if (!galaxyLayer) return;
    const target = galaxyMode ? 1 : 0;
    // Exponential ease toward the target (smooth bloom / collapse).
    const k = Math.min(1, frameDelta * GALAXY_RATE * 3);
    galaxyReveal += (target - galaxyReveal) * k;
    galaxyFade += (target - galaxyFade) * k;
    if (!galaxyMode && galaxyFade < 0.01) {
      // Fully collapsed + faded → restore the default companions once, and stop drawing. (Normally
      // galaxyExitReplay has already reseeded + set the flag; this is the defensive fallback.)
      if (!galaxyReseeded) {
        galaxyReseeded = true;
        scene.reseedDefault();
        physics.syncBodies();
      }
      return;
    }
    galaxyLayer.update(frameDelta, physics.timeScale * GALAXY_SPIN, galaxyReveal, galaxyFade);
    try {
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      galaxyLayer.render(renderer, rig.camera);
      renderer.autoClear = prevAuto;
    } catch (e) {
      console.warn('[onestillpoint] Galaxy Mode render failed — disabling:', e);
      galaxyLayer.dispose();
      galaxyLayer = null;
      galaxyMode = false;
      // Restore the scene we cleared on enter, so a mid-session render failure doesn't strand an
      // empty, frozen view (physics is gated off while galaxyMode was true).
      if (!galaxyReseeded) {
        galaxyReseeded = true;
        scene.reseed();
        physics.syncBodies();
        scene.onChange?.();
      }
    }
  };

  // ── Intro resolution: a deep cut for the reveal, then the scaler converges ──────────────────────
  // The splash→engine takeover (the dolly + disk ignition) is the heaviest the app ever is. Arm a
  // **deep cut**: drop the scale — and, so it actually *holds* that low through the heavy reveal,
  // the scaler's floor — to the tier's `introScale` (below the steady-state minScale). The floor is
  // restored to minScale in the loop once the scaler climbs back past it, so the deep cut belongs to
  // the reveal alone. From there the adaptive `ResolutionScaler` climbs back **as real headroom
  // allows** and then **freezes** (it no longer forces a `maxScale` ramp — that just thrashed the
  // pipeline-target rebuild on a regular cadence, and on a GPU-bound device it can't climb at all).
  // Masked + made intentional by the warm-fuzzy haze.
  const armIntroScale = (): void => {
    const introScale = introResolutionScale(activeQuality);
    // Pin the *ceiling* too: fast covered frames must not let the scaler climb (a resize) under the
    // splash, because the re-arm at dismiss would then drop it again — a second pipeline-target
    // rebuild landing exactly on the reveal (the Firefox recording showed both, mid-crossfade).
    // Released back to native at dismiss, so the climb-back belongs to the haze-masked settle.
    scaler.maxScale = introScale;
    if (scaler.scale > introScale) {
      scaler.scale = introScale;
      scaler.minScale = introScale; // let the floor follow the reveal down (restored as it climbs back)
      scaler.resetSmoothing(); // don't let the prior full-res frame times drag it down further
      applySize();
    }
  };

  // The load splash (built by the inline window.__ospSplash in index.html). We
  // *hide* rather than remove it, so "Replay intro" can rebuild + replay it; the
  // canvas dust self-stops when the `--hide` class appears, freeing the GPU for
  // the crossfade.
  const splash = document.getElementById('osp-splash');
  // The reveal ramps the resolution *ceiling* back to native over the haze fade rather than snapping
  // it to 1: each scaler climb-step rebuilds the bloom/FXAA/pass targets (a GPU hitch), and a hard
  // release let the whole climb-back land **bare in the first ~1s** — the measured reveal freeze
  // (the gate opens on the cheap pre-ignition frames, so the deep-cut buffer is released right as the
  // disk ignites). Ramping the ceiling over FUZZ_FADE_S (the loop does it) spreads those rebuilds out
  // AND keeps them under the warm veil. The scaler still self-paces its climb under this ceiling, so
  // a GPU-bound device simply never reaches it (no forced thrash).
  let revealing = false;
  const dismissSplash = (): void => {
    perf.end('loopToReveal', performance.now()); // splash lifts here — the reveal begins
    splash?.classList.add('osp-splash--hide');
    armIntroScale(); // the reveal + settle is the heaviest the engine gets — start cheap, then climb
    uniforms.fuzz.value = 1; // reveal it "warm and out of focus", easing to reality in the loop
    revealing = true; // the loop ramps scaler.maxScale introScale→1 over the haze fade (was a hard =1)
  };
  // Crossfade out only once the merger has had its minimum time on screen,
  // measured from the splash's first *painted* frame (window.__ospSplashStart) —
  // so it always plays in full, even when a heavy mobile load defers that paint.
  // The reveal is intentionally a touch earlier than the merger's full end + a
  // longer fade (see style.css), so the live disk + background overlap the
  // expanding splash rings/dust rather than cutting to a black void.
  const MIN_SPLASH_MS = INTRO_DIALS.splashHoldMs;
  // Play the splash out once the merger has had its minimum time on screen, measured
  // from its first *painted* frame (window.__ospSplashStart). That frame is now ~0.3s
  // into the intro (after the black hold + test pattern), and __ospIntro resets the
  // marker to undefined at the start of every run — so wait for the *fresh* value
  // before counting down, else a replay would read a stale start and cut the merger
  // short. The reveal is a touch earlier than the merger's full end + a longer fade
  // (see style.css) so the live disk/background overlap the splash rather than cutting.
  const dismissAfterPlayed = (): void => {
    const started = window.__ospSplashStart;
    if (started === undefined) {
      requestAnimationFrame(dismissAfterPlayed); // splash hasn't painted yet — re-check next frame
      return;
    }
    window.setTimeout(dismissSplash, Math.max(0, started + MIN_SPLASH_MS - performance.now()));
  };
  // The history scrub bar (shown with the control panel — always on, hidden during Replay).
  // The loop records each running frame into `history` (a bounded ~2-min ring → "old is lost");
  // `events` logs the colour-coded transient moments (adds / absorptions / escapes), each
  // tagged with the frame counter so it holds its position as the window scrolls.
  const history = new History();
  const events = new EventLog();
  // The timeline playhead over the recorded history — a DVR position decoupled from Pause. Scrub /
  // step / replay move it (clamped to the rewind limit); live physics runs only at the live edge.
  // A body added/removed makes the recorded "future" a different layout, so any transient event
  // snaps it back to live.
  // Restore a recorded frame onto the scene: rebuild the roster (revive bodies absorbed/removed
  // since, drop ones added since) so we can rewind clean *across* a merger, then write the
  // kinematics. Rebuild the GPU buffers only when the roster actually changed (cheap on replay).
  const applyFrame = (frame: HistoryFrame): void => {
    if (scene.restoreRoster(frame.ids)) physics.syncBodies();
    history.restore(frame, scene.bodies);
  };
  const timeline = new Timeline(history, applyFrame);
  // A user edit (add / − removal / clear) made *while scrubbed back* rewrites history from here:
  // commit() makes the scrubbed moment the new live edge and discards the recorded future; we then
  // drop that future's now-orphaned event ticks. Fired *before* the edit applies. At the live edge
  // (the common case) commit() is a no-op and history simply extends as before.
  scene.onUserEdit = () => {
    if (timeline.commit()) events.dropFrom(history.recorded);
  };
  // The "one still point" camera focus (tap a body twice → centre on it; tap the hole twice →
  // re-centre on the origin). Track the focused body so the view re-centres once it leaves the scene.
  let focusedBody: import('./scene/Body').Body | null = null;
  scene.onFocus = (body) => {
    focusedBody = body;
    rig.focusOn(body);
  };
  scene.onEvent = (type, body) => {
    events.add(type, history.recorded);
    // A body reaching the centre is a merger — fire the spacetime ringdown ripple, its amplitude
    // scaled by the absorbed body's mass so a black-hole merger rings harder than a star plunge.
    if (type === 'absorb') {
      uniforms.ripple.value = 0;
      uniforms.rippleStrength.value = body ? rippleStrengthForMass(body.mass) : 1;
    }
  };
  // A companion-companion merge lights the flash uniforms (see uniforms + raymarch): a bright pop
  // at the contact point, blue-white for a hole capture, warm for a star/planet smash.
  scene.onMerge = (x, y, z, kind, strength) => {
    uniforms.mergeFlashPos.value.set(x, y, z);
    const c = kind === 'hole' ? [0.75, 0.88, 1.25] : [1.25, 1.05, 0.7]; // blue-white vs warm HDR
    uniforms.mergeFlashColor.value.set(c[0]! * strength, c[1]! * strength, c[2]! * strength);
    uniforms.mergeFlashAge.value = 0;
    uniforms.mergeFlashActive.value = 1;
  };
  // The seeded line-up is created silently (and starts *unborn* — rendered but not yet on the
  // recorded timeline). This drops a creation tick for each as it swooshes in during the intro (and
  // re-arms on replay): it fires the same `onEvent` a user-driven add would *and* marks the body born,
  // so it's recorded from here on — rewinding before its tick now shows it absent. Armed with the seed.
  const births = new BirthTicker<Body>((body) => {
    scene.markBorn(body);
    scene.onEvent?.(body.type);
  });
  births.arm(scene.companions);
  // While the user drags the bar we freeze the sim (no stepping / recording / replay-advance, in
  // the loop) so the physics doesn't walk the bodies off the restored frame mid-scrub. A transient
  // freeze for the grab only — it never touches `time.paused` (scrubbing must not change Pause).
  let scrubbing = false;
  const historyBar = createHistoryBar({
    history,
    events,
    scrubTo: (pos01) => timeline.scrubTo(pos01),
    currentPos: () => timeline.currentPos,
    startPos: () => timeline.startPos,
    onScrub: (active) => {
      scrubbing = active;
    },
  });

  // "Replay intro": melt the live view inward toward the One Still Point (~2s), then
  // replay the whole intro from the black screen. onReplay (re-seed + restart the
  // formation) runs *after* the melt, hidden under the black/splash; the canvas is
  // un-melted once the splash covers it, just before the crossfade plays it out.
  const replaySplash = (onReplay?: () => void): void => {
    const canvas = renderer.domElement;
    const melt = meltInward(
      canvas,
      () => {
        history.clear(); // a replayed run starts with a fresh, empty timeline
        events.clear();
        onReplay?.();
        armIntroScale(); // render the replayed reveal + settle cheap too, then climb back
        window.__ospIntro?.(); // black hold → test pattern → creation → splash
        window.setTimeout(() => {
          melt.restore(); // un-melt under the now-covering splash (the snap-back is invisible)
          // Re-arm the smoothness gate rather than scheduling the dismiss directly: the replayed
          // reveal also waits for a smooth streak (arm resets the seed, so the melt-spanning gap
          // never counts as a stall). The gate's open calls dismissAfterPlayed, which still waits
          // for the fresh splash's first painted frame + hold as before.
          gate.arm(performance.now(), gateThreshold());
        }, SPLASH_COVERS_AT_MS);
      },
      { durationMs: MELT_MS },
    );
  };

  // Galaxy Mode exit: reset as if the page reloaded and replay the intro (the ask). The galaxy stays
  // on screen through the melt; only once the black splash covers it do we drop Galaxy Mode, restore
  // the default line-up, and restart the formation — so regular mode returns via a clean fresh intro.
  galaxyExitReplay = (): void => {
    replaySplash(() => {
      galaxyMode = false;
      galaxyReveal = 0;
      galaxyFade = 0;
      galaxyReseeded = true; // reseeded here — skip the loop's collapse-reseed path
      scene.reseedDefault(); // fresh random 3 stars + 3 planets (companions were cleared on enter, so
      physics.syncBodies(); //   plain reseed() would restore nothing — a page-refresh-like line-up)
      scene.onChange?.(); // refresh the panel's body counts for the fresh line-up
      formation.restart(); // dolly the fresh intro in from far
    });
  };

  // Share now sends the brand GIF (see ui/share.ts) — the rolling clip recorder is retired from
  // the loop (with it went a per-frame GPU→CPU readback). clipRecorder.ts/recordClip.ts stay in
  // the tree, dormant, for a possible future "record a clip" feature.

  // Build the control panel *lazily, off the critical path*. lil-gui + the panel are a heavy,
  // synchronous DOM build (plus a ~54KB chunk fetch) that isn't needed during the intro — and the
  // Firefox Mac recording caught exactly that cost landing **mid-reveal**: the old idle callback
  // (timeout 2.5s from loop start) fired inside the splash→engine crossfade, freezing the first
  // visible frames for ~400ms. It now waits for the formation to settle (`formation.onDone`, the
  // moment "control returns to the audience" — where a control panel belongs anyway), and only then
  // mounts on the next idle slice. Skip (tap) fires onDone early, so a skipped intro mounts sooner.
  let controlsMounted = false;
  const mountControls = async (): Promise<void> => {
    if (controlsMounted) return;
    controlsMounted = true;
    const { createControls } = await import('./ui/Controls');
    createControls({
      blackHole, scene, physics, time, formation, renderer, scaler,
      bloom: post.bloom, hud, autoTier, applyQuality, background: uniforms.background,
      bgLook: { brightness: uniforms.bgBrightness, saturation: uniforms.bgSaturation, tint: uniforms.bgTint },
      replaySplash, historyBar,
      setMaxFps: (fps: number) => {
        loop.maxFps = fps;
      },
      setGalaxyMode,
      isGalaxyMode,
    });
  };
  const scheduleControls = (): void => {
    if (window.requestIdleCallback) window.requestIdleCallback(() => void mountControls(), { timeout: 2500 });
    else window.setTimeout(() => void mountControls(), 400);
  };

  // (`history` + the scrub bar are set up above, before replaySplash; the loop records
  // each running frame into `history` — cheap, zero-allocation, exactly replayable.)

  // Hold the splash until the loop has *proven* it runs smoothly — N consecutive fast inter-tick
  // gaps, not a raw frame count. A raw count fired the reveal the instant a multi-second cold
  // pipeline stall lifted (the splash-hold countdown had expired during it) — an abrupt hard cut,
  // measured on both Chrome and Firefox. Any stall now resets the streak, so the crossfade only
  // plays into a flowing loop; the gate's ceiling (4s) still guarantees a slow device is never
  // stranded under the splash. Armed before loop.start and re-armed on Replay.
  const gate = new SmoothnessGate();
  // With a cinematic frame cap active, legitimate gaps pace at the cap interval — widen the gate.
  const gateThreshold = (): number => (loop.maxFps > 0 ? 1000 / loop.maxFps + 15 : 50);
  // How long the warm-fuzzy reveal veil takes to ease from full (at the reveal) to
  // nothing — it masks the deep intro-scale cut while the scaler converges. Paced to
  // the takeover (a few seconds), not the old forced 10 s ramp.
  const FUZZ_FADE_S = 5.0;

  loop.onTick = (frameDelta) => {
    const now = performance.now(); // one clock read shared by the profiler + the smoothness gate
    // Reveal profiler: log the true (unclamped) inter-frame interval for the first frames, then
    // print the final report once. Pure measurement — `osp.perf.report()` is also readable any time.
    if (perf.tick(now)) console.info('[onestillpoint] reveal perf', perf.report());
    // The reveal gate: once the loop has held a smooth streak (or hit the ceiling), schedule the
    // crossfade — which still honors the splash-hold minimum inside dismissAfterPlayed.
    if (gate.tick(now)) {
      perf.end('smoothGate', now); // how long smoothness took from arm — readable in osp.perf
      dismissAfterPlayed();
    }
    const resized = scaler.update(frameDelta);
    if (resized) applySize();
    // Count scaler resizes while the reveal floor is still lowered — each rebuilds the bloom/FXAA
    // targets (a GPU hitch), so it's a key signal for whether the climb-back itself is stuttering.
    if (resized && scaler.minScale < activeQuality.minScale) perf.countResize();
    // The intro dropped the scaler's floor below steady state (a deep, haze-masked reveal cut); once
    // it has climbed back past the tier's own minScale, restore that floor so later under-load
    // behaviour is unchanged — the deep cut was the reveal's alone. A genuinely weak device that
    // never climbs back there simply keeps the lower floor (correct graceful degradation).
    if (scaler.minScale < activeQuality.minScale && scaler.scale >= activeQuality.minScale) {
      scaler.minScale = activeQuality.minScale;
    }
    // Ease the warm-fuzzy reveal veil out as the scene settles into focus (PostPipeline), and ride
    // the *same* clock to coarsen the dust march during the reveal — the haze hides the coarser dust,
    // and the in-slab volume sampling is the dominant per-step cost after the geodesic. Both land
    // exactly on steady state at fuzz 0, so neither leaves a permanent quality cut.
    if (uniforms.fuzz.value > 0) {
      uniforms.fuzz.value = Math.max(0, uniforms.fuzz.value - frameDelta / FUZZ_FADE_S);
      blackHole.volumeStep.value = revealVolumeStep(activeQuality, uniforms.fuzz.value);
    }
    // Ramp the resolution ceiling back to native on the *same* haze clock, so the scaler's
    // pipeline-target rebuilds spread out under the veil instead of all landing bare at the reveal.
    if (revealing) {
      const introS = introResolutionScale(activeQuality);
      scaler.maxScale = Math.min(1, introS + (1 - introS) * (1 - uniforms.fuzz.value));
      if (uniforms.fuzz.value <= 0) revealing = false; // fully sharp — stop ramping
    }
    // Age the merger ringdown ripple in wall-clock (it expands + decays after an absorb). Capped so
    // it parks at a large value when idle — the shader envelope is 0 there, so the ripple is a no-op.
    if (uniforms.ripple.value < 100) uniforms.ripple.value += frameDelta;
    // Age the merge flash; retire the term once it has fully decayed (a single branch when idle).
    if (uniforms.mergeFlashActive.value > 0.5) {
      uniforms.mergeFlashAge.value += frameDelta;
      if (uniforms.mergeFlashAge.value > 1.7) uniforms.mergeFlashActive.value = 0; // let the shockwave ring travel out
    }

    const t = time.tick(frameDelta);
    uniforms.time.value += t.animDelta; // bounded dust clock
    uniforms.timeBlur.value = t.timeBlur;
    physics.timeScale = t.orbitMul;
    // Drive the DVR timeline over the recorded history. A drag freezes everything; otherwise a ←/→
    // step walks the recorded tape (extending it live past the edge), and continuous play either
    // replays recorded frames (when scrubbed back, the current marker walking toward "now") or runs
    // live physics + records (at the live edge). None of this reads `time.paused` for the body
    // position — Pause just gates whether the timeline advances.
    // Galaxy Mode stops regular mode: freeze the timeline/physics entirely while the galaxy is up
    // (and through its exit melt) — the raymarch scene is paused, only the galaxy point-cloud runs.
    if (!scrubbing && !galaxyMode) {
      if (t.step < 0) {
        timeline.stepBack(-t.step); // clamped at the rewind limit (the start marker)
      } else if (t.step > 0) {
        const overflow = timeline.stepForward(t.step); // toward "now"; overflow past the edge…
        if (overflow > 0) {
          physics.step(overflow / 60); // …extends the recording live (~1 frame = 1/60 s)
          history.record(scene.bodies);
        }
      } else if (!time.paused) {
        if (timeline.live) {
          if (t.fd > 0) {
            physics.step(t.fd);
            history.record(scene.bodies); // build the timeline on forward progress
          }
        } else {
          timeline.advance(); // replay one recorded frame toward the live edge
        }
      }
    }

    updateBodyUniforms(bodyUniforms, scene, formation.progress);
    // Mark the seeded line-up's "births" on the scrub bar as they swoosh in (staggered so each lands
    // as its own tick; re-armed on replay).
    births.update(formation.progress, frameDelta, () => scene.companions);
    // If the focused "still point" body has left the scene (plunged / merged / escaped), re-centre
    // the view on the origin so the camera never tracks a stale, frozen point.
    if (focusedBody && (focusedBody.absorbing !== undefined || focusedBody.plunging !== undefined || !scene.bodies.includes(focusedBody))) {
      focusedBody = null;
      rig.focusOn(null);
    }
    // The intro drives the camera (controls disabled) until it settles home; after that a Galaxy
    // Mode flight (if any) eases in real time, so pass the frame delta through.
    if (formation.done) rig.update(frameDelta);
    else formation.update(frameDelta);
    // First light: swap in the full shader the moment the scene actually needs it — a companion hole
    // (secondaryDisk), a tear feeding the disk (streamFeed/streamArc), or a merge flash — i.e. the
    // first dramatic beat, where a one-time compile is masked by the drama. Until then lean is
    // pixel-identical, so the reveal + quiet steady state never pay the full compile. (Was gated on
    // formation.done, which dropped the compile right on the reveal/settle.)
    if (fullShaderPending) {
      const needsFull =
        bodyUniforms.feedingActive.value > 0 || // a body is tearing (streamFeed/streamArc)
        uniforms.mergeFlashActive.value > 0.5 || // a body-body merge flash
        blackHole.spin.value > 0 || // experimental Kerr spin — the frame-drag lives in the full shader
        bodyUniforms.slots.some((s) => s.lensMass.value > 0); // a companion hole (secondaryDisk)
      if (needsFull) {
        fullShaderPending = false;
        void upgradeToFullShader();
      } else if (formation.done && !fullWarmScheduled) {
        // No dramatic beat needed it yet — but the intro has settled, so pre-warm the full shader
        // during idle. compileAsync is non-blocking and this runs in true idle, so it never touches
        // the reveal; the payoff is that the *first* collision / plunge / hole then fires instantly,
        // with no first-interaction compile hitch (the "little bits of lag after everything settles").
        fullWarmScheduled = true;
        const warm = (): void => {
          if (!fullShaderPending) return;
          fullShaderPending = false;
          void upgradeToFullShader();
        };
        const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
          .requestIdleCallback;
        if (typeof ric === 'function') ric(warm, { timeout: 3000 });
        else window.setTimeout(warm, 1500);
      }
    }
    // Once Galaxy Mode's dark backdrop is fully opaque, skip the raymarch entirely — that's the whole
    // perf win (Galaxy Mode becomes just the cheap point cloud, not raymarch + overlay). During the
    // bloom/exit crossfade the raymarch still draws *under* the fading backdrop for a seamless hand-off.
    const skipRaymarch = galaxyMode && galaxyFade > 0.85;
    if (!skipRaymarch) post.render();
    renderGalaxyOverlay(frameDelta); // Galaxy Mode (roadmap #9) — the disk (over the post output, or as the frame)
    // Companion breakdown for the HUD's S/P/B readout — one pass, no allocation
    // (skips the always-present central primary, mirroring the Bodies panel).
    let stars = 0;
    let planets = 0;
    let holes = 0;
    for (const b of scene.bodies) {
      if (b.fixed) continue;
      if (b.type === 'star') stars += 1;
      else if (b.type === 'planet') planets += 1;
      else holes += 1;
    }
    // The overhead orbit map's frame — bodies (x/z on the orbital plane) + the camera's floor
    // position. Assembled only while the map is actually on screen (it allocates a small array).
    let mapInfo: HudInfo['map'];
    if (hud.wantsMap) {
      const mapBodies = [];
      for (const b of scene.bodies) {
        if (b.fixed) continue;
        mapBodies.push({
          x: b.position.x,
          y: b.position.y,
          z: b.position.z,
          vx: b.velocity.x,
          vy: b.velocity.y,
          vz: b.velocity.z,
          type: b.type,
          falling: b.plunging !== undefined || b.absorbing !== undefined,
        });
      }
      mapInfo = { bodies: mapBodies, camX: uniforms.camPos.value.x, camZ: uniforms.camPos.value.z };
    }
    hud.update(frameDelta, {
      resScale: scaler.scale,
      stars,
      planets,
      holes,
      timeScale: time.timeScale,
      gpu: physics.useGPU,
      map: mapInfo,
    });
    historyBar.tick(); // keep the bottom scrub bar live (events scroll, playhead rides "now")
  };

  // Pre-warm the render pipeline while the splash still covers the screen, so the fresh-load
  // compile is paid here, not on the first live frames (the measured splash→engine freeze):
  //   1. `post.compileAsync()` compiles the heavy raymarch **against the pass's own render
  //      target** via createRenderPipelineAsync — the RT's color format is part of the pipeline
  //      cache key, so compiling against the default framebuffer (the old call) warmed the WRONG
  //      variant and the real one compiled synchronously in the GPU process at first submit;
  //   2. two covered post renders prime the bloom/FXAA quad pipelines (no async API exists for
  //      those in three r184) with the *lit* disk (formation forced to 1 — the shader multiplies
  //      disk density by it, so priming at 0 would skip the whole volume path);
  //   3. `onSubmittedWorkDone` then *actually drains* that queued GPU work — the old awaited rAF
  //      resolved while ~2s of sync pipeline compiles were still queued (the swap chain lets the
  //      CPU run ahead), so the debt landed on the first live frames and froze every rAF on the
  //      page. Now any residual stall happens here, fully covered by the splash.
  armIntroScale(); // render the pre-warm + covered frames + reveal cheap (climbs back after)
  perf.begin('compile', performance.now());
  await post.compileAsync();
  perf.end('compile', performance.now()); // the raymarch pass-variant WGSL+pipeline, async, covered
  perf.begin('prime', performance.now());
  const formationAtPrewarm = uniforms.formation.value;
  uniforms.formation.value = 1;
  post.render();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  post.render();
  uniforms.formation.value = formationAtPrewarm;
  // Drain the queued compiles/draws for real (guarded — the WebGL fallback backend has no device).
  const gpuDevice = (renderer as unknown as { backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } } })
    .backend?.device;
  if (gpuDevice?.queue?.onSubmittedWorkDone) await gpuDevice.queue.onSubmittedWorkDone();
  perf.end('prime', performance.now()); // the post-quad pipelines + first submits, drained under cover
  perf.end('bootToLoop', performance.now()); // everything before the live loop
  perf.begin('loopToReveal', performance.now()); // …until the splash lifts (in dismissSplash)
  perf.begin('smoothGate', performance.now()); // …and how long the smooth-streak gate takes
  gate.arm(performance.now(), gateThreshold());
  loop.start();
  // Mount the panel only after the intro settles (or is skipped) — never during the reveal.
  // `createControls` re-assigns `formation.onDone` for its own replay handling when it mounts.
  formation.onDone = scheduleControls;

  // Expose handles for console poking during development.
  Object.assign(globalThis, {
    osp: { renderer, rig, pass, post, loop, time, formation, uniforms, blackHole, scene, physics, bodyUniforms, scaler, history, timeline, events, perf },
  });
}

main().catch((error) => {
  console.error('[One Still Point] fatal:', error);
  document.getElementById('osp-splash')?.remove(); // don't hide the error behind the splash
  showFatalError(error);
});
