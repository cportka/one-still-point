/**
 * The HUD's overhead orbit map: a live, simplified top-down (bird's-eye) view of the system —
 * the central black hole at the centre, every companion as a typed dot riding its **predicted
 * orbit** (the exact Kepler conic its state vectors define — see `orbitPath.ts`; iteration two
 * of the feature, per the live review), and a camera chevron showing where the view is and
 * which way it faces (the target is locked at the origin, so it always faces inward; when the
 * camera orbit is wider than the map extent the chevron rides the rim, still pointing the
 * right way).
 *
 * World mapping: the sim's orbital plane is x/z (y is "up" toward the viewer of this map);
 * world +x → map right, world +z → map down, so the map matches a screenshot taken from
 * straight above with the default camera. The extent auto-fits the widest orbit (with a floor
 * so the default system doesn't fill the frame edge-to-edge) and eases between fits so an
 * added far body doesn't snap the scale.
 *
 * The projection helpers are pure and unit-tested (`orbitMap.test.ts`); drawing is guarded so
 * environments without a 2D context (jsdom) no-op.
 */
import { orbitPathXZ, pathMaxRadiusXZ } from './orbitPath';

/** One body on the map — full world position + velocity (the Kepler-conic prediction needs the
 *  3D state; the map itself projects to the top-down x/z). */
export interface MapBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  type: 'star' | 'planet' | 'hole';
  /** Set while the − plunge (or a natural absorption) is animating — drawn hot, no orbit ring. */
  falling?: boolean;
}

/** Per-frame map state (assembled by the render loop only while the map is visible). */
export interface OrbitMapInfo {
  bodies: MapBody[];
  camX: number;
  camZ: number;
  /** Galaxy Mode: the star field as a raw top-down point cloud — `points` is [x0,z0,x1,z1,…] for
   *  the first `count` stars (downsampled), `extent` fits the disk. When present the map draws this
   *  **instead** of `bodies` + orbits: 1760 predicted Kepler conics would be unreadable and slow, so
   *  Galaxy Mode shows a plain dot cloud (density-by-overlap) with no orbit rings. */
  galaxy?: { points: Float32Array; count: number; extent: number };
}

/** The widest orbit the map must contain, with a floor so small systems stay readable and a
 *  headroom factor so dots never sit exactly on the frame edge. Pure. */
export function mapExtent(radii: number[], floor = 58, headroom = 1.18): number {
  let max = 0;
  for (const r of radii) if (Number.isFinite(r) && r > max) max = r;
  return Math.max(floor, max * headroom);
}

/** World (x, z) → map pixels for a square map of `sizePx`, world `extent` at the rim. Pure. */
export function worldToMap(x: number, z: number, extent: number, sizePx: number): { px: number; py: number } {
  const s = sizePx / 2 / extent;
  return { px: sizePx / 2 + x * s, py: sizePx / 2 + z * s };
}

/** Clamp a map point into the rim circle (radius `rimPx` around the centre) — the minimap
 *  convention for something beyond the extent (the camera, mid-flight). Pure. */
export function clampToRim(px: number, py: number, sizePx: number, rimPx: number): { px: number; py: number; clamped: boolean } {
  const cx = sizePx / 2;
  const dx = px - cx;
  const dy = py - cx;
  const d = Math.hypot(dx, dy);
  if (d <= rimPx) return { px, py, clamped: false };
  const k = rimPx / d;
  return { px: cx + dx * k, py: cx + dy * k, clamped: true };
}

/** The camera chevron's heading on the map: the direction it faces (toward the locked origin
 *  target), as a canvas-space angle (0 = +x/right, positive turning toward +y/down). Pure. */
export function headingToward(camX: number, camZ: number, targetX = 0, targetZ = 0): number {
  return Math.atan2(targetZ - camZ, targetX - camX);
}

const SIZE = 128; // CSS px (square); the backing store doubles it for crisp dots
const RIM = SIZE / 2 - 7; // the camera chevron's track when it's outside the extent

export interface OrbitMap {
  el: HTMLCanvasElement;
  /** Draw one frame of the map. Call only while visible (the HUD gates it). */
  draw(info: OrbitMapInfo): void;
}

const DOT: Record<MapBody['type'], string> = {
  star: '#ffd9a0', // the warm companion gold
  planet: '#aec6ff', // a cool counter-swirl blue
  hole: '#e9e3d5', // drawn hollow — a tiny horizon ring
};

