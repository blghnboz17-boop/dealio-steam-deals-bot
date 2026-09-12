import type { Language } from '../domain/user-config.js';
import type { StoreCountryCode } from '../domain/store-country.js';
import type {
  DurableNotificationBatch,
  NotificationBatch,
  NotificationCandidate,
} from '../domain/wishlist-state.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { WishlistStateRepository } from '../persistence/wishlist-state-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export interface NotificationSender {
  plan<T extends SaleNotification>(
    notifications: readonly T[],
    language: Language,
    options?: NotificationSendOptions,
  ): readonly NotificationBatch<T>[];
  send(
    batch: NotificationBatch<SaleNotification>,
    language: Language,
    options?: NotificationSendOptions,
  ): Promise<void>;
}

export interface SaleNotification {
  readonly discordUserId: string;
  readonly appId: number;
  readonly saleEpisodeId: string;
  readonly storeCountryCode: StoreCountryCode;
  readonly gameName: string;
  readonly currency: string;
  readonly normalPriceMinor: number;
  readonly finalPriceMinor: number;
  readonly discountPercent: number;
  readonly createdAt: string;
}

export interface NotificationSendOptions {
  readonly test?: boolean;
}

export class NotificationDeliveryCancelledError extends Error {
  public readonly name = 'NotificationDeliveryCancelledError';
}

export interface NotificationDeliveryResult {
  readonly candidateCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
}

interface BatchDeliveryOutcome {
  readonly sentCount: number;
  readonly failedCount: number;
  readonly cancelled: boolean;
}

export interface NotificationServiceOptions {
  readonly sendingTimeoutMs?: number;
  readonly now?: () => Date;
  readonly coordinator?: UserOperationCoordinator;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly lifecycleSignal?: AbortSignal;
}

const defaultSendingTimeoutMs = 15 * 60 * 1000;
const defaultMaxAttempts = 5;
const defaultRetryBaseDelayMs = 5 * 60 * 1000;
const defaultMaxRetryDelayMs = 24 * 60 * 60 * 1000;

export class NotificationService {
  private readonly sendingTimeoutMs: number;
  private readonly now: () => Date;
  private readonly coordinator: UserOperationCoordinator;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly lifecycleSignal?: AbortSignal;

  public constructor(
    private readonly userConfigRepository: UserConfigRepository,
    private readonly wishlistStateRepository: WishlistStateRepository,
    private readonly sender: NotificationSender,
    options: NotificationServiceOptions = {},
  ) {
    this.sendingTimeoutMs = options.sendingTimeoutMs ?? defaultSendingTimeoutMs;
    this.now = options.now ?? (() => new Date());
    this.coordinator = options.coordinator ?? new UserOperationCoordinator();
    this.maxAttempts = options.maxAttempts ?? defaultMaxAttempts;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? defaultRetryBaseDelayMs;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? defaultMaxRetryDelayMs;
    this.lifecycleSignal = options.lifecycleSignal;

    if (!Number.isSafeInteger(this.sendingTimeoutMs) || this.sendingTimeoutMs <= 0) {
      throw new Error('Notification sending timeout must be a positive safe integer');
    }

    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('Notification max attempts must be a positive safe integer');
    }

