import type { Camera, Scene } from 'three';
import BloomNode, { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { mix, pass, vec3 } from 'three/tsl';
import { RenderPipeline } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import type { Uniforms } from './uniforms';

export interface PostPipeline {
  /** Render the scene through the post chain to the screen. */
  render(): void;
  /**
   * Pre-compile the raymarch **as the pass actually renders it** — against the pass's own HDR
   * render target, using `createRenderPipelineAsync` (non-blocking). This matters: the RT's color
   * format is part of the pipeline cache key, so `renderer.compileAsync(scene, camera)` against the
   * default framebuffer compiles a *different variant* than the one `render()` needs — the real one
   * then compiled **synchronously in the GPU process at first submit**, a multi-second cold-cache
   * stall that froze every rAF on the page (the measured splash→engine freeze). Await this under
   * the splash, before the first render.
   */
  compileAsync(): Promise<void>;
  /**
   * Call after the renderer's drawing-buffer size changes (dynamic resolution).
   *
   * **This is deliberately free.** See the note on the implementation: the pass, the bloom chain
   * and FXAA all track the drawing-buffer size themselves, every frame, so there is nothing to
   * do here. The seam is kept because the *call sites* are correct — they are the places that
   * would have to act if a future three release stopped self-resizing.
   */
  resize(): void;
  /** The bloom node, exposed so the GUI can drive strength/radius/threshold. */
  bloom: BloomNode;
}

/**
 * HDR bloom via the WebGPU node pipeline (the legacy EffectComposer is WebGL
 * only). The raymarch pass outputs linear HDR (material.toneMapped = false);
 * bloom blooms that HDR, then `outputColorTransform` (on by default) applies the
 * renderer's ACES tone mapping + sRGB at the very end — so the bright inner disk
 * and photon ring bleed glow before being compressed to display range.
 *
 * On top of bloom sits the **warm-fuzzy reveal veil**, weighted by `fuzz` (0..1):
 * the intro reveals at a deliberately low resolution (see `introResolutionScale`),
 * and this veil turns that softness into an intentional *warm, out-of-focus* look —
 * a warm tint plus extra bloom glow — that fades to nothing as `fuzz` eases to 0 and
 * the scene sharpens into reality. At `fuzz = 0` (steady state) it's a passthrough.
 */
export function createPostPipeline(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  fuzz: Uniforms['fuzz'],
): PostPipeline {
  const scenePass = pass(scene, camera);
  // Bloom strength is deliberately moderate (was 0.6): a heavy bloom flooded the soft disk to a
  // low-contrast milky white when it settled. Lower strength keeps the bright photon ring blooming
  // while letting the darks stay dark — more contrast between the darkest dark and the lightest light.
  const bloomPass = bloom(scenePass, 0.45, 0.85, 0.0); // strength, radius, threshold
  const base = scenePass.add(bloomPass); // the normal HDR output

  // The warm, dreamy veil: a warm grade (more red, less blue) plus extra soft glow
  // reused from the bloom (so there's no second blur pass to pay for). The low-res
  // buffer supplies the actual fuzz; this makes it read as warm and out-of-focus.
  // Strengthened (warmer grade + more glow) so it more fully masks the deeper intro
  // resolution cut — tune `warm`/the glow multiplier here, paired with `FUZZ_FADE_S`
  // (how long it lingers) and the tier `introScale` (how soft the reveal starts).
  const warm = base.mul(vec3(1.16, 1.0, 0.8));
  const dreamy = warm.add(bloomPass.mul(0.8)); // extra reveal glow (was 1.1 — the settling haze read too bright)
  // mix(base, dreamy, fuzz): fuzz=1 → full warm veil at the reveal; fuzz=0 → base.
  const composed = mix(base, dreamy, fuzz);

  // Anti-alias the result with FXAA. The raymarch renders below native (dynamic resolution, then
  // CSS-upscaled), so the high-contrast edges — the photon ring, the shadow rim — stair-step and
  // read as a low-res "pixel" look at the settled view; FXAA's luma-edge blend smooths those for the
  // cost of one cheap full-screen pass (no extra geometry samples). It also softens the deep-cut
  // intro reveal. Runs last, on the composed image.
  const outputNode = fxaa(composed);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = outputNode;

  return {
    render: () => pipeline.render(),
    // PassNode.compileAsync binds the pass's render target + MRT state, compiles via
    // createRenderPipelineAsync, and restores — the only sanctioned async hook for the pass chain.
    // (The bloom/FXAA quads have no async path in three r184; they're primed by the covered renders.)
    compileAsync: () => scenePass.compileAsync(renderer),
    // A no-op, and that is the point. This used to set `pipeline.needsUpdate = true`, which is a
    // far heavier thing than it looks: `RenderPipeline._update()` re-wraps the whole output node
    // graph (`.context()` + `renderOutput`) and sets `_quadMesh.material.needsUpdate`, recompiling
    // the composite quad's material — fresh WGSL, fresh pipeline. On a **cold** shader cache that
    // is a ~300 ms stall, and the adaptive scaler asks for a resize several times during the
    // reveal, so it landed as a burst of dropped frames each time. A cold-load trace put every one
    // of its 14 janks in a burst behind one of three resizes, worst frame 305 ms.
    //
    // It is redundant, because nothing in this graph depends on the buffer size (verified against
    // three r184, and pinned by postPipelineInvariants.test.ts so a version bump can't quietly
    // invalidate the assumption):
    //   - `PassNode.updateBefore` re-reads the size and calls `setSize` every frame.
    //   - `BloomNode.updateBefore` does `renderer.getDrawingBufferSize()` + `setSize` every frame,
    //     resizing all eleven of its targets.
    //   - `RenderTarget.setSize` no-ops unless a dimension actually changed.
    //   - FXAA's `_invSize` is a **uniform**, refreshed every frame from the texture's real
    //     dimensions — the resolution is never baked into the compiled shader.
    //   - `RenderPipeline._update()` already raises `needsUpdate` itself when the tone mapping or
    //     the output color space changes, which are the only things the graph is built against.
    resize: () => {},
    bloom: bloomPass,
  };
}
