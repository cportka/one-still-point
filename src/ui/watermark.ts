/**
 * The recording watermark: "One Still Point" + the still mark, top-right of the clip.
 *
 * `MediaRecorder` eats a canvas stream, so the watermark must live IN the pixels — a DOM overlay
 * would never reach the recording. `makeWatermarkSource` returns a composite canvas that mirrors
 * the live render canvas frame-by-frame (a rAF `drawImage` loop — the same copy the screenshot
 * path already proves works on the WebGPU canvas) with the watermark drawn on top; the record
 * path captureStreams THIS canvas instead of the raw one. Screenshots stay clean (the preview /
 * PNG path reads the raw canvas as before), and where a 2D compositor isn't available (jsdom, an
 * exotic placeholder canvas) the caller falls back to recording the bare canvas.
 *
 * The icon is the raster app icon, NOT the SVG mark: `public/favicon.svg` carries a viewBox but
 * no width/height, and Firefox refuses to `drawImage` an SVG with no intrinsic size. The 180px
 * `apple-touch-icon.png` is the same still mark and rasterizes cleanly at badge size everywhere.
 */

export const WATERMARK_TEXT = 'One Still Point';
/** The served still mark (raster; assets/logo.svg is the canonical vector). */
export const WATERMARK_ICON_SRC = '/apple-touch-icon.png';

/**
 * Layout for a w×h frame: font/icon/padding scale with the frame's short edge (so portrait and
 * landscape captures read the same), floored so a small capture stays legible. The text sits
 * left of the icon — "One Still Point" with the mark to its right — tucked into the top-right.
 * Pure — unit-tested.
 */
export function watermarkMetrics(w: number, h: number): { font: number; icon: number; gap: number; pad: number } {
  const base = Math.min(w, h);
  const font = Math.max(14, Math.round(base * 0.03));
  return {
    font,
    icon: Math.round(font * 1.6), // the badge reads slightly taller than the text line
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

  const icon = new Image();
  let iconReady = false;
  icon.onload = (): void => {
    iconReady = true;
  };
  icon.src = WATERMARK_ICON_SRC;

  let broken = false;
  const draw = (): void => {
    const w = source.width;
    const h = source.height;
    if (!w || !h) return;
    if (composite.width !== w || composite.height !== h) {
      composite.width = w;
      composite.height = h;
    }
    try {
      ctx.drawImage(source, 0, 0);
    } catch {
      broken = true;
      return;
    }
    const m = watermarkMetrics(w, h);
    ctx.save();
    // The app's own face (the panel/HUD monospace stack) so the clip reads as the site.
    ctx.font = `600 ${m.font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'; // legible over a bright disk or a white flash
    ctx.shadowBlur = m.font * 0.4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    const cy = m.pad + m.icon / 2; // text centred on the badge's vertical middle
    if (iconReady) {
      ctx.drawImage(icon, w - m.pad - m.icon, m.pad, m.icon, m.icon); // the mark, far right
      ctx.fillText(WATERMARK_TEXT, w - m.pad - m.icon - m.gap, cy); // text to its LEFT (icon right of text)
    } else {
      ctx.fillText(WATERMARK_TEXT, w - m.pad, cy); // icon still decoding — text alone, right-flush
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
