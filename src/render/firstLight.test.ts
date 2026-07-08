import { describe, expect, it } from 'vitest';
import { FIRST_LIGHT_DEFAULT, resolveFirstLight } from './firstLight';

describe('resolveFirstLight (the staged cold-compile election)', () => {
  it('returns the default when there is no ?firstlight param', () => {
    expect(resolveFirstLight('')).toBe(FIRST_LIGHT_DEFAULT);
    expect(resolveFirstLight('?worker=1')).toBe(FIRST_LIGHT_DEFAULT);
    // The default is now ON (v0.71.0, after the on-device numbers) — guard it so a revert is a
    // deliberate edit.
    expect(FIRST_LIGHT_DEFAULT).toBe(true);
  });

  it('forces on with ?firstlight=1/on/true', () => {
    for (const s of ['?firstlight=1', '?firstlight=on', '?firstlight=true']) {
      expect(resolveFirstLight(s)).toBe(true);
    }
  });

  it('forces off with ?firstlight=0/off/false — the escape hatch, even if the default flips', () => {
    for (const s of ['?firstlight=0', '?firstlight=off', '?firstlight=false']) {
      expect(resolveFirstLight(s, true)).toBe(false);
    }
  });

  it('honours an explicitly passed default (so the flip is one constant)', () => {
    expect(resolveFirstLight('', true)).toBe(true);
    expect(resolveFirstLight('', false)).toBe(false);
  });
});
