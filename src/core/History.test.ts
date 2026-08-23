import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Body } from '../scene/Body';
import { History } from './History';

function body(id: number, pos: Vector3, vel: Vector3, fixed = false): Body {
  return { id, type: 'star', mass: 1, lensMass: 0, fixed, position: pos, velocity: vel, radius: 1, color: new Vector3() };
}

describe('History', () => {
  it('records the movable bodies (the fixed primary is excluded)', () => {
    const h = new History(8);
    h.record([body(0, new Vector3(), new Vector3(), true), body(1, new Vector3(3, 0, 0), new Vector3(0, 1, 0))]);
    expect(h.length).toBe(1);
    const f = h.peek(0)!;
    expect(Array.from(f.ids)).toEqual([1]);
    expect(f.state[0]).toBe(3); // x
    expect(f.state[4]).toBe(1); // vy
  });

  it('restores a past frame (Float32-exact — snapshots are compact)', () => {
    const h = new History(8);
    const p = body(1, new Vector3(5, 0, 0), new Vector3(0, 0.2, 0));
    const bodies = [body(0, new Vector3(), new Vector3(), true), p];
    h.record(bodies);
    const past = h.peek(0)!;
    p.position.set(99, 99, 99); // drift away…
    p.velocity.set(1, 1, 1);
    expect(h.restore(past, bodies)).toBe(true); // …then scrub back
    expect(p.position.x).toBe(5);
    expect(p.velocity.y).toBeCloseTo(0.2, 6); // Float32 storage → ~1e-7
  });

  it('is a ring buffer: keeps only the last `capacity` frames', () => {
    const h = new History(4);
    const p = body(1, new Vector3(0, 0, 0), new Vector3());
    const bodies = [body(0, new Vector3(), new Vector3(), true), p];
    for (let i = 0; i < 10; i++) {
      p.position.x = i;
      h.record(bodies);
    }
    expect(h.length).toBe(4);
    expect(h.peek(0)!.state[0]).toBe(9); // most recent
    expect(h.peek(3)!.state[0]).toBe(6); // oldest still kept
    expect(h.peek(4)).toBeNull(); // evicted / out of range
  });

  /** Roster detection reuses two arrays and swaps them each recorded frame (no per-frame
   *  allocation on the hot path). Hammer that swap: a long identical run must not drift into a
   *  false change, and a real change straight afterwards must still be seen. */
  it('detects roster changes correctly across a long run of identical frames', () => {
    const h = new History();
    const primary = body(0, new Vector3(), new Vector3(), true);
    const a = body(1, new Vector3(1, 0, 0), new Vector3());
    const b = body(2, new Vector3(2, 0, 0), new Vector3());
    for (let i = 0; i < 200; i++) h.record([primary, a, b]);
    const g = h.currentGeneration;
    for (let i = 0; i < 200; i++) h.record([primary, a, b]);
    expect(h.currentGeneration).toBe(g); // 400 identical rosters → still one generation

    h.record([primary, a]); // b leaves — a shorter roster
    expect(h.currentGeneration).toBe(g + 1);
    h.record([primary, b]); // same length, different member
    expect(h.currentGeneration).toBe(g + 2);
    h.record([primary, b]);
    expect(h.currentGeneration).toBe(g + 2);
  });

  it('bumps the generation when the body set changes, and restore refuses across it', () => {
    const h = new History();
    const primary = body(0, new Vector3(), new Vector3(), true);
    const a = body(1, new Vector3(1, 0, 0), new Vector3());
    const b = body(2, new Vector3(2, 0, 0), new Vector3());
    h.record([primary, a]);
    const g1 = h.currentGeneration;
    h.record([primary, a]); // same set → same generation
    expect(h.currentGeneration).toBe(g1);
    h.record([primary, a, b]); // a body was added
    expect(h.currentGeneration).toBe(g1 + 1);
    // the 2-body frame must not be restored onto the 1-body set
    expect(h.restore(h.peek(0)!, [primary, a])).toBe(false);
  });

  it('clear() drops everything', () => {
    const h = new History(8);
    h.record([body(0, new Vector3(), new Vector3(), true), body(1, new Vector3(1, 0, 0), new Vector3())]);
    h.clear();
    expect(h.length).toBe(0);
    expect(h.peek(0)).toBeNull();
  });

  it('defaults to a ~2-minute scrub window', () => {
    expect(new History().capacity).toBe(7200); // ~2 min at 60 fps
  });

  it('tracks total frames recorded (monotonic) and the current-generation span', () => {
    const h = new History(8);
    const primary = body(0, new Vector3(), new Vector3(), true);
    const a = body(1, new Vector3(1, 0, 0), new Vector3());
    const b = body(2, new Vector3(2, 0, 0), new Vector3());
    h.record([primary, a]);
    h.record([primary, a]); // generation N, two frames
    expect(h.recorded).toBe(2);
    expect(h.restorableLength).toBe(2); // both restorable
    h.record([primary, a, b]); // a body was added → new generation
    h.record([primary, a, b]);
    expect(h.recorded).toBe(4); // monotonic
    expect(h.length).toBe(4);
    expect(h.restorableLength).toBe(2); // only the last two share the current layout
  });

  it('recorded counts past capacity; restorableLength never exceeds length', () => {
    const h = new History(4);
    const bodies = [body(0, new Vector3(), new Vector3(), true), body(1, new Vector3(), new Vector3())];
    for (let i = 0; i < 10; i++) h.record(bodies);
    expect(h.recorded).toBe(10); // monotonic, well past the 4-frame capacity
    expect(h.length).toBe(4);
    expect(h.restorableLength).toBe(4); // all the same generation
  });

  it('truncate() drops the newest frames and rewinds the live edge (and the monotonic counter)', () => {
    const h = new History(16);
    const a = body(1, new Vector3(0, 0, 0), new Vector3());
    const bodies = [body(0, new Vector3(), new Vector3(), true), a];
    for (let i = 0; i < 6; i++) {
      a.position.x = i;
      h.record(bodies); // x = 0..5
    }
    h.truncate(2); // discard x = 4, 5
    expect(h.length).toBe(4);
    expect(h.recorded).toBe(4); // rewound too, so event tags stay aligned to their frames
    expect(h.peek(0)!.state[0]).toBe(3); // the new live edge is the old x=3 frame
    expect(h.peek(3)!.state[0]).toBe(0); // the oldest is untouched
    expect(h.peek(4)).toBeNull(); // nothing beyond the rewound window
  });

  it('truncate() restores change-detection: re-adding a body after it opens a fresh generation', () => {
    const h = new History(16);
    const primary = body(0, new Vector3(), new Vector3(), true);
    const a = body(1, new Vector3(1, 0, 0), new Vector3());
    const b = body(2, new Vector3(2, 0, 0), new Vector3());
    h.record([primary, a]);
    h.record([primary, a]); // generation G, two frames (a only)
    const g = h.currentGeneration;
    h.record([primary, a, b]); // added b → generation G+1
    expect(h.currentGeneration).toBe(g + 1);
    h.truncate(1); // discard the (a, b) frame — back to the a-only layout at the edge
    expect(h.length).toBe(2);
    expect(h.currentGeneration).toBe(g); // generation restored to the new newest frame
    h.record([primary, a]); // same layout → no bump
    expect(h.currentGeneration).toBe(g);
    h.record([primary, a, b]); // re-adding b is detected (prevIds were restored) → a new generation
    expect(h.currentGeneration).toBe(g + 1);
  });

  it('truncate() is clamped: 0 is a no-op, and over-length empties it', () => {
    const h = new History(8);
    const bodies = [body(0, new Vector3(), new Vector3(), true), body(1, new Vector3(), new Vector3())];
    h.record(bodies);
    h.record(bodies);
    h.truncate(0); // no-op
    expect(h.length).toBe(2);
    expect(h.recorded).toBe(2);
    h.truncate(99); // more than recorded → empty
    expect(h.length).toBe(0);
    expect(h.peek(0)).toBeNull();
  });

  it('skips unborn bodies — a seeded body joins the recorded roster only once born', () => {
    const h = new History(8);
    const primary = body(0, new Vector3(), new Vector3(), true);
    const star = { ...body(1, new Vector3(5, 0, 0), new Vector3()), unborn: true };
    const bodies = [primary, star];
    h.record(bodies); // unborn → excluded from the snapshot
    expect(Array.from(h.peek(0)!.ids)).toEqual([]); // empty movable roster — absent on a rewind here
    const g0 = h.currentGeneration;
    star.unborn = false; // its creation tick fired (markBorn)
    h.record(bodies);
    expect(Array.from(h.peek(0)!.ids)).toEqual([1]); // now in the roster…
    expect(h.peek(0)!.state[0]).toBe(5);
    expect(h.currentGeneration).toBe(g0 + 1); // …and the birth reads as a roster change (new generation)
  });
});
