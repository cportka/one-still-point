// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  makeWatermarkSource,
  recordingFrameSize,
  WATERMARK_ICON_SRC,
  WATERMARK_TEXT,
  watermarkMetrics,
} from './watermark';

describe('recording watermark', () => {
  it('pins the brand text and a RASTER icon (Firefox refuses drawImage on a no-intrinsic-size SVG)', () => {
    expect(WATERMARK_TEXT).toBe('One Still Point');
    // public/favicon.svg has a viewBox but no width/height, so it cannot be the drawImage source.
    // The ?v=2 dodges HTTP caches still holding the pre-v0.100.3 bottom-cropped rasterization.
    expect(WATERMARK_ICON_SRC).toBe('/apple-touch-icon.png?v=2');
    expect(WATERMARK_ICON_SRC.includes('.svg')).toBe(false);
  });

  it('the output frame is display size × dpr, capped (dpr 2, long edge 1920) and even (H.264)', () => {
    // The iOS lesson: MediaRecorder locks the whole clip to the FIRST frame's size, so the frame
    // must come from the stable display size — never the scaler-dipped backing store.
    expect(recordingFrameSize(390, 659, 3)).toEqual({ w: 780, h: 1318 }); // iPhone: dpr capped at 2
    expect(recordingFrameSize(1920, 1080, 1)).toEqual({ w: 1920, h: 1080 }); // desktop passthrough
    expect(recordingFrameSize(2560, 1440, 2)).toEqual({ w: 1920, h: 1080 }); // long edge capped
    expect(recordingFrameSize(391, 659, 1).w % 2).toBe(0); // odd widths land even
    expect(recordingFrameSize(0, 0, 0)).toEqual({ w: 2, h: 2 }); // hard floor, never 0
  });

  it('metrics scale with the SHORT edge and floor for small captures', () => {
    expect(watermarkMetrics(1080, 1920)).toEqual(watermarkMetrics(1920, 1080)); // orientation-agnostic
    const m = watermarkMetrics(1920, 1080);
    expect(m.font).toBe(Math.round(1080 * 0.03));
    expect(m.icon).toBe(Math.round(m.font * 3.2)); // a real app-icon badge beside the text
    expect(m.gap).toBeGreaterThan(0);
    expect(m.pad).toBeGreaterThan(0);
  });

  it('the lockup NEVER overflows a narrow frame (the 140×234 iOS capture clipped to "…Point")', () => {
    // At the captured size the old floor-14px lockup was wider than the frame. The clamp must
    // shrink the font so text + gap + icon + both paddings fit inside the width.
    const m = watermarkMetrics(140, 234);
    const lockupPx = WATERMARK_TEXT.length * 0.62 * m.font + m.gap + m.icon + m.pad * 2;
    expect(lockupPx).toBeLessThanOrEqual(140);
    expect(m.font).toBeGreaterThanOrEqual(8); // still drawable, just small
    // A comfortable frame keeps the legibility floor instead.
    expect(watermarkMetrics(780, 1318).font).toBeGreaterThanOrEqual(14);
  });

  it('degrades to null where no 2D compositor exists (caller then records the bare canvas)', () => {
    // jsdom has no 2D context — the factory must fall back rather than throw.
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    expect(makeWatermarkSource(canvas)).toBeNull();
  });
});
