// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShareButton, SHARE_TEXT, SHARE_URL, shareOrDownload } from './share';

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

  it('lays out the pathways Link · Record video · Screenshot, "Record" in red, copy trimmed', () => {
    // Assert the template BEFORE opening — open() re-captures and rewrites the Screenshot hint.
    createShareButton();
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    // Order: Record video is the SECOND option now, between Link and Screenshot.
    const opts = [...overlay.querySelectorAll('.osp-share__opt')].map((o) => o.getAttribute('data-opt'));
    expect(opts).toEqual(['link', 'rec', 'shot']);
    // "Record" is its own red span.
    expect(overlay.querySelector('[data-opt="rec"] .osp-share__rec')!.textContent).toBe('Record');
    // Trimmed copy: no "— copy link", no ", as an image".
    expect(overlay.querySelector('[data-opt="link"] .osp-share__d')!.textContent).toBe('onestillpoint.app');
    expect(overlay.querySelector('[data-opt="shot"] .osp-share__d')!.textContent).toBe('this moment');
  });

  it('the preview carries a retake + a download icon over it', () => {
    createShareButton();
    const wrap = document.querySelector<HTMLElement>('.osp-share__preview-wrap')!;
    expect(wrap.querySelector('[data-act="retake"]')).toBeTruthy();
    expect(wrap.querySelector('[data-act="download"]')).toBeTruthy();
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

  it('Enter/Space on a focused dialog control activates it — it does NOT dismiss the modal', () => {
    // The any-key-close capture listener must exempt Enter/Space while a card button is focused,
    // or the Tab-reachable controls are reachable but not keyboard-OPERABLE (preventDefault would
    // cancel the native activation and just close the dialog).
    const share = createShareButton();
    share.button.dispatchEvent(new MouseEvent('click'));
    const overlay = document.querySelector<HTMLElement>('.osp-share')!;
    const link = document.querySelector<HTMLButtonElement>('[data-opt="link"]')!;
    link.focus();
    expect(document.activeElement).toBe(link);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(overlay.hidden).toBe(false); // Enter activates Link natively — modal stays open
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(overlay.hidden).toBe(false); // Space too
    // …but a key with nothing in the card focused still closes.
    link.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(overlay.hidden).toBe(true);
  });

  it('the Record video row arms exactly one pill; Start begins the counted take; × removes it', () => {
    vi.useFakeTimers();
    try {
      // Minimal MediaRecorder + captureStream so canRecordCanvas() is true and RecordTen can arm.
      class FakeMR {
        static isTypeSupported = (m: string): boolean => m === 'video/mp4;codecs=avc1.42E01E';
        state: 'inactive' | 'recording' = 'inactive';
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start(): void {
          this.state = 'recording';
        }
        stop(): void {
          this.state = 'inactive';
        }
      }
      vi.stubGlobal('MediaRecorder', FakeMR);
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const track = { stop: vi.fn() };
      (canvas as unknown as { captureStream: () => unknown }).captureStream = () => ({
        getVideoTracks: () => [track],
        getTracks: () => [track],
      });

      const share = createShareButton(() => canvas);
      share.button.dispatchEvent(new MouseEvent('click'));
      const overlay = document.querySelector<HTMLElement>('.osp-share')!;
      const rec = document.querySelector<HTMLButtonElement>('[data-opt="rec"]')!;
      expect(rec.disabled).toBe(false); // recordable now that MediaRecorder + captureStream exist

      rec.dispatchEvent(new MouseEvent('click'));
      expect(overlay.hidden).toBe(true); // Record closes the modal
      const pill = document.querySelector<HTMLElement>('.osp-rec')!;
      expect(pill).toBeTruthy();
      const startBtn = pill.querySelector<HTMLButtonElement>('.osp-rec__btn')!;
      expect(startBtn.textContent).toBe('Start Record');

      // Reopen via the S-toggle and click Record again — the single-instance guard must NOT stack
      // a second pill (and the second factory, whose stream is lazy, leaks nothing).
      share.toggle();
      document.querySelector<HTMLButtonElement>('[data-opt="rec"]')!.dispatchEvent(new MouseEvent('click'));
      expect(document.querySelectorAll('.osp-rec').length).toBe(1);

      // Start → the counted take begins (button flips to "Recording <n>").
      startBtn.dispatchEvent(new MouseEvent('click'));
      expect(startBtn.textContent).toMatch(/^Recording \d+$/);
      expect(startBtn.classList.contains('is-recording')).toBe(true);

      // × cancels and removes the pill.
      pill.querySelector<HTMLButtonElement>('.osp-rec__x')!.dispatchEvent(new MouseEvent('click'));
      expect(document.querySelector('.osp-rec')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

describe('shareOrDownload — the record/screenshot output path', () => {
  const file = new File(['clip'], 'onestillpoint.mp4', { type: 'video/mp4' });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('SHARE_TEXT is pinned literally — a rebrand/typo must fail the suite (like SHARE_URL)', () => {
    expect(SHARE_TEXT).toBe('to the stars ~ onestillpoint.app');
  });

  it('shares via the OS sheet with the site link riding along as text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    expect(await shareOrDownload(file)).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file], text: SHARE_TEXT }));
  });

  it('a user-cancelled share sheet is "dismissed" — it does NOT fall through to a surprise download', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownload(file)).toBe('dismissed');
    expect(click).not.toHaveBeenCalled(); // no download on cancel
  });

  it('falls back to a download where the share sheet is unavailable', async () => {
    vi.stubGlobal('navigator', {}); // no canShare / no share
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownload(file)).toBe('saved');
    expect(click).toHaveBeenCalled();
  });
});
