import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isCoarsePointer } from './device';
import type { IntroDriver } from './FormationSequence';
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

  /** Advance damping and publish the camera state to the uniform bus. */
  update(): void {
    this.controls.update();
    this.publish();
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