    for (const [name, value] of [
      ['retry base delay', this.retryBaseDelayMs],
      ['maximum retry delay', this.maxRetryDelayMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Notification ${name} must be a positive safe integer`);
      }
    }
  }

  public async deliverPending(discordUserId: string): Promise<NotificationDeliveryResult> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.deliverPendingExclusive(discordUserId),
    );
  }

  private async deliverPendingExclusive(
    discordUserId: string,
  ): Promise<NotificationDeliveryResult> {
    if (this.lifecycleSignal?.aborted) {
      return { candidateCount: 0, sentCount: 0, failedCount: 0 };
    }

    const config = this.userConfigRepository.findByDiscordUserId(discordUserId);

    if (!config?.enabled) {
      return { candidateCount: 0, sentCount: 0, failedCount: 0 };
    }

    const staleBefore = new Date(this.now().getTime() - this.sendingTimeoutMs).toISOString();
    this.wishlistStateRepository.recoverStaleSending(config, staleBefore);
    this.wishlistStateRepository.expireInactiveNotifications(config);
    const now = this.now().toISOString();
    const retryableBatches = this.wishlistStateRepository.findRetryableNotificationBatches(
      config,
      now,
    );
    const candidates = this.wishlistStateRepository.findRetryableNotificationCandidates(
      config,
      now,
    );
    const candidateCount = candidates.length + retryableBatches.reduce(
      (total, batch) => total + batch.notifications.length,
      0,
    );
    let sentCount = 0;
    let failedCount = 0;
    let cancelled = false;

    for (const batch of retryableBatches) {
      if (this.lifecycleSignal?.aborted) {
        break;
      }

      if (batch.attemptCount >= this.maxAttempts) {
        this.wishlistStateRepository.markNotificationBatchTerminal(
          batch,
          'Maximum delivery attempt count reached',
        );
        failedCount += batch.notifications.length;
        continue;
      }

      const claimed = this.wishlistStateRepository.claimNotificationBatch(
        batch,
        this.now().toISOString(),
      );
      if (!claimed) {
        continue;
      }

      const outcome = await this.deliverClaimedBatch(batch);
      sentCount += outcome.sentCount;
      failedCount += outcome.failedCount;
      cancelled = outcome.cancelled;
      if (cancelled) {
        break;
      }
    }

    const plannedBatches: NotificationBatch<NotificationCandidate>[] = [];
    if (!cancelled && !this.lifecycleSignal?.aborted) {
      let currentAttemptCount: number | undefined;
      let currentCandidates: NotificationCandidate[] = [];

      const flushCandidates = (): void => {
        if (currentCandidates.length > 0) {
          plannedBatches.push(...this.sender.plan(currentCandidates, config.language));
          currentCandidates = [];
        }
      };

      for (const candidate of candidates) {
        if (candidate.attemptCount >= this.maxAttempts) {
          flushCandidates();
          currentAttemptCount = undefined;
          this.wishlistStateRepository.markNotificationTerminal(
            candidate,
            'Maximum delivery attempt count reached',
          );
          failedCount += 1;
          continue;
        }

        if (currentAttemptCount !== undefined && candidate.attemptCount !== currentAttemptCount) {
          flushCandidates();
        }
        currentAttemptCount = candidate.attemptCount;
        currentCandidates.push(candidate);
      }
      flushCandidates();
    }

    for (const plannedBatch of plannedBatches) {
      if (this.lifecycleSignal?.aborted) {
        break;
      }

      const batch = this.wishlistStateRepository.createAndClaimNotificationBatch(
        config,
        config.language,
        plannedBatch.notifications,
        this.now().toISOString(),
      );
      if (!batch) {
        continue;
      }

      const outcome = await this.deliverClaimedBatch(batch);
      sentCount += outcome.sentCount;
      failedCount += outcome.failedCount;
      if (outcome.cancelled) {
        break;
      }
    }

    return {
      candidateCount,
      sentCount,
      failedCount,
    };
  }

  private async deliverClaimedBatch(
    batch: DurableNotificationBatch,
  ): Promise<BatchDeliveryOutcome> {
    try {
      await this.sender.send(batch, batch.language);
    } catch (error: unknown) {
      if (error instanceof NotificationDeliveryCancelledError) {
        return { sentCount: 0, failedCount: 0, cancelled: true };
      }

      const message = error instanceof Error ? error.message : 'Unknown Discord error';
      const attemptCount = batch.attemptCount + 1;
      const permanentlyBlocked = isDiscordDmBlocked(error);
      const terminal = isPermanentDiscordError(error) || attemptCount >= this.maxAttempts;
      const retryDelayMs = Math.min(
        this.retryBaseDelayMs * (2 ** Math.max(0, attemptCount - 1)),
        this.maxRetryDelayMs,
      );
      const nextAttemptAt = terminal
        ? null
        : new Date(this.now().getTime() + retryDelayMs).toISOString();
      this.wishlistStateRepository.markNotificationBatchFailed(
        batch,
        message,
        nextAttemptAt,
        terminal,
      );
      if (permanentlyBlocked) {
        this.userConfigRepository.markDmDeliveryBlocked(
          batch.notifications[0].discordUserId,
          'DISCORD_DM_BLOCKED',
          this.now().toISOString(),
        );
      }
      return {
        sentCount: 0,
        failedCount: batch.notifications.length,
        cancelled: false,
      };
    }

    try {
      this.wishlistStateRepository.markNotificationBatchSent(batch);
      return {
        sentCount: batch.notifications.length,
        failedCount: 0,
        cancelled: false,
      };
    } catch (_error: unknown) {
      // The transaction rolls back to sending; stale recovery preserves at-least-once delivery.
      return {
        sentCount: 0,
        failedCount: batch.notifications.length,
        cancelled: false,
      };
    }
  }
}

export function isPermanentDiscordError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? Number(error.code) : Number.NaN;
  if (code === 50_007) {
    return true;
  }

  const status = 'status' in error ? Number(error.status) : Number.NaN;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** Only an explicit recipient delivery error establishes a DM privacy block. */
export function isDiscordDmBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && Number(error.code) === 50_007;
}
