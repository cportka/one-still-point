import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Points,
  Scene,
  SphereGeometry,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { Galaxy } from './Galaxy';

/**
 * The browser render layer for Galaxy Mode (roadmap #9) — the realistic spiral drawn as three
 * composited pieces, advanced each frame by the pure {@link Galaxy} core:
 *
 *   1. a **fading dark backdrop** (a camera-locked inner sphere) that veils the raymarch as the
 *      galaxy blooms in — once it's fully opaque the host stops rendering the raymarch entirely
 *      (the perf win: Galaxy Mode is then just this cheap point cloud, not raymarch + overlay);
 *   2. a soft additive **core glow** (two billboards) filling the centre with warm light — the
 *      supermassive hole hidden inside a real galaxy's bright bulge;
 *   3. the **star cloud** — a `THREE.Points` of the ~1600 stars (+ planets) as soft round additive
 *      sprites (a radial-gradient texture, so they read as glows, not hard square pinpoints).
 *
 * Deliberately isolated + defensive: construction is guarded, so if a build ever fails on some
 * device the app logs and Galaxy Mode simply stays unavailable — it can never break the core
 * render. The transition rides `reveal` (see Galaxy) + a `fade` opacity.
 */
export class GalaxyLayer {
  readonly galaxy: Galaxy;
  private readonly scene = new Scene();
  private readonly geometry = new BufferGeometry();
  private readonly points: Points;
  private readonly material: PointsNodeMaterial;
  private posAttr: Float32BufferAttribute;
  private readonly sprite: Texture | null;
  private readonly backdrop: Mesh | null = null;
  private readonly backdropMat: MeshBasicNodeMaterial | null = null;
  private readonly glowInner: Mesh | null = null;
  private readonly glowOuter: Mesh | null = null;
  private readonly glowInnerMat: MeshBasicNodeMaterial | null = null;
  private readonly glowOuterMat: MeshBasicNodeMaterial | null = null;
  private reveal = 1;
  /** True unless construction failed — the caller checks before rendering. */
  readonly ok: boolean;

  constructor(opts?: ConstructorParameters<typeof Galaxy>[0]) {
    this.galaxy = new Galaxy(opts);
    const total = this.galaxy.total;
    this.sprite = makeSoftSprite();

    // Fold per-star size into the emissive colour magnitude (bigger = brighter through the bloom),
    // with a global gain so the framed-from-afar disk reads bright, not dim ("too small to see").
    const BRIGHTNESS = 1.15;
    const col = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const s = this.galaxy.sizes[i]! * BRIGHTNESS;
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
      // A radial-gradient sprite makes each point a soft round glow rather than a hard square
      // pinpoint (the old look the user called out). Fixed screen-space size (attenuation OFF):
      // every star reads the same size no matter how far into the disk it sits, so framing the whole
      // galaxy from a distance never shrinks the far edge to nothing. Brightness (folded above)
      // still carries the bulge/size variety.
      if (this.sprite) (material as unknown as { map: Texture }).map = this.sprite;
      (material as unknown as { size: number }).size = 4.5;
      (material as unknown as { sizeAttenuation: boolean }).sizeAttenuation = false;
    } catch (e) {
      console.warn('[onestillpoint] Galaxy Mode unavailable — PointsNodeMaterial failed:', e);
      material = new PointsNodeMaterial();
      ok = false;
    }
    this.material = material;

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions stream every frame; never cull the whole disk
    this.points.renderOrder = 0;
    this.scene.add(this.points);

