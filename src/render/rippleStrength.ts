/**
 * Roadmap #6 — a merger rings harder than a speck. Maps an absorbed body's mass to the spacetime
 * ripple's amplitude (`uniforms.rippleStrength`, multiplied into the envelope in
 * `render/tsl/background.ts`'s `rippleWarp`), so a black-hole coalescence distorts + flashes the sky
 * more than a star/planet plunge.
 *
 * Gravitational-wave strain scales with the merging mass, so this is linear-in-mass — but clamped, a
 * *look* cue rather than a literal strain: a star (~1e-3) maps to ~1× (the unchanged baseline, so the
 * common star/planet plunge is no different than before), a secondary hole (~0.2) to ~2.6×, and it
 * never exceeds the cap. Pure → unit-tested; set CPU-side on the `absorb` event (see `main.ts`).
 */
// Raised for the "overwhelming hole plunge" pass (live review): a star (~1e-3) still maps to
// ~1.02x (the common plunge is visually unchanged), but a secondary hole (~0.2) now rides to
// ~4.2x - and the shader stretches the ringdown *time* by the square root of strength too
// (background.ts), so the biggest merger both hits harder AND rings roughly twice as long.
// Physically the right shape: GW strain grows with the merging mass, the ringdown time with
// the final mass.
export const RIPPLE_MASS_GAIN = 16;
export const RIPPLE_STRENGTH_MAX = 4.5;

export function rippleStrengthForMass(mass: number): number {
  return Math.min(RIPPLE_STRENGTH_MAX, 1 + RIPPLE_MASS_GAIN * Math.max(0, mass));
}
