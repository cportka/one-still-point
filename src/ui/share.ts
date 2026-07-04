/**
 * The "Share" button (top row, beside About + Keys + version). Shares the **brand**: the
 * animated Infall mark as a small looping GIF (`public/share.gif`, ~107 KB — regenerate with
 * `npm run generate:share-gif`) with the line **"to the stars ~ onestillpoint.app"** — preferring
 * the OS share sheet, then a download:
 *   • share-capable (mobile + Safari) → `navigator.share` with the GIF + text + url → "Shared ✓"
 *   • else (e.g. desktop Chromium, no native file share) → download the GIF (the text rides the
 *     filename's home: the site is IN the text)                                     → "Saved ✓"
 *
 * This replaced the rolling canvas-clip share (live review: "just share an optimized animated
 * logo gif with a link and text"). The clip machinery (`clipRecorder.ts`, `recordClip.ts`)
 * stays in the tree, dormant, for a possible future "record a clip" feature — and its removal
 * from the render loops also retired a per-frame GPU→CPU readback on both paths.
 */
const SHARE_TEXT = 'to the stars ~ onestillpoint.app';
const SHARE_URL = 'https://onestillpoint.app';
const GIF_PATH = '/share.gif';

export function createShareButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-share-btn';
  button.textContent = 'Share';
  button.title = `Share the mark — "${SHARE_TEXT}"`;

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

  const download = (file: File): void => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (busy) return;
    busy = true;
    button.classList.add('is-busy');
    void (async () => {
      try {
        const res = await fetch(GIF_PATH);
        if (!res.ok) {
          flash('Failed');
          return;
        }
        const file = new File([await res.blob()], 'onestillpoint.gif', { type: 'image/gif' });
        // text carries the whole line (some share targets drop `url` when files are attached —
        // the domain living inside the text survives everywhere).
        const shareData = { files: [file], text: SHARE_TEXT, url: SHARE_URL };
        if (navigator.canShare?.(shareData) && navigator.share) {
          try {
            await navigator.share(shareData); // the OS share sheet (mobile + Safari)
            flash('Shared ✓');
          } catch (err) {
            // The user dismissing the sheet aborts — leave it be. Any other failure
            // (e.g. the gesture expired) falls back to a download so the mark isn't lost.
            if (err instanceof DOMException && err.name === 'AbortError') reset();
            else {
              download(file);
              flash('Saved ✓');
            }
          }
        } else {
          download(file); // desktop without native file share → save the animation
          flash('Saved ✓');
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
