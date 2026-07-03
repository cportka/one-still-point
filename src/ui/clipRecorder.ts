import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * A rolling video buffer of the last few seconds of the canvas — the source for the
 * Share button's clip. It continuously encodes the live view so that, at any moment, "the
 * previous ~5 seconds" is ready to share as a real **.mp4**.
 *
 * **Why WebCodecs, not MediaRecorder.** `MediaRecorder` can't produce mp4 on many browsers
 * (Chromium often only offers WebM), and macOS can't preview/AirDrop a WebM. So we encode
 * directly with a `VideoEncoder` and mux into an mp4 with `mp4-muxer`. This also gives us
 * what a rolling clip needs: explicit keyframes (so the buffer always begins on a decodable
 * frame), tiny retained chunks, and a correct duration written on finalize.
 *
 *   • Codec: **H.264** first (universally playable, incl. macOS preview/AirDrop); where the
 *     browser has no H.264 encoder (plain Chromium, which omits the proprietary codec) it
 *     falls back to **AV1** — still an .mp4, and playable on modern OSes (see `CODECS`).
 *   • A 720×720 offscreen canvas is the encode surface — each frame the main canvas is
 *     blitted in, centre-cropped to a square and scaled to 720p (clean for share sheets).
 *   • We keep a rolling window of encoded chunks back to the keyframe preceding ~5s ago, so
 *     a clip is always recent (it ends at ~now) and starts clean.
 *
 * Returns `null` (→ a still PNG) only when there's **no** H.264 *or* AV1 encoder, or WebCodecs
 * is missing. When a share still falls back to a PNG, the reason is on `status` (logged by the
 * Share path), so it's never a silent mystery.
 */
/** A diagnostic snapshot of the recorder — surfaced when a share falls back to a still,
 *  so it's clear *why* (no encoder, not buffered yet, no decoder config, …) instead of a
 *  silent PNG. Logged by the Share path; also handy from the `osp` console handle. */
export interface ClipStatus {
  started: boolean;
  dead: boolean;
  /** Why it died / can't produce a clip yet, if known. */
  reason: string | null;
  /** The H.264 profile that configured, if any. */
  codec: string | null;
  /** Whether the encoder has emitted the decoder config (avcC) — required to mux an mp4. */
  hasMeta: boolean;
  /** Buffered encoded chunks, and whether the window starts on a decodable keyframe. */
  frames: number;
  hasKeyframe: boolean;
  /** Age (ms) of the oldest buffered chunk — must reach MIN_SPAN_MS before a clip is offered. */
  oldestMs: number;
  ready: boolean;
}

export interface ClipRecorder {
  /** Begin buffering. Call once the intro is done, to keep the heavy intro frames clear. */
  start: () => void;
  /** Blit + encode the current frame. Call once per render frame (cheap — internally
   *  throttled to the capture rate). No-op until `start()` and the encoder is configured. */
  update: () => void;
  /** Mux the buffered window into a share-ready square **mp4** File that ends at ~now.
   *  Resolves `null` if nothing has buffered yet. */
  takeClip: () => Promise<File | null>;
  /** True once a recent clip is available (else the Share button uses a still). */
  readonly ready: boolean;
  /** A diagnostic snapshot — why a clip is / isn't available. */
  readonly status: ClipStatus;
  /** Stop encoding and release the buffer. */
  dispose: () => void;
}

