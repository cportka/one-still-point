import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';

/** Attach a native hover tooltip to a controller's row (mirrors Controls.ts `tip`). */
type Tip = <T extends Controller>(controller: T, text: string) => T;

/** A Galaxy-Mode dial key — the live settings the menu exposes. */
export type GalaxyDial = 'spin' | 'brightness' | 'size' | 'glow' | 'darkMatter' | 'darkEnergy';

export interface GalaxyFolderCtx {
  /** Toggle Galaxy Mode on/off (roadmap #9). */
  setGalaxyMode: (on: boolean) => void;
  isGalaxyMode: () => boolean;
  /** Push a live dial value to the galaxy layer (a multiplier; 1 = the authored default). */
  setGalaxyDial: (key: GalaxyDial, value: number) => void;
  /** Side effect run when the user turns Galaxy Mode OFF *while it's live*: tuck the panel + scrub
   *  bar away for the exit intro (mirrors Replay). Runs before `setGalaxyMode(false)`. */
  onExit: () => void;
}

export interface GalaxyFolder {
  /** The lil-gui folder (so the Advanced toggle can show/hide it). */
  folder: GUI;
}

/**
 * The "Galaxy mode" panel section — a compact collapsible folder whose *parent title itself carries
 * the on/off checkbox* (mirrors the Display HUD folder). Ticking the title box blooms / collapses
 * Galaxy Mode; expanding the folder reveals its live dials:
 *
 *   ☐ ▸ Galaxy mode         ← checkbox in the title toggles the mode (off by default)
 *       Rotation speed       ← dials, each a multiplier on the authored default (1 = as-is)
 *       Star brightness
 *       Star size
 *       Core glow
 *
 * The folder starts **collapsed**. lil-gui has no native title-checkbox, so a real hidden boolean
 * controller stays the source of truth and a mirror checkbox is injected into the folder's title
 * button (a `click` that stops propagation so it doesn't also expand/collapse the folder) — the same
 * pattern (and CSS) as {@link createHudFolder}.
 */
export function createGalaxyFolder(gui: GUI, ctx: GalaxyFolderCtx, tip: Tip): GalaxyFolder {
  const folder = gui.addFolder('Galaxy mode');

  // Source of truth: a hidden boolean controller, initialised from the live mode state.
  const proxy = { on: ctx.isGalaxyMode() };
  const showCtrl = folder.add(proxy, 'on').name('Galaxy mode');
  showCtrl.domElement.style.display = 'none';

  // The visible toggle: a checkbox mirrored into the folder *title* (compact), reusing the HUD
  // folder's title styling so the two sections match.
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'osp-hud-titlebox';
  box.checked = proxy.on;
  box.setAttribute('aria-label', 'Galaxy mode');
  box.addEventListener('click', (e) => e.stopPropagation()); // tick the box without toggling the folder
  box.addEventListener('change', () => showCtrl.setValue(box.checked));
  folder.$title.classList.add('osp-hud-title'); // flex, so the checkbox sits at the right
  folder.$title.append(box);
  folder.$title.title =
    'Bloom the scene into a small full spiral galaxy — a glowing core, blue spiral arms, and ~1600 ' +
    'stars (some with planets) orbiting the central hole. Tick this box to toggle it; the row arrow ' +
    'reveals its dials. Regular mode pauses while it’s up; toggling off resets and replays the intro.';

  showCtrl.onChange((v: boolean) => {
    box.checked = v;
    // Turning OFF while the mode is live tucks the panel away for the exit intro (like Replay). Guard
    // on isGalaxyMode(): if the mode already dropped to off (a failed lazy build, or a render error
    // disabled it), hiding here would strand the panel with nothing to restore it.
    if (!v && ctx.isGalaxyMode()) ctx.onExit();
    ctx.setGalaxyMode(v);
  });

  // The dials — each a multiplier on the authored default (1 = as-is), pushed live to the layer.
  tip(
    folder.add({ v: 1 }, 'v', 0, 4, 0.05).name('Rotation speed').onChange((v: number) => ctx.setGalaxyDial('spin', v)),
    'How fast the galaxy turns (× the default). 0 = frozen; higher = a brisker spin. This rides on ' +
      'top of the global Speed as well.',
  );
  tip(
    folder.add({ v: 1 }, 'v', 0.2, 2.5, 0.05).name('Star brightness').onChange((v: number) => ctx.setGalaxyDial('brightness', v)),
    'Overall brightness of the star field (× the default). Higher = a more luminous galaxy.',
  );
  tip(
    folder.add({ v: 1 }, 'v', 0.3, 3, 0.05).name('Star size').onChange((v: number) => ctx.setGalaxyDial('size', v)),
    'How large each star renders (× the default). Stars scale with zoom either way — this is a global ' +
      'multiplier on top.',
  );
  tip(
    folder.add({ v: 1 }, 'v', 0, 2, 0.05).name('Core glow').onChange((v: number) => ctx.setGalaxyDial('glow', v)),
    'Brightness of the warm glow at the galactic centre (× the default). 0 = no core glow.',
  );
  // The dark sector — the star-rotation dials (0..1). Dark matter defaults ON so the arms persist.
  tip(
    folder.add({ v: 0.55 }, 'v', 0, 1, 0.01).name('Dark matter').onChange((v: number) => ctx.setGalaxyDial('darkMatter', v)),
    'A dark-matter halo — flattens the rotation curve so the outer arms keep up with the inner disk ' +
      'and the spiral persists instead of quickly shearing into a smooth disk. 0 = none (pure Kepler ' +
      'shear); on by default. The classic reason real galaxies keep their arms.',
  );
  tip(
    folder.add({ v: 0 }, 'v', 0, 1, 0.01).name('Dark energy').onChange((v: number) => ctx.setGalaxyDial('darkEnergy', v)),
    'A cosmological-constant repulsion — slows and eventually stops the outermost arms (cosmic ' +
      'expansion, in miniature). Exaggerated for visibility. 0 = off.',
  );

  folder.close(); // collapsed by default
  return { folder };
}
