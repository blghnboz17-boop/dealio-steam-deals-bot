import { Routes, type Client } from 'discord.js';
import type { Language } from '../domain/user-config.js';
import type { NotificationCandidate } from '../domain/wishlist-state.js';
import {
  NotificationDeliveryCancelledError,
  type NotificationSender,
} from '../application/notification-service.js';
import { buildSaleNotificationMessage } from './notification-messages.js';

export class DiscordNotificationTimeoutError extends Error {
  public readonly name = 'DiscordNotificationTimeoutError';
}

export class DiscordNotificationSender implements NotificationSender {
  private readonly timeoutMs: number;
  private readonly lifecycleSignal?: AbortSignal;

  public constructor(
    private readonly client: Client,
    options: { readonly timeoutMs?: number; readonly lifecycleSignal?: AbortSignal } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.lifecycleSignal = options.lifecycleSignal;

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Discord notification timeout must be a positive safe integer');
    }
  }

  public async send(candidate: NotificationCandidate, language: Language): Promise<void> {
    if (this.lifecycleSignal?.aborted) {
      throw new NotificationDeliveryCancelledError('Notification delivery cancelled');
    }

    const controller = new AbortController();
    const abortForShutdown = (): void => {
      controller.abort(new NotificationDeliveryCancelledError('Notification delivery cancelled'));
    };
    this.lifecycleSignal?.addEventListener('abort', abortForShutdown, { once: true });
    const timeout = setTimeout(() => {
      controller.abort(new DiscordNotificationTimeoutError('Discord notification delivery timed out'));
    }, this.timeoutMs);
    const abortPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new DiscordNotificationTimeoutError('Discord notification delivery timed out'),
        );
      }, { once: true });
    });

    try {
      await Promise.race([this.deliver(candidate, language, controller.signal), abortPromise]);
    } finally {
      clearTimeout(timeout);
      this.lifecycleSignal?.removeEventListener('abort', abortForShutdown);
    }
  }

  private async deliver(
    candidate: NotificationCandidate,
    language: Language,
    signal: AbortSignal,
  ): Promise<void> {
    const channel = await this.client.rest.post(Routes.userChannels(), {
      body: { recipient_id: candidate.discordUserId },
      signal,
    }) as { id?: unknown };
    if (typeof channel.id !== 'string' || !/^\d+$/.test(channel.id)) {
      throw new Error('Discord returned an invalid DM channel');
    }

    await this.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        content: buildSaleNotificationMessage(candidate, language),
        allowed_mentions: { parse: [] },
      },
      signal,
    });
  }
}
