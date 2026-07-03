import { describe, expect, it } from 'vitest';
import { handleMessage } from './router';
import { WORKER_PROTOCOL_VERSION, type WorkerToMain } from './protocol';
import type { WorkerEngine } from './workerEngine';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0)); // let engine.init() settle

function collect() {
  const out: WorkerToMain[] = [];
  return { post: (m: WorkerToMain) => out.push(m), out };
}

function mockEngine(overrides: Partial<WorkerEngine> = {}): { engine: WorkerEngine; calls: string[] } {
  const calls: string[] = [];
  const engine: WorkerEngine = {
    init: async () => {
      calls.push('init');
      return { backend: 'webgpu' };
    },
    resize: () => {
      calls.push('resize');
    },
    pointer: (msg) => {
      calls.push(`pointer:${msg.action}`);
    },
    wheel: () => {
      calls.push('wheel');
    },
    control: (key, value) => {
      calls.push(`control:${key}=${String(value)}`);
    },
    command: (name, args) => {
      calls.push(`command:${name}${args ? `(${args.join(',')})` : ''}`);
    },
    dispose: () => {
      calls.push('dispose');
    },
    ...overrides,
  };
  return { engine, calls };
}

const canvas = {} as OffscreenCanvas;
const initMsg = (protocol = WORKER_PROTOCOL_VERSION) =>
  ({ type: 'init', protocol, canvas, width: 100, height: 80, dpr: 1, quality: 'auto', coarse: false, reducedMotion: false }) as const;

describe('renderWorker routing', () => {
  it('builds the engine and replies `ready` to a matching-protocol init', async () => {
    const { post, out } = collect();
    const { engine, calls } = mockEngine();
    handleMessage(initMsg(), post, engine);
    await flush();
    expect(calls).toContain('init');
    expect(out).toEqual([{ type: 'ready', protocol: WORKER_PROTOCOL_VERSION, backend: 'webgpu' }]);
  });

  it('replies `error` on a protocol mismatch — without building the engine', () => {
    const { post, out } = collect();
    const { engine, calls } = mockEngine();
    handleMessage(initMsg(999), post, engine);
    expect(calls).not.toContain('init');
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('error');
  });

  it('surfaces an engine init failure as `error`', async () => {
    const { post, out } = collect();
    const { engine } = mockEngine({
      init: () => Promise.reject(new Error('no webgpu')),
    });
    handleMessage(initMsg(), post, engine);
    await flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'error', message: 'no webgpu' });
  });

  it('surfaces an `ospUnsupported`-marked init failure as `unsupported` (the clean fall-back signal)', async () => {
    const { post, out } = collect();
    const err = new Error('worker render path unsupported: navigator.gpu is not exposed to workers in this browser');
    (err as unknown as { ospUnsupported: boolean }).ospUnsupported = true;
    const { engine } = mockEngine({ init: () => Promise.reject(err) });
    handleMessage(initMsg(), post, engine);
    await flush();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'unsupported', reason: err.message });
  });

  it('routes resize + input + control + command(args) + dispose to the engine', () => {
    const { post, out } = collect();
    const { engine, calls } = mockEngine();
    handleMessage({ type: 'resize', width: 1, height: 1, dpr: 1 }, post, engine);
    handleMessage({ type: 'pointer', action: 'down', x: 5, y: 5, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 }, post, engine);
    handleMessage({ type: 'pointer', action: 'move', x: 9, y: 5, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 }, post, engine);
    handleMessage({ type: 'wheel', deltaY: -50, deltaMode: 0, ctrlKey: false }, post, engine);
    handleMessage({ type: 'command', name: 'reveal' }, post, engine); // the splash lifted (3c)
    handleMessage({ type: 'control', key: 'time.scale', value: 80 }, post, engine); // the 4a channel
    handleMessage({ type: 'command', name: 'addBody', args: ['star'] }, post, engine); // body edits carry args
    handleMessage({ type: 'dispose' }, post, engine);
    expect(calls).toEqual([
      'resize',
      'pointer:down',
      'pointer:move',
      'wheel',
      'command:reveal',
      'control:time.scale=80',
      'command:addBody(star)',
      'dispose',
    ]);
    expect(out).toEqual([]);
  });
});
