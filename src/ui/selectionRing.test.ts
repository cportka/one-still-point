// @vitest-environment jsdom
import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSelectionRing, ringFor } from './selectionRing';

// The selection ring reuses the same world→screen projection as pickBody, so these lock the
// projection: a body at the look-at point lands at screen centre, a body behind the camera is
// culled, and a nearer body projects a larger ring than a farther one.
describe('selectionRing.ringFor', () => {
  const cam = (): PerspectiveCamera => {
    const c = new PerspectiveCamera(60, 1, 0.1, 1000);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  };

  it('projects a body at the look-at point to screen centre', () => {
    const p = ringFor(cam(), new Vector3(0, 0, 0), 1, 200, 100);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(100, 1); // centre x = cssW / 2
    expect(p!.y).toBeCloseTo(50, 1); // centre y = cssH / 2
    expect(p!.r).toBeGreaterThan(0); // a positive projected radius
  });

  it('returns null for a body behind the camera', () => {
    // Camera at z = 10 looking toward the origin; a body at z = 20 sits behind it.
    expect(ringFor(cam(), new Vector3(0, 0, 20), 1, 200, 100)).toBeNull();
  });

  it('projects a nearer body to a larger ring than a farther one', () => {
    const near = ringFor(cam(), new Vector3(0, 0, 5), 1, 200, 100); // 5 units away
    const far = ringFor(cam(), new Vector3(0, 0, -5), 1, 200, 100); // 15 units away
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.r).toBeGreaterThan(far!.r);
  });
});

/** A recording stand-in for the 2D context jsdom doesn't implement. */
function stubCanvas2D(): { clears: () => number; strokes: () => number } {
  let clears = 0;
  let strokes = 0;
  const ctx = {
    clearRect: () => { clears += 1; },
    stroke: () => { strokes += 1; },
    setTransform: () => {},
    save: () => {}, restore: () => {}, beginPath: () => {}, arc: () => {},
    lineWidth: 0, strokeStyle: '', shadowColor: '', shadowBlur: 0, globalAlpha: 1,
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { clears: () => clears, strokes: () => strokes };
}

/**
 * The overlay is a full-viewport canvas sitting above the scene, and for the whole 6.5 s intro
 * (and most of a normal session) it has nothing to draw — main.ts passes nulls until
 * `formation.done`. Clearing it anyway marks the compositor layer dirty and forces a
 * full-viewport re-upload every frame, which is real main-thread cost landing right on the
 * reveal. Idle frames must touch the canvas exactly zero times.
 */
describe('selectionRing idle frames', () => {
  afterEach(() => vi.restoreAllMocks());

  const cam = (): PerspectiveCamera => {
    const c = new PerspectiveCamera(60, 1, 0.1, 1000);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  };
  const body = (): { position: Vector3; radius: number } => ({ position: new Vector3(0, 0, 0), radius: 1 });

  it('never touches the canvas while nothing is selected or hovered', () => {
    const rec = stubCanvas2D();
    const ring = createSelectionRing();
    ring.resize(1280, 720, 2);
    for (let i = 0; i < 120; i++) ring.draw(cam(), null, null, i * 16);
    expect(rec.clears()).toBe(0); // 120 reveal-window frames, zero full-viewport clears
    expect(rec.strokes()).toBe(0);
  });

  it('paints while something is selected', () => {
    const rec = stubCanvas2D();
    const ring = createSelectionRing();
    ring.resize(1280, 720, 2);
    ring.draw(cam(), body(), null, 0);
    expect(rec.clears()).toBe(1);
    expect(rec.strokes()).toBeGreaterThan(0);
  });

  it('wipes the last ring exactly once when the selection is dropped, then goes quiet', () => {
    const rec = stubCanvas2D();
    const ring = createSelectionRing();
    ring.resize(1280, 720, 2);
    ring.draw(cam(), body(), null, 0); // paints
    const afterPaint = rec.clears();
    ring.draw(cam(), null, null, 16); // one wipe
    expect(rec.clears()).toBe(afterPaint + 1);
    for (let i = 0; i < 30; i++) ring.draw(cam(), null, null, 32 + i * 16);
    expect(rec.clears()).toBe(afterPaint + 1); // and nothing after that
  });

  it('a resize re-blanks the canvas, so the next idle frame stays quiet', () => {
    const rec = stubCanvas2D();
    const ring = createSelectionRing();
    ring.resize(1280, 720, 2);
    ring.draw(cam(), body(), null, 0);
    ring.resize(1024, 640, 2); // reallocating the backing store clears it
    const after = rec.clears();
    ring.draw(cam(), null, null, 16);
    expect(rec.clears()).toBe(after);
  });
});
