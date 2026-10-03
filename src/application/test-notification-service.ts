import type { Language } from '../domain/user-config.js';
import type { StoreCountryCode } from '../domain/store-country.js';
import type { NotificationSender, SaleNotification } from './notification-service.js';
import { safeLogger } from './safe-logger.js';

const exampleNotification: Omit<SaleNotification, 'discordUserId' | 'createdAt'> = {
  appId: 620,
  saleEpisodeId: 'test-notification',
  gameName: 'Portal 2',
  // Sample fixture data in USD, as Steam now prices many regions including Turkey;
  // production displays the currency received from Steam unchanged.
  currency: 'USD',
  normalPriceMinor: 999,
  finalPriceMinor: 199,
  discountPercent: 80,
  storeCountryCode: 'TR',
  // Sample history so the test shows how a real alert presents price context.
  historicalLow: {
    currency: 'USD',
    amountMinor: 99,
    discountPercent: 90,
    recordedAt: '2025-06-26T17:00:00.000Z',
  },
};

export class TestNotificationCooldownError extends Error {
  public readonly name = 'TestNotificationCooldownError';

  public constructor(public readonly retryAfterSeconds: number) {
    super(`Test notification cooldown: retry after ${retryAfterSeconds} seconds`);
  }
}

export class TestNotificationService {
  private readonly cooldownMs: number;
  private readonly attempts = new Map<string, number>();

  public constructor(
    private readonly sender: NotificationSender,
    options: { readonly cooldownMs?: number } = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? 30_000;

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

    const notification: SaleNotification = {
        ...exampleNotification,
        storeCountryCode,
        discordUserId,
        createdAt: new Date().toISOString(),
    };
    const batches = this.sender.plan([notification], language, { test: true });
    const batch = batches[0];
    if (!batch || batches.length !== 1) {
      throw new Error('Test notification could not be planned as one Discord message');
    }

    const receipt = await this.sender.send(
      batch,
      language,
      { test: true },
    );
    if (receipt) {
      const latency = Date.parse(receipt.deliveredAt) - Date.parse(notification.createdAt);
      if (Number.isFinite(latency) && latency >= 0) {
        safeLogger.log(`[test-notification-timing] candidateToDeliveryMs=${latency}`);
      }
    }
  }
}