const SIZE = 720; // 720×720 square
// Capture rate for the rolling share clip. Each captured frame is a `drawImage` off the live
// WebGPU canvas (a GPU→CPU read) plus a VideoEncoder.encode — real per-capture cost on the main
// thread, so on a phone a high rate shows up as a regular-cadence stutter. 20 fps is plenty for a
// short looping share clip and a third cheaper than 30. (The proper fix moves this into the render
// worker — see docs/offscreen-canvas.md.)
const FPS = 20;
const BITRATE = 5_000_000; // ~5 Mbps — plenty for 720p square
const WINDOW_MS = 5000; // keep ~the last 5 seconds
const KEYFRAME_MS = 1000; // force a keyframe ~every second (tight rolling-window start)
const MIN_SPAN_MS = 2000; // don't offer a clip until at least this much has buffered
// Codecs to try, in order. H.264 first (most universally playable — incl. macOS
// preview / AirDrop); then AV1 as a fallback for browser builds *without* the proprietary
// H.264 encoder (plain Chromium), which still mux into an .mp4 and play on modern OSes.
// `mux` is the mp4-muxer track codec. `realtime` biases the encoder toward speed: OFF for
// H.264 (the default/software path reliably emits the avcC decoder config the muxer needs —
// the realtime/hardware path frequently omits it), ON for AV1 (software libaom needs it to
// keep up at 30 fps, and it still emits av1C). Verified in Chromium: AV1 encodes ~6 ms/frame.
const CODECS: { codec: string; mux: 'avc' | 'av1'; realtime: boolean }[] = [
  { codec: 'avc1.4d0028', mux: 'avc', realtime: false }, // H.264 Main 4.0
  { codec: 'avc1.42001f', mux: 'avc', realtime: false }, // H.264 Baseline 3.1
  { codec: 'avc1.42e01e', mux: 'avc', realtime: false }, // H.264 Baseline 3.0
  { codec: 'av01.0.04M.08', mux: 'av1', realtime: true }, // AV1 Main, L4.0, 8-bit (fallback)
];

interface Entry {
  chunk: EncodedVideoChunk;
  t: number; // performance.now() when encoded — drives the rolling window
}

