// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareButton, SHARE_TEXT } from './share';

/** Let a fire-and-forget async handler settle. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Share modal (link · screenshot · record-10)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicking Share opens the modal with the three pathways', () => {
    const button = createShareButton();
    button.dispatchEvent(new MouseEvent('click'));

    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector('[data-opt="link"]')).toBeTruthy();
    expect(overlay.querySelector('[data-opt="shot"]')).toBeTruthy();
    expect(overlay.querySelector('[data-opt="rec"]')).toBeTruthy();
  });

  it('the link row copies the branded line to the clipboard and flashes the ✓', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const button = createShareButton();
    button.dispatchEvent(new MouseEvent('click'));
    const link = document.querySelector<HTMLButtonElement>('[data-opt="link"]')!;
    link.dispatchEvent(new MouseEvent('click'));
    await tick();

    expect(writeText).toHaveBeenCalledWith(SHARE_TEXT);
    expect(link.classList.contains('is-copied')).toBe(true);
  });

  it('screenshot + record report unavailable when there is no canvas / no MediaRecorder', async () => {
    const button = createShareButton(); // no getCanvas at all
    button.dispatchEvent(new MouseEvent('click'));
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
    const button = createShareButton(() => canvas);
    button.dispatchEvent(new MouseEvent('click'));
    await tick();

    // jsdom's getContext('2d') is unimplemented → captureCanvasPng resolves null → the row
    // disables with the honest hint instead of throwing.
    const shot = document.querySelector<HTMLButtonElement>('[data-opt="shot"]')!;
    expect(shot.disabled).toBe(true);
    expect(shot.textContent).toContain('not available');
  });

  it('closes when the backdrop is clicked', () => {
    const button = createShareButton();
    button.dispatchEvent(new MouseEvent('click'));
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    overlay.dispatchEvent(new MouseEvent('click')); // target === overlay (the backdrop)
    expect(overlay.hidden).toBe(true);
  });
});
