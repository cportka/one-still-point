import type GUI from 'lil-gui';
import type { Controller } from 'lil-gui';
import type { Hud } from './hud';

/** Attach a native hover tooltip to a controller's row (mirrors Controls.ts `tip`). */
type Tip = <T extends Controller>(controller: T, text: string) => T;

export interface HudFolder {
  /** The lil-gui folder (so the Advanced toggle can show/hide it). */
  folder: GUI;
  /** Toggle HUD visibility (wired to the F key). */
  toggle: () => void;
}

/**
 * The "Display HUD" panel section — a **compact** collapsible folder whose *parent
 * title itself carries the on/off checkbox*. Toggling that checkbox shows/hides the
 * lower-left HUD; expanding the folder reveals its two child toggles:
 *
 *   ☐ ▸ Display HUD        ← checkbox in the title toggles the HUD (off by default)
 *       ☑ Frame-time graph ← children on by default, so the first time the HUD is
 *       ☑ Detail              turned on it shows everything
 *
 * The folder starts **collapsed**. lil-gui has no native title-checkbox, so a real
 * hidden boolean controller (`prefs.showFps`) stays the source of truth — it persists
 * through the panel's settings loop and supports `setValue` for the keybinding — and a
 * mirror checkbox is injected into the folder's title button (a `click` that stops
 * propagation so it doesn't also expand/collapse the folder).
 */
export function createHudFolder(gui: GUI, hud: Hud, prefs: { showFps: boolean }, tip: Tip): HudFolder {
  const folder = gui.addFolder('Display HUD');
  hud.setVisible(prefs.showFps);
  // Children on by default → turning the HUD on the first time shows everything.
  const hudOpts = { graph: true, detail: true, map: true };
  hud.setOptions(hudOpts);

  // Source of truth: a hidden boolean controller (persisted + keybinding-driveable).
  const showCtrl = folder.add(prefs, 'showFps').name('Display HUD');
  showCtrl.domElement.style.display = 'none';

  // The visible toggle: a checkbox mirrored into the folder *title* (compact).
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'osp-hud-titlebox';
  box.checked = prefs.showFps;
  box.setAttribute('aria-label', 'Display HUD');
  box.addEventListener('click', (e) => e.stopPropagation()); // tick the box without toggling the folder
  box.addEventListener('change', () => showCtrl.setValue(box.checked));
  folder.$title.classList.add('osp-hud-title'); // flex, so the checkbox sits at the right
  folder.$title.append(box); // to the *right* of the label (after the caret + text)
  folder.$title.title =
    'Show the lower-left HUD — frame rate + resolution, plus the child rows below. ' +
    'Tick this box to toggle it (the F key does too); the row arrow expands its options.';
  // Keep the checkbox in sync however state changes (keybinding, settings load, click).
  showCtrl.onChange((v: boolean) => {
    box.checked = v;
    hud.setVisible(v);
  });

  const children = [
    tip(
      folder.add(hudOpts, 'graph').name('Frame-time graph'),
      'A live frame-time sparkline (green = smooth, amber/red = slow frames).',
    ),
    tip(
      folder.add(hudOpts, 'detail').name('Detail'),
      'Show the S/P/B body breakdown (stars / planets / black holes) · time scale · CPU/GPU compute path.',
    ),
    tip(
      folder.add(hudOpts, 'map').name('Orbit map'),
      'A live overhead view: the central hole, each companion riding its current orbit circle, ' +
        'and a chevron marking where the camera sits and which way it faces.',
    ),
  ];
  children.forEach((c) => c.onChange(() => hud.setOptions(hudOpts)));
  folder.close(); // collapsed by default

  return { folder, toggle: () => showCtrl.setValue(!prefs.showFps) };
}
