/**
 * The render engine running **inside the worker** (OffscreenCanvas path, step 3c). Browser-only (it
 * creates a `WebGPURenderer`), so it is not unit-tested — it's verified by the forced-flag Chromium
 * smoke test and injected behind a small interface so the message routing in `renderWorker.ts` stays
 * testable. See `docs/offscreen-canvas.md` + `docs/offscreen-canvas-session.md`.
 *
 * Scope (step 3c, the full dynamics): everything the main-thread path runs *except the DOM* now
 * lives here — the Scene + N-body physics, the formation dolly + staggered swooshes, the adaptive
 * `ResolutionScaler` with the intro deep cut, the fuzz/volumeStep reveal ramps, the ripple, the
 * pre-warm (correct-variant `post.compileAsync` + lit-disk prime + a real GPU drain), the
 * `SmoothnessGate`, and the `RevealProfiler`. The loop is driven by `renderer.setAnimationLoop` —
 * **real vsync-paced worker rAF**, which also fixes the step-2 crash: the old free-running
 * `setTimeout(16)` submitted heavy frames with no presentation backpressure, ballooning the GPU
 * process until the tab died. The main thread keeps only: the splash choreography (it answers our
 * `revealReady` with `command 'reveal'` once the splash hold elapses), input capture, and resize.
 * Controls/HUD/timeline arrive in step 4; Share in step 5.
 */
import { BirthTicker } from '../core/BirthTicker';
import { pickBody } from '../core/pick';
import { CameraRig } from '../core/CameraRig';
import { createRenderer } from '../core/Renderer';
import { FormationSequence } from '../core/FormationSequence';
import { History, type HistoryFrame } from '../core/History';
import { Loop } from '../core/Loop';
import { Timeline } from '../core/Timeline';
import { detectQualityTier, introResolutionScale, QUALITY_TIERS, revealVolumeStep, type QualitySettings, type QualityTier } from '../core/quality';
import { ResolutionScaler } from '../core/ResolutionScaler';
import { RevealProfiler } from '../core/RevealProfiler';
import { SmoothnessGate } from '../core/SmoothnessGate';
import { TimeController } from '../core/TimeController';
import { PhysicsController } from '../physics/PhysicsController';
import { createBodyUniforms, updateBodyUniforms } from '../render/bodyUniforms';
import { dramaImminent } from '../render/fullShaderNeed';
import { createPostPipeline, type PostPipeline } from '../render/PostPipeline';
import { RaymarchPass } from '../render/RaymarchPass';
import { rippleStrengthForMass } from '../render/rippleStrength';
import { createBlackHoleNode } from '../render/tsl/raymarch';
import { createUniforms } from '../render/uniforms';
import { Scene } from '../scene/Scene';
import type { Body, BodyType } from '../scene/Body';
import { applyControl, type ControlTargets } from './controlMap';
import { ElementProxy } from './elementProxy';
import { BODY_STRIDE, BODY_TYPE_CODES, type InitMessage, type PointerMessage, type WheelMessage, type WorkerToMain } from './protocol';

/** The slice of the worker engine the message router drives. */
export interface WorkerEngine {
  init(msg: InitMessage): Promise<{ backend: 'webgpu' | 'webgl' }>;
  resize(width: number, height: number, dpr: number): void;
  pointer(msg: PointerMessage): void;
  wheel(msg: WheelMessage): void;
  /** A panel control change (step 4a) — applied via the {@link applyControl} table. */
  control(key: string, value: number | boolean | string): void;
  command(name: string, args?: readonly (number | string)[]): void;
  dispose(): void;
}

const scope = globalThis as unknown as {
  setTimeout(cb: () => void, ms: number): number;
  requestAnimationFrame?: (cb: () => void) => number;
};

