import type { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { apparentScreenPos } from '../core/pick';

/**
 * A crisp **neon selection ring** drawn in screen space around the hovered / selected body — a
 * clear, explicit affordance on top of the emissive halo (which blooms into a soft glow but doesn't
 * read as a distinct outline). Selected is **bold** (a bright cyan double-stroke with a slow
 * breathing pulse); hovered is **faint** (a single thin ring, no pulse). Purely a 2D-canvas overlay:
 * it shares the world→screen projection with {@link import('../core/pick').pickBody} — including
 * the central hole's **lensing correction** (`apparentScreenPos`, a march of the shader's own
 * geodesic), so the ring lands on the body's *lensed* image exactly where the raymarch draws it.
 * (Video-measured: the linear projection was centred far from the hole but drifted tens of px
 * toward the hole beside the disk — the classic lensing displacement, now corrected.)
 *
 * Main-thread render path only — it needs the live camera + body positions, which on the worker path
 * live in the worker (that path keeps the emissive halo). Cheap: one clearRect + one or two arcs a
 * frame, and nothing at all when nothing is hovered or selected.
 */

const TAU = Math.PI * 2;
const RING_MIN_PX = 15; // floor on the body's projected radius, so even a distant speck gets a grabbable ring

// Selected (bold): a bright cyan double-stroke with a gentle breathing pulse.
const SEL_GLOW = 'rgba(120, 220, 255, 0.9)';
const SEL_OUTER = 'rgba(120, 220, 255, 0.28)'; // soft wide halo stroke
const SEL_PAD = 1.95; // ring radius = projected body radius × this (+ a few px), so it sits just outside the body
// Hover (faint): a single thin, low-alpha ring.
const HOV_GLOW = 'rgba(150, 200, 255, 0.5)';
const HOV_STROKE = 'rgba(190, 220, 255, 0.42)';
const HOV_PAD = 1.7;

/**
 * Project a body's world position to its **apparent** CSS-pixel screen coordinates (the central
 * hole's lensing included when `holeMass > 0`) and its projected pixel radius, or `null` if it's
 * behind the camera / past the far plane. Delegates to `apparentScreenPos` — one projection shared
 * with `pickBody`, so the ring and the click always agree. Pure over its inputs (unit-tested).
 */
export function ringFor(
  camera: PerspectiveCamera,
  position: Vector3,
  radius: number,
  cssW: number,
  cssH: number,
  holeMass = 0,
): { x: number; y: number; r: number } | null {
  const p = apparentScreenPos(camera, position, radius, cssW, cssH, holeMass);
  return p ? { x: p.x, y: p.y, r: p.rPx } : null;
}

export interface SelectionRing {
  readonly canvas: HTMLCanvasElement;
  /** Size the overlay to the viewport (CSS px) at the given device-pixel ratio, for crisp strokes. */
  resize(cssW: number, cssH: number, dpr: number): void;
  /**
   * Redraw for this frame. `selected` / `hovered` are the bodies' world position + radius (or null).
   * Hover is skipped when it's the same body as selected — matching the emissive states.
   * `holeMass` (> 0) applies the central hole's point-lens correction so the ring sits on the
   * body's lensed image.
   */
  draw(
    camera: PerspectiveCamera,
    selected: { position: Vector3; radius: number } | null,
    hovered: { position: Vector3; radius: number } | null,
    nowMs: number,
    holeMass?: number,
  ): void;
  dispose(): void;
}

export function createSelectionRing(): SelectionRing {
  const canvas = document.createElement('canvas');
  canvas.className = 'osp-selring';
  const ctx = canvas.getContext('2d');
  let cssW = 1;
  let cssH = 1;

  const drawRing = (
    camera: PerspectiveCamera,
    body: { position: Vector3; radius: number },
    bold: boolean,
    nowMs: number,
    holeMass: number,
  ): void => {
    if (!ctx) return;
    const p = ringFor(camera, body.position, body.radius, cssW, cssH, holeMass);
    if (!p) return;
    const base = Math.max(p.r, RING_MIN_PX);
    ctx.save();
    if (bold) {
      const beat = Math.sin(nowMs * 0.006); // slow breathing pulse
      const r = base * SEL_PAD * (1 + 0.05 * beat) + 4;
      ctx.shadowColor = SEL_GLOW;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 4; // soft wide halo ring
      ctx.strokeStyle = SEL_OUTER;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 2; // crisp bright inner ring
      ctx.strokeStyle = `rgba(170, 235, 255, ${(0.85 + 0.1 * beat).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    } else {
      const r = base * HOV_PAD + 3;
      ctx.shadowColor = HOV_GLOW;
      ctx.shadowBlur = 5;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = HOV_STROKE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  };

  return {
    canvas,
    resize(w, h, dpr) {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      // Draw in CSS px; the DPR scale keeps the strokes crisp on retina.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw(camera, selected, hovered, nowMs, holeMass = 0) {
      if (!ctx) return;
      ctx.clearRect(0, 0, cssW, cssH);
      camera.updateMatrixWorld();
      // Hover under, selected on top; skip hover when it's the selected body (matches the emissive states).
      if (hovered && hovered !== selected) drawRing(camera, hovered, false, nowMs, holeMass);
      if (selected) drawRing(camera, selected, true, nowMs, holeMass);
    },
    dispose() {
      canvas.remove();
    },
  };
}
