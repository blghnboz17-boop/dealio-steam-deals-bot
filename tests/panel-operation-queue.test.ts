import { describe, expect, it, vi } from 'vitest';
import { PanelOperationQueue } from '../src/discord/ui/operation-queue.js';

describe('PanelOperationQueue', () => {
  it('observes a failed acknowledgement immediately and keeps later clicks usable', async () => {
    let release!: () => void;
    const onError = vi.fn();
    const queue = new PanelOperationQueue(onError);
    void queue.enqueue(Promise.resolve(), () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const failedOperation = vi.fn();
    const failure = new Error('acknowledgement failed');
    void queue.enqueue(Promise.reject(failure), failedOperation);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const nextOperation = vi.fn().mockResolvedValue(undefined);
    void queue.enqueue(Promise.resolve(), nextOperation);
    expect(nextOperation).not.toHaveBeenCalled();
    release();
    await queue.drain();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(failedOperation).not.toHaveBeenCalled();
    expect(nextOperation).toHaveBeenCalledOnce();
  });

  it('recovers when both an operation and its error notice fail', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const queue = new PanelOperationQueue(async () => { throw new Error('notice failed'); });
      void queue.enqueue(Promise.resolve(), async () => { throw new Error('update failed'); });
      const next = vi.fn().mockResolvedValue(undefined);
      await queue.enqueue(Promise.resolve(), next);
      expect(next).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); }
  });
});
