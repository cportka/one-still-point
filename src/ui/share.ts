/**
 * The "Share" button (top row, beside About + Keys + version). Shares the site as **one clean link
 * card**: `navigator.share({ url })` lets the OS unfurl `onestillpoint.app` into a single rich
 * preview carrying the site's Open Graph mark (`og.png` — the monoline logo + wordmark) and
 * description. **Nothing else is attached** — no image, no separate text line — so the message is
 * just that one card (live review: "only show the card that links to the site; the logo instead of
 * a file placeholder; drop sending the animated logo").
 *   • share-capable (mobile + Safari) → `navigator.share({ url })` → the unfurled card → "Shared ✓"
 *   • else (e.g. desktop Chromium, no native share) → copy the link line to the clipboard → "Copied ✓"
 *
 * Why link-only: the previous pass attached the animated GIF *and* the tagline text *and* the url,
 * so the share sheet read "1 Link and 1 Image" (a generic file placeholder, not the mark) and the
 * message stacked three blocks. A URL-only share collapses to the single OG card — which already
 * shows the logo — and keeps the message tiny (a link, not an embedded image). The card image is
 * the site's static `og:image`; link-preview renderers show it non-animated, so an animated card
 * isn't controllable from here (and would risk ballooning) — the static mark is the clean choice.
 *
 * The dormant clip machinery (`clipRecorder.ts`, `recordClip.ts`) and the `share.gif` generator stay
 * in the tree for a possible future "record a clip" / animated-share path; neither is on the hot loop.
 */
const SHARE_TEXT = 'to the stars ~ onestillpoint.app';
const SHARE_URL = 'https://onestillpoint.app';

export function createShareButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-share-btn';
  button.textContent = 'Share';
  button.title = 'Share the link to onestillpoint.app';

  let busy = false;
  const reset = (): void => {
    button.classList.remove('is-done');
    button.textContent = 'Share';
  };
  // The confirmation stays on one line (see .osp-share-btn { white-space: nowrap }).
  const flash = (text: string): void => {
    button.classList.add('is-done');
    button.textContent = text;
    window.setTimeout(reset, 1600);
  };

  // Desktop / no native share sheet: copy the branded link line so a paste reads
  // "to the stars ~ onestillpoint.app". Returns whether the copy succeeded.
  const copyLink = async (): Promise<boolean> => {
    try {
      await navigator.clipboard?.writeText(SHARE_TEXT);
      return true;
    } catch {
      return false;
    }
  };

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    button.classList.add('is-busy');
    void (async () => {
      try {
        // URL only — the OS unfurls it into the single OG card (logo + title + description).
        const shareData = { url: SHARE_URL };
        if (navigator.canShare?.(shareData) && navigator.share) {
          try {
            await navigator.share(shareData); // the OS share sheet (mobile + Safari)
            flash('Shared ✓');
          } catch (err) {
            // The user dismissing the sheet aborts — leave it be. Any other failure
            // (e.g. the gesture expired) falls back to copying the link.
            if (err instanceof DOMException && err.name === 'AbortError') reset();
            else flash((await copyLink()) ? 'Copied ✓' : 'Failed');
          }
        } else {
          flash((await copyLink()) ? 'Copied ✓' : 'Failed'); // desktop without native share → copy
        }
      } catch {
        reset();
      } finally {
        busy = false;
        button.classList.remove('is-busy');
      }
    })();
  });

  return button;
}