    // The dark backdrop + the warm core glow are best-effort extras: any failure just disables that
    // piece (the star cloud still renders), so the whole block is guarded and never flips `ok`.
    try {
      const rInner = this.galaxy.rInner;
      // Backdrop: an inner sphere painted a near-black deep-space colour, locked to the camera each
      // frame (see render) so it always fills the view. Opacity rides `fade`; at full fade it fully
      // hides the raymarch and the host can skip it.
      this.backdropMat = new MeshBasicNodeMaterial({
        color: new Color(0x03040c),
        side: BackSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.backdropMat.opacity = 0;
      this.backdrop = new Mesh(new SphereGeometry(200, 32, 16), this.backdropMat);
      this.backdrop.frustumCulled = false;
      this.backdrop.renderOrder = -10; // behind everything
      this.scene.add(this.backdrop);

      // Two additive, camera-facing glow billboards fill the centre with warm light: a broad, dim
      // halo and a tighter, brighter core. The soft sprite gives the falloff.
      const mkGlow = (color: number, order: number): { mesh: Mesh; mat: MeshBasicNodeMaterial } => {
        const mat = new MeshBasicNodeMaterial({
          color: new Color(color),
          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: AdditiveBlending,
        });
        if (this.sprite) mat.map = this.sprite;
        mat.opacity = 0;
        const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        this.scene.add(mesh);
        return { mesh, mat };
      };
      const outer = mkGlow(0xffb066, -2); // broad, warm-amber halo
      const inner = mkGlow(0xffe6c0, -1); // tight, bright warm-white core
      this.glowOuter = outer.mesh;
      this.glowOuterMat = outer.mat;
      this.glowInner = inner.mesh;
      this.glowInnerMat = inner.mat;
      this.glowOuter.scale.setScalar(rInner * 7);
      this.glowInner.scale.setScalar(rInner * 2.8);
    } catch (e) {
      console.warn('[onestillpoint] Galaxy Mode backdrop/glow unavailable (stars still render):', e);
    }

    this.ok = ok;
  }

  /** Advance the simulation and upload the fresh positions. `reveal` 0→1 blooms the disk; `fade`
   *  0→1 sets the overlay opacity (the mode-transition cross-fade). */
  update(dt: number, timeScale: number, reveal: number, fade: number): void {
    this.galaxy.update(dt, timeScale, reveal);
    this.reveal = reveal;
    this.posAttr.needsUpdate = true;
    (this.material as unknown as { opacity: number }).opacity = fade;
    // The backdrop goes fully opaque a touch before `fade` completes, so the raymarch is certainly
    // hidden by the time the host stops drawing it (no seam at the hand-off).
    if (this.backdropMat) this.backdropMat.opacity = Math.min(1, fade * 1.35);
    // The glows bloom in with the disk (reveal) and fade with the overlay (fade).
    if (this.glowOuterMat) this.glowOuterMat.opacity = fade * 0.5 * reveal;
    if (this.glowInnerMat) this.glowInnerMat.opacity = fade * 0.8 * reveal;
  }

  /** Composite the galaxy over whatever is already on screen (caller sets `renderer.autoClear`
   *  false so this draws on top of the post output — or, once the backdrop is opaque, *as* the
   *  frame). */
  render(renderer: WebGPURenderer, camera: PerspectiveCamera): void {
    // Lock the backdrop to the camera so its inner sphere always surrounds the view; billboard the
    // glows to face the camera and scale them with the bloom.
    if (this.backdrop) this.backdrop.position.copy(camera.position);
    if (this.glowOuter) {
      this.glowOuter.quaternion.copy(camera.quaternion);
      this.glowOuter.scale.setScalar(this.galaxy.rInner * 7 * (0.35 + 0.65 * this.reveal));
    }
    if (this.glowInner) {
      this.glowInner.quaternion.copy(camera.quaternion);
      this.glowInner.scale.setScalar(this.galaxy.rInner * 2.8 * (0.35 + 0.65 * this.reveal));
    }
    renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.sprite?.dispose();
    this.backdrop?.geometry.dispose();
    this.backdropMat?.dispose();
    this.glowInner?.geometry.dispose();
    this.glowOuter?.geometry.dispose();
    this.glowInnerMat?.dispose();
    this.glowOuterMat?.dispose();
  }
}

/** A 64×64 radial-gradient sprite (white core → transparent edge) so additive points and glows read
 *  as soft round light instead of hard squares. Best-effort — returns null if a canvas isn't
 *  available (the layer then falls back to plain square points). */
function makeSoftSprite(): Texture | null {
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}
