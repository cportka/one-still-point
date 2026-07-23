/**
 * The "Share" button (top row, beside About) → the **Share modal** (v0.98.0, refined v0.99.0),
 * three pathways:
 *
 *  1. **Link** — a button that *is* the link; clicking copies the plain URL
 *     (`https://onestillpoint.app`, nothing else) to the clipboard. The OG card unfurls
 *     wherever it's pasted, so nothing else needs attaching.
 *  2. **Screenshot** — a still of the current session, generated the moment the modal opens
 *     (the WebGPU canvas drawn into a 2D canvas → PNG) and shown as a live preview. Clicking
 *     the *preview* downloads (or re-downloads) that PNG; the row's button prefers the OS
 *     share sheet (`navigator.share` with files — mobile + Safari) and falls back to the same
 *     download on desktop.
 *  3. **Record video** — closes the modal and arms a red pulsing "Start Record" button in the
 *     upper-left. We're *always recording* while armed (a rolling ≤1 s MediaRecorder take —
 *     see `recordTen.ts`), so the moment *before* the click opens the clip; Start counts
 *     "Recording 19 … 0" and the ~20 s clip (mp4 where the browser records H.264, WebM
 *     otherwise) goes out through the same share-sheet-or-download path, with the site link
 *     riding along as the share text. (20 s so a whole black-hole plunge fits with padding.)
 *
 * The modal closes on backdrop click or **any key press**; the panel's `S` shortcut toggles
 * it (`keybindings.ts`). Starting a recording deliberately does NOT collapse the control
 * panel — the panel is DOM chrome above the canvas, so it's never in the recording anyway.
 *
 * The rolling WebCodecs recorder (`clipRecorder.ts`) stays dormant; this path builds on the
 * broadly-supported `MediaRecorder` + `canvas.captureStream` floor (`recordClip.ts`).
 */
import { bestClipMime, canRecordCanvas } from './recordClip';
import { RecordTen, type RecorderLike } from './recordTen';
import { makeWatermarkSource } from './watermark';

export const SHARE_TEXT = 'to the stars ~ onestillpoint.app';
export const SHARE_URL = 'https://onestillpoint.app';

