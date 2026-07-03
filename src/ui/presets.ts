/**
 * Named looks. Presets deliberately toggle *physical* effects on and off (e.g.
 * Interstellar turns Doppler beaming off for the symmetric, art-directed disk),
 * so the panel doubles as an A/B of what's real versus stylised.
 */
export interface Preset {
  emissiveStrength: number;
  diskDensity: number;
  diskTemp: number;
  scatterStrength: number;
  extinction: number;
  doppler: number; // 0 or 1
  redshift: number; // 0 or 1
  turbAmount: number;
  rotationSpeed: number;
  exposure: number;
}

/** The selectable skies, in `background.value` order. Shared by the main panel and the worker
 *  panel (step 4a) so the two stay one list. */
export const BACKGROUNDS = ['Stars', 'Nebula', 'Filaments', 'Lattice'];

/** Per-background look presets, loaded into Advanced → Background on selection.
 *  Nebula reads best dim, near-grey and a touch warm; the rest keep neutrals. */
export const BG_PRESETS: Record<number, { brightness: number; saturation: number; tint: number }> = {
  0: { brightness: 1, saturation: 1, tint: 0 }, // Stars
  1: { brightness: 0.3, saturation: 1.75, tint: 0.25 }, // Nebula — dim, punchy, warm
  2: { brightness: 0.5, saturation: 1, tint: 0 }, // Filaments
  3: { brightness: 0.5, saturation: 1, tint: 0 }, // Lattice
};

export const PRESETS: Record<string, Preset> = {
  // Physically accurate: full beaming + redshift, hot inner disk.
  Physical: {
    emissiveStrength: 0.1, diskDensity: 1.0, diskTemp: 15000, scatterStrength: 0.2,
    extinction: 0.25, doppler: 1, redshift: 1, turbAmount: 0.9, rotationSpeed: 6, exposure: 1.0,
  },
  // EHT-style orange photon-ring look (cooler, smoother).
  EHT: {
    emissiveStrength: 0.13, diskDensity: 1.2, diskTemp: 9000, scatterStrength: 0.15,
    extinction: 0.3, doppler: 1, redshift: 1, turbAmount: 0.7, rotationSpeed: 5, exposure: 1.1,
  },
  // Interstellar: symmetric, stylised — Doppler beaming OFF.
  Interstellar: {
    emissiveStrength: 0.1, diskDensity: 1.1, diskTemp: 11000, scatterStrength: 0.3,
    extinction: 0.2, doppler: 0, redshift: 1, turbAmount: 0.6, rotationSpeed: 4, exposure: 1.0,
  },
  // Stylised: punchy, hot, turbulent.
  Stylized: {
    emissiveStrength: 0.2, diskDensity: 1.4, diskTemp: 18000, scatterStrength: 0.5,
    extinction: 0.2, doppler: 1, redshift: 1, turbAmount: 1.2, rotationSpeed: 9, exposure: 1.2,
  },
};
