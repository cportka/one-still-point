import { describe, expect, it } from 'vitest';
import { isMainToWorker, isWorkerToMain, MAIN_TO_WORKER_TYPES, WORKER_TO_MAIN_TYPES, WORKER_PROTOCOL_VERSION } from './protocol';

describe('worker protocol guards', () => {
  it('recognises main→worker messages by their tag', () => {
    expect(isMainToWorker({ type: 'init' })).toBe(true);
    expect(isMainToWorker({ type: 'resize' })).toBe(true);
    expect(isMainToWorker({ type: 'dispose' })).toBe(true);
    expect(isMainToWorker({ type: 'ready' })).toBe(false); // a worker→main type, not main→worker
    expect(isMainToWorker({ type: 'nope' })).toBe(false);
    expect(isMainToWorker(null)).toBe(false);
    expect(isMainToWorker('init')).toBe(false); // a bare string is not a tagged message
    expect(isMainToWorker({})).toBe(false);
  });

  it('recognises worker→main messages by their tag', () => {
    expect(isWorkerToMain({ type: 'ready' })).toBe(true);
    expect(isWorkerToMain({ type: 'status' })).toBe(true);
    expect(isWorkerToMain({ type: 'error' })).toBe(true);
    expect(isWorkerToMain({ type: 'capability' })).toBe(true); // v4 — the worker's WebGPU probe
    expect(isWorkerToMain({ type: 'unsupported' })).toBe(true); // v4 — the clean fall-back verdict
    expect(isWorkerToMain({ type: 'frame' })).toBe(true); // v5 — per-tick HUD telemetry
    expect(isWorkerToMain({ type: 'timeline' })).toBe(true); // v6 — the DVR's marker numbers
    expect(isWorkerToMain({ type: 'init' })).toBe(false);
    expect(isWorkerToMain(undefined)).toBe(false);
  });

  it('keeps the two directions disjoint (no tag is valid in both)', () => {
    for (const type of [...MAIN_TO_WORKER_TYPES, ...WORKER_TO_MAIN_TYPES]) {
      const m = { type };
      expect(isMainToWorker(m) && isWorkerToMain(m)).toBe(false);
    }
  });

  it('carries a protocol version (≥ 1) for stale-bundle detection', () => {
    expect(WORKER_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
