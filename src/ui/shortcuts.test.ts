// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createShortcutsOverlay } from './shortcuts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createShortcutsOverlay', () => {
  it('starts hidden; toggle shows/hides; tapping the panel dismisses', () => {
    const overlay = createShortcutsOverlay();
    const panel = document.querySelector<HTMLElement>('.osp-keys')!;
    expect(panel.hidden).toBe(true);
    overlay.toggle();
    expect(overlay.isOpen()).toBe(true);
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.isOpen()).toBe(false);
  });

  it('a click anywhere outside the panel dismisses it (live review)', () => {
    const overlay = createShortcutsOverlay();
    overlay.toggle();
    expect(overlay.isOpen()).toBe(true);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })); // e.g. the canvas
    expect(overlay.isOpen()).toBe(false);
  });

  it('an opener that stops its click propagation does not immediately re-close it', () => {
    // The Keys button opens on click and stopPropagation()s — the document-level outside-close
    // must never see that click (else every open would instantly close).
    const overlay = createShortcutsOverlay();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.toggle();
    });
    opener.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(overlay.isOpen()).toBe(true); // opened, and stayed open
  });
});