export function createOrbitMap(): OrbitMap {
  const el = document.createElement('canvas');
  el.className = 'hud__map';
  el.width = SIZE * 2; // 2× backing for retina-crisp 1px rings
  el.height = SIZE * 2;
  const g = el.getContext('2d');
  g?.scale(2, 2);

  let extent = mapExtent([]); // eased between frames so a new far body doesn't snap the scale

  // The camera chevron at its floor position, pointing the way it faces (inward — the target is
  // origin-locked). Beyond the extent it rides the rim, heading preserved. Shared by both map modes.
  const drawChevron = (camX: number, camZ: number): void => {
    if (!g) return;
    const raw = worldToMap(camX, camZ, extent, SIZE);
    const { px, py } = clampToRim(raw.px, raw.py, SIZE, RIM);
    const a = headingToward(camX, camZ);
    g.save();
    g.translate(px, py);
    g.rotate(a);
    g.beginPath(); // a slim chevron: tip forward, two swept-back tails
    g.moveTo(5, 0);
    g.lineTo(-3.5, -3.6);
    g.lineTo(-1.5, 0);
    g.lineTo(-3.5, 3.6);
    g.closePath();
    g.fillStyle = 'rgba(233, 227, 213, 0.95)';
    g.fill();
    g.restore();
  };

  // The galactic core marker (the central hole), shared origin dot for both modes.
  const drawCore = (): void => {
    if (!g) return;
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, 4.5, 0, Math.PI * 2);
    g.fillStyle = '#000';
    g.fill();
    g.strokeStyle = 'rgba(233, 227, 213, 0.9)';
    g.lineWidth = 1.25;
    g.stroke();
  };

  // Galaxy Mode: a plain top-down dot cloud of the star field — no per-star Kepler orbits (1760
  // conics would be unreadable + slow). Low-alpha 1px dots so overlap reads as density: the dense
  // bulge glows brightest, the arms trace out. Fast (a fillRect per point, no path).
  const drawGalaxy = (gx: NonNullable<OrbitMapInfo['galaxy']>, camX: number, camZ: number): void => {
    if (!g) return;
    extent += (gx.extent - extent) * 0.08; // ease to the galaxy extent (smooth on a mode switch)
    g.clearRect(0, 0, SIZE, SIZE);
    const s = SIZE / 2 / extent;
    g.fillStyle = 'rgba(174, 198, 255, 0.5)'; // cool arm blue-white; overlap builds density
    for (let i = 0; i < gx.count; i++) {
      const px = SIZE / 2 + gx.points[i * 2]! * s;
      const py = SIZE / 2 + gx.points[i * 2 + 1]! * s;
      g.fillRect(px - 0.5, py - 0.5, 1, 1);
    }
    drawCore(); // the galactic centre
    drawChevron(camX, camZ);
  };

  const draw = (info: OrbitMapInfo): void => {
    if (!g) return;
    if (info.galaxy) {
      drawGalaxy(info.galaxy, info.camX, info.camZ); // Galaxy Mode — the dot cloud, no orbits
      return;
    }
    // Predicted paths: the exact Kepler conic each body's state defines in the central field
    // (see orbitPath.ts — "taking the current acceleration into account" in closed form, ~50
    // trig calls per body, only while the map is on screen). Unbound/plunging states → no path.
    const paths = info.bodies.map((b) => (b.falling ? null : orbitPathXZ(b)));
    const radii = info.bodies.map((b, i) => {
      const p = paths[i];
      return p ? pathMaxRadiusXZ(p) : Math.hypot(b.x, b.z); // fit the apoapsis, not just "now"
    });
    const target = mapExtent(radii);
    extent += (target - extent) * 0.08; // ease toward the fitting extent

    g.clearRect(0, 0, SIZE, SIZE);

    // Predicted orbits first (under everything): one faint conic per non-falling bound body.
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(216, 209, 196, 0.16)';
    const s = SIZE / 2 / extent;
    for (const path of paths) {
      if (!path) continue;
      g.beginPath();
      for (let i = 0; i < path.length; i += 2) {
        const px = SIZE / 2 + path[i]! * s;
        const py = SIZE / 2 + path[i + 1]! * s;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
    }

    // The central black hole: a void dot inside its warm photon ring (the brand mark, tiny).
    drawCore();

    // Companions: warm dots for stars, cool for planets, tiny hollow rings for holes;
    // a falling body draws hot (it's on its way in — the map's one moment of drama).
    for (const b of info.bodies) {
      const { px, py } = worldToMap(b.x, b.z, extent, SIZE);
      g.beginPath();
      if (b.type === 'hole' && !b.falling) {
        g.arc(px, py, 2.6, 0, Math.PI * 2);
        g.strokeStyle = DOT.hole;
        g.lineWidth = 1.25;
        g.stroke();
      } else {
        g.arc(px, py, b.type === 'planet' ? 1.8 : 2.3, 0, Math.PI * 2);
        g.fillStyle = b.falling ? '#ff9a5c' : DOT[b.type];
        g.fill();
      }
    }

    // The camera chevron (shared with Galaxy Mode).
    drawChevron(info.camX, info.camZ);
  };

  return { el, draw };
}
