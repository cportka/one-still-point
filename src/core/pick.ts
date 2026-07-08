import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { Body } from '../scene/Body';

/**
 * Screen-space body picking for the click/tap gestures (highlight / plunge / plunge-into / rescue).
 * Projects every companion through the camera and returns the nearest one within its hit circle —
 * the body's *projected* radius (with slack, small bodies are hard to hit) floored at `minPx` so
 * even a speck is clickable. Pure over its inputs and shared verbatim by both render paths (the
 * main thread picks against its own camera; the worker picks against its rig's camera using the
 * relayed CSS coordinates). Returns `null` when nothing is near the click.
 */
const projected = new Vector3(); // scratch — this runs on double-clicks only, but keep it clean

export function pickBody(
  bodies: readonly Body[],
  camera: PerspectiveCamera,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  minPx = 22,
): Body | null {
  camera.updateMatrixWorld();
  const focal = cssH / 2 / Math.tan((camera.fov * Math.PI) / 360); // px per world-unit at distance 1
  let best: Body | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    if (b.fixed) continue; // the primary is the destination, not a pick target
    projected.copy(b.position).project(camera);
    if (projected.z < -1 || projected.z > 1) continue; // behind the camera / past the far plane
    const sx = ((projected.x + 1) / 2) * cssW;
    const sy = ((1 - projected.y) / 2) * cssH;
    const d = Math.hypot(sx - cssX, sy - cssY);
    const dist = camera.position.distanceTo(b.position);
    const rPx = (b.radius / Math.max(dist, 1e-3)) * focal;
    const hit = Math.max(minPx, rPx * 1.6); // the body circle with slack, floored for specks
    if (d <= hit && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}
