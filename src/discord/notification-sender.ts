import { randomUUID } from 'node:crypto';
import {
  Events,
  MessageFlags,
  Routes,
  type APIEmbed,
  type Client,
  type Interaction,
} from 'discord.js';
import type { Language } from '../domain/user-config.js';
import type { NotificationBatch } from '../domain/wishlist-state.js';
import type {
  InitialWishlistSummary,
  InitialWishlistSummarySender,
} from '../application/initial-wishlist-summary-service.js';
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
import {
  parseInitialSummaryPageAction,
  type InitialSummaryPresentationOptions,
} from './initial-wishlist-summary-messages.js';
import {
  buildInitialWishlistV2Page,
  buildSaleNotificationPanel,
} from './notification-components-v2.js';
import { languageFromDiscordLocale } from './language.js';
import {
  buildExpiredPanel,
  buildNoticePanel,
  dealioEphemeralV2Flags,
} from './ui/components-v2.js';
import { dealioUiSessions } from './ui/session-manager.js';

const maximumEmbedsPerMessage = 5;
const maximumEmbedTextPerMessage = 6_000;
const initialSummarySessionLifetimeMs = 15 * 60 * 1_000;

interface InitialSummaryPaginationSession {
  readonly summary: InitialWishlistSummary;
  readonly channelId: string;
  readonly messageId: string;
  readonly expiresAt: number;
  readonly timeout: NodeJS.Timeout;
  readonly closeUiSession: () => void;
  pageIndex: number;
}

export class DiscordNotificationTimeoutError extends Error {
  public readonly name = 'DiscordNotificationTimeoutError';
}

export class DiscordNotificationSender implements NotificationSender, InitialWishlistSummarySender {
  private readonly timeoutMs: number;
  private readonly lifecycleSignal?: AbortSignal;
  private readonly initialSummaryPresentation: InitialSummaryPresentationOptions;
  private readonly initialSummarySessions = new Map<string, InitialSummaryPaginationSession>();
  private readonly interactionListener = (interaction: Interaction): void => {
    if (typeof interaction.isButton !== 'function' || !interaction.isButton()) {
      return;
    }
    const action = parseInitialSummaryPageAction(interaction.customId);
    if (!action) {
      return;
    }
    void this.handleInitialSummaryPageInteraction(interaction, action).catch((error: unknown) => {
      console.error('Dealio initial-summary pagination failed', error);
    });
  };

  public constructor(
    private readonly client: Client,
    options: {
      readonly timeoutMs?: number;
      readonly lifecycleSignal?: AbortSignal;
      readonly bannerUrl?: string;
      readonly pollIntervalHours?: number;
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.lifecycleSignal = options.lifecycleSignal;
    this.initialSummaryPresentation = {
      bannerUrl: options.bannerUrl,
      pollIntervalHours: options.pollIntervalHours,
    };

    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Discord notification timeout must be a positive safe integer');
    }

    if (typeof this.client.on === 'function') {
      this.client.on(Events.InteractionCreate, this.interactionListener);
    }
    this.lifecycleSignal?.addEventListener('abort', () => {
      if (typeof this.client.off === 'function') {
        this.client.off(Events.InteractionCreate, this.interactionListener);
      }
      for (const session of this.initialSummarySessions.values()) {
        clearTimeout(session.timeout);
        session.closeUiSession();
      }
      this.initialSummarySessions.clear();
    }, { once: true });
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

    await this.runWithDeadline((signal) => this.deliver(batch, language, options, signal));
  }

  public async sendInitialSummary(summary: InitialWishlistSummary): Promise<void> {
    await this.runWithDeadline((signal) => this.deliverInitialSummary(summary, signal));
  }

