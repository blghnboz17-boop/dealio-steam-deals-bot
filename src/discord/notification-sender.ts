import { safeLogger } from '../application/safe-logger.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  Events,
  MessageFlags,
  Routes,
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
  type DeliveryReceipt,
  type NotificationSender,
  type SaleNotification,
} from '../application/notification-service.js';
import {
  parseInitialSummaryPageAction,
  type InitialSummaryPresentationOptions,
} from './initial-wishlist-summary-messages.js';
import {
  buildInitialWishlistV2Page,
  buildSaleNotificationPanel,
} from './notification-components-v2.js';
import { localizer } from './i18n.js';
import { languageFromDiscordLocale } from './language.js';
import {
  buildExpiredPanel,
  buildNoticePanel,
  dealioEphemeralV2Flags,
} from './ui/components-v2.js';
import { dealioUiSessions } from './ui/session-manager.js';
import { isRefusedInteraction } from './ui/refused-interactions.js';
import { PanelOperationQueue } from './ui/operation-queue.js';
import { measureDiscordOperation } from './interaction-timing.js';

/**
 * Games in one sale DM. Discord fits ten game sections in one panel (and the
 * durable batch holds ten), so a big sale arrives as one message, not a stream.
 */
export const maximumGamesPerMessage = 10;
const initialSummarySessionLifetimeMs = 15 * 60 * 1_000;

interface InitialSummaryPaginationSession {
  readonly summary: InitialWishlistSummary;
  readonly channelId: string;
  readonly messageId: string;
  readonly expiresAt: number;
  readonly timeout: NodeJS.Timeout;
  readonly closeUiSession: () => void;
  readonly operations: PanelOperationQueue;
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
      safeLogger.error('Dealio initial-summary pagination failed', error);
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
    return partitionNotificationBatches(sorted, (batch) => {
      try {
        buildSaleNotificationPanel(batch, language, options);
        return true;
      } catch (_error: unknown) {
        return false;
      }
    });
  }

  public async send(
    batch: NotificationBatch<SaleNotification>,
    language: Language,
    options: NotificationSendOptions = {},
  ): Promise<DeliveryReceipt> {
    const recipientId = batch.notifications[0].discordUserId;
    if (batch.notifications.some((notification) => notification.discordUserId !== recipientId)) {
      throw new Error('Notification batch must contain exactly one Discord recipient');
    }

    return this.runWithDeadline((signal) => this.deliver(batch, language, options, signal));
  }

  public async sendInitialSummary(summary: InitialWishlistSummary): Promise<void> {
    await this.runWithDeadline((signal) => this.deliverInitialSummary(summary, signal));
  }

  private async runWithDeadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
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
      return await Promise.race([
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
  ): Promise<DeliveryReceipt> {
    const recipientId = batch.notifications[0].discordUserId;
    const channel = await this.client.rest.post(Routes.userChannels(), {
      body: { recipient_id: recipientId },
      signal,
    }) as { id?: unknown };
    if (typeof channel.id !== 'string' || !/^\d+$/.test(channel.id)) {
      throw new Error('Discord returned an invalid DM channel');
    }

    const delivered = await this.client.rest.post(Routes.channelMessages(channel.id), {
      body: {
        // Discord deduplicates recent nonces only; durable retries keep the same
        // identity, but long outages still have at-least-once delivery semantics.
        nonce: createHash('sha256').update(batch.batchId ?? randomUUID()).digest('hex').slice(0, 24),
        enforce_nonce: true,
        flags: MessageFlags.IsComponentsV2,
        components: [buildSaleNotificationPanel(batch.notifications, language, options).toJSON()],
        allowed_mentions: { parse: [] },
      },
      signal,
    }) as {id?: unknown};
    if (typeof delivered?.id !== 'string' || !/^\d+$/.test(delivered.id)) throw new Error('Discord returned an invalid delivery receipt');
    return {messageId:delivered.id,channelId:channel.id,deliveredAt:new Date().toISOString()};
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
        operations: new PanelOperationQueue(error => {
          safeLogger.error('Dealio initial-summary pagination failed', error);
        }),
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
    // The block check answers in a listener that may run after this one.
    await Promise.resolve();
    if (isRefusedInteraction(interaction)) {
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
          localizer(session.summary.language)({ tr: 'Bu panel başkasına ait', en: 'This panel belongs to someone else', de: 'Dieses Panel gehört jemand anderem', fr: 'Ce panneau appartient à quelqu’un d’autre' }),
          localizer(session.summary.language)({
            tr: 'Kendi Dealio panelini /dealio ile açabilirsin.',
            en: 'Use /dealio to open your own Dealio panel.',
            de: 'Mit /dealio öffnest du dein eigenes Dealio-Panel.',
            fr: 'Utilise /dealio pour ouvrir ton propre panneau Dealio.',
          }),
        )],
        flags: dealioEphemeralV2Flags,
      }).catch(() => undefined);
      return;
    }

    const acknowledgement = measureDiscordOperation(interaction, 'initial-summary.button-ack', () => interaction.deferUpdate());
    await session.operations.enqueue(acknowledgement, async () => {
      if (this.initialSummarySessions.get(action.sessionId) !== session
        || session.expiresAt <= Date.now() || this.lifecycleSignal?.aborted) return;
      const requestedPage = session.pageIndex + (action.action === 'next' ? 1 : -1);
      const page = buildInitialWishlistV2Page(
        session.summary,
        this.currentInitialSummaryPresentation(),
        action.sessionId,
        requestedPage,
      );
      await measureDiscordOperation(interaction, 'initial-summary.render', () => interaction.editReply({
        components: [...page.components],
        allowedMentions: { parse: [] },
      }));
      session.pageIndex = page.pageIndex;
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
    // A pending successful edit must finish before the final disabled page is sent.
    await session.operations.drain();
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
        safeLogger.error('Dealio initial-summary pagination expiry failed', error);
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

/**
 * Fills each DM with as many games as one Dealio panel holds, in order. A new
 * message starts only when the next game would not fit within Discord's limits.
 */
export function partitionNotificationBatches<T>(
  notifications: readonly T[],
  fitsOnePanel: (batch: readonly T[]) => boolean,
): readonly NotificationBatch<T>[] {
  const batches: NotificationBatch<T>[] = [];
  let current: T[] = [];
  for (const notification of notifications) {
    if (!fitsOnePanel([notification])) {
      throw new Error('A notification exceeds Discord limits');
    }
    const next = [...current, notification];
    if (current.length > 0 && (next.length > maximumGamesPerMessage || !fitsOnePanel(next))) {
      batches.push({ notifications: current as [T, ...T[]] });
      current = [notification];
    } else {
      current = next;
    }
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
