import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Body } from '../scene/Body';
import { dramaImminent, FULL_SHADER_APPROACH_R } from './fullShaderNeed';

const bodyAt = (r: number, extra: Partial<Body> = {}): Body =>
  ({
    id: 1,
    type: 'star',
    mass: 1e-3,
    lensMass: 0,
    fixed: false,
    position: new Vector3(r, 0, 0),
    velocity: new Vector3(),
    radius: 1.2,
    color: new Vector3(1, 1, 1),
    ...extra,
  }) as Body;

describe('dramaImminent (the compile-ahead trigger)', () => {
  it('is quiet for a steady scene: far live orbits + the fixed primary', () => {
    const primary = bodyAt(0, { fixed: true, type: 'hole' });
    expect(dramaImminent([primary, bodyAt(30), bodyAt(44)])).toBe(false);
  });

  it('fires the moment a plunge or chase starts — seconds before the tear renders', () => {
    expect(dramaImminent([bodyAt(30, { plunging: 0 })])).toBe(true);
    expect(dramaImminent([bodyAt(30, { chaseId: 7 })])).toBe(true);
  });

  it('fires on a natural close approach inside the approach radius', () => {
    expect(dramaImminent([bodyAt(FULL_SHADER_APPROACH_R - 1)])).toBe(true);
    expect(dramaImminent([bodyAt(FULL_SHADER_APPROACH_R + 1)])).toBe(false);
  });

  it('a body already absorbing is past the drama — not a trigger', () => {
    expect(dramaImminent([bodyAt(1, { absorbing: 0.3 })])).toBe(false);
  });

  it('the fixed primary at the origin never triggers', () => {
    expect(dramaImminent([bodyAt(0, { fixed: true, type: 'hole' })])).toBe(false);
  });
});
