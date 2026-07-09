import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Uint32BufferAttribute,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { Galaxy } from './Galaxy';

// Two visual-tuning knobs for the star field (device-verify — can't drive WebGPU here):
//   STAR_SCALE — the world-space half-size of a `sizes[i] == 1` star quad. Bigger → chunkier stars.
//   BRIGHTNESS — a global gain on every star's colour. The galaxy composites *over* the post output
//     (no bloom on it), so the additive quads carry their own glow — nudge this if the field reads
//     dim or blown out.
const STAR_SCALE = 0.5;
const BRIGHTNESS = 1.5;

/**
 * The browser render layer for Galaxy Mode (roadmap #9) — the realistic spiral drawn as three
 * composited pieces, advanced each frame by the pure {@link Galaxy} core:
 *
 *   1. a **fading dark backdrop** (a camera-locked inner sphere) that veils the raymarch as the
 *      galaxy blooms in — once it's fully opaque the host stops rendering the raymarch entirely
 *      (the perf win: Galaxy Mode is then just this cheap star field, not raymarch + overlay);
 *   2. a soft additive **core glow** (two billboards) filling the centre with warm light — the
 *      supermassive hole hidden inside a real galaxy's bright bulge. It **breathes** (a slow,
 *      detuned pulse on opacity + scale) so the centre feels alive and part of the system rather
 *      than a static disc pasted over the view;
 *   3. the **star cloud** — one merged mesh of ~1760 **camera-facing quads** (stars + planets), each
 *      a soft round additive sprite. Because every quad lives in world space at its star's position,
 *      perspective scales it with the camera: stars grow as you zoom in and shrink as you pull back
 *      (WebGPU draws `THREE.Points` at a fixed 1px regardless of `size`, so a point cloud can't do
 *      this — hence the billboard quads).
 *
 * Deliberately isolated + defensive: construction is guarded, so if a build ever fails on some
 * device the app logs and Galaxy Mode simply stays unavailable — it can never break the core
 * render. The transition rides `reveal` (see Galaxy) + a `fade` opacity.
 */
export class GalaxyLayer {
  readonly galaxy: Galaxy;
  private readonly scene = new Scene();
  private readonly geometry = new BufferGeometry();
  private readonly stars: Mesh;
  private readonly material: MeshBasicNodeMaterial;
  private readonly posAttr: Float32BufferAttribute;
  /** Per-star world-space half-size (folds `Galaxy.sizes` × STAR_SCALE), read each frame to build the
   *  billboard quad corners. */
  private readonly halfExtent: Float32Array;
  private readonly sprite: Texture | null;
  private readonly backdrop: Mesh | null = null;
  private readonly backdropMat: MeshBasicNodeMaterial | null = null;
  private readonly glowInner: Mesh | null = null;
  private readonly glowOuter: Mesh | null = null;
  private readonly glowInnerMat: MeshBasicNodeMaterial | null = null;
  private readonly glowOuterMat: MeshBasicNodeMaterial | null = null;
  private reveal = 1;
  /** A real-seconds clock (accumulated from the frame delta, independent of the sim speed) driving
   *  the core glow's breathing pulse — a steady breath regardless of the Speed slider. */
  private clock = 0;
  /** Live user dials (Galaxy-Mode settings menu), each a multiplier on the baked default (1 = as
   *  authored): `sizeMul` scales the star quads, `glowMul` scales the core-glow opacity. Star
   *  brightness rides `material.color` directly (a global gain on every vertex colour). */
  private sizeMul = 1;
  private glowMul = 1;
  /** True unless construction failed — the caller checks before rendering. */
  readonly ok: boolean;

