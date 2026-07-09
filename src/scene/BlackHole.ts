import { uniform } from 'three/tsl';

/**
 * A Schwarzschild black hole's parameters, exposed as GPU uniforms. This is the
 * seed of the Phase 5 scene/body model — for now there is exactly one hole at
 * the origin, but the shader reads its parameters as uniforms so the data
 * already flows the way a multi-body scene will.
 *
 * `mass` (M) is the length scale in geometric units (G = c = 1): horizon 2M,
 * photon sphere 3M, ISCO 6M. Disk radii are in units of M.
 *
 * Everything here is live-tunable from the console before the Phase 4 GUI, e.g.
 * `osp.blackHole.emissiveStrength.value = 90`, `osp.blackHole.doppler.value = 0`,
 * and `osp.loop.paused = true` freezes the animation to inspect the lensing.
 */
export function createBlackHole() {
  return {
    mass: uniform(1),
    // Roadmap #10 — experimental Kerr spin (a/M). 0 = Schwarzschild (the default). Drives a
    // phenomenological frame-dragging term in the geodesic (see schwarzschild.ts / raymarch.ts).
    spin: uniform(0),

    // Disk geometry & thermodynamics
    diskInner: uniform(6), // inner edge = ISCO = 6M
    diskOuter: uniform(20), // outer edge (M)
    diskTemp: uniform(15000), // peak temperature scale (K)
    diskThickness: uniform(0.8), // vertical Gaussian scale height (M)
    doppler: uniform(1), // relativistic beaming toggle (0 or 1)
    redshift: uniform(1), // gravitational redshift toggle (0 or 1)

    // Volumetric dust (Phase 3, retuned in Phase 4)
    diskDensity: uniform(1.0), // overall density scale
    emissiveStrength: uniform(0.1), // HDR heat-emission scale
    scatterStrength: uniform(0.12), // cheap single-scatter of inner light (0.2 → 0.12: the diffuse fill washed the disk out; less fill = darker darks, more contrast)
    extinction: uniform(0.25), // Beer–Lambert opacity (lower = more transparent)
    volumeStep: uniform(0.25), // affine step inside the disk slab (M)

    // Turbulence & flow (Phase 3 animation)
    turbAmount: uniform(0.9), // turbulence depth (filament contrast)
    turbScale: uniform(0.3), // turbulence frequency (1/M)
    rotationSpeed: uniform(6), // visual multiplier on Keplerian Ω·t
    infallRate: uniform(0.15), // inward radial drift
    churnRate: uniform(0.25), // turbulence evolution rate (anti-boil)
  };
}

export type BlackHole = ReturnType<typeof createBlackHole>;
