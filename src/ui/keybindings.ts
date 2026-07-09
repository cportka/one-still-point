/**
 * Global keyboard shortcuts, registered once from createControls (which owns the
 * actions they trigger):
 *
 *   Esc          close an open overlay, else toggle the About dialog
 *   ? or /       the keyboard-shortcuts cheat-sheet
 *   Space        Pause / Resume
 *   ← / →        Step back / forward
 *   ↑ / ↓        double / halve the Speed
 *   R            Replay intro
 *   F            toggle the HUD
 *
 * Text entry is never hijacked. The action keys also defer to a focused
 * button/slider (so they don't double-fire or fight a control the user is
 * operating) and act when focus is on the scene — Esc works from anywhere.
 */
export interface Keybindings {
  /** Esc: close an open overlay if any, otherwise toggle About. */
  onEscape: () => void;
  toggleShortcuts: () => void;
  togglePause: () => void;
  toggleFps: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  replayIntro: () => void;
  /** Multiply the time scale (2 = double, 0.5 = halve). */
  speedBy: (factor: number) => void;
}

const isTextField = (el: Element | null): boolean =>
  !!el && ((el as HTMLElement).isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));

export function attachKeybindings(actions: Keybindings): void {
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // leave browser/OS shortcuts alone
    const el = document.activeElement;
    if (isTextField(el)) return; // never hijack typing

    // Esc and ? work from anywhere (they don't activate a focused control).
    if (e.key === 'Escape') {
      actions.onEscape();
      e.preventDefault();
      return;
    }
    if (e.key === '?' || e.key === '/') {
      // "/" so the user need not press Shift; preventDefault stops Firefox quick-find.
      actions.toggleShortcuts();
      e.preventDefault();
      return;
    }

    // Action keys: if a button/slider is focused, let it handle the key natively
    // (e.g. Space re-clicks a focused Pause exactly once) rather than double-acting.
    if (el && el.tagName === 'BUTTON') return;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        actions.togglePause();
        break;
      case 'ArrowRight':
        actions.stepForward();
        break;
      case 'ArrowLeft':
        actions.stepBackward();
        break;
      case 'ArrowUp':
        actions.speedBy(2);
        break;
      case 'ArrowDown':
        actions.speedBy(0.5);
        break;
      default:
        // Letter shortcuts, case-insensitive.
        switch (e.key.toLowerCase()) {
          case 'r':
            actions.replayIntro();
            break;
          case 'f':
            actions.toggleFps();
            break;
          default:
            return; // not ours — leave default behaviour intact
        }
    }
    e.preventDefault();
  });
}
