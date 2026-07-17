// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachKeybindings, type Keybindings } from './keybindings';

// One set of mock actions + a single listener (attachKeybindings has no detach);
// counts are reset per test.
const actions: Keybindings = {
  onEscape: vi.fn(),
  toggleShortcuts: vi.fn(),
  togglePause: vi.fn(),
  toggleFps: vi.fn(),
  stepForward: vi.fn(),
  stepBackward: vi.fn(),
  replayIntro: vi.fn(),
  speedBy: vi.fn(),
  toggleShare: vi.fn(),
};

beforeAll(() => attachKeybindings(actions));
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('attachKeybindings', () => {
  it('maps the playback keys to their actions', () => {
    press(' ');
    expect(actions.togglePause).toHaveBeenCalledOnce();
    press('ArrowRight');
    expect(actions.stepForward).toHaveBeenCalledOnce();
    press('ArrowLeft');
    expect(actions.stepBackward).toHaveBeenCalledOnce();
    press('ArrowUp');
    expect(actions.speedBy).toHaveBeenLastCalledWith(2);
    press('ArrowDown');
    expect(actions.speedBy).toHaveBeenLastCalledWith(0.5);
  });

  it('handles Esc, ? and / (no Shift), and the case-insensitive letters', () => {
    press('Escape');
    expect(actions.onEscape).toHaveBeenCalledOnce();
    press('?');
    press('/');
    expect(actions.toggleShortcuts).toHaveBeenCalledTimes(2);
    press('R'); // upper-case still maps
    press('f');
    press('s');
    expect(actions.replayIntro).toHaveBeenCalledOnce();
    expect(actions.toggleFps).toHaveBeenCalledOnce();
    expect(actions.toggleShare).toHaveBeenCalledOnce(); // S opens the Share modal
  });

  it('preventDefaults handled keys and leaves unknown keys alone', () => {
    expect(press(' ').defaultPrevented).toBe(true);
    const unknown = press('q');
    expect(unknown.defaultPrevented).toBe(false);
  });

  it('never hijacks typing in a text field', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    press(' ');
    press('ArrowUp');
    press('Escape');
    expect(actions.togglePause).not.toHaveBeenCalled();
    expect(actions.speedBy).not.toHaveBeenCalled();
    expect(actions.onEscape).not.toHaveBeenCalled();
  });

  it('ignores modifier combos (browser / OS shortcuts)', () => {
    press(' ', { metaKey: true });
    press('ArrowUp', { ctrlKey: true });
    press('r', { altKey: true });
    expect(actions.togglePause).not.toHaveBeenCalled();
    expect(actions.speedBy).not.toHaveBeenCalled();
    expect(actions.replayIntro).not.toHaveBeenCalled();
  });

  it('defers Space to a focused button, but Esc AND the letters still fire from anywhere', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    press(' '); // native button activation owns Space — we must not double-fire
    expect(actions.togglePause).not.toHaveBeenCalled();
    press('Escape');
    expect(actions.onEscape).toHaveBeenCalledOnce();
    // Letters have NO native button behaviour — S must work right after clicking Share
    // (the blanket deferral used to leave S/R/F silently dead until focus moved).
    press('s');
    expect(actions.toggleShare).toHaveBeenCalledOnce();
  });
});
