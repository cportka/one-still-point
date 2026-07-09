import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isCoarsePointer } from './device';
import type { IntroDriver } from './FormationSequence';
import type { Body } from '../scene/Body';
import type { Uniforms } from '../render/uniforms';

// The home framing — just above the disc plane, near the ring. Touch devices
// start pulled further back: a fixed 60° vertical FOV makes the wide disk loom
// large on a narrow phone screen, so the extra distance keeps it comfortably framed.
const HOME_DESKTOP = new Vector3(0, 4, 19);
const HOME_MOBILE = new Vector3(0, 6, 32);

/**
 * The camera is purely an input device. OrbitControls drives a real
 * PerspectiveCamera — swipe / drag to orbit, pinch / scroll to dolly — and each
 * frame we read its world position and orthonormal basis into the uniform bus,
 * where the raymarch shader uses them to build a view ray per pixel.
 *
 * It also serves as the formation intro's `IntroDriver`: the sequence dollies
 * the camera along the home ray (controls disabled) and hands back on arrival.
 *
 * Distances are in units of M (gravitational radii); the horizon sits at 2M, so
 * minDistance keeps the camera comfortably outside it. See build plan §5 / §7.
 */
export class CameraRig implements IntroDriver {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** The resting pose the intro settles into and the default view. */
  readonly homePosition: Vector3;
  private readonly homeDir: Vector3;

  // A cinematic flight (Galaxy Mode auto-frame): while active, input is suspended and the camera
  // eases along a straight world-space path to `flightTo`, looking at the locked target.
  private flying = false;
  private readonly flightFrom = new Vector3();
  private readonly flightTo = new Vector3();
  private flightT = 0;
  private flightDur = 1;

  // The "one still point" focus: the body the view centres on (its position is tracked each frame so
  // the camera follows it, keeping it fixed in frame while everything orbits it). null = the origin
  // (the central hole — the default). See {@link focusOn}.
  private focusTarget: Body | null = null;
  private readonly focusOrigin = new Vector3(0, 0, 0);
  private readonly followDelta = new Vector3();

  constructor(
    private readonly uniforms: Uniforms,
    domElement: HTMLElement,
    // Injectable for the worker render path: `matchMedia` doesn't exist in a worker, so the main
    // thread probes coarseness and passes it through the init message (protocol v2).
    opts: { coarse?: boolean } = {},
  ) {
    this.camera = new PerspectiveCamera(60, 1, 0.01, 1000);
    this.homePosition = ((opts.coarse ?? isCoarsePointer()) ? HOME_MOBILE : HOME_DESKTOP).clone();
    this.homeDir = this.homePosition.clone().normalize();
    this.camera.position.copy(this.homePosition);

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 4; // stay outside the 3M photon sphere
    this.controls.maxDistance = 240; // how far you can pull back (doubled — more room to zoom out)
    // Panning is off: there's no re-centre control yet, so a pan would strand the hole
    // off-screen with no way back. Keep the target locked at the origin — orbit + zoom only.
    this.controls.enablePan = false;
    // Allow the full vertical sweep — directly overhead through to directly below.
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.setAspect(1);
  }

