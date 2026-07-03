/**
 * Main-thread side of the OffscreenCanvas render path (step 2). Spawns the render worker, hands it
 * control of the canvas (`transferControlToOffscreen`), kicks off `init`, and relays the worker's
 * `ready`/`error`/`status` back to callbacks. Off by default — only reached when
 * `canUseOffscreenRendering()` says so (see `docs/offscreen-canvas.md`). Lazy-imported, so neither it
 * nor the worker bundle touches the default main-thread load.
 */
import {
  WORKER_PROTOCOL_VERSION,
  isWorkerToMain,
  type FrameMessage,
  type MainToWorker,
  type PointerMessage,
  type QualityChoice,
  type ShareMessage,
  type StatusMessage,
  type TimelineMessage,
  type WheelMessage,
} from './protocol';

export interface WorkerHostCallbacks {
  onReady?: (backend: 'webgpu' | 'webgl') => void;
  onError?: (message: string) => void;
  onStatus?: (status: StatusMessage) => void;
  /** The worker's smoothness gate opened — the splash may play out (answer with `command('reveal')`). */
  onRevealReady?: () => void;
  /** The worker's reveal profiler completed — on-device debug telemetry. */
  onPerf?: (report: unknown) => void;
  /** Per-tick HUD telemetry (step 4b) — only streamed while `command('hudStream', ['on'])`. */
  onFrame?: (frame: FrameMessage) => void;
  /** The DVR's marker numbers for the scrub bar (step 4b, history half). */
  onTimeline?: (timeline: TimelineMessage) => void;
  /** The worker's answer to `command 'shareCapture'` (step 5). */
  onShare?: (share: ShareMessage) => void;
  /** A transient timeline event tick (or the reserved 'drop' — see the protocol). */
  onEvent?: (event: string, frame: number) => void;
  /** The worker's WebGPU probe answered (before any renderer exists) — also the earliest
   *  "worker alive" signal, so the caller's boot watchdog should clear on it. */
  onCapability?: (webgpu: boolean) => void;
  /** This environment can't run the worker path (a clean probe verdict, not a failure) — the
   *  caller should dispose the host and fall back to the main-thread renderer. */
  onUnsupported?: (reason: string) => void;
}

export interface WorkerHost {
  resize(width: number, height: number, dpr: number): void;
  pointer(msg: Omit<PointerMessage, 'type'>): void;
  wheel(msg: Omit<WheelMessage, 'type'>): void;
  /** A panel control change (step 4a) — the worker applies it via its control table. */
  control(key: string, value: number | boolean | string): void;
  command(name: string, args?: readonly (number | string)[]): void;
  dispose(): void;
}

export interface WorkerHostInit {
  width: number;
  height: number;
  dpr: number;
  quality: QualityChoice;
  coarse: boolean;
  reducedMotion: boolean;
}

export function startWorkerHost(
  canvas: HTMLCanvasElement,
  init: WorkerHostInit,
  cb: WorkerHostCallbacks = {},
): WorkerHost {
  const worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorker, transfer: Transferable[] = []): void => worker.postMessage(message, transfer);

  // A worker script 404 / module-evaluation throw never posts a protocol message — it fires
  // 'error' on the Worker OBJECT only. Without this listener the opaque splash strands forever.
  worker.addEventListener('error', (ev: ErrorEvent) => {
    cb.onError?.(`worker failed to start: ${ev.message || 'script error'} (${ev.filename ?? '?'}:${ev.lineno ?? '?'})`);
  });
  worker.addEventListener('messageerror', () => cb.onError?.('worker message deserialization failed'));
  worker.addEventListener('message', (ev: MessageEvent) => {
    const m = ev.data;
    if (!isWorkerToMain(m)) return;
    if (m.type === 'ready') cb.onReady?.(m.backend);
    else if (m.type === 'capability') cb.onCapability?.(m.webgpu);
    else if (m.type === 'unsupported') cb.onUnsupported?.(m.reason);
    else if (m.type === 'error') cb.onError?.(m.message);
    else if (m.type === 'status') cb.onStatus?.(m);
    else if (m.type === 'frame') cb.onFrame?.(m);
    else if (m.type === 'timeline') cb.onTimeline?.(m);
    else if (m.type === 'share') cb.onShare?.(m);
    else if (m.type === 'event') cb.onEvent?.(m.event, m.frame);
    else if (m.type === 'revealReady') cb.onRevealReady?.();
    else if (m.type === 'perf') cb.onPerf?.(m.report);
  });

  // Transferring control means the worker now owns this canvas's drawing buffer; the main thread can
  // no longer get a 2D/WebGPU context from it. It must be passed in the transfer list.
  const offscreen = canvas.transferControlToOffscreen();
  send(
    {
      type: 'init',
      protocol: WORKER_PROTOCOL_VERSION,
      canvas: offscreen,
      width: init.width,
      height: init.height,
      dpr: init.dpr,
      quality: init.quality,
      coarse: init.coarse,
      reducedMotion: init.reducedMotion,
    },
    [offscreen],
  );

  return {
    resize: (width, height, dpr) => send({ type: 'resize', width, height, dpr }),
    pointer: (msg) => send({ type: 'pointer', ...msg }),
    wheel: (msg) => send({ type: 'wheel', ...msg }),
    control: (key, value) => send({ type: 'control', key, value }),
    command: (name, args) => send({ type: 'command', name, ...(args ? { args } : {}) }),
    dispose: () => {
      send({ type: 'dispose' });
      worker.terminate();
    },
  };
}

/**
 * Capture pointer/wheel input on the on-page canvas and replay it to the worker's camera (step 3).
 * The REAL element does the pointer capture (so drags keep tracking outside the canvas) and
 * `preventDefault`s wheel/touch scrolling — the worker-side proxy only ever no-ops those. CSS-pixel
 * coordinates relative to the canvas, matching the proxy's `clientWidth/Height`.
 */
export function attachWorkerInput(canvas: HTMLCanvasElement, host: WorkerHost): void {
  const relay = (action: PointerMessage['action']) => (ev: PointerEvent) => {
    if (action === 'down') canvas.setPointerCapture(ev.pointerId);
    if (action === 'up' || action === 'cancel') {
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    }
    const rect = canvas.getBoundingClientRect();
    host.pointer({
      action,
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      pointerId: ev.pointerId,
      pointerType: ev.pointerType,
      button: ev.button,
      buttons: ev.buttons,
    });
    if (action === 'down') ev.preventDefault();
  };
  canvas.addEventListener('pointerdown', relay('down'));
  canvas.addEventListener('pointermove', relay('move'));
  canvas.addEventListener('pointerup', relay('up'));
  canvas.addEventListener('pointercancel', relay('cancel'));
  canvas.addEventListener(
    'wheel',
    (ev: WheelEvent) => {
      ev.preventDefault(); // the page must not scroll under a zoom gesture
      host.wheel({ deltaY: ev.deltaY, deltaMode: ev.deltaMode, ctrlKey: ev.ctrlKey });
    },
    { passive: false },
  );
  canvas.style.touchAction = 'none'; // pointer events own touch — no browser pan/zoom on the canvas
}