/** Snapshot a (WebGPU) canvas into a PNG blob via a 2D copy — null wherever that's not drawable. */
export async function captureCanvasPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return null;
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(canvas, 0, 0);
  } catch {
    return null; // e.g. a placeholder canvas the browser refuses as an image source
  }
  return await new Promise<Blob | null>((resolve) => {
    try {
      copy.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/** Plain download of a file (also the share-sheet fallback). True if the click went out. */
function downloadFile(file: File): boolean {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

/** Share a file via the OS sheet where possible (with the site link as text), else download it.
 *  Returns 'shared' | 'saved' | 'dismissed' | 'failed' for the UI flash. */
export async function shareOrDownload(file: File): Promise<'shared' | 'saved' | 'dismissed' | 'failed'> {
  const withText = { files: [file], text: SHARE_TEXT };
  const filesOnly = { files: [file] };
  const data = navigator.canShare?.(withText) ? withText : navigator.canShare?.(filesOnly) ? filesOnly : null;
  if (data && navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'dismissed';
      // fall through to the download
    }
  }
  return downloadFile(file) ? 'saved' : 'failed';
}

/** One shared capture stream per record-mode entry; recorders re-arm over it (recordTen.ts). */
function makeRecorderFactory(
  canvas: HTMLCanvasElement,
): { create: () => RecorderLike | null; mime: string; dispose: () => void } | null {
  if (!canRecordCanvas(canvas)) return null;
  const mime = bestClipMime();
  if (!mime) return null;
  // The clip records a WATERMARKED composite of the canvas ("One Still Point" + the still mark,
  // top-right — see watermark.ts); where compositing isn't possible it records the bare canvas.
  const wm = makeWatermarkSource(canvas);
  const recCanvas = wm?.canvas ?? canvas;
  let stream: MediaStream | null = null;
  const create = (): RecorderLike | null => {
    try {
      stream ??= recCanvas.captureStream(30);
      if (stream.getVideoTracks().length === 0) return null;
      return new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }) as unknown as RecorderLike;
    } catch {
      return null;
    }
  };
  const dispose = (): void => {
    wm?.dispose();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  return { create, mime, dispose };
}

/** The armed / counting-down pill in the upper-left. Only one lives at a time. */
function enterRecordMode(factory: NonNullable<ReturnType<typeof makeRecorderFactory>>): void {
  // One pill at a time. A second factory here holds no capture stream yet (makeRecorderFactory
  // defers captureStream to create(), which only arm() calls), so bailing leaks nothing.
  if (document.querySelector('.osp-rec')) return;
  const wrap = document.createElement('div');
  wrap.className = 'osp-rec';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'osp-rec__btn';
  btn.textContent = 'Start Record';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'osp-rec__x';
  x.setAttribute('aria-label', 'Cancel recording');
  x.textContent = '×';
  wrap.append(btn, x);
  document.body.appendChild(wrap);

  const exit = (): void => {
    factory.dispose();
    wrap.remove();
  };
  // The finished clip, parked until a real tap. `navigator.share` only works inside a fresh user
  // gesture (transient activation) — the clip lands ~20 s after the last tap (when the recorder
  // flushes), so sharing it directly from onDone gets rejected and used to fall through to a bare
  // download (the iOS "download only" report). Where the OS sheet can take the file, the pill
  // becomes a "Share video" button and the share call happens inside that click; elsewhere
  // (no file-share sheet — e.g. desktop Firefox) the immediate download stays.
  let clip: File | null = null;
  const engine = new RecordTen({
    createRecorder: factory.create,
    mime: factory.mime,
    onTick: (s) => {
      btn.textContent = s > 0 ? `Recording ${s}` : 'Saving…';
    },
    onDone: (file) => {
      if (file && navigator.canShare?.({ files: [file] })) {
        clip = file;
        factory.dispose(); // recording is over — release the capture stream while the pill waits
        btn.classList.remove('is-recording');
        btn.classList.add('is-share');
        btn.textContent = 'Share video';
        return; // the pill stays up until they share or ×
      }
      exit();
      if (file) void shareOrDownload(file);
    },
  });
  if (!engine.arm()) {
    exit();
    return;
  }
  btn.addEventListener('click', () => {
    if (clip) {
      // Inside the tap → transient activation → the native share sheet opens.
      void shareOrDownload(clip).then((r) => {
        // A dismissed sheet keeps the pill (an accidental swipe-down doesn't lose the take);
        // shared / saved / failed all retire it.
        if (r !== 'dismissed') {
          clip = null;
          exit();
        }
      });
      return;
    }
    if (btn.classList.contains('is-recording')) return;
    btn.classList.add('is-recording');
    engine.begin();
  });
  x.addEventListener('click', () => {
    engine.cancel();
    exit();
  });
}

/**
 * The panel's Share button + modal. `getCanvas` hands back the live render canvas (the WebGPU
 * canvas on the main path, the placeholder element on the worker path — both draw +
 * captureStream); without it the screenshot/record rows report themselves unavailable.
 * Returns the button plus a `toggle` so the `S` shortcut can drive the same modal.
 */
export function createShareButton(getCanvas?: () => HTMLCanvasElement | null): { button: HTMLButtonElement; toggle: () => void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-share-btn';
  button.textContent = 'Share';
  button.title = 'Share One Still Point — link, screenshot, or a 20-second clip (S)';

  // The modal is built once, opened per click (the preview re-captures each open).
  const overlay = document.createElement('div');
  overlay.className = 'osp-share';
  overlay.hidden = true;
  overlay.setAttribute('data-nosnippet', '');
  overlay.innerHTML = `
    <div class="osp-share__card" role="dialog" aria-modal="true" aria-label="Share One Still Point">
      <button class="osp-share__close" type="button" aria-label="Close">×</button>
      <div class="osp-share__title">Share</div>
      <button class="osp-share__opt" type="button" data-opt="link">
        <span class="osp-share__k">Link</span>
        <span class="osp-share__d">onestillpoint.app</span>
        <span class="osp-share__done">✓ copied</span>
      </button>
      <button class="osp-share__opt" type="button" data-opt="rec">
        <span class="osp-share__k"><span class="osp-share__rec">Record</span> video</span>
        <span class="osp-share__d">a 20-second clip</span>
      </button>
      <button class="osp-share__opt" type="button" data-opt="shot">
        <span class="osp-share__k">Screenshot</span>
        <span class="osp-share__d">this moment</span>
        <span class="osp-share__done">✓</span>
      </button>
      <div class="osp-share__preview-wrap" hidden>
        <img class="osp-share__preview" alt="Screenshot preview">
        <div class="osp-share__preview-tools">
          <button class="osp-share__icon" type="button" data-act="retake" aria-label="Retake screenshot" title="Retake — capture this moment">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <button class="osp-share__icon" type="button" data-act="download" aria-label="Download screenshot" title="Download">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const linkOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="link"]')!;
  const shotOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="shot"]')!;
  const recOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="rec"]')!;
  const previewWrap = overlay.querySelector<HTMLElement>('.osp-share__preview-wrap')!;
  const preview = overlay.querySelector<HTMLImageElement>('.osp-share__preview')!;
  const shotHint = shotOpt.querySelector<HTMLSpanElement>('.osp-share__d')!;
  const recHint = recOpt.querySelector<HTMLSpanElement>('.osp-share__d')!;

  let shot: Blob | null = null; // the current screenshot (backs the preview + the download icon)
  let previewUrl = '';
  let captureGen = 0; // staleness token — a rapid re-capture / reopen can leave an old capture in flight

  // Capture the live canvas into the preview. Used by open(), the Screenshot row, and the
  // preview's camera icon — each just refreshes the preview to "this moment". Disables the
  // Screenshot row + hides the preview where the canvas can't be drawn (worker placeholder some
  // browsers refuse, zero-size canvas, jsdom).
  const captureToPreview = (): void => {
    const canvas = getCanvas?.() ?? null;
    const gen = ++captureGen;
    shotOpt.disabled = true;
    shotHint.textContent = 'capturing…';
    if (!canvas) {
      shotHint.textContent = 'not available on this browser';
      return;
    }
    void captureCanvasPng(canvas).then((blob) => {
      if (overlay.hidden || gen !== captureGen) return; // closed, or a newer capture owns the preview
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      shot = blob;
      if (blob) {
        previewUrl = URL.createObjectURL(blob);
        preview.src = previewUrl;
        previewWrap.hidden = false;
        shotOpt.disabled = false;
        shotHint.textContent = 'this moment';
      } else {
        previewUrl = '';
        previewWrap.hidden = true;
        shotHint.textContent = 'not available on this browser';
      }
    });
  };

  // Any key press closes the modal (consumed, so it can't also fire an app shortcut — Space
  // shouldn't pause the sim through a dialog, and the S that opened it closes it next press).
  // Exemptions keep the dialog honest: browser/OS chords (Cmd+C, Ctrl+L…) pass through
  // untouched, a bare modifier press isn't "a key press" to a user mid-chord, and Tab keeps
  // the aria-modal card keyboard-reachable instead of only dismissable.
  const onAnyKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    // Enter/Space with a dialog control focused must ACTIVATE it (copy the link, retake,
    // download, close) — not be swallowed as an any-key dismiss. Tab makes the card's buttons
    // reachable (above); without this they'd be reachable but not keyboard-OPERABLE: the capture
    // listener's preventDefault would cancel the button's native activation and just close the
    // modal. (keybindings.ts defers Space/Enter on a focused button for the same reason.)
    const active = document.activeElement;
    if (
      (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') &&
      active?.tagName === 'BUTTON' &&
      overlay.contains(active)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const close = (): void => {
    overlay.hidden = true;
    window.removeEventListener('keydown', onAnyKey, true);
    captureGen++; // orphan any in-flight capture
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    previewWrap.hidden = true;
    shot = null;
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.osp-share__close')?.addEventListener('click', close);

  const open = (): void => {
    overlay.hidden = false;
    window.addEventListener('keydown', onAnyKey, true); // capture — beats the app keybindings
    captureToPreview(); // grab the moment the modal opened → the preview
    // Record: available where MediaRecorder can eat the canvas.
    const canvas = getCanvas?.() ?? null;
    const recordable = !!canvas && canRecordCanvas(canvas);
    recOpt.disabled = !recordable;
    recHint.textContent = recordable ? 'a 20-second clip' : 'not available on this browser';
  };

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });

  // 1 — the link: copy the plain URL (nothing else), flash the ✓.
  linkOpt.addEventListener('click', () => {
    const flash = (): void => {
      linkOpt.classList.add('is-copied');
      window.setTimeout(() => linkOpt.classList.remove('is-copied'), 1400);
    };
    const clip = navigator.clipboard;
    if (clip?.writeText) void clip.writeText(SHARE_URL).then(flash, flash);
    else flash();
  });

  // 2 — the screenshot: the row (and the preview's camera icon) just re-capture "this moment"
  // into the preview; the preview's download icon saves that exact PNG.
  shotOpt.addEventListener('click', captureToPreview);
  previewWrap.querySelector('[data-act="retake"]')?.addEventListener('click', captureToPreview);
  previewWrap.querySelector('[data-act="download"]')?.addEventListener('click', () => {
    if (!shot) return;
    downloadFile(new File([shot], 'onestillpoint.png', { type: 'image/png' }));
  });

  // 3 — record video: close the modal, arm the red button.
  recOpt.addEventListener('click', () => {
    const canvas = getCanvas?.() ?? null;
    if (!canvas) return;
    const factory = makeRecorderFactory(canvas);
    if (!factory) return;
    close();
    enterRecordMode(factory);
  });

  const toggle = (): void => {
    if (overlay.hidden) open();
    else close();
  };
  return { button, toggle };
}
