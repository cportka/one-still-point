// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShareButton } from './share';

/** Let the button's fire-and-forget async click handler settle. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Share button (one clean link card)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares the URL only — no files, no separate text (so it collapses to one OG card)', async () => {
    let shared: unknown;
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: (data: unknown) => {
        shared = data;
        return Promise.resolve();
      },
    });

    const button = createShareButton();
    button.dispatchEvent(new MouseEvent('click'));
    await tick();

    expect(shared).toEqual({ url: 'https://onestillpoint.app' });
    // The whole point of the change: never attach a file or a text block again.
    expect(shared).not.toHaveProperty('files');
    expect(shared).not.toHaveProperty('text');
    expect(button.textContent).toContain('Shared');
  });

  it('falls back to copying the branded link when there is no native share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } }); // no canShare/share → desktop path

    const button = createShareButton();
    button.dispatchEvent(new MouseEvent('click'));
    await tick();

    expect(writeText).toHaveBeenCalledWith('to the stars ~ onestillpoint.app');
    expect(button.textContent).toContain('Copied');
  });
});
