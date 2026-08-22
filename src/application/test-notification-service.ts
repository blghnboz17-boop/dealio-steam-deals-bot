import type { Language } from '../domain/user-config.js';
import type { NotificationSender, SaleNotification } from './notification-service.js';

const exampleNotification: Omit<SaleNotification, 'discordUserId' | 'createdAt'> = {
  appId: 620,
  saleEpisodeId: 'test-notification',
  gameName: 'Portal 2',
  // TRY is sample fixture data; production displays the currency received from Steam unchanged.
  currency: 'TRY',
  normalPriceMinor: 105_000,
  finalPriceMinor: 10_500,
  discountPercent: 90,
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

  public async send(discordUserId: string, language: Language): Promise<void> {
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
        discordUserId,
        createdAt: new Date().toISOString(),
    };
    const batches = this.sender.plan([notification], language, { test: true });
    const batch = batches[0];
    if (!batch || batches.length !== 1) {
      throw new Error('Test notification could not be planned as one Discord message');
    }

    await this.sender.send(
      batch,
      language,
      { test: true },
    );
  }
}
