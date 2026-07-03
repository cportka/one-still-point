import { describe, expect, it } from 'vitest';
import { applyControl, CONTROL_KEYS, type ControlTargets } from './controlMap';

/** A fully-instrumented fake target set: every cell starts at a sentinel, every setter records. */
function fakeTargets() {
  const cell = () => ({ value: -999 });
  const calls: Record<string, unknown[]> = { exposure: [], maxFps: [], quality: [] };
  const t: ControlTargets = {
    blackHole: {
      emissiveStrength: cell(),
      diskDensity: cell(),
      diskTemp: cell(),
      scatterStrength: cell(),
      extinction: cell(),
      doppler: cell(),
      redshift: cell(),
      turbAmount: cell(),
      rotationSpeed: cell(),
      volumeStep: cell(),
    },
    background: { mode: cell(), brightness: cell(), saturation: cell(), tint: cell() },
    bloom: { strength: cell(), radius: cell(), threshold: cell() },
    time: { timeScale: -999, paused: false },
    setExposure: (v) => calls.exposure!.push(v),
    setMaxFps: (v) => calls.maxFps!.push(v),
    setQuality: (tier) => calls.quality!.push(tier),
  };
  return { t, calls };
}

/** Where each key's write lands — the table-driven acceptance walk (the 4a checklist item). */
const EXPECT: Record<string, (t: ControlTargets, calls: Record<string, unknown[]>) => unknown> = {
  'bh.emissiveStrength': (t) => t.blackHole.emissiveStrength.value,
  'bh.diskDensity': (t) => t.blackHole.diskDensity.value,
  'bh.diskTemp': (t) => t.blackHole.diskTemp.value,
  'bh.scatterStrength': (t) => t.blackHole.scatterStrength.value,
  'bh.extinction': (t) => t.blackHole.extinction.value,
  'bh.doppler': (t) => t.blackHole.doppler.value,
  'bh.redshift': (t) => t.blackHole.redshift.value,
  'bh.turbAmount': (t) => t.blackHole.turbAmount.value,
  'bh.rotationSpeed': (t) => t.blackHole.rotationSpeed.value,
  'bh.volumeStep': (t) => t.blackHole.volumeStep.value,
  'bg.mode': (t) => t.background.mode.value,
  'bg.brightness': (t) => t.background.brightness.value,
  'bg.saturation': (t) => t.background.saturation.value,
  'bg.tint': (t) => t.background.tint.value,
  'bloom.strength': (t) => t.bloom.strength.value,
  'bloom.radius': (t) => t.bloom.radius.value,
  'bloom.threshold': (t) => t.bloom.threshold.value,
  'time.scale': (t) => t.time.timeScale,
  'render.exposure': (_t, calls) => calls.exposure!.at(-1),
  'render.maxFps': (_t, calls) => calls.maxFps!.at(-1),
};

describe('controlMap (the 4a channel table)', () => {
  it('every numeric key writes its target — the full-table walk', () => {
    let n = 1;
    for (const key of Object.keys(EXPECT)) {
      const { t, calls } = fakeTargets();
      const value = n++ * 1.5; // distinct per key, so a cross-wired setter would show
      expect(applyControl(t, key, value)).toBe(true);
      expect(EXPECT[key]!(t, calls)).toBe(value);
    }
  });

  it('covers exactly the exported key list (no dead keys, no untested keys)', () => {
    const tested = new Set([...Object.keys(EXPECT), 'time.paused', 'render.quality']);
    expect(new Set(CONTROL_KEYS)).toEqual(tested);
  });

  it('time.paused takes a boolean and rejects non-booleans', () => {
    const { t } = fakeTargets();
    expect(applyControl(t, 'time.paused', true)).toBe(true);
    expect(t.time.paused).toBe(true);
    applyControl(t, 'time.paused', 1); // a number must not sneak into a boolean field
    expect(t.time.paused).toBe(true);
  });

  it('render.quality accepts only real tiers (auto re-detects worker-side)', () => {
    const { t, calls } = fakeTargets();
    for (const tier of ['auto', 'low', 'medium', 'high']) {
      expect(applyControl(t, 'render.quality', tier)).toBe(true);
    }
    expect(calls.quality).toEqual(['auto', 'low', 'medium', 'high']);
    applyControl(t, 'render.quality', 'ultra'); // unknown tier → ignored, no throw
    expect(calls.quality).toHaveLength(4);
  });

  it('guards live uniforms against malformed values (NaN / wrong type / unknown key)', () => {
    const { t } = fakeTargets();
    applyControl(t, 'bh.diskTemp', Number.NaN);
    applyControl(t, 'bh.diskTemp', 'hot');
    expect(t.blackHole.diskTemp.value).toBe(-999); // untouched
    expect(applyControl(t, 'warp.factor', 9)).toBe(false); // unknown key → not handled
  });
});
