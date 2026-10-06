import type { InteractionUpdateOptions, Message, MessageComponentInteraction } from 'discord.js';
import { measureDiscordOperation } from '../interaction-timing.js';

/**
 * How old a click may get before it is acknowledged without its panel edit.
 * Discord fails a click that has no answer after 3 s; this leaves room for the
 * answer itself and a slow gateway.
 */
export const clickAnswerWindowMs = 1_500;

type Clickable = Pick<MessageComponentInteraction, 'deferUpdate' | 'update' | 'createdTimestamp' | 'message'>;

/**
 * Lets the panel edit a click causes be the click's answer: one Discord call
 * (`update`) instead of two (`deferUpdate`, then an edit of the message). When
 * that edit is not ready in time, the click is deferred as before and the edit
 * goes through the panel's own path.
 */
export class ClickResponse {
  private state: 'pending' | 'deferred' | 'answered' = 'pending';
  private deferral: Promise<unknown> = Promise.resolve();
  private readonly timer: ReturnType<typeof setTimeout>;

  public constructor(
    private readonly component: Clickable,
    private readonly name: string,
    now: () => number = Date.now,
  ) {
    const age = now() - component.createdTimestamp;
    const delay = Number.isFinite(age) ? Math.max(0, clickAnswerWindowMs - age) : 0;
    this.timer = setTimeout(() => { void this.defer().catch(() => undefined); }, delay);
    this.timer.unref?.();
  }

  /** Shows `options` as the click's answer when it still can; otherwise runs `fallback`. */
  public async edit<T>(options: InteractionUpdateOptions, fallback: () => Promise<T>): Promise<T | Message> {
    if (this.state === 'pending' && typeof this.component.update === 'function') {
      this.state = 'answered';
      clearTimeout(this.timer);
      await measureDiscordOperation(this.component, `${this.name}.button-update`, () => this.component.update(options));
      return this.component.message;
    }
    await this.defer();
    return fallback();
  }

  /** Acknowledges the click unless its answer was already sent. */
  public defer(): Promise<unknown> {
    if (this.state === 'pending') {
      this.state = 'deferred';
      clearTimeout(this.timer);
      this.deferral = measureDiscordOperation(this.component, `${this.name}.button-ack`, () => this.component.deferUpdate());
    }
    return this.deferral;
  }
}
