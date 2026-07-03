import { describe, expect, it } from 'vitest';
import { canUseOffscreenRendering, isGeckoUA, probeOffscreenEnv, resolveRenderPath, type OffscreenEnv } from './capability';

const FULL: OffscreenEnv = { offscreenCanvas: true, worker: true, transferControl: true };

describe('probeOffscreenEnv', () => {
  it('reports all-false on a bare global (e.g. Node / SSR)', () => {
    expect(probeOffscreenEnv({} as typeof globalThis)).toEqual({
      offscreenCanvas: false,
      worker: false,
      transferControl: false,
    });
  });

  it('detects each capability when present', () => {
    const g = {
      OffscreenCanvas: function OffscreenCanvas() {},
      Worker: function Worker() {},
      HTMLCanvasElement: { prototype: { transferControlToOffscreen: () => undefined } },
    } as unknown as typeof globalThis;
    expect(probeOffscreenEnv(g)).toEqual(FULL);
  });
});

describe('canUseOffscreenRendering', () => {
  it('is off by default during the scaffolding phase (not enabled)', () => {
    expect(canUseOffscreenRendering(FULL)).toBe(false);
  });

  it('is on only when explicitly enabled AND fully capable', () => {
    expect(canUseOffscreenRendering(FULL, { enabled: true })).toBe(true);
    expect(canUseOffscreenRendering({ ...FULL, offscreenCanvas: false }, { enabled: true })).toBe(false);
    expect(canUseOffscreenRendering({ ...FULL, worker: false }, { enabled: true })).toBe(false);
    expect(canUseOffscreenRendering({ ...FULL, transferControl: false }, { enabled: true })).toBe(false);
  });

  it('forceMain overrides even when enabled + capable', () => {
    expect(canUseOffscreenRendering(FULL, { enabled: true, forceMain: true })).toBe(false);
  });
});

describe('isGeckoUA (the Firefox worker-path gate)', () => {
  it('matches Firefox on every platform', () => {
    // macOS, Windows, Linux, Android — all carry both "Gecko/<version>" and "Firefox/<version>".
    expect(isGeckoUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:141.0) Gecko/20100101 Firefox/141.0')).toBe(true);
    expect(isGeckoUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0')).toBe(true);
    expect(isGeckoUA('Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0')).toBe(true);
    expect(isGeckoUA('Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0')).toBe(true);
  });

  it('does not match WebKit/Blink browsers (their "like Gecko" token has no version slash)', () => {
    // Chrome + Safari say "(KHTML, like Gecko)" — no "Gecko/<digits>", no "Firefox/".
    expect(
      isGeckoUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'),
    ).toBe(false);
    expect(
      isGeckoUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'),
    ).toBe(false);
    // Firefox on iOS is WebKit underneath (FxiOS) — not Gecko, so it is NOT gated.
    expect(isGeckoUA('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15')).toBe(false);
  });
});

describe('resolveRenderPath (the step-6 render-path election)', () => {
  const FULL: OffscreenEnv = { offscreenCanvas: true, worker: true, transferControl: true };
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:141.0) Gecko/20100101 Firefox/141.0';
  const BARE: OffscreenEnv = { offscreenCanvas: false, worker: false, transferControl: false };

  it('?worker=0 is the escape hatch — main, always', () => {
    expect(resolveRenderPath('0', CHROME, FULL, true)).toBe('main');
    expect(resolveRenderPath('0', CHROME, FULL, false)).toBe('main');
  });

  it('?worker=1 elects the worker on a capable non-Gecko browser only', () => {
    expect(resolveRenderPath('1', CHROME, FULL)).toBe('worker');
    expect(resolveRenderPath('1', FIREFOX, FULL)).toBe('main'); // the Gecko gate
    expect(resolveRenderPath('1', CHROME, BARE)).toBe('main'); // no OffscreenCanvas
  });

  it('?worker=force bypasses the Gecko gate (re-testing), never the capability probe', () => {
    expect(resolveRenderPath('force', FIREFOX, FULL)).toBe('worker');
    expect(resolveRenderPath('force', FIREFOX, BARE)).toBe('main');
  });

  it('no param follows the staged default flip (WORKER_DEFAULT)', () => {
    expect(resolveRenderPath(null, CHROME, FULL, false)).toBe('main'); // today: opt-in
    expect(resolveRenderPath(null, CHROME, FULL, true)).toBe('worker'); // flipped: default-on
    expect(resolveRenderPath(null, FIREFOX, FULL, true)).toBe('main'); // …still never Gecko
    expect(resolveRenderPath(null, CHROME, BARE, true)).toBe('main'); // …still capability-gated
  });
});