  constructor(opts?: ConstructorParameters<typeof Galaxy>[0]) {
    this.galaxy = new Galaxy(opts);
    const total = this.galaxy.total;
    this.sprite = makeSoftSprite();

    // One merged mesh: 4 vertices + 2 triangles per star. `position` is rebuilt every frame (the
    // billboard corners, from the camera basis — see writeCorners); `color`/`uv`/index are static.
    this.halfExtent = new Float32Array(total);
    const pos = new Float32Array(total * 4 * 3); // filled per frame
    const col = new Float32Array(total * 4 * 3);
    const uv = new Float32Array(total * 4 * 2);
    const idx = new Uint32Array(total * 6);
    for (let i = 0; i < total; i++) {
      this.halfExtent[i] = this.galaxy.sizes[i]! * STAR_SCALE;
      const r = this.galaxy.colors[i * 3]! * BRIGHTNESS;
      const g = this.galaxy.colors[i * 3 + 1]! * BRIGHTNESS;
      const b = this.galaxy.colors[i * 3 + 2]! * BRIGHTNESS;
      const v = i * 4; // first vertex of this star's quad
      for (let k = 0; k < 4; k++) {
        col[(v + k) * 3] = r;
        col[(v + k) * 3 + 1] = g;
        col[(v + k) * 3 + 2] = b;
      }
      // uv corners (0,0) (1,0) (1,1) (0,1) — so the radial sprite maps across the quad.
      uv[(v + 0) * 2] = 0; uv[(v + 0) * 2 + 1] = 0;
      uv[(v + 1) * 2] = 1; uv[(v + 1) * 2 + 1] = 0;
      uv[(v + 2) * 2] = 1; uv[(v + 2) * 2 + 1] = 1;
      uv[(v + 3) * 2] = 0; uv[(v + 3) * 2 + 1] = 1;
      const t = i * 6;
      idx[t] = v; idx[t + 1] = v + 1; idx[t + 2] = v + 2;
      idx[t + 3] = v; idx[t + 4] = v + 2; idx[t + 5] = v + 3;
    }

    this.posAttr = new Float32BufferAttribute(pos, 3);
    this.posAttr.setUsage(0x88e8); // DYNAMIC_DRAW — the billboard corners change every frame
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    this.geometry.setIndex(new Uint32BufferAttribute(idx, 1));

    let ok = true;
    let material: MeshBasicNodeMaterial;
    try {
      material = new MeshBasicNodeMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        side: DoubleSide, // the quads are hand-wound to face the camera; DoubleSide removes any
        // winding-mistake risk of a culled (invisible) star, and additive means no double-draw.
      });
      // The soft radial sprite maps across each quad (a real mesh carries uv, unlike THREE.Points),
      // so every star reads as a soft round glow tinted by its vertex colour — perspective-scaled.
      if (this.sprite) material.map = this.sprite;
    } catch (e) {
      console.warn('[onestillpoint] Galaxy Mode unavailable — star material failed:', e);
      material = new MeshBasicNodeMaterial();
      ok = false;
    }
    this.material = material;

    this.stars = new Mesh(this.geometry, this.material);
    this.stars.frustumCulled = false; // corners stream every frame; never cull the whole disk
    this.stars.renderOrder = 0;
    this.scene.add(this.stars);

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

  // --- Live settings (Galaxy-Mode menu). Each takes a multiplier; 1 = the authored default. ---

  /** Scale the star quads (0.3…3). Applied per frame in {@link writeCorners}. */
  setStarSize(mul: number): void {
    this.sizeMul = Math.max(0, mul);
  }

  /** Scale every star's brightness. `material.color` (default white) multiplies the vertex colours,
   *  so this is a global gain on the whole star field — the same live-uniform path the glow opacities
   *  already use. */
  setBrightness(mul: number): void {
    this.material.color.setScalar(Math.max(0, mul));
  }

  /** Scale the core-glow opacity (0…2). Applied to the glow billboards in {@link update}. */
  setGlow(mul: number): void {
    this.glowMul = Math.max(0, mul);
  }

  /** Advance the simulation and set the layer opacities. `reveal` 0→1 blooms the disk; `fade` 0→1
   *  sets the overlay opacity (the mode-transition cross-fade). The billboard corners are rebuilt in
   *  {@link render} (they need the camera basis). */
  update(dt: number, timeScale: number, reveal: number, fade: number): void {
    this.galaxy.update(dt, timeScale, reveal);
    this.reveal = reveal;
    this.clock += dt;
    this.material.opacity = fade;
    // The backdrop goes fully opaque a touch before `fade` completes, so the raymarch is certainly
    // hidden by the time the host stops drawing it (no seam at the hand-off).
    if (this.backdropMat) this.backdropMat.opacity = Math.min(1, fade * 1.35);
    // The glows bloom in with the disk (reveal) and fade with the overlay (fade), and **breathe** on
    // two detuned pulses so the inner core and outer halo don't move in lockstep — the centre feels
    // alive rather than a static decal. (Scale breathes too, in render.)
    const bo = 1 + 0.14 * Math.sin(this.clock * 0.55);
    const bi = 1 + 0.18 * Math.sin(this.clock * 0.8 + 1.3);
    if (this.glowOuterMat) this.glowOuterMat.opacity = fade * 0.5 * reveal * bo * this.glowMul;
    if (this.glowInnerMat) this.glowInnerMat.opacity = fade * 0.8 * reveal * bi * this.glowMul;
  }

  /** Composite the galaxy over whatever is already on screen (caller sets `renderer.autoClear`
   *  false so this draws on top of the post output — or, once the backdrop is opaque, *as* the
   *  frame). */
  render(renderer: WebGPURenderer, camera: PerspectiveCamera): void {
    // Rebuild the star quads facing the camera, then lock the backdrop to the camera and billboard +
    // breathe the glows.
    this.writeCorners(camera);
    if (this.backdrop) this.backdrop.position.copy(camera.position);
    if (this.glowOuter) {
      this.glowOuter.quaternion.copy(camera.quaternion);
      const breath = 1 + 0.05 * Math.sin(this.clock * 0.55 + 0.6);
      this.glowOuter.scale.setScalar(this.galaxy.rInner * 7 * (0.35 + 0.65 * this.reveal) * breath);
    }
    if (this.glowInner) {
      this.glowInner.quaternion.copy(camera.quaternion);
      const breath = 1 + 0.07 * Math.sin(this.clock * 0.8 + 1.9);
      this.glowInner.scale.setScalar(this.galaxy.rInner * 2.8 * (0.35 + 0.65 * this.reveal) * breath);
    }
    renderer.render(this.scene, camera);
  }

  /** Expand each star centre into a camera-facing quad: corners = centre ± right·h ± up·h, where
   *  right/up are the camera's world basis and h the star's world half-size. Living in world space,
   *  the quad projects larger up close and smaller far away — the zoom-scaling a fixed-px point
   *  cloud can't give. */
  private writeCorners(camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    // matrixWorld columns 0/1 are the camera's world right / up axes (already unit length).
    const rx = e[0]!, ry = e[1]!, rz = e[2]!;
    const ux = e[4]!, uy = e[5]!, uz = e[6]!;
    const src = this.galaxy.positions;
    const dst = this.posAttr.array as Float32Array;
    const h = this.halfExtent;
    const n = this.galaxy.total;
    const sizeMul = this.sizeMul;
    for (let i = 0; i < n; i++) {
      const hi = h[i]! * sizeMul; // the live Star-size dial scales every quad
      const ax = rx * hi, ay = ry * hi, az = rz * hi; // right · h
      const bx = ux * hi, by = uy * hi, bz = uz * hi; // up · h
      const cx = src[i * 3]!, cy = src[i * 3 + 1]!, cz = src[i * 3 + 2]!;
      const o = i * 12;
      dst[o] = cx - ax - bx; // v0 = c − right − up
      dst[o + 1] = cy - ay - by;
      dst[o + 2] = cz - az - bz;
      dst[o + 3] = cx + ax - bx; // v1 = c + right − up
      dst[o + 4] = cy + ay - by;
      dst[o + 5] = cz + az - bz;
      dst[o + 6] = cx + ax + bx; // v2 = c + right + up
      dst[o + 7] = cy + ay + by;
      dst[o + 8] = cz + az + bz;
      dst[o + 9] = cx - ax + bx; // v3 = c − right + up
      dst[o + 10] = cy - ay + by;
      dst[o + 11] = cz - az + bz;
    }
    this.posAttr.needsUpdate = true;
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

/** A 64×64 radial-gradient sprite (white core → transparent edge) so additive quads and glows read
 *  as soft round light instead of hard squares. Best-effort — returns null if a canvas isn't
 *  available (the layer then falls back to plain square quads). */
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
