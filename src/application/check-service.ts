import { createSaleKey } from '../domain/sale.js';
import {
  SteamWishlistError,
  type WishlistItemError,
} from '../domain/steam.js';
import type { NotificationCandidate } from '../domain/wishlist-state.js';
import { CheckStateRepository } from '../persistence/check-state-repository.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { WishlistStateRepository } from '../persistence/wishlist-state-repository.js';
import type { SteamClient } from '../steam/steam-client.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export type CheckResult =
  | { readonly status: 'not-configured' }
  | { readonly status: 'already-running' }
  | { readonly status: 'cooldown'; readonly retryAfterSeconds: number }
  | {
      readonly status: 'success';
      readonly checkedCount: number;
      readonly notificationCandidates: readonly NotificationCandidate[];
      readonly failedItems: readonly WishlistItemError[];
      readonly unknownPriceCount: number;
    }
  | { readonly status: 'unavailable'; readonly errorCode: string }
  | {
      readonly status: 'failed';
      readonly errorCode: 'PERSISTENCE_ERROR' | 'INTERNAL_ERROR';
    };

export interface CheckServiceOptions {
  readonly cooldownMs?: number;
  readonly now?: () => Date;
}

const defaultCooldownMs = 5 * 60 * 1000;

export class CheckService {
  private readonly runningUsers = new Set<string>();
  private readonly cooldownMs: number;
  private readonly now: () => Date;

  public constructor(
    private readonly userConfigRepository: UserConfigRepository,
    private readonly checkStateRepository: CheckStateRepository,
    private readonly wishlistStateRepository: WishlistStateRepository,
    private readonly steamClient: Pick<SteamClient, 'getWishlistWithErrors'>,
    private readonly coordinator = new UserOperationCoordinator(),
    options: CheckServiceOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? defaultCooldownMs;
    this.now = options.now ?? (() => new Date());

    if (!Number.isSafeInteger(this.cooldownMs) || this.cooldownMs < 0) {
      throw new Error('Check cooldown must be a non-negative safe integer');
    }
  }

  public async check(discordUserId: string): Promise<CheckResult> {
    if (this.runningUsers.has(discordUserId)) {
      return { status: 'already-running' };
    }

    this.runningUsers.add(discordUserId);
    try {
      return await this.coordinator.runExclusive(discordUserId, () =>
        this.checkExclusive(discordUserId),
      );
    } finally {
      this.runningUsers.delete(discordUserId);
    }
  }

  private async checkExclusive(discordUserId: string): Promise<CheckResult> {
    let config;
    try {
      config = this.userConfigRepository.findByDiscordUserId(discordUserId);
    } catch (_error: unknown) {
      return { status: 'failed', errorCode: 'PERSISTENCE_ERROR' };
    }

    if (!config) {
      return { status: 'not-configured' };
    }

    const now = this.now();
    try {
      const previousCheck = this.checkStateRepository.findByDiscordUserId(discordUserId);
      const previousCompletedAt = previousCheck?.lastCompletedAt
        ? new Date(previousCheck.lastCompletedAt).getTime()
        : Number.NaN;
      const elapsed = now.getTime() - previousCompletedAt;
      if (this.cooldownMs > 0 && Number.isFinite(elapsed) && elapsed < this.cooldownMs) {
        return {
          status: 'cooldown',
          retryAfterSeconds: Math.max(1, Math.ceil((this.cooldownMs - elapsed) / 1000)),
        };
      }
    } catch (_error: unknown) {
      return { status: 'failed', errorCode: 'PERSISTENCE_ERROR' };
    }

    const startedAt = now.toISOString();
    let steamResult;

    try {
      steamResult = await this.steamClient.getWishlistWithErrors(config.steamId64);
    } catch (error: unknown) {
      const completedAt = this.now().toISOString();
      if (!(error instanceof SteamWishlistError)) {
        try {
          this.checkStateRepository.markFailed(
            discordUserId,
            startedAt,
            completedAt,
            'INTERNAL_ERROR',
            config.configVersion,
          );
        } catch (_persistenceError: unknown) {
          return { status: 'failed', errorCode: 'PERSISTENCE_ERROR' };
        }

        return { status: 'failed', errorCode: 'INTERNAL_ERROR' };
      }

      const errorCode = error.code;
      try {
        this.checkStateRepository.markUnavailable(
          discordUserId,
          startedAt,
          completedAt,
          errorCode,
          config.configVersion,
        );
      } catch (_persistenceError: unknown) {
        return { status: 'failed', errorCode: 'PERSISTENCE_ERROR' };
      }

      return { status: 'unavailable', errorCode };
    }

    try {
      const notificationCandidates: NotificationCandidate[] = [];
      let unknownPriceCount = 0;

      for (const item of steamResult.items) {
        if (
          item.price === null ||
          item.onSale === null ||
          (item.onSale && item.price.currency === null)
        ) {
          unknownPriceCount += 1;
          continue;
        }

        const saleKey = item.onSale ? createSaleKey(item.price) : null;
        const observation = this.wishlistStateRepository.recordObservation(config, {
          item,
          saleKey,
          observedAt: this.now().toISOString(),
        });

        if (observation.notificationCandidate) {
          notificationCandidates.push(observation.notificationCandidate);
        }
      }

      const completedAt = this.now().toISOString();
      const seenAppIds = [
        ...steamResult.items.map((item) => item.appId),
        ...steamResult.errors.map((error) => error.appId),
      ];
      this.wishlistStateRepository.markMissingItemsInactive(
        config,
        seenAppIds,
        completedAt,
      );
      this.checkStateRepository.markSuccess(
        discordUserId,
        startedAt,
        completedAt,
        config.configVersion,
      );

      return {
        status: 'success',
        checkedCount: steamResult.items.length,
        notificationCandidates,
        failedItems: steamResult.errors,
        unknownPriceCount,
      };
    } catch (_error: unknown) {
      try {
        this.checkStateRepository.markFailed(
          discordUserId,
          startedAt,
          this.now().toISOString(),
          'PERSISTENCE_ERROR',
          config.configVersion,
        );
      } catch (_markError: unknown) {
        // The original persistence error remains the authoritative result.
      }

      return { status: 'failed', errorCode: 'PERSISTENCE_ERROR' };
    }
  }
}
