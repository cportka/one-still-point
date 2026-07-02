/**
 * The render engine running **inside the worker** (OffscreenCanvas path, step 3). Browser-only (it
 * creates a `WebGPURenderer`), so it is not unit-tested — it's verified by the forced-flag Chromium
 * smoke test and injected behind a small interface so the message routing in `renderWorker.ts` stays
 * testable. See `docs/offscreen-canvas.md` + `docs/offscreen-canvas-session.md`.
 *
 * Scope (step 3, input + resize): the renderer + the **real raymarch** + post pipeline on the
 * transferred canvas, an **interactive `CameraRig`** driven by replayed pointer/wheel events (the
 * {@link ElementProxy} implements the DOM surface OrbitControls needs), and honest drawing-buffer
 * sizing (quality-tier scale + DPR cap, resolved from the tier the main thread detected). The
 * dynamics (Scene/physics/formation), the resolution scaler, Controls and Share move in steps 3c–5;
 * the view is the formed steady state, but you can orbit and zoom it off-thread.
 */
import { CameraRig } from '../core/CameraRig';
import { createRenderer } from '../core/Renderer';
import { detectQualityTier, QUALITY_TIERS, type QualityTier } from '../core/quality';
import { createBlackHole } from '../scene/BlackHole';
import { createBodyUniforms } from '../render/bodyUniforms';
import { createPostPipeline, type PostPipeline } from '../render/PostPipeline';
import { RaymarchPass } from '../render/RaymarchPass';
import { createBlackHoleNode } from '../render/tsl/raymarch';
import { createUniforms } from '../render/uniforms';
import { ElementProxy } from './elementProxy';
import type { InitMessage, PointerMessage, WheelMessage } from './protocol';

/** The slice of the worker engine the message router drives. */
export interface WorkerEngine {
  init(msg: InitMessage): Promise<{ backend: 'webgpu' | 'webgl' }>;
  resize(width: number, height: number, dpr: number): void;
  pointer(msg: PointerMessage): void;
  wheel(msg: WheelMessage): void;
  dispose(): void;
}

// setTimeout/clearTimeout live on the worker global; rAF does not exist in a worker, so the loop
// self-drives at ~60 Hz. (Step 3c moves to main-thread vsync ticks with the full dynamics.)
const scope = globalThis as unknown as {
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

const POINTER_EVENT = { down: 'pointerdown', move: 'pointermove', up: 'pointerup', cancel: 'pointercancel' } as const;

export function createWorkerEngine(): WorkerEngine {
  let post: PostPipeline | null = null;
  let pass: RaymarchPass | null = null;
  let renderer: Awaited<ReturnType<typeof createRenderer>>['renderer'] | null = null;
  let rig: CameraRig | null = null;
  const proxy = new ElementProxy();
  const uniforms = createUniforms();
  let tier: QualityTier = 'low';
  let dprCap = 1;
  let raf = 0;
  let disposed = false;

  // Drawing buffer = CSS size × capped DPR × the tier's steady scale (the adaptive scaler joins in
  // step 3c; a fixed tier scale is the honest interim — the same formula as main.ts's applySize).
  const applySize = (width: number, height: number, dpr: number): void => {
    if (!renderer || !post || !rig) return;
    const q = QUALITY_TIERS[tier];
    const cssW = Math.max(1, width / Math.max(1, dpr));
    const cssH = Math.max(1, height / Math.max(1, dpr));
    proxy.setSize(cssW, cssH); // OrbitControls normalizes drag rotation by the CSS height
    const w = Math.max(1, Math.floor(cssW * dprCap * q.scale));
    const h = Math.max(1, Math.floor(cssH * dprCap * q.scale));
    renderer.setSize(w, h, false);
    post.resize();
    rig.setAspect(cssW / cssH);
    uniforms.resolution.value.set(w, h);
  };

  return {
    async init(msg) {
      const bundle = await createRenderer({ canvas: msg.canvas, width: msg.width, height: msg.height });
      if (disposed) {
        bundle.renderer.dispose();
        return { backend: 'webgpu' };
      }
      renderer = bundle.renderer;
      // The main thread resolves the tier ('auto' only as a defensive fallback — detectQualityTier
      // degrades gracefully in a worker: no matchMedia reads as a mouse-driven desktop).
      tier = msg.quality === 'auto' ? detectQualityTier() : msg.quality;
      dprCap = Math.min(msg.dpr, QUALITY_TIERS[tier].dprCap);
      const blackHole = createBlackHole();
      blackHole.volumeStep.value = QUALITY_TIERS[tier].volumeStep;
      const bodyUniforms = createBodyUniforms();
      pass = new RaymarchPass(createBlackHoleNode(uniforms, blackHole, bodyUniforms));
      post = createPostPipeline(renderer, pass.scene, pass.camera, uniforms.fuzz);
      // The camera runs here, in the worker: OrbitControls drives the proxy element, fed by
      // replayed pointer/wheel messages. Coarse framing comes from the main thread's probe.
      rig = new CameraRig(uniforms, proxy as unknown as HTMLElement, { coarse: msg.coarse });
      applySize(msg.width, msg.height, msg.dpr);
      await post.compileAsync(); // the pass-variant compile, async, off the main thread entirely
      const loop = (): void => {
        if (disposed || !post || !rig) return;
        rig.update(); // damping + publish the camera pose to the uniform bus
        post.render();
        raf = scope.setTimeout(loop, 16);
      };
      loop();
      return { backend: bundle.backend === 'webgpu' ? 'webgpu' : 'webgl' };
    },
    resize(width, height, dpr) {
      dprCap = Math.min(dpr, QUALITY_TIERS[tier].dprCap);
      applySize(width, height, dpr);
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
    },
    wheel(msg) {
      proxy.dispatch('wheel', { deltaY: msg.deltaY, deltaMode: msg.deltaMode, ctrlKey: msg.ctrlKey });
    },
    dispose() {
      disposed = true;
      scope.clearTimeout(raf);
      rig?.dispose();
      pass?.dispose();
      renderer?.dispose();
      post = null;
      pass = null;
      renderer = null;
      rig = null;
    },
  };
}
