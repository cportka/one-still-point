import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, Scene } from 'three';
import { PointsNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import type { PerspectiveCamera } from 'three';
import { Galaxy } from './Galaxy';

/**
 * The browser render layer for Galaxy Mode (roadmap #9) — a `THREE.Points` cloud of the ~1000
 * stars (+ planets), advanced each frame by the pure {@link Galaxy} core and composited as an
 * **additive overlay** over the raymarch (drawn with the real perspective camera *after* the post
 * pipeline). Emissive additive points + the existing bloom give the disk its glow and the dense
 * inner region its bright bulge.
 *
 * Deliberately isolated + defensive: construction is guarded, so if a build ever fails on some
 * device the app logs and Galaxy Mode simply stays unavailable — it can never break the core
 * render. Per-star **size** variety is folded into the vertex-colour magnitude (brighter points
 * read larger through the bloom), so this needs only vertex colours + additive blending — no
 * per-vertex point-size node, keeping it robust across three versions.
 *
 * v1 is **main-path only** and does not lens the galaxy points through the hole (they composite in
 * front); those are noted follow-ups. The transition rides `reveal` (see Galaxy) + a fade.
 */
export class GalaxyLayer {
  readonly galaxy: Galaxy;
  private readonly scene = new Scene();
  private readonly geometry = new BufferGeometry();
  private readonly points: Points;
  private readonly material: PointsNodeMaterial;
  private posAttr: Float32BufferAttribute;
  /** True unless construction failed — the caller checks before rendering. */
  readonly ok: boolean;

  constructor(opts?: ConstructorParameters<typeof Galaxy>[0]) {
    this.galaxy = new Galaxy(opts);
    const total = this.galaxy.total;

    // Fold per-star size into the emissive colour magnitude (bigger = brighter through the bloom).
    const col = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const s = this.galaxy.sizes[i]!;
      col[i * 3] = this.galaxy.colors[i * 3]! * s;
      col[i * 3 + 1] = this.galaxy.colors[i * 3 + 1]! * s;
      col[i * 3 + 2] = this.galaxy.colors[i * 3 + 2]! * s;
    }

    this.posAttr = new Float32BufferAttribute(this.galaxy.positions, 3);
    this.posAttr.setUsage(0x88e8); // DYNAMIC_DRAW — positions change every frame
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.geometry.computeBoundingSphere();

    let ok = true;
    let material: PointsNodeMaterial;
    try {
      material = new PointsNodeMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      });
      // Small screen-space points with distance attenuation — a starfield, not blobs.
      (material as unknown as { size: number }).size = 2.2;
      (material as unknown as { sizeAttenuation: boolean }).sizeAttenuation = true;
    } catch (e) {
      console.warn('[onestillpoint] Galaxy Mode unavailable — PointsNodeMaterial failed:', e);
      material = new PointsNodeMaterial();
      ok = false;
    }
    this.material = material;
    this.ok = ok;

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions stream every frame; never cull the whole disk
    this.scene.add(this.points);
  }

  /** Advance the simulation and upload the fresh positions. `reveal` 0→1 blooms the disk; `fade`
   *  0→1 sets the overlay opacity (the mode-transition cross-fade). */
  update(dt: number, timeScale: number, reveal: number, fade: number): void {
    this.galaxy.update(dt, timeScale, reveal);
    this.posAttr.needsUpdate = true;
    (this.material as unknown as { opacity: number }).opacity = fade;
  }

  /** Composite the galaxy over whatever is already on screen (caller sets `renderer.autoClear`
   *  false so this draws on top of the post output). */
  render(renderer: WebGPURenderer, camera: PerspectiveCamera): void {
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
