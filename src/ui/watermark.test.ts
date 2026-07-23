// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makeWatermarkSource, WATERMARK_ICON_SRC, WATERMARK_TEXT, watermarkMetrics } from './watermark';

describe('recording watermark', () => {
  it('pins the brand text and a RASTER icon (Firefox refuses drawImage on a no-intrinsic-size SVG)', () => {
    expect(WATERMARK_TEXT).toBe('One Still Point');
    // public/favicon.svg has a viewBox but no width/height, so it cannot be the drawImage source.
    expect(WATERMARK_ICON_SRC).toBe('/apple-touch-icon.png');
    expect(WATERMARK_ICON_SRC.endsWith('.svg')).toBe(false);
  });

  it('metrics scale with the SHORT edge and floor for small captures', () => {
    // A small capture floors at 14px so the text stays legible.
    expect(watermarkMetrics(320, 240).font).toBe(14);
    // Portrait and landscape of the same frame agree (short-edge driven).
    expect(watermarkMetrics(1080, 1920)).toEqual(watermarkMetrics(1920, 1080));
    // A desktop-scale capture grows with it.
    const m = watermarkMetrics(1920, 1080);
    expect(m.font).toBe(Math.round(1080 * 0.03));
    expect(m.icon).toBeGreaterThan(m.font); // the badge reads taller than the text line
    expect(m.gap).toBeGreaterThan(0);
    expect(m.pad).toBeGreaterThan(0);
  });

  it('degrades to null where no 2D compositor exists (caller then records the bare canvas)', () => {
    // jsdom has no 2D context — the factory must fall back rather than throw.
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    expect(makeWatermarkSource(canvas)).toBeNull();
  });
});
