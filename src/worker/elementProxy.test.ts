import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../core/CameraRig';
import { createUniforms } from '../render/uniforms';
import { ElementProxy } from './elementProxy';

describe('ElementProxy', () => {
  it('fires listeners with a plain event carrying defaults + overrides', () => {
    const proxy = new ElementProxy(800, 600);
    const seen: number[] = [];
    proxy.addEventListener('pointerdown', (ev) => seen.push(ev.clientX ?? -1));
    proxy.dispatch('pointerdown', { clientX: 42 });
    proxy.dispatch('pointermove', { clientX: 7 }); // no listener → nothing
    expect(seen).toEqual([42]);
  });

  it('lets a listener remove itself mid-dispatch (OrbitControls does on pointerup)', () => {
    const proxy = new ElementProxy();
    let calls = 0;
    const once = (): void => {
      calls += 1;
      proxy.removeEventListener('pointerup', once);
    };
    proxy.addEventListener('pointerup', once);
    proxy.dispatch('pointerup');
    proxy.dispatch('pointerup');
    expect(calls).toBe(1);
  });

  it('exposes the DOM surface OrbitControls touches, sized in CSS pixels', () => {
    const proxy = new ElementProxy(320, 200);
    expect(proxy.clientWidth).toBe(320);
    expect(proxy.clientHeight).toBe(200);
    expect(proxy.getBoundingClientRect()).toMatchObject({ left: 0, top: 0, width: 320, height: 200 });
    expect(proxy.getRootNode()).toBe(proxy); // the "offscreen canvas compatibility" hook
    expect(proxy.ownerDocument).toBe(proxy);
    proxy.setPointerCapture(1); // main-thread concerns — must not throw
    proxy.releasePointerCapture(1);
    proxy.setSize(640, 480);
    expect(proxy.clientHeight).toBe(480);
  });
});

// The real seam: three's OrbitControls (inside CameraRig) driven entirely through the proxy —
// no DOM, no browser. This is what the worker does with replayed pointer/wheel messages.
describe('CameraRig over an ElementProxy (the worker camera)', () => {
  function rigOnProxy() {
    const proxy = new ElementProxy(800, 600);
    const uniforms = createUniforms();
    const rig = new CameraRig(uniforms, proxy as unknown as HTMLElement, { coarse: false });
    return { proxy, uniforms, rig };
  }

  it('orbits on a replayed pointer drag — the camera pose moves in the uniform bus', () => {
    const { proxy, uniforms, rig } = rigOnProxy();
    rig.update();
    const before = new Vector3().copy(uniforms.camPos.value);

    proxy.dispatch('pointerdown', { pointerId: 1, clientX: 400, clientY: 300, button: 0, buttons: 1 });
    proxy.dispatch('pointermove', { pointerId: 1, clientX: 480, clientY: 300, button: 0, buttons: 1 });
    proxy.dispatch('pointerup', { pointerId: 1, clientX: 480, clientY: 300, button: 0, buttons: 0 });
    for (let i = 0; i < 30; i++) rig.update(); // let damping settle

    expect(uniforms.camPos.value.distanceTo(before)).toBeGreaterThan(0.1); // it orbited
    expect(uniforms.camPos.value.length()).toBeCloseTo(before.length(), 1); // …at ~constant radius
  });

  it('dollies on a replayed wheel — the camera radius changes', () => {
    const { proxy, uniforms, rig } = rigOnProxy();
    rig.update();
    const before = uniforms.camPos.value.length();

    proxy.dispatch('wheel', { deltaY: -240, deltaMode: 0 }); // zoom in
    for (let i = 0; i < 30; i++) rig.update();

    expect(uniforms.camPos.value.length()).toBeLessThan(before);
  });

  it('uses the mobile home framing when the main thread reports a coarse pointer', () => {
    const proxy = new ElementProxy(400, 800);
    const uniforms = createUniforms();
    const fine = new CameraRig(createUniforms(), new ElementProxy(400, 800) as unknown as HTMLElement, { coarse: false });
    const coarse = new CameraRig(uniforms, proxy as unknown as HTMLElement, { coarse: true });
    expect(coarse.homeDistance).toBeGreaterThan(fine.homeDistance); // phones start pulled back
  });
});
