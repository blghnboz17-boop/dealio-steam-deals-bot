import type { InteractionUpdateOptions, Message, MessageComponentInteraction } from 'discord.js';
import { safeLogger } from '../../application/safe-logger.js';
import { ClickResponse } from './click-response.js';

/** Serializes panel updates while observing Discord acknowledgements immediately. */
export class PanelOperationQueue {
  private pending = Promise.resolve();
  private activeClick: ClickResponse | null = null;

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

  /**
   * Queues a click's work without acknowledging it first: the first panel edit
   * the work makes through `edit` answers the click in the same Discord call.
   * A click with no edit in time, or none at all, is acknowledged as before.
   */
  public enqueueClick(
    component: MessageComponentInteraction,
    name: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const click = new ClickResponse(component, name);
    return this.enqueue(Promise.resolve(), async () => {
      this.activeClick = click;
      try {
        await operation();
      } catch (error: unknown) {
        // The click still needs its answer before the error notice follows it.
        this.activeClick = null;
        await click.defer().catch(() => undefined);
        throw error;
      }
      this.activeClick = null;
      await click.defer();
    });
  }

  /** Edits the panel: as the running click's answer when possible, otherwise with `fallback`. */
  public edit<T>(options: InteractionUpdateOptions, fallback: () => Promise<T>): Promise<T | Message> {
    return this.activeClick ? this.activeClick.edit(options, fallback) : fallback();
  }

  public drain(): Promise<void> {
    return this.pending;
  }
}
