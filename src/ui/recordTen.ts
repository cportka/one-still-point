/**
 * The "Record video" engine behind the Share modal's video pathway.
 *
 * The trick the UX wants: the clip opens on the moment *before* the user clicked
 * "Start Record" — the moment that made them reach for the button. A `MediaRecorder`
 * stream can't be trimmed after the fact (chunks only decode from the start), so instead of
 * one long recording we keep a **rolling arm**: while the red button is waiting, the live
 * recorder is restarted every second, discarding the stopped one's data. At any instant the
 * running recorder therefore holds at most ~1 s of footage. Clicking Start simply *stops
 * restarting* — the current recorder keeps going for 19 more counted seconds and its whole
 * take (0–1 s of pre-roll + 19 s counted down) becomes the ~20 s clip — long enough that a
 * whole black-hole plunge fits with padding — mp4 where the browser's MediaRecorder speaks
 * H.264, WebM otherwise (see `CLIP_MIME_PREFS` in recordClip.ts).
 *
 * The class is pure orchestration over an injected recorder factory + clock so the whole
 * arm/re-arm/countdown/stop dance is unit-testable without a real MediaRecorder.
 */

/** The slice of MediaRecorder this engine drives (injectable for tests). */
export interface RecorderLike {
  state: 'inactive' | 'recording' | 'paused';
  start(): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface RecordTenOpts {
  /** Build a fresh recorder over the (shared) capture stream, or null if the platform can't. */
  createRecorder: () => RecorderLike | null;
  /** The chosen MIME (drives the file extension); from `bestClipMime()`. */
  mime: string;
  /** Countdown tick while recording: 19, 18, … 1, 0 (one per second). */
  onTick: (secondsLeft: number) => void;
  /** The finished ~20 s clip (or null if recording failed). Fires once. */
  onDone: (file: File | null) => void;
}

/** Re-arm cadence while waiting — the live recorder never holds more than this much pre-roll. */
export const PRE_ROLL_MS = 1000;
/** Counted-down recording time after Start (pre-roll + this ≈ the 20 s clip — a black-hole
 *  plunge runs a few seconds past the old 10, so the count gives it padding). */
export const POST_ROLL_MS = 19_000;

export class RecordTen {
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private rearmTimer = 0;
  private tickTimer = 0;
  private phase: 'idle' | 'armed' | 'recording' | 'done' = 'idle';
  // Once the user cancels, NO clip ever ships — even a cancel during the async "Saving…" window
  // (after the countdown hit 0 and finish() set phase='done', while onstop is still flushing).
  // Without this, cancel() early-returned on phase==='done' and the pending onstop still fired
  // onDone → the "Cancel recording" × silently shared/downloaded the take anyway.
  private cancelled = false;

  constructor(private readonly opts: RecordTenOpts) {}

  /** Enter the rolling arm: a live recorder, restarted every second until {@link begin}. */
  arm(): boolean {
    if (this.phase !== 'idle') return this.phase === 'armed';
    if (!this.spinUp()) return false;
    this.phase = 'armed';
    this.rearmTimer = window.setInterval(() => this.spinUp(), PRE_ROLL_MS);
    return true;
  }

  /** Start the counted recording — the current (≤1 s old) take becomes the clip's opening. */
  begin(): void {
    if (this.phase !== 'armed') return;
    this.phase = 'recording';
    window.clearInterval(this.rearmTimer);
    let left = Math.round(POST_ROLL_MS / 1000);
    this.opts.onTick(left);
    this.tickTimer = window.setInterval(() => {
      left -= 1;
      this.opts.onTick(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(this.tickTimer);
        this.finish();
      }
    }, 1000);
  }

  /** Abandon everything (leaving record mode, page teardown). Safe in any phase — including the
   *  async "Saving…" window after the countdown hits 0, where finish() has already set phase
   *  'done' and is awaiting onstop. `teardownRecorder(true)` detaches that pending onstop, so a
   *  take the user cancelled mid-save never reaches onDone (→ shareOrDownload). */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.phase = 'done';
    window.clearInterval(this.rearmTimer);
    window.clearInterval(this.tickTimer);
    this.teardownRecorder(true);
  }

  /** (Re)start a fresh recorder, discarding whatever the previous one held. */
  private spinUp(): boolean {
    this.teardownRecorder(true);
    const r = this.opts.createRecorder();
    if (!r) {
      // The platform refused mid-arm (e.g. the GPU canvas went away) — fail the whole take.
      if (this.phase === 'armed' || this.phase === 'recording') this.fail();
      return false;
    }
    this.chunks = [];
    r.ondataavailable = (e): void => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    r.onerror = (): void => {
      if (this.phase === 'recording') this.fail();
    };
    try {
      r.start();
    } catch {
      if (this.phase === 'armed' || this.phase === 'recording') this.fail();
      return false;
    }
    this.recorder = r;
    return true;
  }

  /** Stop the live recorder; once its data has flushed, hand back the clip File. */
  private finish(): void {
    if (this.cancelled) return; // cancelled between the last tick and here — ship nothing
    const r = this.recorder;
    this.phase = 'done';
    if (!r) {
      this.opts.onDone(null);
      return;
    }
    r.onstop = (): void => {
      this.recorder = null;
      if (this.cancelled) return; // a cancel during the flush wins — no clip ships
      const ext = this.opts.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      const type = this.opts.mime.split(';')[0]!;
      this.opts.onDone(
        this.chunks.length > 0 ? new File(this.chunks, `onestillpoint.${ext}`, { type }) : null,
      );
    };
    try {
      if (r.state !== 'inactive') r.stop();
      else r.onstop?.();
    } catch {
      this.opts.onDone(null);
    }
  }

  private fail(): void {
    this.phase = 'done';
    window.clearInterval(this.rearmTimer);
    window.clearInterval(this.tickTimer);
    this.teardownRecorder(true);
    this.opts.onDone(null);
  }

  private teardownRecorder(discard: boolean): void {
    const r = this.recorder;
    this.recorder = null;
    if (!r) return;
    if (discard) {
      r.ondataavailable = null;
      r.onstop = null;
      r.onerror = null;
    }
    try {
      if (r.state !== 'inactive') r.stop();
    } catch {
      /* already gone */
    }
  }
}
