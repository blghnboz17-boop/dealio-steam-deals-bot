import { Routes, type APIEmbed, type Client } from 'discord.js';
import type { Language } from '../domain/user-config.js';
import type { NotificationBatch } from '../domain/wishlist-state.js';
import {
  NotificationDeliveryCancelledError,
  type NotificationSendOptions,
  type NotificationSender,
  type SaleNotification,
} from '../application/notification-service.js';
import {
  buildSaleNotificationEmbed,
  embedTextLength,
} from './notification-messages.js';

const maximumEmbedsPerMessage = 10;
const maximumEmbedTextPerMessage = 6_000;

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

  public plan<T extends SaleNotification>(
    notifications: readonly T[],
    language: Language,
    options: NotificationSendOptions = {},
  ): readonly NotificationBatch<T>[] {
    const sorted = [...notifications].sort(compareNotifications);
    return partitionNotificationBatches(
      sorted,
      (notification) => buildSaleNotificationEmbed(notification, language, options),
    );
  }

  public async send(
    batch: NotificationBatch<SaleNotification>,
    language: Language,
    options: NotificationSendOptions = {},
  ): Promise<void> {
    const recipientId = batch.notifications[0].discordUserId;
    if (batch.notifications.some((notification) => notification.discordUserId !== recipientId)) {
      throw new Error('Notification batch must contain exactly one Discord recipient');
    }

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
      await Promise.race([
        this.deliver(batch, language, options, controller.signal),
        abortPromise,
      ]);
    } finally {
      clearTimeout(timeout);
      this.lifecycleSignal?.removeEventListener('abort', abortForShutdown);
    }
  }

  private async deliver(
    batch: NotificationBatch<SaleNotification>,
    language: Language,
    options: NotificationSendOptions,
    signal: AbortSignal,
  ): Promise<void> {
    const recipientId = batch.notifications[0].discordUserId;
    const channel = await this.client.rest.post(Routes.userChannels(), {
      body: { recipient_id: recipientId },
      signal,
    }) as { id?: unknown };
    if (typeof channel.id !== 'string' || !/^\d+$/.test(channel.id)) {
      throw new Error('Discord returned an invalid DM channel');
    }

    await this.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        embeds: batch.notifications.map((notification) =>
          buildSaleNotificationEmbed(notification, language, options)
        ),
        allowed_mentions: { parse: [] },
      },
      signal,
    });
  }
}

export function partitionNotificationBatches<T>(
  notifications: readonly T[],
  renderEmbed: (notification: T) => APIEmbed,
): readonly NotificationBatch<T>[] {
  const batches: NotificationBatch<T>[] = [];
  let current: T[] = [];
  let currentTextLength = 0;

  for (const notification of notifications) {
    const textLength = embedTextLength(renderEmbed(notification));
    if (textLength > maximumEmbedTextPerMessage) {
      throw new Error('A notification embed exceeds Discord limits');
    }

    if (
      current.length === maximumEmbedsPerMessage
      || (current.length > 0 && currentTextLength + textLength > maximumEmbedTextPerMessage)
    ) {
      batches.push({ notifications: current as [T, ...T[]] });
      current = [];
      currentTextLength = 0;
    }

    current.push(notification);
    currentTextLength += textLength;
  }

  if (current.length > 0) {
    batches.push({ notifications: current as [T, ...T[]] });
  }

  return batches;
}

function compareNotifications(left: SaleNotification, right: SaleNotification): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  if (left.appId !== right.appId) {
    return left.appId - right.appId;
  }
  if (left.saleEpisodeId === right.saleEpisodeId) {
    return 0;
  }
  return left.saleEpisodeId < right.saleEpisodeId ? -1 : 1;
}
