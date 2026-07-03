/**
 * Worker render **entry** (OffscreenCanvas path, step 2). Thin: it wires the real WebGPU engine
 * (`createWorkerEngine`, browser-only) to the pure message {@link handleMessage} router (unit-tested
 * separately, in `router.ts`). Still **off by default** — only spawned when `canUseOffscreenRendering`
 * says so. See `docs/offscreen-canvas.md`.
 *
 * Scope today: the worker renders a **static formed view** off the main thread (the proof that the
 * heavy raymarch compiles + presents in a worker). Dynamics, input, Controls and Share move in later
 * steps.
 */
import { isMainToWorker, type WorkerToMain } from './protocol';
import { handleMessage, type Post } from './router';
import { createWorkerEngine } from './workerEngine';

// In a dedicated worker `globalThis` *is* the scope; cast to the slice we use so we don't need the
// "WebWorker" tsconfig lib (it collides with "DOM"). Guarded so importing the module outside a worker
// (defensive) is a no-op.
const scope = globalThis as unknown as {
  postMessage?: (message: WorkerToMain) => void;
  addEventListener?: (type: 'message', listener: (ev: { data: unknown }) => void) => void;
  WorkerGlobalScope?: unknown;
};

if (typeof scope.WorkerGlobalScope !== 'undefined' && scope.addEventListener && scope.postMessage) {
  const post: Post = (message) => scope.postMessage!(message);
  const engine = createWorkerEngine(post); // the engine posts status/revealReady/perf itself (3c)
  scope.addEventListener('message', (ev) => {
    if (isMainToWorker(ev.data)) handleMessage(ev.data, post, engine);
  });
  // Debug telemetry: an uncaught throw or rejection inside the worker must reach the main-thread
  // console (a silent dead worker looks exactly like a hang — the ?worker=1 crash reports need
  // this). Rate-limited: a persistent per-frame throw (three's rAF chain survives callback throws)
  // must report once per second with a repeat count, not flood a message per vsync forever.
  let lastErrorAt = 0;
  let suppressed = 0;
  const relayError = (message: string): void => {
    const now = Date.now();
    if (now - lastErrorAt < 1000) {
      suppressed += 1;
      return;
    }
    lastErrorAt = now;
    post({ type: 'error', message: suppressed > 0 ? `${message} (+${suppressed} repeats suppressed)` : message });
    suppressed = 0;
  };
  const errorHook = scope.addEventListener as (type: string, listener: (ev: unknown) => void) => void;
  errorHook('error', (ev) => {
    const e = ev as { message?: string; filename?: string; lineno?: number; preventDefault?: () => void };
    e.preventDefault?.(); // we relay it — silence the browser's own duplicate per-frame report
    relayError(`worker uncaught: ${e.message ?? 'unknown'} (${e.filename ?? '?'}:${e.lineno ?? '?'})`);
  });
  errorHook('unhandledrejection', (ev) => {
    const r = (ev as { reason?: unknown }).reason;
    relayError(`worker unhandled rejection: ${r instanceof Error ? r.message : String(r)}`);
  });
}
