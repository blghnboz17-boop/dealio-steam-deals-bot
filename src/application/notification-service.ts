import type { Language } from '../domain/user-config.js';
import type { NotificationCandidate } from '../domain/wishlist-state.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { WishlistStateRepository } from '../persistence/wishlist-state-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export interface NotificationSender {
  send(candidate: NotificationCandidate, language: Language): Promise<void>;
}

export class NotificationDeliveryCancelledError extends Error {
  public readonly name = 'NotificationDeliveryCancelledError';
}

export interface NotificationDeliveryResult {
  readonly candidateCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
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

    if (!config) {
      return { candidateCount: 0, sentCount: 0, failedCount: 0 };
    }

    const staleBefore = new Date(this.now().getTime() - this.sendingTimeoutMs).toISOString();
    this.wishlistStateRepository.recoverStaleSending(config, staleBefore);
    this.wishlistStateRepository.expireInactiveNotifications(config);
    const candidates = this.wishlistStateRepository.findRetryableNotificationCandidates(
      config,
      this.now().toISOString(),
    );
    let sentCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
      if (this.lifecycleSignal?.aborted) {
        break;
      }

      if (candidate.attemptCount >= this.maxAttempts) {
        this.wishlistStateRepository.markNotificationTerminal(
          candidate,
          'Maximum delivery attempt count reached',
        );
        failedCount += 1;
        continue;
      }

      const claimed = this.wishlistStateRepository.claimNotificationCandidate(
        candidate,
        this.now().toISOString(),
      );

      if (!claimed) {
        continue;
      }

      try {
        await this.sender.send(candidate, config.language);
      } catch (error: unknown) {
        if (error instanceof NotificationDeliveryCancelledError) {
          break;
        }

        const message = error instanceof Error ? error.message : 'Unknown Discord error';
        const attemptCount = candidate.attemptCount + 1;
        const terminal = isPermanentDiscordError(error) || attemptCount >= this.maxAttempts;
        const retryDelayMs = Math.min(
          this.retryBaseDelayMs * (2 ** Math.max(0, attemptCount - 1)),
          this.maxRetryDelayMs,
        );
        const nextAttemptAt = terminal
          ? null
          : new Date(this.now().getTime() + retryDelayMs).toISOString();
        this.wishlistStateRepository.markNotificationFailed(
          candidate,
          message,
          nextAttemptAt,
          terminal,
        );
        failedCount += 1;
        continue;
      }

      try {
        this.wishlistStateRepository.markNotificationSent(candidate);
        sentCount += 1;
      } catch (_error: unknown) {
        // Keep the sending state to avoid a second DM after an uncertain database write.
        failedCount += 1;
      }
    }

    return {
      candidateCount: candidates.length,
      sentCount,
      failedCount,
    };
  }
}

function isPermanentDiscordError(error: unknown): boolean {
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
