/**
 * The recording watermark: "One Still Point" + the still mark, top-right of the clip.
 *
 * `MediaRecorder` eats a canvas stream, so the watermark must live IN the pixels — a DOM overlay
 * would never reach the recording. `makeWatermarkSource` returns a composite canvas that mirrors
 * the live render canvas (a rAF `drawImage` loop — the same copy the screenshot path already
 * proves works on the WebGPU canvas) with the watermark drawn on top; the record path
 * captureStreams THIS canvas instead of the raw one. Screenshots stay clean.
 *
 * THE OUTPUT FRAME IS FIXED AT CREATION — the first on-device clip (iOS, v0.100.0) proved why:
 * the render canvas's backing store is the resolution scaler's live playground (the iPhone
 * capture ran at 140×234), iOS MediaRecorder locks the whole recording to the FIRST frame's
 * size, and a composite that tracked the backing store re-laid the watermark out at every
 * scaler move — a tiny clip whose watermark jumped between sizes and clipped "One Still Point"
 * down to "…Point". So: the composite locks to the canvas's DISPLAY size × devicePixelRatio
 * (capped) once, every source frame is cover-fit scaled into it (the same upscale CSS performs
 * on screen, so the clip matches the live view), and the watermark is laid out exactly once,
 * with a width clamp so the lockup can never overflow a narrow frame.
 *
 * The icon is the raster app icon, NOT the SVG mark: `public/favicon.svg` carries a viewBox but
 * no width/height, and Firefox refuses to `drawImage` an SVG with no intrinsic size. The 180px
 * `apple-touch-icon.png` is the same still mark and rasterizes cleanly at badge size. Its slot
 * is RESERVED from frame one, so the text never shifts when the icon finishes decoding.
 */

export const WATERMARK_TEXT = 'One Still Point';
/** The served still mark (raster; assets/logo.svg is the canonical vector). The `?v=2` skips
 *  HTTP caches still holding the pre-v0.100.3 bottom-cropped rasterization of this file. */
export const WATERMARK_ICON_SRC = '/apple-touch-icon.png?v=2';

/**
 * The fixed output frame for a canvas displayed at cssW×cssH: full display resolution with the
 * devicePixelRatio capped at 2 (encode cost), the long edge capped at 1920 (MediaRecorder
 * bitrate sanity), and even dimensions (H.264 requires them). Pure — unit-tested.
 */
export function recordingFrameSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const d = Math.min(Math.max(dpr || 1, 1), 2);
  let w = Math.round(cssW * d);
  let h = Math.round(cssH * d);
  const long = Math.max(w, h);
  if (long > 1920) {
    const k = 1920 / long;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  w -= w % 2;
  h -= h % 2;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

/**
 * Watermark layout for a FIXED w×h frame: font/icon/padding scale with the short edge, floored
 * for legibility — then clamped so the whole lockup (text + gap + icon + both paddings, in
 * monospace ems) stays inside ~92% of the frame width. Without the clamp, a narrow frame
 * clipped "One Still Point" off the left edge to "…Point" (the iOS capture). Pure — unit-tested.
 */
export function watermarkMetrics(w: number, h: number): { font: number; icon: number; gap: number; pad: number } {
  const base = Math.min(w, h);
  let font = Math.max(14, Math.round(base * 0.03));
  // Monospace advance ≈ 0.62em/char; the lockup in ems: text + gap (0.55) + icon (3.2) + pads.
  const lockupEms = WATERMARK_TEXT.length * 0.62 + 0.55 + 3.2 + 0.9 * 2;
  const maxFont = Math.floor((w * 0.92) / lockupEms);
  if (font > maxFont) font = Math.max(8, maxFont);
  return {
    font,
    icon: Math.round(font * 3.2), // a real app-icon badge — 2.1× still read too small on device (v0.100.2)
    gap: Math.round(font * 0.55),
    pad: Math.round(font * 0.9),
  };
}

/**
 * Build the watermarked mirror of `source`. Returns null where compositing can't work (no 2D
 * context, or the very first frame copy throws — e.g. a worker placeholder canvas the browser
 * refuses as an image source); the caller then records the bare canvas, same as before.
 */
export function makeWatermarkSource(
  source: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; dispose: () => void } | null {
  const composite = document.createElement('canvas');
  const ctx = composite.getContext('2d');
  if (!ctx) return null;

  // Lock the frame NOW (see the header) — display size first, backing store as the fallback
  // where layout hasn't happened, and a hard floor so a zero-size moment can't stick.
  const cssW = source.clientWidth || source.width || 640;
  const cssH = source.clientHeight || source.height || 360;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const { w: W, h: H } = recordingFrameSize(cssW, cssH, dpr);
  composite.width = W;
  composite.height = H;
  const m = watermarkMetrics(W, H); // laid out ONCE — never re-derived mid-clip

  const icon = new Image();
  let iconReady = false;
  icon.onload = (): void => {
    iconReady = true;
  };
  icon.src = WATERMARK_ICON_SRC;

  let broken = false;
  const draw = (): void => {
    const sw = source.width;
    const sh = source.height;
    if (!sw || !sh) return; // keep the last good frame
    try {
      // Cover-fit: fill the fixed frame whatever the scaler has done to the backing store.
      const k = Math.max(W / sw, H / sh);
      ctx.drawImage(source, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    } catch {
      broken = true;
      return;
    }
    ctx.save();
    // The app's own face (the panel/HUD monospace stack) so the clip reads as the site.
    ctx.font = `600 ${m.font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // legible over a bright disk or a white flash
    ctx.shadowBlur = m.font * 0.4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const cy = m.pad + m.icon / 2; // text centred on the badge's vertical middle
    // The icon's slot is reserved whether or not it has decoded — the text NEVER shifts.
    ctx.fillText(WATERMARK_TEXT, W - m.pad - m.icon - m.gap, cy);
    if (iconReady) {
      const ix = W - m.pad - m.icon;
      ctx.drawImage(icon, ix, m.pad, m.icon, m.icon);
      if (typeof ctx.roundRect === 'function') {
        // A hairline rim lifts the dark tile off dark space (matches the tile's 10% corner).
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = Math.max(1, m.font / 14);
        ctx.beginPath();
        ctx.roundRect(ix + 0.5, m.pad + 0.5, m.icon - 1, m.icon - 1, m.icon * 0.1);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  draw();
  if (broken) return null; // this canvas can't be copied — record it bare instead

  let raf = 0;
  const loop = (): void => {
    draw();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return {
    canvas: composite,
    dispose: (): void => cancelAnimationFrame(raf),
  };
}
