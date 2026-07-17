// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST_ROLL_MS, PRE_ROLL_MS, RecordTen, type RecorderLike } from './recordTen';

/** A scripted MediaRecorder: emits one payload chunk (its own id) when stopped. */
class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive';
  ondataavailable: RecorderLike['ondataavailable'] = null;
  onstop: RecorderLike['onstop'] = null;
  onerror: RecorderLike['onerror'] = null;
  constructor(public readonly id: number) {}
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    // Data only reaches whoever still listens — a discarded (re-armed) take has been unhooked.
    this.ondataavailable?.({ data: new Blob([`take-${this.id}`]) });
    this.onstop?.();
  }
}

const COUNT_FROM = POST_ROLL_MS / 1000; // 19 with the 20 s clip

describe('RecordTen (rolling pre-roll + counted take)', () => {
  it('the v0.99.0 release claim holds: ~20 s clip = 1 s pre-roll + 19 counted seconds', () => {
    // Pinned literally — the ladder test below derives from the constant, so without this a
    // regression back to 9 s (or a typo to 190 s) would pass the whole suite.
    expect(PRE_ROLL_MS).toBe(1000);
    expect(POST_ROLL_MS).toBe(19_000);
  });
  let made: FakeRecorder[];
  let ticks: number[];
  let done: Array<File | null>;
  let engine: RecordTen;

  const build = (createRecorder: () => RecorderLike | null = () => {
    const r = new FakeRecorder(made.length);
    made.push(r);
    return r;
  }): RecordTen =>
    new RecordTen({
      createRecorder,
      mime: 'video/mp4;codecs=avc1.42E01E',
      onTick: (s) => ticks.push(s),
      onDone: (f) => done.push(f),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    made = [];
    ticks = [];
    done = [];
  });
  afterEach(() => {
    engine?.cancel();
    vi.useRealTimers();
  });

  it('while armed, the live take is restarted every second — at most ~1 s is ever held', () => {
    engine = build();
    expect(engine.arm()).toBe(true);
    expect(made.length).toBe(1);
    vi.advanceTimersByTime(PRE_ROLL_MS * 3);
    expect(made.length).toBe(4); // three re-arms
    expect(made[3]!.state).toBe('recording'); // only the newest lives…
    expect(made[0]!.state).toBe('inactive'); // …the rest were stopped + discarded
  });

  it('begin() keeps the current (≤1 s old) take as the clip opening and counts the full ladder to 0', async () => {
    engine = build();
    engine.arm();
    vi.advanceTimersByTime(PRE_ROLL_MS + 400); // one re-arm, then 0.4 s of pre-roll on take #1
    engine.begin();
    expect(ticks[0]).toBe(COUNT_FROM);
    vi.advanceTimersByTime(POST_ROLL_MS);
    expect(ticks).toEqual(Array.from({ length: COUNT_FROM + 1 }, (_, i) => COUNT_FROM - i));
    expect(made.length).toBe(2); // no re-arms after begin
    expect(done.length).toBe(1);
    const file = done[0]!;
    expect(file.name).toBe('onestillpoint.mp4'); // mp4-preferred naming
    expect(file.type).toBe('video/mp4');
    // Exactly the live take's payload — the discarded take-0 never leaks into the clip.
    await expect(file.text()).resolves.toBe('take-1');
  });

  it('a WebM mime names the file .webm', () => {
    engine = new RecordTen({
      createRecorder: () => {
        const r = new FakeRecorder(made.length);
        made.push(r);
        return r;
      },
      mime: 'video/webm;codecs=vp9',
      onTick: (s) => ticks.push(s),
      onDone: (f) => done.push(f),
    });
    engine.arm();
    engine.begin();
    vi.advanceTimersByTime(POST_ROLL_MS);
    expect(done[0]!.name).toBe('onestillpoint.webm');
    expect(done[0]!.type).toBe('video/webm');
  });

  it('cancel() while armed stops the recorder and never reports a clip', () => {
    engine = build();
    engine.arm();
    vi.advanceTimersByTime(PRE_ROLL_MS * 2);
    engine.cancel();
    expect(made.every((r) => r.state === 'inactive')).toBe(true);
    vi.advanceTimersByTime(PRE_ROLL_MS * 5); // no zombie re-arms
    expect(made.length).toBe(3);
    expect(done.length).toBe(0);
  });

  it('the platform refusing a recorder mid-arm fails the take once (onDone null)', () => {
    let allow = true;
    engine = build(() => {
      if (!allow) return null;
      const r = new FakeRecorder(made.length);
      made.push(r);
      return r;
    });
    engine.arm();
    allow = false;
    vi.advanceTimersByTime(PRE_ROLL_MS); // the next re-arm fails
    expect(done).toEqual([null]);
    vi.advanceTimersByTime(PRE_ROLL_MS * 5);
    expect(done.length).toBe(1); // …exactly once
  });
});