export function createClipRecorder(source: HTMLCanvasElement | OffscreenCanvas): ClipRecorder | null {
  // Need WebCodecs. (H.264 encoder support is checked async in start(); until then ready=false.)
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;

  // The encode surface: a DOM canvas on the main thread, an OffscreenCanvas inside the render
  // worker (step 5 — same recorder, both paths). Everything below (2d blit, VideoFrame, File)
  // is identical on either.
  let square: HTMLCanvasElement | OffscreenCanvas;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    square = c;
  } else {
    square = new OffscreenCanvas(SIZE, SIZE);
  }
  const ctx = square.getContext('2d', { alpha: false }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  ctx.fillStyle = '#05060a'; // the app's near-black, so a clip taken early isn't pure black
  ctx.fillRect(0, 0, SIZE, SIZE);

  let encoder: VideoEncoder | null = null;
  let meta: EncodedVideoChunkMetadata | null = null; // decoder config (avcC) from the encoder
  let buf: Entry[] = [];
  let started = false;
  let dead = false;
  let deadReason: string | null = null; // why we gave up (surfaced via `status` for diagnostics)
  let codecUsed: string | null = null; // the codec string that configured, if any
  let muxerCodec: 'avc' | 'av1' = 'avc'; // which mp4 track codec takeClip() should write
  let busy = false; // pause encoding while a clip is flushed + muxed
  let baseTs = 0;
  let lastBlit = 0;
  let lastKey = 0;

  // Drop chunks older than the window, but never below the keyframe that precedes the kept
  // span — so the buffer always begins on a decodable keyframe.
  const prune = (): void => {
    const cutoff = performance.now() - WINDOW_MS;
    let keep = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i]!.t > cutoff) break;
      if (buf[i]!.chunk.type === 'key') keep = i;
    }
    if (keep > 0) buf.splice(0, keep);
  };

  const start = (): void => {
    if (started || dead) return;
    started = true;
    void (async () => {
      try {
        let chosen: (typeof CODECS)[number] | null = null;
        for (const c of CODECS) {
          const cfg = { codec: c.codec, width: SIZE, height: SIZE, bitrate: BITRATE, framerate: FPS };
          if ((await VideoEncoder.isConfigSupported(cfg)).supported) {
            chosen = c;
            break;
          }
        }
        if (!chosen) {
          // No H.264 *or* AV1 encoder at all → the Share button uses a still PNG instead.
          dead = true;
          deadReason = 'no H.264/AV1 encoder (isConfigSupported was false for every codec)';
          return;
        }
        codecUsed = chosen.codec;
        muxerCodec = chosen.mux;
        encoder = new VideoEncoder({
          output: (chunk, m): void => {
            if (m?.decoderConfig) meta = m;
            buf.push({ chunk, t: performance.now() });
            prune();
          },
          error: (e: DOMException): void => {
            dead = true;
            deadReason = `VideoEncoder error: ${e.message || e.name}`;
            encoder = null;
          },
        });
        const config: VideoEncoderConfig = { codec: chosen.codec, width: SIZE, height: SIZE, bitrate: BITRATE, framerate: FPS };
        // See CODECS: realtime OFF for H.264 (so the software path emits avcC), ON for AV1.
        if (chosen.realtime) config.latencyMode = 'realtime';
        if (chosen.mux === 'avc') config.avc = { format: 'avc' }; // length-prefixed (avcC), as mp4-muxer wants
        encoder.configure(config);
        baseTs = performance.now();
      } catch (e) {
        dead = true;
        deadReason = `encoder setup threw: ${e instanceof Error ? e.message : String(e)}`;
      }
    })();
  };

  const update = (): void => {
    if (!started || dead || busy || !encoder || encoder.state !== 'configured') return;
    const now = performance.now();
    if (now - lastBlit < 1000 / FPS) return; // throttle to the capture rate
    lastBlit = now;
    const sw = source.width;
    const sh = source.height;
    if (sw === 0 || sh === 0) return;
    const s = Math.min(sw, sh); // centre-crop the drawing buffer to a square, scaled to 720
    ctx.drawImage(source, (sw - s) / 2, (sh - s) / 2, s, s, 0, 0, SIZE, SIZE);
    if (encoder.encodeQueueSize > 4) return; // backpressure: skip a frame if the encoder is behind
    const keyFrame = now - lastKey >= KEYFRAME_MS;
    if (keyFrame) lastKey = now;
    const frame = new VideoFrame(square, { timestamp: Math.max(0, Math.round((now - baseTs) * 1000)) });
    try {
      encoder.encode(frame, { keyFrame });
    } finally {
      frame.close(); // VideoFrames hold GPU memory — release immediately
    }
  };

  const takeClip = async (): Promise<File | null> => {
    if (!encoder || dead || !meta || buf.length === 0) return null;
    busy = true; // stop feeding frames while we flush + mux a clean snapshot
    try {
      await encoder.flush(); // drain pending frames so the clip ends at ~now
      const entries = buf.slice();
      const startIdx = entries.findIndex((e) => e.chunk.type === 'key');
      if (startIdx < 0) return null;
      const clip = entries.slice(startIdx);
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: muxerCodec, width: SIZE, height: SIZE },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset', // rebase the clip to start at t=0
      });
      for (let i = 0; i < clip.length; i++) muxer.addVideoChunk(clip[i]!.chunk, i === 0 ? meta : undefined);
      muxer.finalize();
      return new File([target.buffer], 'onestillpoint.mp4', { type: 'video/mp4' });
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };

  const isReady = (): boolean =>
    started &&
    !dead &&
    meta !== null &&
    buf.length > 0 &&
    buf.some((e) => e.chunk.type === 'key') &&
    performance.now() - buf[0]!.t >= MIN_SPAN_MS;

  return {
    start,
    update,
    takeClip,
    get ready(): boolean {
      return isReady();
    },
    get status(): ClipStatus {
      const oldestMs = buf.length > 0 ? performance.now() - buf[0]!.t : 0;
      return {
        started,
        dead,
        reason: deadReason,
        codec: codecUsed,
        hasMeta: meta !== null,
        frames: buf.length,
        hasKeyframe: buf.some((e) => e.chunk.type === 'key'),
        oldestMs: Math.round(oldestMs),
        ready: isReady(),
      };
    },
    dispose(): void {
      started = false;
      dead = true;
      try {
        encoder?.close();
      } catch {
        /* already closed */
      }
      encoder = null;
      buf = [];
    },
  };
}
