import { EVENT_COLOR, EVENT_LEGEND } from './historyBar';

/**
 * The general **info popover**, toggled with "?" (or "/"): the keyboard shortcuts plus a colour
 * key for the history scrub bar's transient-event ticks. Not a modal — a small translucent panel
 * pinned to the **top-left** (mirroring the control panel top-right), at the same opacity as the
 * dropdown. Tap it, or press ? / / / Esc, to dismiss.
 */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Esc', 'About dialog'],
  ['? /', 'This shortcuts list'],
  ['Space', 'Pause / Resume'],
  ['← →', 'Step back / forward'],
  ['↑ ↓', 'Speed ×2 / ÷2'],
  ['R', 'Replay intro'],
  ['F', 'Toggle HUD'],
];

export interface ShortcutsOverlay {
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createShortcutsOverlay(): ShortcutsOverlay {
  const panel = document.createElement('div');
  panel.className = 'osp-keys';
  panel.hidden = true;
  const keyRows = SHORTCUTS.map(
    ([keys, label]) =>
      `<div class="osp-keys__row"><span class="osp-keys__k">${keys
        .split(' ')
        .map((k) => `<kbd>${k}</kbd>`)
        .join(' ')}</span><span class="osp-keys__d">${label}</span></div>`,
  ).join('');
  // Colour key for the history scrub bar's transient-event ticks (palette in historyBar.ts).
  const legendRows = EVENT_LEGEND.map(
    ([type, label]) =>
      `<div class="osp-keys__row"><span class="osp-keys__sw" style="--c:${EVENT_COLOR[type]}"></span>` +
      `<span class="osp-keys__d">${label}</span></div>`,
  ).join('');
  panel.innerHTML =
    `<div class="osp-keys__title">Keyboard shortcuts</div>${keyRows}` +
    `<div class="osp-keys__title osp-keys__sub">Timeline events</div>${legendRows}`;
  document.body.appendChild(panel);

  const close = (): void => {
    panel.hidden = true;
  };
  const toggle = (): void => {
    panel.hidden = !panel.hidden;
  };
  const isOpen = (): boolean => !panel.hidden;
  panel.addEventListener('click', close); // tap the panel to dismiss (touch)
  // …and a click anywhere OUTSIDE it dismisses too (live review). A document-level `click`
  // listener, deliberately not `pointerdown`: the panel's openers (the Keys button, lil-gui
  // rows) stop their click's propagation, so an opening click never reaches this and
  // immediately re-closes what it just opened — while a click on the canvas/backdrop does.
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node)) close();
  });
  return { toggle, close, isOpen };
}
