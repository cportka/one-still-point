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
import { CameraRig } from '../core/CameraRig';
import { createRenderer } from '../core/Renderer';
import { FormationSequence } from '../core/FormationSequence';
import { Loop } from '../core/Loop';
import { detectQualityTier, introResolutionScale, QUALITY_TIERS, revealVolumeStep, type QualitySettings, type QualityTier } from '../core/quality';
import { ResolutionScaler } from '../core/ResolutionScaler';
import { RevealProfiler } from '../core/RevealProfiler';
import { SmoothnessGate } from '../core/SmoothnessGate';
import { TimeController } from '../core/TimeController';
import { PhysicsController } from '../physics/PhysicsController';
import { createBodyUniforms, updateBodyUniforms } from '../render/bodyUniforms';
import { createPostPipeline, type PostPipeline } from '../render/PostPipeline';
import { RaymarchPass } from '../render/RaymarchPass';
import { rippleStrengthForMass } from '../render/rippleStrength';
import { createBlackHoleNode } from '../render/tsl/raymarch';
import { createUniforms } from '../render/uniforms';
import { Scene } from '../scene/Scene';
import type { BodyType } from '../scene/Body';
import { applyControl, type ControlTargets } from './controlMap';
import { ElementProxy } from './elementProxy';
import type { InitMessage, PointerMessage, WheelMessage, WorkerToMain } from './protocol';

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

  const FUZZ_FADE_S = 5.0; // mirrors main.ts — the haze/volumeStep reveal clock

  const applySize = (): void => {
    if (!renderer || !postPipe || !rig) return;
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
      pass = new RaymarchPass(createBlackHoleNode(uniforms, blackHole, bodyUniforms));
      postPipe = createPostPipeline(renderer, pass.scene, pass.camera, uniforms.fuzz);
      loop = new Loop(renderer);
      physics = new PhysicsController(scene, renderer);
      physics.gpuAvailable = bundle.backend === 'webgpu';
      formation = new FormationSequence(rig, uniforms.formation, { reducedMotion: msg.reducedMotion });
      scene.onEvent = (type, body) => {
        if (type === 'absorb') {
          uniforms.ripple.value = 0;
          uniforms.rippleStrength.value = body ? rippleStrengthForMass(body.mass) : 1;
        }
        // Timeline event ticks flow to the history bar with the step-4 channel.
      };

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
      localLoop.onTick = (frameDelta) => {
        const now = performance.now();
        if (perf.tick(now)) post({ type: 'perf', report: perf.report() }); // on-device debug telemetry
        if (gate.tick(now)) {
          perf.end('smoothGate', now); // same semantics as main: how long the smooth streak took
          post({ type: 'revealReady' }); // the loop flows — main may play the splash out
        }

        const resized = scaler.update(frameDelta);
        if (resized) applySize();
        if (resized && scaler.minScale < activeQuality.minScale) perf.countResize();
        if (scaler.minScale < activeQuality.minScale && scaler.scale >= activeQuality.minScale) {
          scaler.minScale = activeQuality.minScale;
        }
        if (uniforms.fuzz.value > 0) {
          uniforms.fuzz.value = Math.max(0, uniforms.fuzz.value - frameDelta / FUZZ_FADE_S);
          localScene.blackHole.volumeStep.value = revealVolumeStep(activeQuality, uniforms.fuzz.value);
        }
        if (uniforms.ripple.value < 100) uniforms.ripple.value += frameDelta;

        // No pause/DVR surface in the worker path until the step-4 channel — live time only.
        const t = time.tick(frameDelta);
        uniforms.time.value += t.animDelta;
        uniforms.timeBlur.value = t.timeBlur;
        localPhysics.timeScale = t.orbitMul;
        if (t.fd > 0) localPhysics.step(t.fd);

        updateBodyUniforms(bodyUniforms, localScene, localFormation.progress);
        if (localFormation.done) localRig.update();
        else localFormation.update(frameDelta);
        localPost.render();

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
      if (name === 'reveal') {
        // The splash is lifting on main: the reveal + settle is the heaviest the engine gets —
        // start cheap and haze-masked, release the pin, then the scaler climbs (main.ts parity).
        perf.end('loopToReveal', performance.now()); // loop start → splash lift, same as the main path
        armIntroScale();
        scaler.maxScale = 1;
        uniforms.fuzz.value = 1;
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
