import type { Language, UserConfig } from '../domain/user-config.js';
import type { StoreCountryCode } from '../domain/store-country.js';
import type { WishlistItem } from '../domain/steam.js';
import type { HistoricalLowSource } from '../price-history/itad-client.js';
import type { NotificationSender, SaleNotification } from './notification-service.js';
import { safeLogger } from './safe-logger.js';

/** A test alert's game: everything a real alert shows, without delivery identity. */
export type TestSale = Omit<SaleNotification, 'discordUserId' | 'createdAt' | 'saleEpisodeId'>;

/**
 * Only when nothing on the wishlist is discounted: a fixed, clearly labelled
 * example. It carries no invented price history.
 */
const exampleSale: TestSale = {
  appId: 620,
  gameName: 'Portal 2',
  currency: 'USD',
  normalPriceMinor: 999,
  finalPriceMinor: 199,
  discountPercent: 80,
  storeCountryCode: 'TR',
};

/**
 * Picks the deepest current discount on the user's saved wishlist (muted games
 * excluded), with its Steam historical low when available, so the test shows
 * exactly what a real alert would look like.
 */
export async function wishlistTestSale(
  config: UserConfig,
  items: readonly WishlistItem[],
  mutedAppIds: ReadonlySet<number>,
  priceHistory?: HistoricalLowSource,
): Promise<TestSale | null> {
  const deals = items.filter((item) => item.onSale === true && item.price?.currency
    && item.price.finalMinor < item.price.initialMinor && !mutedAppIds.has(item.appId));
  const best = deals.sort((a, b) => b.price!.discountPercent - a.price!.discountPercent)[0];
  if (!best?.price?.currency) return null;
  const currency = best.price.currency;
  let historicalLow: SaleNotification['historicalLow'];
  try {
    historicalLow = (await priceHistory?.historicalLows([{ appId: best.appId, currency }], config.storeCountryCode))
      ?.get(best.appId);
  } catch {
    historicalLow = undefined;
  }
  return {
    appId: best.appId,
    gameName: best.name,
    currency,
    normalPriceMinor: best.price.initialMinor,
    finalPriceMinor: best.price.finalMinor,
    discountPercent: best.price.discountPercent,
    storeCountryCode: config.storeCountryCode,
    ...(best.headerImageUrl ? { headerImageUrl: best.headerImageUrl } : {}),
    ...(best.storeFacts ? { storeFacts: best.storeFacts } : {}),
    ...(historicalLow ? { historicalLow } : {}),
  };
}

export class TestNotificationCooldownError extends Error {
  public readonly name = 'TestNotificationCooldownError';

  public constructor(public readonly retryAfterSeconds: number) {
    super(`Test notification cooldown: retry after ${retryAfterSeconds} seconds`);
  }
}

export class TestNotificationService {
  private readonly cooldownMs: number;
  private readonly attempts = new Map<string, number>();
  private readonly sample?: (discordUserId: string) => Promise<TestSale | null>;

  public constructor(
    private readonly sender: NotificationSender,
    options: {
      readonly cooldownMs?: number;
      /** A real discounted game from the user's wishlist; null falls back to the example. */
      readonly sample?: (discordUserId: string) => Promise<TestSale | null>;
    } = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.sample = options.sample;

    if (!Number.isSafeInteger(this.cooldownMs) || this.cooldownMs <= 0) {
      throw new Error('Test notification cooldown must be a positive safe integer');
    }
  }

  public async send(
    discordUserId: string,
    language: Language,
    storeCountryCode: StoreCountryCode = 'TR',
  ): Promise<void> {
    const startedAt = Date.now();
    const previousAttempt = this.attempts.get(discordUserId);
    if (previousAttempt !== undefined) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((this.cooldownMs - (startedAt - previousAttempt)) / 1_000),
      );
      throw new TestNotificationCooldownError(retryAfterSeconds);
    }

    const timer = setTimeout(() => {
      if (this.attempts.get(discordUserId) === startedAt) {
        this.attempts.delete(discordUserId);
      }
    }, this.cooldownMs);
    timer.unref();
    this.attempts.set(discordUserId, startedAt);

    let sample: TestSale | null = null;
    try {
      sample = await this.sample?.(discordUserId) ?? null;
    } catch (error: unknown) {
      safeLogger.error('Test notification sample lookup failed', error);
    }
    const options = { test: true, testSource: sample ? 'wishlist' : 'example' } as const;
    const notification: SaleNotification = {
        ...(sample ?? { ...exampleSale, storeCountryCode }),
        saleEpisodeId: 'test-notification',
        discordUserId,
        createdAt: new Date().toISOString(),
    };
    const batches = this.sender.plan([notification], language, options);
    const batch = batches[0];
    if (!batch || batches.length !== 1) {
      throw new Error('Test notification could not be planned as one Discord message');
    }

    const receipt = await this.sender.send(batch, language, options);
    if (receipt) {
      const latency = Date.parse(receipt.deliveredAt) - Date.parse(notification.createdAt);
      if (Number.isFinite(latency) && latency >= 0) {
        safeLogger.log(`[test-notification-timing] candidateToDeliveryMs=${latency}`);
      }
    }
  }
}
