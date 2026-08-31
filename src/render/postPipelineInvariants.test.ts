import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `PostPipeline.resize()` is a deliberate no-op. It used to set `pipeline.needsUpdate = true`,
 * which re-wraps the whole output node graph and recompiles the composite quad's material — a
 * ~300 ms stall on a cold shader cache, paid on every adaptive-resolution step. A cold-load trace
 * put all 14 of its janks in bursts behind three resizes, worst frame 305 ms.
 *
 * Dropping it is only safe while three keeps sizing itself. These guards read the installed
 * three and fail loudly if a version bump changes that, because the symptom otherwise would be a
 * *silently* stale or wrongly-sized composite rather than a test failure.
 *
 * If one of these fails: do not just re-add `needsUpdate` — check what actually changed, and
 * prefer resizing only the thing that stopped self-sizing.
 */
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The body of `updateBefore(...)`, which is what runs per frame. */
const updateBefore = (src: string): string => {
  const i = src.indexOf('updateBefore(');
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, i + 4000);
};

describe('three r184 invariants that let PostPipeline.resize() be free', () => {
  it('PassNode re-sizes its render target every frame', () => {
    const src = read('../../node_modules/three/src/nodes/display/PassNode.js');
    expect(updateBefore(src)).toMatch(/this\.setSize\(\s*_size\.width,\s*_size\.height\s*\)/);
  });

  it('BloomNode re-reads the drawing-buffer size and re-sizes its chain every frame', () => {
    const src = read('../../node_modules/three/examples/jsm/tsl/display/BloomNode.js');
    const body = updateBefore(src);
    expect(body).toMatch(/renderer\.getDrawingBufferSize\(\s*_size\s*\)/);
    expect(body).toMatch(/this\.setSize\(\s*size\.width,\s*size\.height\s*\)/);
  });

  it('RenderTarget.setSize is a no-op unless a dimension really changed', () => {
    const src = read('../../node_modules/three/src/core/RenderTarget.js');
    // Guards the whole reallocation behind a dimension comparison, so per-frame setSize is cheap.
    expect(src).toMatch(/this\.width !== width \|\| this\.height !== height/);
  });

  it('FXAA carries its resolution in a per-frame uniform, never baked into the shader', () => {
    const src = read('../../node_modules/three/examples/jsm/tsl/display/FXAANode.js');
    expect(src).toMatch(/_invSize\s*=\s*uniform\(/); // a uniform, not a constant
    expect(updateBefore(src)).toMatch(/_invSize\.value\.set\(/); // refreshed every frame
  });

  it('RenderPipeline raises needsUpdate itself for the only things its graph is built against', () => {
    const src = read('../../node_modules/three/src/renderers/common/RenderPipeline.js');
    const i = src.indexOf('_update()');
    const body = src.slice(i, i + 1200);
    // Tone mapping and output color space — nothing size-related.
    expect(body).toMatch(/this\._toneMapping !== this\.renderer\.toneMapping/);
    expect(body).toMatch(/this\._outputColorSpace !== this\.renderer\.outputColorSpace/);
    expect(body).toMatch(/this\.needsUpdate = true/);
  });

  it('our own resize() stays free — no needsUpdate, no rebuild', () => {
    const src = read('./PostPipeline.ts');
    const body = src.slice(src.indexOf('resize: ()'), src.indexOf('bloom: bloomPass'));
    expect(body).not.toMatch(/needsUpdate/);
  });
});
