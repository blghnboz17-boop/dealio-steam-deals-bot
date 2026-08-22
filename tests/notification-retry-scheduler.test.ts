import { describe, expect, it, vi } from 'vitest';
import {
  NotificationRetryScheduler,
  type NotificationRetryClock,
} from '../src/application/notification-retry-scheduler.js';
import type { UserConfig } from '../src/domain/user-config.js';
import type { WishlistItem } from '../src/domain/steam.js';
import { NotificationService } from '../src/application/notification-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

function user(discordUserId: string): UserConfig {
  return {
    discordUserId,
    configurationId: 'configuration-id',
    steamId64: '76561198000000000',
    configVersion: 1,
    language: 'en',
    storeCountryCode: 'TR',
    enabled: true,
    minimumDiscountPercent: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function clockFixture() {
  let callback: (() => void) | null = null;
  const clock: NotificationRetryClock = {
    setInterval: vi.fn((nextCallback) => {
      callback = nextCallback;
      return {} as ReturnType<typeof setInterval>;
    }),
    clearInterval: vi.fn(() => {
      callback = null;
    }),
  };
  return { clock, trigger: () => callback?.() };
}

describe('NotificationRetryScheduler', () => {
  it('delivers pending notifications independently of Steam checks', async () => {
    const deliverPending = vi.fn().mockResolvedValue({
      candidateCount: 1,
      sentCount: 1,
      failedCount: 0,
    });
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository: { findEnabled: () => [user('a'), user('b')] },
      notificationService: { deliverPending },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(scheduler.runOnce()).resolves.toEqual({
      userCount: 2,
      completedCount: 2,
      candidateCount: 2,
      sentCount: 2,
      failedCount: 0,
      errorCount: 0,
    });
    expect(deliverPending).toHaveBeenCalledTimes(2);
  });

  it('does not send or expire a pending notification while its price is unknown', async () => {
    const database = createDatabase(':memory:');
    const userConfigRepository = new UserConfigRepository(database);
    const wishlistStateRepository = new WishlistStateRepository(database);
    const config = userConfigRepository.upsert(
      'discord-user',
      '76561198000000000',
      'en',
      'TR',
      '2026-08-21T00:00:00.000Z',
    );
    const regularItem: WishlistItem = {
      appId: 10,
      name: 'Scheduler Test Game',
      priority: null,
      dateAdded: null,
      price: {
        currency: 'TRY',
        initialMinor: 1_000,
        finalMinor: 1_000,
        discountPercent: 0,
        isFree: false,
      },
      onSale: false,
    };
    wishlistStateRepository.recordObservation(config, {
      item: regularItem,
      saleKey: null,
      observedAt: '2026-08-21T00:01:00.000Z',
    });
    const sale = wishlistStateRepository.recordObservation(config, {
      item: {
        ...regularItem,
        onSale: true,
        price: { ...regularItem.price!, finalMinor: 500, discountPercent: 50 },
      },
      saleKey: 'TRY:1000:500:50',
      observedAt: '2026-08-21T00:02:00.000Z',
    }).notificationCandidate;
    if (!sale) {
      throw new Error('Expected scheduler test candidate');
    }
    wishlistStateRepository.markObservationStatus(
      config,
      [sale.appId],
      'unknown',
      '2026-08-21T00:03:00.000Z',
    );
    const sender = {
      plan: vi.fn((notifications: readonly typeof sale[]) => [{ notifications }]),
      send: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository,
      notificationService: new NotificationService(
        userConfigRepository,
        wishlistStateRepository,
        sender,
      ),
      logger: { info: vi.fn(), error: vi.fn() },
    });

    try {
      await expect(scheduler.runOnce()).resolves.toMatchObject({
        candidateCount: 0,
        sentCount: 0,
        failedCount: 0,
      });
      expect(sender.send).not.toHaveBeenCalled();
      expect(wishlistStateRepository.findNotificationStatus(sale)).toBe('candidate');
    } finally {
      database.close();
    }
  });

  it('does not select disabled users for notification retries', async () => {
    const database = createDatabase(':memory:');
    const repository = new UserConfigRepository(database);
    repository.upsert('enabled-user', '76561198000000000', 'en', 'TR', '2026-08-21T00:00:00Z');
    repository.upsert('disabled-user', '76561198000000001', 'en', 'TR', '2026-08-21T00:00:00Z');
    repository.setEnabled('disabled-user', false, '2026-08-21T01:00:00Z');
    const deliverPending = vi.fn().mockResolvedValue({
      candidateCount: 0,
      sentCount: 0,
      failedCount: 0,
    });
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository: repository,
      notificationService: { deliverPending },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    try {
      await expect(scheduler.runOnce()).resolves.toMatchObject({ userCount: 1 });
      expect(deliverPending).toHaveBeenCalledOnce();
      expect(deliverPending).toHaveBeenCalledWith('enabled-user');
    } finally {
      database.close();
    }
  });

  it('runs immediately, repeats on its interval, and stops cleanly', async () => {
    const fixture = clockFixture();
    const deliverPending = vi.fn().mockResolvedValue({
      candidateCount: 0,
      sentCount: 0,
      failedCount: 0,
    });
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 30,
      userConfigRepository: { findEnabled: () => [user('a')] },
      notificationService: { deliverPending },
      clock: fixture.clock,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    scheduler.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    fixture.trigger();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await scheduler.stop();

    expect(scheduler.intervalMilliseconds).toBe(30_000);
    expect(deliverPending).toHaveBeenCalledTimes(2);
    expect(fixture.clock.clearInterval).toHaveBeenCalledOnce();
  });

  it('prevents overlapping runs and waits for active delivery on stop', async () => {
    let resolveDelivery: (() => void) | undefined;
    const deliverPending = vi.fn(() => new Promise<{
      candidateCount: number;
      sentCount: number;
      failedCount: number;
    }>((resolve) => {
      resolveDelivery = () => resolve({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    }));
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository: { findEnabled: () => [user('a')] },
      notificationService: { deliverPending },
      logger: { info: vi.fn(), error: vi.fn() },
    });
    const active = scheduler.runOnce();
    await vi.waitFor(() => expect(deliverPending).toHaveBeenCalledOnce());

    await expect(scheduler.runOnce()).resolves.toMatchObject({ userCount: 0 });
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveDelivery?.();
    await Promise.all([active, stopping]);
    expect(stopped).toBe(true);
  });

  it('bounds concurrency and isolates one user failure', async () => {
    let activeCount = 0;
    let maximumActiveCount = 0;
    const deliverPending = vi.fn(async (discordUserId: string) => {
      activeCount += 1;
      maximumActiveCount = Math.max(maximumActiveCount, activeCount);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeCount -= 1;
      if (discordUserId === 'user-2') {
        throw new Error('delivery failed');
      }
      return { candidateCount: 0, sentCount: 0, failedCount: 0 };
    });
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository: {
        findEnabled: () => Array.from({ length: 5 }, (_, index) => user(`user-${index}`)),
      },
      notificationService: { deliverPending },
      maxUserConcurrency: 2,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const summary = await scheduler.runOnce();

    expect(maximumActiveCount).toBe(2);
    expect(summary).toMatchObject({ completedCount: 5, errorCount: 1 });
  });

  it('rejects unsafe intervals and concurrency', () => {
    const base = {
      userConfigRepository: { findEnabled: () => [] },
      notificationService: {
        deliverPending: vi.fn().mockResolvedValue({
          candidateCount: 0,
          sentCount: 0,
          failedCount: 0,
        }),
      },
    };

    expect(() => new NotificationRetryScheduler({ ...base, intervalSeconds: 0 }))
      .toThrow('between 1 and 3600 seconds');
    expect(() => new NotificationRetryScheduler({
      ...base,
      intervalSeconds: 60,
      maxUserConcurrency: 0,
    })).toThrow('positive safe integer');
  });
});