  private async runWithDeadline(
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
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
        operation(controller.signal),
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
        flags: MessageFlags.IsComponentsV2,
        components: [buildSaleNotificationPanel(batch.notifications, language, options).toJSON()],
        allowed_mentions: { parse: [] },
      },
      signal,
    });
  }

  private async deliverInitialSummary(
    summary: InitialWishlistSummary,
    signal: AbortSignal,
  ): Promise<void> {
    const channel = await this.client.rest.post(Routes.userChannels(), {
      body: { recipient_id: summary.discordUserId },
      signal,
    }) as { id?: unknown };
    if (typeof channel.id !== 'string' || !/^\d+$/.test(channel.id)) {
      throw new Error('Discord returned an invalid DM channel');
    }

    const sessionId = randomUUID();
    const firstPage = buildInitialWishlistV2Page(
      summary,
      this.currentInitialSummaryPresentation(),
      sessionId,
      0,
    );
    const message = await this.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        flags: MessageFlags.IsComponentsV2,
        components: firstPage.components.map((component) => component.toJSON()),
        allowed_mentions: { parse: [] },
      },
      signal,
    }) as { id?: unknown };
    if (typeof message.id !== 'string' || !/^\d+$/.test(message.id)) {
      throw new Error('Discord returned an invalid initial-summary message');
    }

    if (firstPage.totalPages > 1) {
      const closeUiSession = dealioUiSessions.open(
        sessionId,
        summary.discordUserId,
        ['dealio-summary'],
        initialSummarySessionLifetimeMs,
      );
      const timeout = setTimeout(() => {
        void this.expireInitialSummarySession(sessionId);
      }, initialSummarySessionLifetimeMs);
      timeout.unref();
      this.initialSummarySessions.set(sessionId, {
        summary,
        channelId: channel.id,
        messageId: message.id,
        expiresAt: Date.now() + initialSummarySessionLifetimeMs,
        timeout,
        closeUiSession,
        pageIndex: 0,
      });
    }
  }

  private async handleInitialSummaryPageInteraction(
    interaction: Extract<Interaction, { customId: string }>,
    action: { readonly sessionId: string; readonly action: 'previous' | 'next' },
  ): Promise<void> {
    if (!interaction.isButton()) {
      return;
    }
    const session = this.initialSummarySessions.get(action.sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) {
        this.initialSummarySessions.delete(action.sessionId);
        clearTimeout(session.timeout);
        session.closeUiSession();
      }
      return;
    }
    if (interaction.message.id !== session.messageId || interaction.channelId !== session.channelId) {
      const language = languageFromDiscordLocale(interaction.locale);
      await interaction.reply({
        components: [buildExpiredPanel(language)],
        flags: dealioEphemeralV2Flags,
      }).catch(() => undefined);
      return;
    }
    if (interaction.user.id !== session.summary.discordUserId) {
      await interaction.reply({
        components: [buildNoticePanel(
          session.summary.language,
          'warning',
          session.summary.language === 'tr' ? 'Bu panel sana ait değil' : 'This panel is not yours',
          session.summary.language === 'tr'
            ? 'Kendi Dealio panelini açmak için /wishlist komutunu kullan.'
            : 'Use /wishlist to open your own Dealio panel.',
        )],
        flags: dealioEphemeralV2Flags,
      }).catch(() => undefined);
      return;
    }

    const requestedPage = session.pageIndex + (action.action === 'next' ? 1 : -1);
    const page = buildInitialWishlistV2Page(
      session.summary,
      this.currentInitialSummaryPresentation(),
      action.sessionId,
      requestedPage,
    );
    session.pageIndex = page.pageIndex;
    await interaction.update({
      components: [...page.components],
      allowedMentions: { parse: [] },
    });
  }

  private async expireInitialSummarySession(sessionId: string): Promise<void> {
    const session = this.initialSummarySessions.get(sessionId);
    if (!session) {
      return;
    }
    this.initialSummarySessions.delete(sessionId);
    clearTimeout(session.timeout);
    session.closeUiSession();
    const page = buildInitialWishlistV2Page(
      session.summary,
      this.currentInitialSummaryPresentation(),
      sessionId,
      session.pageIndex,
      true,
    );
    try {
      await this.runWithDeadline(async (signal) => {
        await this.client.rest.patch(Routes.channelMessage(session.channelId, session.messageId), {
          body: { components: page.components.map((component) => component.toJSON()) },
          signal,
        });
      });
    } catch (error: unknown) {
      if (!this.lifecycleSignal?.aborted) {
        console.error('Dealio initial-summary pagination expiry failed', error);
      }
    }
  }

  private currentInitialSummaryPresentation(): InitialSummaryPresentationOptions {
    let avatarUrl: string | undefined;
    try {
      avatarUrl = this.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
    } catch (_error: unknown) {
      avatarUrl = undefined;
    }
    return { ...this.initialSummaryPresentation, avatarUrl };
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
