// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../version';

/** Module-level state (first-crash-wins, the storm counter) is the point of the design, so
 *  each test gets a fresh module instance. */
let mod: typeof import('./crashScreen');

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '';
  sessionStorage.clear();
  mod = await import('./crashScreen');
});

describe('crashPattern (the test-pattern iteration)', () => {
  it('is deterministic: the same crash renders the same iteration', () => {
    const a = mod.crashPattern('gpu', 'device lost');
    const b = mod.crashPattern('gpu', 'device lost');
    expect(a).toEqual(b);
  });

  it('different crashes render visibly different iterations (offsets + code differ)', () => {
    const a = mod.crashPattern('gpu', 'device lost');
    const b = mod.crashPattern('gpu', 'out of memory');
    expect(a.code).not.toBe(b.code);
    expect(a.offsets).not.toEqual(b.offsets);
  });

  it('the tint and station-code prefix encode the crash kind', () => {
    expect(mod.crashPattern('gpu', 'x').hue).toBe('#ffae4f');
    expect(mod.crashPattern('error', 'x').hue).toBe('#ff3cc0');
    expect(mod.crashPattern('worker', 'x').hue).toBe('#36e0ff');
    expect(mod.crashPattern('boot', 'x').hue).toBe('#b06aff');
    expect(mod.crashPattern('gpu', 'x').code).toMatch(/^GPU-[0-9A-F]{4}$/);
    expect(mod.crashPattern('boot', 'x').code).toMatch(/^BOT-[0-9A-F]{4}$/);
  });

  it('band offsets are a full set of in-range rows', () => {
    const { offsets } = mod.crashPattern('worker', 'anything');
    expect(offsets).toHaveLength(6);
    for (const o of offsets) {
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(1);
    }
  });
});

describe('showCrashScreen', () => {
  it('builds the card: kind class, message, version, and the matching station code', () => {
    mod.showCrashScreen({ kind: 'gpu', message: 'device lost', phase: 'compiling full shader' });
    const el = document.querySelector('.osp-crash');
    expect(el).not.toBeNull();
    expect(el!.className).toContain('osp-crash--gpu');
    expect(el!.querySelector('.osp-crash__msg')!.textContent).toBe('device lost');
    expect(el!.querySelector('.osp-crash__meta')!.textContent).toContain(`v${VERSION}`);
    expect(el!.querySelector('.osp-crash__meta')!.textContent).toContain('compiling full shader');
    expect(el!.querySelector('.osp-crash__code')!.textContent).toContain(mod.crashPattern('gpu', 'device lost').code);
    expect(el!.querySelectorAll('.osp-crash__glitch')).toHaveLength(6);
  });

  it('first crash wins the screen — later crashes bump the repeat counter, not the DOM', () => {
    mod.showCrashScreen({ kind: 'error', message: 'first' });
    mod.showCrashScreen({ kind: 'gpu', message: 'second' });
    mod.showCrashScreen({ kind: 'gpu', message: 'third' });
    expect(document.querySelectorAll('.osp-crash')).toHaveLength(1);
    expect(document.querySelector('.osp-crash__msg')!.textContent).toBe('first');
    expect(document.querySelector('.osp-crash__repeats')!.textContent).toContain('+2');
  });

  it('a GPU loss arms lean safe mode for the session; other kinds do not', () => {
    expect(mod.leanSafeMode()).toBe(false);
    mod.showCrashScreen({ kind: 'error', message: 'not gpu' });
    expect(mod.leanSafeMode()).toBe(false);
  });

  it('reportGpuLoss shows immediately and arms lean safe mode', () => {
    mod.reportGpuLoss('WebGPU device lost', 'live');
    expect(document.querySelector('.osp-crash--gpu')).not.toBeNull();
    expect(mod.leanSafeMode()).toBe(true);
  });

  it('removes the splash so the card is never hidden, and announces on osp-crash', () => {
    const splash = document.createElement('div');
    splash.id = 'osp-splash';
    document.body.appendChild(splash);
    const seen: string[] = [];
    window.addEventListener('osp-crash', (ev) => seen.push((ev as CustomEvent<{ kind: string }>).detail.kind));
    mod.showCrashScreen({ kind: 'boot', message: 'no webgpu' });
    expect(document.getElementById('osp-splash')).toBeNull();
    expect(seen).toEqual(['boot']);
  });
});

describe('installCrashGuard (the storm counter)', () => {
  it('a one-off uncaught error does NOT nuke a healthy view', () => {
    mod.installCrashGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: 'a minor handler hiccup' }));
    expect(document.querySelector('.osp-crash')).toBeNull();
  });

  it('an error storm (3 within the window) shows the card', () => {
    mod.installCrashGuard();
    for (let i = 0; i < 3; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'loop throw' }));
    expect(document.querySelector('.osp-crash--error')).not.toBeNull();
  });

  it('an unmistakably GPU-flavoured message crosses the line immediately', () => {
    mod.installCrashGuard();
    window.dispatchEvent(new ErrorEvent('error', { message: "Texture with 'depth' label has been destroyed" }));
    expect(document.querySelector('.osp-crash--gpu')).not.toBeNull();
  });

  it('a worker-relayed device loss is fatal-GPU on the first report', () => {
    mod.reportWorkerCrash('webgpu device lost in the worker: reason unknown');
    expect(document.querySelector('.osp-crash--gpu')).not.toBeNull();
    // …while an ordinary worker error needs the storm.
  });

  it('an ordinary worker error needs a storm too', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    const fresh = await import('./crashScreen');
    fresh.reportWorkerCrash('worker uncaught: something odd');
    expect(document.querySelector('.osp-crash')).toBeNull();
  });
});
