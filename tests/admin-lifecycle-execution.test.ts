import { describe, expect, it, vi } from 'vitest';
import type { BotActionSnapshot } from '../src/admin/bot-controller.js';
import { startLifecycleExecution, type AdminLifecycleResult } from '../src/admin/lifecycle-execution.js';

function flushDetachedExecution(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('admin lifecycle execution', () => {
  it.each([
    ['throws synchronously', () => {
      throw new TypeError('sensitive synchronous output');
    }],
    ['returns a rejected promise', () => Promise.reject(new TypeError('sensitive rejected output'))],
  ])('delivers one generic failure when the controller %s', async (_case, execute) => {
    // Given
    const onSettled = vi.fn<(result: AdminLifecycleResult) => void>();
    const onInternalFailure = vi.fn<() => void>();
    const controller = {
      snapshot: (): BotActionSnapshot => ({ state: 'idle' }),
      execute: vi.fn(execute),
    };

    // When
    startLifecycleExecution(controller, 'restart', { onSettled, onInternalFailure });

    // Then
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    await flushDetachedExecution();
    expect(onSettled).toHaveBeenCalledWith({ action: 'restart', outcome: 'failed', durationMs: 0 });
    expect(onInternalFailure).not.toHaveBeenCalled();
    expect(controller.execute).toHaveBeenCalledOnce();
  });

  it.each<readonly [string, BotActionSnapshot]>([
    ['idle', { state: 'idle' }],
    ['running', { action: 'start', state: 'running', startedAt: '2026-08-29T12:00:00.000Z' }],
  ])('maps a resolved %s snapshot to one generic failure', async (_case, snapshot) => {
    // Given
    const onSettled = vi.fn<(result: AdminLifecycleResult) => void>();
    const onInternalFailure = vi.fn<() => void>();
    const controller = { snapshot: () => snapshot, execute: vi.fn(async () => snapshot) };

    // When
    startLifecycleExecution(controller, 'start', { onSettled, onInternalFailure });

    // Then
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    expect(onSettled).toHaveBeenCalledWith({ action: 'start', outcome: 'failed', durationMs: 0 });
    expect(onInternalFailure).not.toHaveBeenCalled();
    expect(controller.execute).toHaveBeenCalledOnce();
  });

  it('preserves completed execution duration', async () => {
    // Given
    const snapshot: BotActionSnapshot = {
      action: 'stop',
      state: 'completed',
      startedAt: '2026-08-29T12:00:00.250Z',
      completedAt: '2026-08-29T12:00:02.750Z',
      outcome: 'succeeded',
    };
    const onSettled = vi.fn<(result: AdminLifecycleResult) => void>();
    const controller = { snapshot: () => snapshot, execute: vi.fn(async () => snapshot) };

    // When
    startLifecycleExecution(controller, 'stop', { onSettled, onInternalFailure: vi.fn() });

    // Then
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
    expect(onSettled).toHaveBeenCalledWith({ action: 'stop', outcome: 'succeeded', durationMs: 2_500 });
  });

  it('reports a throwing settlement consumer once without retrying it', async () => {
    // Given
    const snapshot: BotActionSnapshot = { state: 'idle' };
    const onSettled = vi.fn(() => {
      throw new TypeError('sensitive audit output');
    });
    const onInternalFailure = vi.fn<() => void>();
    const controller = { snapshot: () => snapshot, execute: vi.fn(async () => snapshot) };

    // When
    startLifecycleExecution(controller, 'start', { onSettled, onInternalFailure });

    // Then
    await vi.waitFor(() => expect(onInternalFailure).toHaveBeenCalledOnce());
    await flushDetachedExecution();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith({ action: 'start', outcome: 'failed', durationMs: 0 });
    expect(onInternalFailure).toHaveBeenCalledWith();
  });

  it('contains a throwing internal failure reporter without an unhandled rejection', async () => {
    // Given
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const snapshot: BotActionSnapshot = { state: 'idle' };
    const onSettled = vi.fn(() => {
      throw new TypeError('sensitive audit output');
    });
    const onInternalFailure = vi.fn(() => {
      throw new TypeError('sensitive reporter output');
    });
    const controller = { snapshot: () => snapshot, execute: vi.fn(async () => snapshot) };

    try {
      // When
      startLifecycleExecution(controller, 'restart', { onSettled, onInternalFailure });

      // Then
      await vi.waitFor(() => expect(onInternalFailure).toHaveBeenCalledOnce());
      await flushDetachedExecution();
      expect(onSettled).toHaveBeenCalledOnce();
      expect(onInternalFailure).toHaveBeenCalledWith();
      expect(unhandledReasons).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
