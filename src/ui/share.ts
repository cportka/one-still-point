/**
 * The "Share" button (top row, beside About) → the **Share modal** (v0.98.0), three pathways:
 *
 *  1. **Link** — a button that *is* the link; clicking copies the branded line
 *     ("to the stars ~ onestillpoint.app") to the clipboard. The OG card unfurls wherever
 *     it's pasted, so nothing else needs attaching.
 *  2. **Screenshot** — a still of the current session, generated at modal-open (the WebGPU
 *     canvas drawn into a 2D canvas → PNG) and shown as a live preview. Sharing prefers the
 *     OS share sheet (`navigator.share` with files — mobile + Safari) and falls back to a
 *     plain download on desktop.
 *  3. **Record 10** — closes the modal and arms a red pulsing "Start Record 10" button in the
 *     upper-left. We're *always recording* while armed (a rolling ≤1 s MediaRecorder take —
 *     see `recordTen.ts`), so the second *before* the click becomes the clip's first second;
 *     Start counts "Recording 9 … 0" and the ~10 s clip (mp4 where the browser records H.264,
 *     WebM otherwise) goes out through the same share-sheet-or-download path, with the site
 *     link riding along as the share text.
 *
 * The rolling WebCodecs recorder (`clipRecorder.ts`) stays dormant; this path builds on the
 * broadly-supported `MediaRecorder` + `canvas.captureStream` floor (`recordClip.ts`).
 */
import { bestClipMime, canRecordCanvas } from './recordClip';
import { RecordTen, type RecorderLike } from './recordTen';

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

/** Share a file via the OS sheet where possible (with the site link as text), else download it.
 *  Returns 'shared' | 'saved' | 'dismissed' | 'failed' for the UI flash. */
async function shareOrDownload(file: File): Promise<'shared' | 'saved' | 'dismissed' | 'failed'> {
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
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** One shared capture stream per record-mode entry; recorders re-arm over it (recordTen.ts). */
function makeRecorderFactory(
  canvas: HTMLCanvasElement,
): { create: () => RecorderLike | null; mime: string; dispose: () => void } | null {
  if (!canRecordCanvas(canvas)) return null;
  const mime = bestClipMime();
  if (!mime) return null;
  let stream: MediaStream | null = null;
  const create = (): RecorderLike | null => {
    try {
      stream ??= canvas.captureStream(30);
      if (stream.getVideoTracks().length === 0) return null;
      return new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 }) as unknown as RecorderLike;
    } catch {
      return null;
    }
  };
  const dispose = (): void => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  return { create, mime, dispose };
}

/** The armed / counting-down pill in the upper-left. Only one lives at a time. */
function enterRecordMode(factory: NonNullable<ReturnType<typeof makeRecorderFactory>>): void {
  if (document.querySelector('.osp-rec')) return;
  const wrap = document.createElement('div');
  wrap.className = 'osp-rec';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'osp-rec__btn';
  btn.textContent = 'Start Record 10';
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
  const engine = new RecordTen({
    createRecorder: factory.create,
    mime: factory.mime,
    onTick: (s) => {
      btn.textContent = s > 0 ? `Recording ${s}` : 'Saving…';
    },
    onDone: (file) => {
      exit();
      if (file) void shareOrDownload(file);
    },
  });
  if (!engine.arm()) {
    exit();
    return;
  }
  btn.addEventListener('click', () => {
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
 * The panel's Share button. `getCanvas` hands back the live render canvas (the WebGPU canvas on
 * the main path, the placeholder element on the worker path — both draw + captureStream);
 * without it the screenshot/record rows report themselves unavailable.
 */
export function createShareButton(getCanvas?: () => HTMLCanvasElement | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-share-btn';
  button.textContent = 'Share';
  button.title = 'Share One Still Point — link, screenshot, or a 10-second clip';

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
        <span class="osp-share__d">onestillpoint.app — copy to clipboard</span>
        <span class="osp-share__done">✓ copied</span>
      </button>
      <button class="osp-share__opt" type="button" data-opt="shot">
        <span class="osp-share__k">Screenshot</span>
        <span class="osp-share__d">this moment, as an image</span>
        <span class="osp-share__done">✓</span>
      </button>
      <img class="osp-share__preview" alt="Screenshot preview" hidden>
      <button class="osp-share__opt" type="button" data-opt="rec">
        <span class="osp-share__k">Record 10</span>
        <span class="osp-share__d">a 10-second clip — starts a second back</span>
      </button>
    </div>`;
  document.body.appendChild(overlay);

  const linkOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="link"]')!;
  const shotOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="shot"]')!;
  const recOpt = overlay.querySelector<HTMLButtonElement>('[data-opt="rec"]')!;
  const preview = overlay.querySelector<HTMLImageElement>('.osp-share__preview')!;
  const shotHint = shotOpt.querySelector<HTMLSpanElement>('.osp-share__d')!;
  const recHint = recOpt.querySelector<HTMLSpanElement>('.osp-share__d')!;

  let shot: Blob | null = null; // this open's screenshot (backs both the preview and the share)
  let previewUrl = '';

  const close = (): void => {
    overlay.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    preview.hidden = true;
    shot = null;
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.osp-share__close')?.addEventListener('click', close);

  const open = (): void => {
    overlay.hidden = false;
    const canvas = getCanvas?.() ?? null;
    // Screenshot: capture now → preview. Unavailable (worker placeholder some browsers refuse,
    // zero-size canvas, jsdom) → the row says so and disables.
    shotOpt.disabled = true;
    shotHint.textContent = 'capturing…';
    if (canvas) {
      void captureCanvasPng(canvas).then((blob) => {
        if (overlay.hidden) return; // closed while capturing
        shot = blob;
        if (blob) {
          previewUrl = URL.createObjectURL(blob);
          preview.src = previewUrl;
          preview.hidden = false;
          shotOpt.disabled = false;
          shotHint.textContent = 'this moment, as an image';
        } else {
          shotHint.textContent = 'not available on this browser';
        }
      });
    } else {
      shotHint.textContent = 'not available on this browser';
    }
    // Record: available where MediaRecorder can eat the canvas.
    const recordable = !!canvas && canRecordCanvas(canvas);
    recOpt.disabled = !recordable;
    recHint.textContent = recordable ? 'a 10-second clip — starts a second back' : 'not available on this browser';
  };

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });

  // 1 — the link: copy the branded line, flash the ✓.
  linkOpt.addEventListener('click', () => {
    const flash = (): void => {
      linkOpt.classList.add('is-copied');
      window.setTimeout(() => linkOpt.classList.remove('is-copied'), 1400);
    };
    const clip = navigator.clipboard;
    if (clip?.writeText) void clip.writeText(SHARE_TEXT).then(flash, flash);
    else flash();
  });

  // 2 — the screenshot: share sheet where it exists, download otherwise.
  shotOpt.addEventListener('click', () => {
    if (!shot) return;
    const file = new File([shot], 'onestillpoint.png', { type: 'image/png' });
    void shareOrDownload(file).then((outcome) => {
      if (outcome === 'dismissed' || outcome === 'failed') return;
      shotOpt.classList.add('is-copied');
      window.setTimeout(() => shotOpt.classList.remove('is-copied'), 1400);
    });
  });

  // 3 — record 10: close the modal, arm the red button.
  recOpt.addEventListener('click', () => {
    const canvas = getCanvas?.() ?? null;
    if (!canvas) return;
    const factory = makeRecorderFactory(canvas);
    if (!factory) return;
    close();
    enterRecordMode(factory);
  });

  return button;
}