/** One awaited frame, for the pre-warm's two primed renders — worker rAF where the browser
 *  provides it (all transferControlToOffscreen browsers do), a timer tick otherwise. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (scope.requestAnimationFrame) scope.requestAnimationFrame(() => resolve());
    else scope.setTimeout(() => resolve(), 16);
  });

const POINTER_EVENT = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' } as const;
const STATUS_EVERY = 30; // ticks between status posts (~0.5s at 60Hz) — HUD telemetry + debug signal
const ADAPTER_PROBE_MS = 3000; // WebGPU capability probe budget — a healthy adapter answers in ms

export function createWorkerEngine(post: (message: WorkerToMain) => void = () => {}): WorkerEngine {
  let renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'] | null = null;
  let postPipe: PostPipeline | null = null;
  let pass: RaymarchPass | null = null;
  let rig: CameraRig | null = null;
  let loop: Loop | null = null;
  let scene: Scene | null = null;
  let physics: PhysicsController | null = null;
  let formation: FormationSequence | null = null;
  const proxy = new ElementProxy();
  const uniforms = createUniforms();
  const time = new TimeController();
  const scaler = new ResolutionScaler();
  const perf = new RevealProfiler();
  const gate = new SmoothnessGate();
  let activeQuality: QualitySettings = QUALITY_TIERS.low;
  let dprCap = 1;
  let lastSize = { width: 1, height: 1, dpr: 1 };
  let statusIn = STATUS_EVERY;
  let disposed = false;
  let controls: ControlTargets | null = null; // the 4a control-table targets, built at init
  let hudStream = false; // 4b: stream per-tick `frame` telemetry only while main's HUD is visible
  let timeline: Timeline | null = null; // 4b history half: the DVR lives worker-side
  let scrubbing = false; // frozen while the user drags the scrub bar (main.ts parity)
  let revealing = false; // ramp scaler.maxScale introScale→1 over the haze fade after 'reveal' (main.ts parity)
  // The lean→full compile freeze guard (main.ts parity): a resize mid-compile destroys the pass
  // depth texture `compileAsync` is bound to (the Firefox device-loss crash) — defer it instead.
  let compilingFull = false;
  let pendingResize = false;

  const FUZZ_FADE_S = 5.0; // mirrors main.ts — the haze/volumeStep reveal clock

  const applySize = (): void => {
    if (!renderer || !postPipe || !rig) return;
    if (compilingFull) {
      pendingResize = true;
      return;
    }
    const cssW = Math.max(1, lastSize.width / Math.max(1, lastSize.dpr));
    const cssH = Math.max(1, lastSize.height / Math.max(1, lastSize.dpr));
    proxy.setSize(cssW, cssH);
    const w = Math.max(1, Math.floor(cssW * dprCap * scaler.scale));
    const h = Math.max(1, Math.floor(cssH * dprCap * scaler.scale));
    renderer.setSize(w, h, false);
    postPipe.resize();
    rig.setAspect(cssW / cssH);
    uniforms.resolution.value.set(w, h);
  };

  // The intro deep cut, pinned while covered — the same discipline as main.ts's armIntroScale.
  const armIntroScale = (): void => {
    const intro = introResolutionScale(activeQuality);
    scaler.maxScale = intro;
    if (scaler.scale > intro) {
      scaler.scale = intro;
      scaler.minScale = intro;
      scaler.resetSmoothing();
      applySize();
    }
  };

  return {
    async init(msg) {
      // Seed the size BEFORE the first await: a resize handled while init is suspended must win
      // (rotate-during-boot on a phone), so nothing below reads the init message's size again.
      lastSize = { width: msg.width, height: msg.height, dpr: msg.dpr };

      // The capability probe — BEFORE any renderer exists. This path requires **WebGPU in the
      // worker**; the WebGL2 fallback stays main-thread-only. Letting three's automatic WebGL2
      // fallback engage *inside a worker* wedged Firefox's whole GPU process (tab dead, force
      // restart — 2026-07-03 report), so a worker without a real, answering WebGPU adapter says
      // `unsupported` and the host falls back to the proven main-thread renderer instead. The
      // `capability` post doubles as the host watchdog's "worker alive" heartbeat — it arrives
      // within spawn time, long before the multi-second compile.
      const gpu = (globalThis as { navigator?: { gpu?: { requestAdapter?: () => Promise<unknown> } } }).navigator?.gpu;
      let adapter: unknown = null;
      if (gpu?.requestAdapter) {
        try {
          adapter = await Promise.race([
            gpu.requestAdapter(),
            new Promise((resolve) => scope.setTimeout(() => resolve(null), ADAPTER_PROBE_MS)),
          ]);
        } catch {
          adapter = null; // a throwing probe is as unsupported as a missing one
        }
      }
      post({ type: 'capability', webgpu: !!adapter });
      if (!adapter) {
        const reason = gpu?.requestAdapter
          ? `WebGPU adapter unavailable in the worker (requestAdapter returned null, threw, or took > ${ADAPTER_PROBE_MS}ms)`
          : 'navigator.gpu is not exposed to workers in this browser';
        const err = new Error(`worker render path unsupported: ${reason}`);
        (err as { ospUnsupported?: boolean }).ospUnsupported = true;
        throw err;
      }

      const bundle = await createRenderer({ canvas: msg.canvas, width: msg.width, height: msg.height });
      if (disposed) {
        bundle.renderer.dispose();
        return { backend: 'webgpu' };
      }
      renderer = bundle.renderer;

      const tier: QualityTier = msg.quality === 'auto' ? detectQualityTier() : msg.quality;
      activeQuality = QUALITY_TIERS[tier];
      scaler.scale = activeQuality.scale;
      scaler.minScale = activeQuality.minScale;
      dprCap = Math.min(lastSize.dpr, activeQuality.dprCap);

      scene = new Scene();
      const blackHole = scene.blackHole;
      blackHole.volumeStep.value = activeQuality.volumeStep;
      const bodyUniforms = createBodyUniforms();
      rig = new CameraRig(uniforms, proxy as unknown as HTMLElement, { coarse: msg.coarse });
      // First light on the worker path (roadmap #1): build the reveal on the LEAN shader. The
      // worker's cold compile+prime saturates Chrome's *shared* GPU process, and on the full shader
      // that window is long enough to swallow the whole splash (the compositor can't paint the
      // merger → a black splash). The lean variant compiles far faster, shrinking that contention
      // window so the splash animates; the full shader swaps in later (below), off the critical path.
      pass = new RaymarchPass(createBlackHoleNode(uniforms, blackHole, bodyUniforms, { lean: true }));
      postPipe = createPostPipeline(renderer, pass.scene, pass.camera, uniforms.fuzz);
      loop = new Loop(renderer);
      physics = new PhysicsController(scene, renderer);
      physics.gpuAvailable = bundle.backend === 'webgpu';
      formation = new FormationSequence(rig, uniforms.formation, { reducedMotion: msg.reducedMotion });
      // The DVR (4b history half): the worker owns the recorded tape + playhead; main only
      // renders the bar from `timeline`/`event` messages and drives it with scrub commands.
      const history = new History();
      const applyFrame = (frame: HistoryFrame): void => {
        if (!scene || !physics) return; // disposed mid-message
        if (scene.restoreRoster(frame.ids)) physics.syncBodies();
        history.restore(frame, scene.bodies);
      };
      const localTimeline = new Timeline(history, applyFrame);
      timeline = localTimeline;
      scene.onUserEdit = () => {
        // A live edit while scrubbed back rewrites history from here — main drops its mirrored
        // event ticks at/after this frame (the reserved 'drop' event).
        if (localTimeline.commit()) post({ type: 'event', event: 'drop', frame: history.recorded });
      };
      // The "one still point" camera focus (tap a body twice → centre on it). CameraRig.update follows
      // it each frame. (Main also re-centres when the focused body leaves the scene; on this opt-in
      // path that edge case is deferred — part of the worker-parity backlog.)
      scene.onFocus = (body) => rig?.focusOn(body);
      scene.onEvent = (type, body) => {
        post({ type: 'event', event: type, frame: history.recorded }); // a tick for the scrub bar
        if (type === 'absorb') {
          uniforms.ripple.value = 0;
          uniforms.rippleStrength.value = body ? rippleStrengthForMass(body.mass) : 1;
        }
      };
      scene.onMerge = (x, y, z, kind, strength) => {
        uniforms.mergeFlashPos.value.set(x, y, z);
        const c = kind === 'hole' ? [0.75, 0.88, 1.25] : [1.25, 1.05, 0.7];
        uniforms.mergeFlashColor.value.set(c[0]! * strength, c[1]! * strength, c[2]! * strength);
        uniforms.mergeFlashAge.value = 0;
        uniforms.mergeFlashActive.value = 1;
      };
      // Seeded bodies get their birth ticks as they swoosh in (main.ts parity — rewinding
      // before a body's tick shows it absent).
      const births = new BirthTicker<Body>((body) => {
        scene!.markBorn(body);
        scene!.onEvent?.(body.type);
      });
      births.arm(scene.companions);

      // The 4a control-table targets: the same objects the main-thread panel binds directly,
      // reachable here through `control {key, value}` messages (see controlMap.ts).
      const localRenderer = renderer;
      const localLoopForControls = loop;
      controls = {
        blackHole,
        background: {
          mode: uniforms.background,
          brightness: uniforms.bgBrightness,
          saturation: uniforms.bgSaturation,
          tint: uniforms.bgTint,
        },
        bloom: postPipe.bloom,
        time,
        setExposure: (v) => {
          localRenderer.toneMappingExposure = v;
        },
        setMaxFps: (v) => {
          localLoopForControls.maxFps = v;
        },
        setQuality: (tier) => {
          // Main-path applyQuality parity: re-tier the scale bounds, DPR cap and dust step.
          const q = QUALITY_TIERS[tier === 'auto' ? detectQualityTier() : tier];
          activeQuality = q;
          scaler.scale = q.scale;
          scaler.minScale = q.minScale;
          blackHole.volumeStep.value = q.volumeStep;
          dprCap = Math.min(lastSize.dpr, q.dprCap);
          applySize();
        },
      };

      // The pre-warm, exactly as the (measured, fixed) main path does it: deep cut pinned →
      // correct-variant async compile → two covered *lit* primes → a real GPU drain.
      armIntroScale();
      perf.begin('compile', performance.now());
      await postPipe.compileAsync();
      perf.end('compile', performance.now());
      perf.begin('prime', performance.now());
      const formationAtPrewarm = uniforms.formation.value;
      uniforms.formation.value = 1;
      postPipe.render();
      await nextFrame();
      postPipe.render();
      uniforms.formation.value = formationAtPrewarm;
      const gpuDevice = (renderer as unknown as { backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } } })
        .backend?.device;
      if (gpuDevice?.queue?.onSubmittedWorkDone) await gpuDevice.queue.onSubmittedWorkDone();
      perf.end('prime', performance.now());

      const localScene = scene;
      const localPhysics = physics;
      const localFormation = formation;
      const localRig = rig;
      const localPost = postPipe;
      const localLoop = loop;
      const localPass = pass;
      const localBodyUniforms = bodyUniforms;
      // First light (worker): swap the lean reveal shader for the full one the first frame the scene
      // actually needs it (a companion hole, a tear feeding the disk, or a merge flash) — a dramatic
      // beat that masks the one-time compile. Until then lean is pixel-identical. Same as main.ts.
      let fullShaderPending = true;
      const upgradeToFullShader = async (): Promise<void> => {
        compilingFull = true; // freeze resizes for the one-shot compile (main.ts parity)
        try {
          const t0 = performance.now();
          localPass.setColorNode(createBlackHoleNode(uniforms, blackHole, localBodyUniforms, { lean: false }));
          await localPost.compileAsync();
          perf.record('fullCompile', performance.now() - t0);
        } catch (e) {
          console.warn('[onestillpoint] worker first-light: full-shader upgrade failed, staying on lean:', e);
        } finally {
          compilingFull = false;
          if (pendingResize) {
            pendingResize = false;
            applySize(); // apply the resize we held off during the compile
          }
          scaler.resetSmoothing(); // the compile's giant frame must not poison the frame-time average
        }
      };
      localLoop.onTick = (frameDelta) => {
        const now = performance.now();
        if (perf.tick(now)) post({ type: 'perf', report: perf.report() }); // on-device debug telemetry
        if (gate.tick(now)) {
          perf.end('smoothGate', now); // same semantics as main: how long the smooth streak took
          post({ type: 'revealReady' }); // the loop flows — main may play the splash out
        }

        const resized = !compilingFull && scaler.update(frameDelta); // frozen during the lean→full compile
        if (resized) applySize();
        if (resized && scaler.minScale < activeQuality.minScale) perf.countResize();
        if (scaler.minScale < activeQuality.minScale && scaler.scale >= activeQuality.minScale) {
          scaler.minScale = activeQuality.minScale;
        }
        if (uniforms.fuzz.value > 0) {
          uniforms.fuzz.value = Math.max(0, uniforms.fuzz.value - frameDelta / FUZZ_FADE_S);
          localScene.blackHole.volumeStep.value = revealVolumeStep(activeQuality, uniforms.fuzz.value);
        }
        // Ramp the resolution ceiling back to native over the haze fade so the scaler's target
        // rebuilds spread out under the veil instead of landing bare at the reveal (main.ts parity).
        if (revealing) {
          const introS = introResolutionScale(activeQuality);
          scaler.maxScale = Math.min(1, introS + (1 - introS) * (1 - uniforms.fuzz.value));
          if (uniforms.fuzz.value <= 0) revealing = false;
        }
        // First light: swap to the full shader the first frame the scene needs it (main.ts parity).
        if (fullShaderPending) {
          const needsFull =
            dramaImminent(localScene.bodies) || // compile-AHEAD: pay the one-shot compile in the calm before the tear (main.ts parity)
            localBodyUniforms.feedingActive.value > 0 ||
            uniforms.mergeFlashActive.value > 0.5 ||
            localScene.blackHole.spin.value > 0 || // Kerr frame-drag (main.ts parity — no worker control yet, so 0 today)
            localBodyUniforms.slots.some((s) => s.lensMass.value > 0);
          if (needsFull) {
            fullShaderPending = false;
            void upgradeToFullShader();
          }
        }
        if (uniforms.ripple.value < 100) uniforms.ripple.value += frameDelta;
        if (uniforms.mergeFlashActive.value > 0.5) {
          uniforms.mergeFlashAge.value += frameDelta;
          if (uniforms.mergeFlashAge.value > 1.7) uniforms.mergeFlashActive.value = 0; // match main.ts — the slower-decaying shockwave ring needs the longer window
        }

        const t = time.tick(frameDelta);
        uniforms.time.value += t.animDelta;
        uniforms.timeBlur.value = t.timeBlur;
        localPhysics.timeScale = t.orbitMul;
        // The DVR over the recorded history — the exact main.ts block: a drag freezes everything;
        // a ←/→ step walks the tape (extending it live past the edge); continuous play either
        // replays recorded frames (scrubbed back) or runs live physics + records (at the edge).
        if (!scrubbing) {
          if (t.step < 0) {
            localTimeline.stepBack(-t.step);
          } else if (t.step > 0) {
            const overflow = localTimeline.stepForward(t.step);
            if (overflow > 0) {
              localPhysics.step(overflow / 60);
              history.record(localScene.bodies);
            }
          } else if (!time.paused) {
            if (localTimeline.live) {
              if (t.fd > 0) {
                localPhysics.step(t.fd);
                history.record(localScene.bodies);
              }
            } else {
              localTimeline.advance();
            }
          }
        }
        // The bar's marker numbers: per-tick while the head visibly moves (scrubbed / replaying /
        // dragged), else at status cadence below (only the window + start marker crawl while live).
        if (!localTimeline.live || scrubbing) {
          post({
            type: 'timeline',
            recorded: history.recorded,
            length: history.length,
            currentPos: localTimeline.currentPos,
            startPos: localTimeline.startPos,
          });
        }

        updateBodyUniforms(bodyUniforms, localScene, localFormation.progress);
        births.update(localFormation.progress, frameDelta, () => localScene.companions);
        if (localFormation.done) localRig.update();
        else localFormation.update(frameDelta);
        localPost.render();

        // 4b: the HUD's per-tick telemetry (frame ms, res scale, camera + packed body positions
        // for the orbit map) — streamed only while main's HUD is on screen (command 'hudStream').
        if (hudStream) {
          let n = 0;
          for (const b of localScene.bodies) if (!b.fixed) n += 1;
          const packed = new Float32Array(n * BODY_STRIDE);
          let o = 0;
          for (const b of localScene.bodies) {
            if (b.fixed) continue;
            packed[o] = b.position.x;
            packed[o + 1] = b.position.y;
            packed[o + 2] = b.position.z;
            packed[o + 3] = b.velocity.x;
            packed[o + 4] = b.velocity.y;
            packed[o + 5] = b.velocity.z;
            packed[o + 6] = BODY_TYPE_CODES[b.type];
            packed[o + 7] = b.plunging !== undefined || b.absorbing !== undefined ? 1 : 0;
            o += BODY_STRIDE;
          }
          post({
            type: 'frame',
            ms: frameDelta * 1000,
            resScale: scaler.scale,
            camX: uniforms.camPos.value.x,
            camZ: uniforms.camPos.value.z,
            bodies: packed.buffer,
            count: n,
          });
        }

        if (--statusIn <= 0) {
          statusIn = STATUS_EVERY;
          let stars = 0;
          let planets = 0;
          let holes = 0;
          for (const b of localScene.bodies) {
            if (b.fixed) continue;
            if (b.type === 'star') stars += 1;
            else if (b.type === 'planet') planets += 1;
            else holes += 1;
          }
          post({
            type: 'status',
            fps: frameDelta > 0 ? Math.round(1 / frameDelta) : 0,
            ms: Math.round(frameDelta * 1000 * 100) / 100,
            resScale: scaler.scale,
            stars,
            planets,
            holes,
            gpu: localPhysics.useGPU,
            timeScale: time.timeScale,
          });
          post({
            type: 'timeline',
            recorded: history.recorded,
            length: history.length,
            currentPos: localTimeline.currentPos,
            startPos: localTimeline.startPos,
          });
        }
      };

      applySize();
      perf.begin('loopToReveal', performance.now()); // …until main lifts the splash (command 'reveal')
      perf.begin('smoothGate', performance.now());
      gate.arm(performance.now());
      localLoop.start(); // vsync-paced worker rAF via setAnimationLoop — no free-running submits
      return { backend: bundle.backend === 'webgpu' ? 'webgpu' : 'webgl' };
    },
    resize(width, height, dpr) {
      lastSize = { width, height, dpr };
      dprCap = Math.min(dpr, activeQuality.dprCap);
      applySize();
    },
    pointer(msg) {
      proxy.dispatch(POINTER_EVENT[msg.action], {
        pointerId: msg.pointerId,
        pointerType: msg.pointerType,
        button: msg.button,
        buttons: msg.buttons,
        clientX: msg.x,
        clientY: msg.y,
        pageX: msg.x,
        pageY: msg.y,
      });
      // A tap during the intro skips to the formed view — dispatched to the proxy FIRST so
      // OrbitControls sees the pointerdown while still disabled (main-path listener-order parity:
      // the skipping tap never grabs the camera). Unlike main's old once-listener, a tap inside
      // the 0.5s guard does not consume skippability (skip() no-ops until the guard passes).
      if (msg.action === 'down' && formation && !formation.done) formation.skip();
    },
    wheel(msg) {
      proxy.dispatch('wheel', { deltaY: msg.deltaY, deltaMode: msg.deltaMode, ctrlKey: msg.ctrlKey });
    },
    control(key, value) {
      if (!controls) return; // a control before init has nothing to write to (panel mounts on ready)
      applyControl(controls, key, value);
    },
    command(name, args) {
      if (name === 'hudStream') {
        hudStream = args?.[0] === 'on'; // needs no engine objects — usable the moment init runs
        return;
      }
      if (name === 'pick') {
        // The single-tap gesture (highlight / plunge / plunge-into / rescue), hit-tested against the
        // worker's camera in the relayed CSS coordinates (main.ts parity — inert until the intro
        // settles). `null` (empty space) deselects; the shared state machine lives in Scene.
        const [x, y] = [args?.[0], args?.[1]];
        if (typeof x !== 'number' || typeof y !== 'number') return;
        if (!scene || !rig || !formation?.done) return;
        const cssW = proxy.clientWidth;
        const cssH = proxy.clientHeight;
        scene.clickBody(pickBody(scene.bodies, rig.camera, x, y, cssW, cssH, 34, true, scene.blackHole.mass.value)); // includeFixed + lens-aware (matches main; 34 = the forgiving radius)
        return;
      }
      if (name === 'scrubbing') {
        scrubbing = args?.[0] === 'on'; // freeze the sim under the drag (main.ts parity)
        return;
      }
      if (name === 'scrub') {
        const pos = args?.[0];
        if (typeof pos === 'number' && timeline) timeline.scrubTo(Math.min(1, Math.max(0, pos)));
        return;
      }
      if (name === 'reveal') {
        // The splash is lifting on main: the reveal + settle is the heaviest the engine gets —
        // start cheap and haze-masked, then the loop ramps the ceiling back up under the haze
        // (main.ts parity — a hard maxScale=1 landed every target rebuild bare in the first ~1s).
        perf.end('loopToReveal', performance.now()); // loop start → splash lift, same as the main path
        armIntroScale();
        uniforms.fuzz.value = 1;
        revealing = true;
        return;
      }
      // Body edits are commands, not controls: discrete actions with a physics side effect —
      // whoever changes the body set must syncBodies() (GPU buffer rebuild; PhysicsController doc).
      if (!scene || !physics) return;
      if (name === 'addBody') {
        const type = args?.[0];
        if (type === 'star') scene.addStar();
        else if (type === 'planet') scene.addPlanet();
        else if (type === 'hole') scene.addBlackHole();
        else return;
        physics.syncBodies();
        return;
      }
      if (name === 'removeBody') {
        const type = args?.[0];
        if (type !== 'star' && type !== 'planet' && type !== 'hole') return;
        if (scene.removing) return; // the − tap-guard, enforced at the engine (main-panel parity)
        scene.removeOne(type as BodyType); // the plunge choreography frees it; prune() self-syncs
        return;
      }
      if (name === 'clearBodies') {
        scene.clearCompanions();
        physics.syncBodies();
      }
    },
    dispose() {
      disposed = true;
      controls = null;
      timeline = null;
      loop?.stop();
      rig?.dispose();
      pass?.dispose();
      renderer?.dispose();
      renderer = null;
      postPipe = null;
      pass = null;
      rig = null;
      loop = null;
      scene = null;
      physics = null;
      formation = null;
    },
  };
}
