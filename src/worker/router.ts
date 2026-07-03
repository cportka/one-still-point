/**
 * Pure main→worker message routing for the render worker — separated from the worker entry so it can
 * be unit-tested without importing the WebGPU engine (three/webgpu). The {@link WorkerEngine} is
 * injected; the entry (`renderWorker.ts`) wires the real one. See `docs/offscreen-canvas.md`.
 */
import { WORKER_PROTOCOL_VERSION, type MainToWorker, type WorkerToMain } from './protocol';
import type { WorkerEngine } from './workerEngine';

/** Where worker → main messages go. In a real worker this is `self.postMessage`; injectable for tests. */
export type Post = (message: WorkerToMain) => void;

/**
 * Handle one main → worker message against `engine`. On `init` it checks the protocol, builds the
 * engine, and posts `ready` (or `error`); `resize`/`dispose` drive the engine; the rest are no-ops
 * until later steps wire them.
 */
export function handleMessage(msg: MainToWorker, post: Post, engine: WorkerEngine): void {
  switch (msg.type) {
    case 'init':
      if (msg.protocol !== WORKER_PROTOCOL_VERSION) {
        post({ type: 'error', message: `protocol mismatch: main ${msg.protocol} vs worker ${WORKER_PROTOCOL_VERSION}` });
        return;
      }
      engine
        .init(msg)
        .then(({ backend }) => post({ type: 'ready', protocol: WORKER_PROTOCOL_VERSION, backend }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          // An `ospUnsupported`-marked throw is the engine's capability probe saying "this
          // environment can't run the worker path" — a clean fall-back signal, not a failure.
          if (typeof err === 'object' && err !== null && (err as { ospUnsupported?: boolean }).ospUnsupported === true) {
            post({ type: 'unsupported', reason: message });
          } else {
            post({ type: 'error', message });
          }
        });
      return;
    case 'resize':
      engine.resize(msg.width, msg.height, msg.dpr);
      return;
    case 'pointer':
      engine.pointer(msg);
      return;
    case 'wheel':
      engine.wheel(msg);
      return;
    case 'control':
      engine.control(msg.key, msg.value); // the 4a panel channel — one table worker-side
      return;
    case 'command':
      engine.command(msg.name, msg.args);
      return;
    case 'dispose':
      engine.dispose();
      return;
    default:
      return;
  }
}
