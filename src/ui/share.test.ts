// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareButton, SHARE_URL } from './share';

/** Let a fire-and-forget async handler settle. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Share modal (link · screenshot · record video)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicking Share opens the modal with the three pathways (record reads "Record video")', () => {
    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));

    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector('[data-opt="link"]')).toBeTruthy();
    expect(overlay.querySelector('[data-opt="shot"]')).toBeTruthy();
    const rec = overlay.querySelector<HTMLButtonElement>('[data-opt="rec"]')!;
    expect(rec.textContent).toContain('Record video');
    expect(rec.textContent).not.toContain('starts a second back');
  });

  it('the toggle drives the same modal (the S shortcut path)', () => {
    const share = createShareButton();
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    expect(overlay.hidden).toBe(true);
    share.toggle();
    expect(overlay.hidden).toBe(false);
    share.toggle();
    expect(overlay.hidden).toBe(true);
  });

  it('the link row copies the PLAIN URL — nothing else — and flashes the ✓', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));
    const link = document.querySelector<HTMLButtonElement>('[data-opt="link"]')!;
    link.dispatchEvent(new MouseEvent('click'));
    await tick();

    expect(writeText).toHaveBeenCalledWith(SHARE_URL);
    // "nothing else" pinned literally — re-branding the constant would otherwise still pass.
    expect(SHARE_URL).toBe('https://onestillpoint.app');
    expect(link.classList.contains('is-copied')).toBe(true);
  });

  it('a bare modifier, a browser chord, or Tab does NOT dismiss the modal', () => {
    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // starting a chord…
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })); // …Ctrl+C
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); // focus nav into the card
    expect(overlay.hidden).toBe(false); // none of those read as "a key press" to the user
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(overlay.hidden).toBe(true); // a real key still closes
  });

  it('ANY key press closes the modal — and is consumed, so app shortcuts never fire through it', () => {
    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    expect(overlay.hidden).toBe(false);

    const seen = vi.fn();
    window.addEventListener('keydown', seen); // stands in for the app keybindings (bubble phase)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(overlay.hidden).toBe(true);
    expect(seen).not.toHaveBeenCalled(); // stopped in capture — Space can't also pause the sim
    window.removeEventListener('keydown', seen);

    // …and the listener is gone once closed: keys flow normally again.
    window.addEventListener('keydown', seen);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', seen);
  });

  it('screenshot + record report unavailable when there is no canvas / no MediaRecorder', async () => {
    const share = createShareButton(); // no getCanvas at all
    share.button.dispatchEvent(new MouseEvent('click'));
    await tick();

    const shot = document.querySelector<HTMLButtonElement>('[data-opt="shot"]')!;
    const rec = document.querySelector<HTMLButtonElement>('[data-opt="rec"]')!;
    expect(shot.disabled).toBe(true);
    expect(rec.disabled).toBe(true);
    expect(shot.textContent).toContain('not available');
    expect(rec.textContent).toContain('not available');
  });

  it('screenshot degrades gracefully when the canvas cannot be drawn (jsdom has no 2D context)', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const share = createShareButton(() => canvas);
    share.button.dispatchEvent(new MouseEvent('click'));
    await tick();

    // jsdom's getContext('2d') is unimplemented → captureCanvasPng resolves null → the row
    // disables with the honest hint instead of throwing.
    const shot = document.querySelector<HTMLButtonElement>('[data-opt="shot"]')!;
    expect(shot.disabled).toBe(true);
    expect(shot.textContent).toContain('not available');
  });

  it('closes when the backdrop is clicked', () => {
    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    overlay.dispatchEvent(new MouseEvent('click')); // target === overlay (the backdrop)
    expect(overlay.hidden).toBe(true);
  });
});
