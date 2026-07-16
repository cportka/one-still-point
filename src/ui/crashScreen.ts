import { VERSION } from '../version';

/**
 * The crash screen — the intro's beat-B **test pattern, iterated** (the 40px white/black
 * horizontal bands that flash for one frame before the moment of creation). When the app
 * dies — the WebGPU device is lost, the boot fails, an error storm kills the loop, or the
 * render worker crashes — the view is replaced by a full-screen broadcast-style test card
 * whose pattern *carries the crash information*:
 *
 * - The **tint** of the glitch bands encodes the crash kind (amber = GPU device lost,
 *   magenta = uncaught error storm, cyan = render worker, violet = boot failure) — the
 *   same hues as the creation burst's rays.
 * - The **band offsets** derive from a hash of the error message, so every distinct crash
 *   renders a visibly different iteration of the pattern — two screenshots match iff the
 *   crash matches. The hash is also printed as the card's **station code** (e.g. GPU-7F3A).
 * - The card itself prints the message, phase, version, and uptime, with Reload +
 *   Copy-details actions.
 *
 * Pure DOM/CSS — it must render when the GPU is gone (the iOS captures: canvas dead-black,
 * page JS still alive). The screen shows once per session; later crashes bump a counter.
 */

export type CrashKind = 'gpu' | 'error' | 'worker' | 'boot';

export interface CrashInfo {
  kind: CrashKind;
  message: string;
  /** Where it happened, for the card's meta line: 'boot' | 'intro' | 'live' | 'compiling full shader'… */
  phase?: string;
  /** A secondary line (stack head, device-lost reason…). */
  detail?: string;
}

/** The deterministic pattern iteration for a crash — pure, unit-tested. */
export interface CrashPattern {
  /** Kind accent (the creation burst's palette). */
  hue: string;
  /** Station code printed on the card AND encoded in the bands: KIND-XXXX (hash hex). */
  code: string;
  /** Per-glitch-band horizontal offsets in [0, 1) of the viewport width (length = BANDS). */
  offsets: number[];
}

const BANDS = 6; // glitch rows spread over the height
const HUES: Record<CrashKind, string> = {
  gpu: '#ffae4f', // amber — the burst's warm ray
  error: '#ff3cc0', // magenta
  worker: '#36e0ff', // cyan
  boot: '#b06aff', // violet
};
const PREFIX: Record<CrashKind, string> = { gpu: 'GPU', error: 'ERR', worker: 'WRK', boot: 'BOT' };
const HEADLINE: Record<CrashKind, string> = {
  gpu: 'The graphics device was lost',
  error: 'The engine hit a wall',
  worker: 'The render worker crashed',
  boot: "One Still Point couldn't start",
};
const HINT: Record<CrashKind, string> = {
  gpu: 'The GPU gave out — on phones this is usually a memory limit. Reload restarts in safe mode (lean visuals, no heavy shader).',
  error: 'An error kept the frame loop from continuing. Reload to try again — and please report the code above if it repeats.',
  worker: 'The background renderer died. Reload falls back to the standard renderer.',
  boot: 'This visualizer needs a browser with WebGPU or WebGL2. If your browser has them, reload to try again.',
};

