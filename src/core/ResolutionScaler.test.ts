import { describe, expect, it } from 'vitest';
import { ResolutionScaler } from './ResolutionScaler';

const feed = (s: ResolutionScaler, frameDelta: number, frames = 300): void => {
  for (let i = 0; i < frames; i++) s.update(frameDelta);
};

describe('ResolutionScaler', () => {
  it('drops resolution when frames run slower than the target', () => {
    const s = new ResolutionScaler();
    s.targetFps = 50;
    feed(s, 1 / 30); // a steady 30fps — well under target
    expect(s.scale).toBeLessThan(1);
    expect(s.scale).toBeGreaterThanOrEqual(s.minScale);
  });

  it('raises resolution back up when there is headroom', () => {
    const s = new ResolutionScaler();
    s.targetFps = 50;
    s.scale = 0.5;
    feed(s, 1 / 120); // plenty of headroom
    expect(s.scale).toBeGreaterThan(0.5);
  });

  it('respects the target: lenient at a low target, strict at a high one', () => {
    const lenient = new ResolutionScaler();
    lenient.targetFps = 40;
    feed(lenient, 1 / 45); // 45fps clears a 40 target
    expect(lenient.scale).toBe(1);

    const strict = new ResolutionScaler();
    strict.targetFps = 50;
    feed(strict, 1 / 45); // 45fps misses a 50 target
    expect(strict.scale).toBeLessThan(1);
  });

  it('renders at full resolution when auto-scaling is disabled', () => {
    const s = new ResolutionScaler();
    s.enabled = false;
    s.scale = 0.5;
    s.update(1 / 10); // even a terrible frame shouldn't lower it
    expect(s.scale).toBe(s.maxScale);
  });

  it('converges and then stops resizing at steady state (no thrash)', () => {
    const s = new ResolutionScaler();
    s.targetFps = 50;
    s.scale = 0.7;
    feed(s, 1 / 50, 400); // ~8 s right at the target → it should settle and hold 0.7

    // Now jitter around the target. A hunting scaler would resize every cooldown forever; a
    // converged one tolerates the jitter and barely moves (each move is an expensive GPU rebuild).
    let changes = 0;
    let prev = s.scale;
    for (let i = 0; i < 600; i++) {
      s.update(i % 2 === 0 ? 1 / 44 : 1 / 56); // ~50 fps with ±6 fps jitter
      if (s.scale !== prev) {
        changes += 1;
        prev = s.scale;
      }
    }
    expect(changes).toBeLessThanOrEqual(1); // settled → no continuous up/down resizing
  });

  it('resetSmoothing forgets a heavy backlog so a fresh cheap scale climbs back, not down', () => {
    const s = new ResolutionScaler();
    s.targetFps = 50;
    feed(s, 1 / 20, 40); // slow 20fps frames build a heavy EMA and push the scale down
    expect(s.scale).toBeLessThan(1); // sanity: the backlog really did drag it down
    // The intro reveal drops to a cheaper scale; with the backlog forgotten, the now-light
    // (fast) frames climb the scale back up instead of the stale history dragging it lower.
    s.scale = 0.45;
    s.resetSmoothing();
    feed(s, 1 / 120, 300);
    expect(s.scale).toBeGreaterThan(0.45);
  });
});

/**
 * The reveal hold. `resetSmoothing()` clears the cooldown so the climb-back starts clean, but the
 * frames right after the loop starts are artificially cheap — the disk ignites over the first
 * ~0.65 s and the buffer is at the intro's deep cut — so the EMA dips below `fastLimit` within a
 * few frames and the scaler climbs on headroom that isn't real. A cold-load trace caught the first
 * resize at 115 ms, before the disk had lit, and every one of its 14 janks fell in a burst behind
 * one of three such resizes.
 */
describe('ResolutionScaler.hold (the reveal window)', () => {
  const fastFrame = 1 / 120; // plenty of (false) headroom

  const climbing = (): ResolutionScaler => {
    const s = new ResolutionScaler();
    s.scale = 0.22; // the intro deep cut
    s.minScale = 0.22;
    s.maxScale = 1;
    s.resetSmoothing();
    return s;
  };

  it('climbs on cheap frames when NOT held — the behaviour the trace caught', () => {
    const s = climbing();
    let resized = false;
    for (let i = 0; i < 40 && !resized; i++) resized = s.update(fastFrame);
    expect(resized).toBe(true);
    expect(s.scale).toBeGreaterThan(0.22);
  });

  it('stays perfectly still for the whole hold, however cheap the frames look', () => {
    const s = climbing();
    s.hold(1.6);
    let resizes = 0;
    for (let i = 0; i < 1.6 / fastFrame; i++) if (s.update(fastFrame)) resizes += 1;
    expect(resizes).toBe(0);
    expect(s.scale).toBe(0.22);
    expect(s.holding).toBe(true);
  });

  it('resumes climbing once the hold expires', () => {
    const s = climbing();
    s.hold(0.5);
    for (let i = 0; i < 0.5 / fastFrame + 2; i++) s.update(fastFrame);
    expect(s.holding).toBe(false);
    let resized = false;
    for (let i = 0; i < 200 && !resized; i++) resized = s.update(fastFrame);
    expect(resized).toBe(true);
    expect(s.scale).toBeGreaterThan(0.22);
  });

  it('keeps the EMA warm while held, so the first decision after it uses real frame times', () => {
    const held = climbing();
    held.hold(0.5);
    // Held through a stretch of genuinely SLOW frames: when the hold lifts it must know it is
    // slow, and not climb off a stale seed.
    for (let i = 0; i < 0.5 / 0.05 + 2; i++) held.update(0.05); // 50 ms frames
    expect(held.holding).toBe(false);
    let resized = false;
    for (let i = 0; i < 5; i++) resized = held.update(0.05) || resized;
    // It may drop (it is genuinely slow), but it must never climb.
    expect(held.scale).toBeLessThanOrEqual(0.22);
  });

  it('hold() extends rather than shortens an existing hold', () => {
    const s = climbing();
    s.hold(1.6);
    s.hold(0.2); // a shorter request must not cut the reveal hold short
    for (let i = 0; i < 0.5 / fastFrame; i++) s.update(fastFrame);
    expect(s.holding).toBe(true);
  });

  it('resetSmoothing() does not clear a hold — the reveal arms both together', () => {
    const s = climbing();
    s.hold(1.6);
    s.resetSmoothing();
    expect(s.holding).toBe(true);
    let resizes = 0;
    for (let i = 0; i < 60; i++) if (s.update(fastFrame)) resizes += 1;
    expect(resizes).toBe(0);
  });
});