  /** Re-derive projection params after a viewport resize. */
  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.uniforms.aspect.value = aspect;
    this.uniforms.tanHalfFov.value = Math.tan((this.camera.fov * Math.PI) / 360);
  }

  /** Advance damping (or an in-progress flight) and publish the camera state to the uniform bus.
   *  Pass the frame delta so a cinematic flight can ease in real time; omit it for a plain tick. */
  update(dt = 0): void {
    if (this.flying) {
      this.flightT = Math.min(1, this.flightT + dt / this.flightDur);
      const e = this.flightT * this.flightT * (3 - 2 * this.flightT); // smoothstep ease
      this.camera.position.lerpVectors(this.flightFrom, this.flightTo, e);
      this.camera.lookAt(this.controls.target);
      if (this.flightT >= 1) {
        this.flying = false;
        this.controls.enabled = true;
        this.controls.update(); // resync OrbitControls' spherical from the arrived pose
      }
      this.publish();
      return;
    }
    // Follow the focused body (the "one still point"): glide the orbit target onto it and translate
    // the camera by the same delta, so the body stays fixed in frame while everything orbits it.
    // A large delta on a focus *switch* eases in (dt·k); the per-frame drift as a companion orbits is
    // tiny. Unfocused → the origin (the central hole), so this is a no-op for the default view.
    const desired = this.focusTarget ? this.focusTarget.position : this.focusOrigin;
    this.followDelta.copy(desired).sub(this.controls.target).multiplyScalar(Math.min(1, dt > 0 ? dt * 6 : 1));
    if (this.followDelta.lengthSq() > 1e-12) {
      this.controls.target.add(this.followDelta);
      this.camera.position.add(this.followDelta); // move both → preserve the offset (a true follow)
    }
    this.controls.update();
    this.publish();
  }

  /** Centre the view on a body (the "one still point"): the orbit target tracks it as it orbits and
   *  the camera follows, so the body stays fixed in frame while everything moves around it. Pass
   *  `null` (or the fixed primary) to re-centre on the origin — the central hole, the default. */
  focusOn(body: Body | null): void {
    this.focusTarget = body && !body.fixed ? body : null;
  }

  /** Drop any "still point" focus and snap the orbit target back to the origin. Called whenever a
   *  flight or the intro takes the wheel (they all frame the origin/disk and aim at `controls.target`
   *  each frame): without this, a prior focus would leave the target off-origin, so the flyToFrame /
   *  intro would frame the scene off-centre and then "swim" back when the follow eased in. */
  private recenter(): void {
    this.focusTarget = null;
    this.controls.target.set(0, 0, 0);
  }

  /** A snapshot of the current camera position — save it before a flight to fly back to later. */
  snapshot(): Vector3 {
    return this.camera.position.clone();
  }

  /** Fly out to frame a disk of radius `radius` (sim units) about the target from an elevated 3/4
   *  angle, so the whole thing fills the view rather than scattering past the frame. Galaxy Mode
   *  calls this on enter; the distance is clamped to the dolly range. */
  flyToFrame(radius: number): void {
    const dist = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, radius * 2.35));
    const dir = new Vector3(0.3, 0.62, 0.72).normalize(); // ~38° above the disk plane — a 3/4 view
    this.flyTo(dir.multiplyScalar(dist));
  }

  /** Smoothly dolly/orbit the camera to `to` (world position), looking at the locked target, over
   *  `seconds`. Input is suspended for the flight and restored (OrbitControls resynced) on arrival.
   *  Galaxy Mode uses this to frame the whole disk on enter and to return to the saved pose on exit. */
  flyTo(to: Vector3, seconds = 1.8): void {
    this.recenter(); // a flight frames the origin — drop any "still point" focus + off-origin target
    this.flightFrom.copy(this.camera.position);
    this.flightTo.copy(to);
    this.flightT = 0;
    this.flightDur = Math.max(1e-3, seconds);
    this.flying = true;
    this.controls.enabled = false;
  }

  /** Write the current camera pose into the uniform bus. */
  private publish(): void {
    this.camera.updateMatrixWorld();
    // matrixWorld is column-major: columns 0/1/2 are the camera's right / up /
    // back axes. The camera looks down its local -Z, so forward = -column2.
    const e = this.camera.matrixWorld.elements;
    this.uniforms.camPos.value.copy(this.camera.position);
    this.uniforms.camRight.value.set(e[0]!, e[1]!, e[2]!);
    this.uniforms.camUp.value.set(e[4]!, e[5]!, e[6]!);
    this.uniforms.camForward.value.set(-e[8]!, -e[9]!, -e[10]!);
  }

  // --- IntroDriver (FormationSequence) ---

  get homeDistance(): number {
    return this.homePosition.length();
  }

  /** Take the wheel for the intro: ignore user input while it dollies. */
  beginIntro(): void {
    this.recenter(); // a replayed intro is a clean reset — clear any "still point" focus first
    this.controls.enabled = false;
  }

  /** Place the camera on the home ray at `distance`, looking at the hole. */
  placeOnHomeRay(distance: number): void {
    this.camera.position.copy(this.homeDir).multiplyScalar(distance);
    this.camera.lookAt(this.controls.target);
    this.publish();
  }

  /** Snap to the home pose and return control to the user. */
  finishIntro(): void {
    this.camera.position.copy(this.homePosition);
    this.controls.enabled = true;
    this.update(); // resync OrbitControls' internal spherical from the camera
  }

  dispose(): void {
    this.controls.dispose();
  }
}
