import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';

/** Attach a native hover tooltip to a controller's row (mirrors Controls.ts `tip`). */
type Tip = <T extends Controller>(controller: T, text: string) => T;

/** A Galaxy-Mode dial key — the live settings the menu exposes. */
export type GalaxyDial = 'spin' | 'brightness' | 'size' | 'glow' | 'darkMatter' | 'darkEnergy';

/**
 * The **Galaxy-Mode dials** (rotation / brightness / size / core glow / dark matter / dark energy) —
 * the live settings for Galaxy Mode. They're added **flat, directly onto the root panel** (no
 * "Galaxy settings" sub-folder: in Galaxy mode the whole menu *is* the galaxy's settings, so a
 * nested folder was redundant) right after the mode switch + Speed, and shown only while Galaxy mode
 * is active (Controls' registry hides them in Singularity). Each dial is a multiplier / 0..1 on the
 * authored default (1 = as-is), pushed live to the layer via `setGalaxyDial`. Returns the six
 * controllers so Controls can show/hide them with the mode.
 */
export function createGalaxyDials(
  gui: GUI,
  setGalaxyDial: (key: GalaxyDial, value: number) => void,
  tip: Tip,
): Controller[] {
  return [
    tip(
      gui.add({ v: 1 }, 'v', 0, 4, 0.05).name('Rotation speed').onChange((v: number) => setGalaxyDial('spin', v)),
      'How fast the galaxy turns (× the default). 0 = frozen; higher = a brisker spin. Rides on top of ' +
        'the global Speed as well.',
    ),
    tip(
      gui.add({ v: 1 }, 'v', 0.2, 2.5, 0.05).name('Star brightness').onChange((v: number) => setGalaxyDial('brightness', v)),
      'Overall brightness of the star field (× the default). Higher = a more luminous galaxy.',
    ),
    tip(
      gui.add({ v: 1 }, 'v', 0.3, 3, 0.05).name('Star size').onChange((v: number) => setGalaxyDial('size', v)),
      'How large each star renders (× the default). Stars scale with zoom either way — this is a global ' +
        'multiplier on top.',
    ),
    tip(
      gui.add({ v: 1 }, 'v', 0, 2, 0.05).name('Core glow').onChange((v: number) => setGalaxyDial('glow', v)),
      'Brightness of the warm glow at the galactic centre (× the default). 0 = no core glow.',
    ),
    tip(
      gui.add({ v: 0.55 }, 'v', 0, 1, 0.01).name('Dark matter').onChange((v: number) => setGalaxyDial('darkMatter', v)),
      'A dark-matter halo — flattens the rotation curve so the outer arms keep up with the inner disk ' +
        'and the spiral persists instead of quickly shearing into a smooth disk. 0 = none (pure Kepler ' +
        'shear); on by default. The classic reason real galaxies keep their arms.',
    ),
    tip(
      gui.add({ v: 0 }, 'v', 0, 1, 0.01).name('Dark energy').onChange((v: number) => setGalaxyDial('darkEnergy', v)),
      'A cosmological-constant repulsion — slows and eventually stops the outermost arms (cosmic ' +
        'expansion, in miniature). Exaggerated for visibility. 0 = off.',
    ),
  ];
}
