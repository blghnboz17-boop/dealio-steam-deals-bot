import { safeLogger } from '../../application/safe-logger.js';
/** Serializes panel updates while observing Discord acknowledgements immediately. */
export class PanelOperationQueue {
  private pending = Promise.resolve();

  public constructor(private readonly onError: (error: unknown) => void | Promise<void>) {}

  public enqueue(acknowledgement: Promise<unknown>, operation: () => Promise<void>): Promise<void> {
    // A later click can fail its acknowledgement while an earlier update is still running.
    const acknowledged = acknowledgement.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    this.pending = this.pending.then(async () => {
      const outcome = await acknowledged;
      if (!outcome.ok) throw outcome.error;
      await operation();
    }).catch(async (error: unknown) => {
      try {
        await this.onError(error);
      } catch (reportError: unknown) {
        safeLogger.error('Discord panel error notice failed', reportError);
      }
    });
    return this.pending;
  }

  public drain(): Promise<void> {
    return this.pending;
  }
}
