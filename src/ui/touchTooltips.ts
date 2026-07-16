import { isCoarsePointer } from '../core/device';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const AUTO_HIDE_MS = 4000;

/**
 * Tooltip popup for the control panel — two ways in:
 *
 * - **Long-press** (touch devices): native `title` hovers never fire on touch, so a long press on
 *   any row carrying a `title` shows the text in a floating popup (auto-hides after a few seconds).
 * - **Click-to-toggle** (all pointers, v0.97.2): clicking a row's *label* (the `.name` cell — never
 *   the widget, so sliders/selects/buttons keep working) shows the same popup and **pins** it.
 *   If the popup is already showing for that row (e.g. from a long-press), the first click pins it
 *   open instead of closing; clicking the label again closes. Clicking another label switches;
 *   clicking anywhere else dismisses.
 */
export function attachTouchTooltips(root: HTMLElement): void {
  const pop = document.createElement('div');
  pop.className = 'osp-tooltip';
  document.body.appendChild(pop);

  let timer = 0;
  let hideTimer = 0;
  let startX = 0;
  let startY = 0;
  let shownFor: HTMLElement | null = null; // the [title] row the popup currently describes
  let pinned = false; // a clicked (pinned) popup ignores the auto-hide

  const hide = (): void => {
    pop.classList.remove('is-visible');
    window.clearTimeout(hideTimer);
    shownFor = null;
    pinned = false;
  };

  const show = (row: HTMLElement, text: string, x: number, y: number, pin: boolean): void => {
    pop.textContent = text;
    pop.classList.add('is-visible');
    // Measure, then clamp on-screen — above the pointer, nudged in from the edges.
    const r = pop.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(x - r.width / 2, margin), window.innerWidth - r.width - margin);
    const top = Math.max(y - r.height - 16, margin);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    shownFor = row;
    pinned = pin;
    window.clearTimeout(hideTimer);
    if (!pin) hideTimer = window.setTimeout(hide, AUTO_HIDE_MS);
  };

  // --- Click-to-toggle (all pointer types) -------------------------------------------------------
  root.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    // Only the label cell toggles — a click on the widget (slider, select, checkbox, button)
    // operates the control and must never fight a tooltip.
    if (!target || target.closest('button, input, select, textarea')) return;
    const name = target.closest('.name');
    if (!name) return;
    const row = name.closest('[title]') as HTMLElement | null;
    const text = row?.getAttribute('title');
    if (!row || !text) return;
    if (shownFor === row) {
      if (pinned) hide(); // second click on a pinned popup → close
      else {
        pinned = true; // already showing (long-press) → the first click PINS it open
        window.clearTimeout(hideTimer);
      }
      return;
    }
    show(row, text, e.clientX, e.clientY, true);
  });

  // A click/tap anywhere outside the panel or the popup dismisses a pinned tooltip.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node | null;
    if (shownFor && t && !root.contains(t) && !pop.contains(t)) hide();
  });

  // --- Long-press (touch only) -------------------------------------------------------------------
  if (!isCoarsePointer()) return;

  const cancel = (): void => window.clearTimeout(timer);

  root.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (!pinned) hide(); // a fresh touch dismisses an auto tooltip (a pinned one keeps its click contract)
      const touch = e.touches[0];
      if (!touch) return;
      const row = (e.target as HTMLElement | null)?.closest('[title]') as HTMLElement | null;
      const text = row?.getAttribute('title');
      if (!row || !text) return;
      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => show(row, text, startX, startY, false), LONG_PRESS_MS);
    },
    { passive: true },
  );

  root.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch && Math.hypot(touch.clientX - startX, touch.clientY - startY) > MOVE_CANCEL_PX) cancel();
    },
    { passive: true },
  );

  root.addEventListener('touchend', cancel, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
}
