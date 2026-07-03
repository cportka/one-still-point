import { describe, expect, it } from 'vitest';
import { RIPPLE_MASS_GAIN, RIPPLE_STRENGTH_MAX, rippleStrengthForMass } from './rippleStrength';

describe('rippleStrengthForMass', () => {
  it('leaves a star/planet plunge at the baseline (no regression for the common case)', () => {
    expect(rippleStrengthForMass(1e-3)).toBeCloseTo(1 + RIPPLE_MASS_GAIN * 1e-3, 6); // ≈ 1.008
    expect(rippleStrengthForMass(1e-5)).toBeCloseTo(1, 3); // a planet is essentially baseline
  });

  it('rings a black-hole merger harder than a star plunge', () => {
    const star = rippleStrengthForMass(1e-3);
    const hole = rippleStrengthForMass(0.2); // a secondary hole's mass
    expect(hole).toBeGreaterThan(star);
    expect(hole).toBeCloseTo(1 + RIPPLE_MASS_GAIN * 0.2, 6); // ≈ 4.2 (the overwhelming-plunge pass)
  });

  it('clamps at the cap for a very heavy body', () => {
    expect(rippleStrengthForMass(1)).toBe(RIPPLE_STRENGTH_MAX);
    expect(rippleStrengthForMass(1000)).toBe(RIPPLE_STRENGTH_MAX);
  });

  it('never drops below the baseline (a massless/zero body still rings at 1×)', () => {
    expect(rippleStrengthForMass(0)).toBe(1);
    expect(rippleStrengthForMass(-5)).toBe(1); // guarded against a stray negative
  });

  it('increases monotonically with mass up to the cap', () => {
    expect(rippleStrengthForMass(0.05)).toBeLessThan(rippleStrengthForMass(0.1));
    expect(rippleStrengthForMass(0.1)).toBeLessThan(rippleStrengthForMass(0.2));
  });
});