/** FNV-1a over the kind + message — the seed for the code and the band offsets. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The pattern iteration for a crash: same crash → same code + band layout. */
export function crashPattern(kind: CrashKind, message: string): CrashPattern {
  const seed = fnv1a(`${kind}:${message}`);
  const offsets: number[] = [];
  // A tiny LCG walked from the hash — enough spread for visibly distinct iterations.
  let s = seed || 1;
  for (let i = 0; i < BANDS; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    offsets.push((s >>> 8) / 0x1000000); // [0, 1)
  }
  const code = `${PREFIX[kind]}-${(seed & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
  return { hue: HUES[kind], code, offsets };
}

/** The session flag a GPU loss arms: the next load in this tab stays on the lean shader.
 *  (The iOS captures: the lean intro is fine every time; the full-shader upgrade is what
 *  kills the device. sessionStorage scopes the degradation to the tab, not the browser.) */
const LEAN_SAFE_KEY = 'osp-lean-safe';

export function leanSafeMode(): boolean {
  try {
    return sessionStorage.getItem(LEAN_SAFE_KEY) === '1';
  } catch {
    return false;
  }
}

function armLeanSafeMode(): void {
  try {
    sessionStorage.setItem(LEAN_SAFE_KEY, '1');
  } catch {
    /* private mode / storage denied — the crash screen still shows */
  }
}

/** The persisted crash record: iOS WebKit **reloads the tab on its own** after a GPU-process
 *  death, wiping the DOM — the card "flashed" and vanished. The record survives in
 *  sessionStorage; `restoreCrashScreen()` (called at boot) re-shows the card after any reload
 *  the user didn't ask for. The card's own Reload/Dismiss buttons clear it — a deliberate
 *  dismissal is the only way the pattern leaves the screen. */
const RECORD_KEY = 'osp-crash-record';

function persistRecord(info: CrashInfo): void {
  try {
    sessionStorage.setItem(RECORD_KEY, JSON.stringify(info));
  } catch {
    /* storage denied — the card still shows this page-life */
  }
}

function clearRecord(): void {
  try {
    sessionStorage.removeItem(RECORD_KEY);
  } catch {
    /* ignore */
  }
}

let shownEl: HTMLElement | null = null;
let repeats = 0;
const bootAt = typeof performance !== 'undefined' ? performance.now() : 0;

/** What each iteration of the pattern means — printed on the card so the pattern itself is
 *  legible: the tint names the failure, the band layout + station code fingerprint it. */
function legendFor(kind: CrashKind, code: string): string {
  const tintName: Record<CrashKind, string> = {
    gpu: 'amber = the graphics device died',
    error: 'magenta = a JavaScript error storm',
    worker: 'cyan = the background renderer died',
    boot: 'violet = the app could not start',
  };
  return (
    `Pattern key: ${tintName[kind]} · the band layout is the fingerprint of this exact ` +
    `failure — the same crash always draws the same pattern, and its code is ${code}.`
  );
}

/** Replace the view with the crash test card. Idempotent — the first crash wins the screen,
 *  later ones bump its repeat counter (a dead loop can throw every frame). */
export function showCrashScreen(info: CrashInfo, restored = false): void {
  console.error(`[onestillpoint] crash (${info.kind}): ${info.message}`, info.detail ?? '');
  if (shownEl) {
    repeats += 1;
    const rep = shownEl.querySelector('.osp-crash__repeats');
    if (rep) rep.textContent = `+${repeats} more since`;
    return;
  }
  if (info.kind === 'gpu') armLeanSafeMode();
  if (!restored) persistRecord(info); // survive WebKit's own post-crash reload
  // The loop/hosts listen for this to stop submitting work (a dead device throws per frame).
  try {
    window.dispatchEvent(new CustomEvent('osp-crash', { detail: info }));
  } catch {
    /* CustomEvent unavailable — cosmetic only */
  }
  document.getElementById('osp-splash')?.remove(); // never hide the card behind the splash

  const pat = crashPattern(info.kind, info.message);
  const el = document.createElement('div');
  el.className = `osp-crash osp-crash--${info.kind}`;
  el.setAttribute('role', 'alert');
  el.style.setProperty('--osp-crash-hue', pat.hue);

  const bands = document.createElement('div');
  bands.className = 'osp-crash__bands';
  for (let i = 0; i < pat.offsets.length; i++) {
    const g = document.createElement('i');
    g.className = 'osp-crash__glitch';
    g.style.setProperty('--o', `${(pat.offsets[i]! * 100).toFixed(1)}%`);
    g.style.setProperty('--row', String(i));
    bands.appendChild(g);
  }
  el.appendChild(bands);

  const uptimeS = Math.round((performance.now() - bootAt) / 1000);
  const phase = restored ? `${info.phase ?? 'live'} · restored after reload` : (info.phase ?? 'live');
  const card = document.createElement('div');
  card.className = 'osp-crash__card';
  card.innerHTML =
    `<div class="osp-crash__code">SIGNAL LOST · <b>${pat.code}</b> <span class="osp-crash__repeats"></span></div>` +
    `<h1>${HEADLINE[info.kind]}</h1>` +
    `<p class="osp-crash__msg"></p>` +
    (info.detail ? `<p class="osp-crash__detail"></p>` : '') +
    `<p class="osp-crash__meta">v${VERSION} · ${phase} · up ${uptimeS}s</p>` +
    `<div class="osp-crash__actions">` +
    `<button type="button" class="osp-crash__reload">Reload</button>` +
    (restored ? `<button type="button" class="osp-crash__dismiss">Dismiss</button>` : '') +
    `<button type="button" class="osp-crash__copy">Copy details</button>` +
    `</div>` +
    `<p class="osp-crash__legend">${legendFor(info.kind, pat.code)}</p>` +
    `<p class="osp-crash__hint">${HINT[info.kind]}</p>`;
  // Message/detail as textContent — error text is not trusted HTML.
  card.querySelector('.osp-crash__msg')!.textContent = info.message;
  if (info.detail) card.querySelector('.osp-crash__detail')!.textContent = info.detail;
  // Reload/Dismiss are the deliberate dismissals — only they clear the persisted record.
  card.querySelector('.osp-crash__reload')!.addEventListener('click', () => {
    clearRecord();
    location.reload();
  });
  card.querySelector('.osp-crash__dismiss')?.addEventListener('click', () => {
    clearRecord();
    el.remove();
    shownEl = null;
  });
  card.querySelector('.osp-crash__copy')!.addEventListener('click', () => {
    const report = JSON.stringify(
      { app: 'onestillpoint', version: VERSION, code: pat.code, ...info, uptimeS, ua: navigator.userAgent },
      null,
      2,
    );
    void navigator.clipboard?.writeText(report).catch(() => {});
  });
  el.appendChild(card);
  document.body.appendChild(el);
  shownEl = el;
}

/** Re-show the crash card after a reload the user didn't ask for (iOS WebKit reloads a tab on
 *  its own after a GPU-process death — without this the card "flashed" and vanished with the
 *  DOM). Call once at boot, before the engine starts; the app boots underneath (in lean safe
 *  mode if the crash was a GPU loss) and Dismiss reveals it. Returns whether a card restored. */
export function restoreCrashScreen(): boolean {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(RECORD_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const info = JSON.parse(raw) as CrashInfo;
    if (!info || typeof info.message !== 'string' || !(info.kind in HUES)) return false;
    showCrashScreen(info, true);
    return true;
  } catch {
    clearRecord(); // a corrupt record must not wedge every boot
    return false;
  }
}

// ---------------------------------------------------------------------------
// The guard: global listeners + the storm counter.

/** One-off errors (a UI handler hiccup) must NOT nuke a healthy view: only an error STORM
 *  (a per-frame throw from a dead loop) or an unmistakably GPU-flavoured message crosses
 *  the line. Storm = this many uncaught errors inside the window. */
const STORM_COUNT = 3;
const STORM_WINDOW_MS = 10_000;
const GPU_MESSAGE = /webgpu|\bgpu\b|device lost|device is lost|texture.*destroyed|pipeline/i;

const stormAt: number[] = [];

function noteError(kind: CrashKind, message: string, phase?: string, detail?: string): void {
  const now = performance.now();
  stormAt.push(now);
  while (stormAt.length > 0 && now - stormAt[0]! > STORM_WINDOW_MS) stormAt.shift();
  if (GPU_MESSAGE.test(message)) {
    showCrashScreen({ kind: 'gpu', message, phase, detail });
    return;
  }
  if (stormAt.length >= STORM_COUNT) showCrashScreen({ kind, message, phase, detail });
}

/** Report a crash relayed from the render worker ('error' messages after commitment). */
export function reportWorkerCrash(message: string): void {
  noteError('worker', message, 'worker');
}

/** Report a WebGPU device loss — always fatal, always shows (and arms lean safe mode). */
export function reportGpuLoss(message: string, phase: string): void {
  showCrashScreen({ kind: 'gpu', message, phase });
}

/** Install the global uncaught-error / unhandled-rejection listeners. Call once, early. */
export function installCrashGuard(): void {
  window.addEventListener('error', (ev) => {
    noteError('error', ev.message || 'uncaught error', undefined, ev.filename ? `${ev.filename}:${ev.lineno ?? '?'}` : undefined);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r: unknown = ev.reason;
    noteError('error', r instanceof Error ? r.message : String(r), undefined, r instanceof Error ? r.stack?.split('\n')[1]?.trim() : undefined);
  });
}
