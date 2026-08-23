/**
 * Drawing-buffer sizing, shared by the main-thread and worker render paths.
 *
 * Resizing is the most expensive thing the engine does short of a shader compile. One
 * `renderer.setSize()` makes the next render **dispose and reallocate** the bloom chain's eleven
 * render targets plus the HDR pass target *and its depth texture*, and the post pipeline's
 * `resize()` dirties the pipeline, which re-wraps the entire output node graph and rebuilds the
 * composite quad's material. That is a real, visible hitch on a phone.
 *
 * It is also, often, unnecessary. The adaptive `ResolutionScaler` climbs back toward native during
 * the reveal under a *continuously ramping* ceiling, so it asks for a resize repeatedly — and a
 * viewport event, a quality change and the intro's own scale arm can each ask again. Once those
 * requests round to the same integer buffer size, everything above is pure waste. `SizeLatch` is
 * the guard: ask it, and only pay when the size genuinely moved.
 */

/** The integer drawing-buffer size for a CSS viewport at a DPR cap and a render scale. */
export function drawingBufferSize(
  cssW: number,
  cssH: number,
  dprCap: number,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.floor(cssW * dprCap * scale)),
    h: Math.max(1, Math.floor(cssH * dprCap * scale)),
  };
}

/** Remembers the last committed size and reports whether a new one differs. */
export class SizeLatch {
  private w = -1;
  private h = -1;

  /**
   * Latch `w × h`. Returns true when it differs from the last committed size — i.e. when the
   * caller must actually do the expensive work. A first call always commits.
   */
  commit(w: number, h: number): boolean {
    if (w === this.w && h === this.h) return false;
    this.w = w;
    this.h = h;
    return true;
  }

  /** Forget the committed size, so the next `commit()` reports a change no matter what. Use when
   *  the targets were torn down behind our back and must be rebuilt at the same size. */
  reset(): void {
    this.w = -1;
    this.h = -1;
  }
}
