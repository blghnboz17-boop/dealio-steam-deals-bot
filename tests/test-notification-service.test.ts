import { describe, expect, it, vi } from 'vitest';
import { TestNotificationService, wishlistTestSale } from '../src/application/test-notification-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import type { WishlistItem } from '../src/domain/steam.js';

describe('TestNotificationService', () => {
  it('records receipt latency as a test metric without recipient or message identifiers', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = createSender(vi.fn(async (batch) => ({
      messageId: 'private-message', channelId: 'private-channel',
      deliveredAt: new Date(Date.parse(batch.notifications[0].createdAt) + 450).toISOString(),
    })));
    try {
      await new TestNotificationService(sender).send('private-recipient', 'en');
      expect(log.mock.calls).toEqual([['[test-notification-timing] candidateToDeliveryMs=450']]);
    } finally { log.mockRestore(); }
  });

  it('sends an in-memory example without writing sale or notification records', async () => {
    const database = createDatabase(':memory:');
    seedSaleNotification(database);
    const stateBefore = database.prepare('SELECT * FROM wishlist_item_state').all();
    const notificationsBefore = database.prepare('SELECT * FROM notification_log').all();
    const batchesBefore = database.prepare('SELECT * FROM notification_batch').all();
    const sender = createSender();
    const service = new TestNotificationService(sender);

    try {
      await service.send('invoking-user', 'en');

      expect(sender.plan).toHaveBeenCalledWith(
        [expect.objectContaining({
          discordUserId: 'invoking-user', appId: 620, saleEpisodeId: 'test-notification',
          gameName: 'Portal 2', discountPercent: 80, currency: 'USD',
        })],
        'en',
        { test: true, testSource: 'example' },
      );
      expect(sender.send).toHaveBeenCalledWith(
        { notifications: [expect.objectContaining({ appId: 620 })] },
        'en',
        { test: true, testSource: 'example' },
      );
      // The example never carries invented price history.
      expect(sender.plan.mock.calls[0]?.[0]?.[0]).not.toHaveProperty('historicalLow');
      expect(database.prepare('SELECT * FROM wishlist_item_state').all()).toEqual(stateBefore);
      expect(database.prepare('SELECT * FROM notification_log').all()).toEqual(
        notificationsBefore,
      );
      expect(database.prepare('SELECT * FROM notification_batch').all()).toEqual(batchesBefore);
      expect(rowCount(database, 'notification_batch_item')).toBe(0);
    } finally {
      database.close();
    }
  });

  it('shows the deepest real discount from the wishlist, with its historical low', async () => {
    const sender = createSender();
    const config = { storeCountryCode: 'DE' } as never;
    const item = (appId: number, discountPercent: number, onSale = true): WishlistItem => ({
      appId, name: `Game ${appId}`, priority: null, dateAdded: null, onSale,
      headerImageUrl: `https://cdn.example/${appId}.jpg`,
      price: { currency: 'EUR', initialMinor: 2000, finalMinor: 2000 * (100 - discountPercent) / 100, discountPercent, isFree: false },
    });
    const historicalLows = vi.fn().mockResolvedValue(new Map([[3, {
      currency: 'EUR', amountMinor: 300, discountPercent: 85, recordedAt: '2025-01-01T00:00:00.000Z',
    }]]));
    const service = new TestNotificationService(sender, {
      sample: () => wishlistTestSale(config, [item(1, 40), item(2, 90), item(3, 75), item(4, 0, false)],
        new Set([2]), { historicalLows }),
    });

    await service.send('invoking-user', 'en', 'DE');

    expect(sender.plan).toHaveBeenCalledWith([expect.objectContaining({
      appId: 3, gameName: 'Game 3', currency: 'EUR', finalPriceMinor: 500, normalPriceMinor: 2000,
      discountPercent: 75, storeCountryCode: 'DE', headerImageUrl: 'https://cdn.example/3.jpg',
      historicalLow: expect.objectContaining({ amountMinor: 300 }), saleEpisodeId: 'test-notification',
    })], 'en', { test: true, testSource: 'wishlist' });
    expect(historicalLows).toHaveBeenCalledWith([{ appId: 3, currency: 'EUR' }], 'DE');
  });

  it('falls back to the example when nothing is discounted or the lookup fails', async () => {
    const sender = createSender();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await new TestNotificationService(sender, { sample: async () => null }).send('a', 'en', 'TR');
      await new TestNotificationService(sender, { sample: async () => { throw new Error('db'); } }).send('b', 'en', 'TR');
      expect(sender.plan.mock.calls.map((call) => [call[0][0].appId, call[2]])).toEqual([
        [620, { test: true, testSource: 'example' }],
        [620, { test: true, testSource: 'example' }],
      ]);
    } finally { error.mockRestore(); }
  });

  it('propagates delivery failures without persisting a retry candidate', async () => {
    const database = createDatabase(':memory:');
    const service = new TestNotificationService(
      createSender(vi.fn().mockRejectedValue(new Error('DM blocked'))),
    );

    try {
      await expect(service.send('invoking-user', 'tr')).rejects.toThrow('DM blocked');
      expect(rowCount(database, 'wishlist_item_state')).toBe(0);
      expect(rowCount(database, 'notification_log')).toBe(0);
      expect(rowCount(database, 'notification_batch')).toBe(0);
      expect(rowCount(database, 'notification_batch_item')).toBe(0);
    } finally {
      database.close();
    }
  });

  it('rate-limits repeated attempts per user without blocking other users', async () => {
    const sender = createSender();
    const service = new TestNotificationService(sender, { cooldownMs: 30_000 });

    await service.send('first-user', 'en');

    await expect(service.send('first-user', 'en')).rejects.toMatchObject({
      retryAfterSeconds: 30,
    });
    await expect(service.send('second-user', 'tr')).resolves.toBeUndefined();
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid cooldown configuration', () => {
    expect(() => new TestNotificationService(
      createSender(),
      { cooldownMs: 0 },
    )).toThrow('positive safe integer');
  });
});

function createSender(send = vi.fn().mockResolvedValue(undefined)) {
  return {
    plan: vi.fn((notifications: readonly unknown[]) => notifications.length === 0
      ? []
      : [{ notifications: [...notifications] }]),
    send,
  };
}

function rowCount(
  database: ReturnType<typeof createDatabase>,
  table:
    | 'wishlist_item_state'
    | 'notification_log'
    | 'notification_batch'
    | 'notification_batch_item',
): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}

function seedSaleNotification(database: ReturnType<typeof createDatabase>): void {
  const config = new UserConfigRepository(database).upsert(
    'configured-user',
    '76561198000000000',
    'en',
    'TR',
    '2026-08-21T00:00:00.000Z',
  );
  const repository = new WishlistStateRepository(database);
  const regularPrice: WishlistItem = {
    appId: 10,
    name: 'Existing Game',
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
  repository.recordObservation(config, {
    item: regularPrice,
    saleKey: null,
    observedAt: '2026-08-21T00:01:00.000Z',
  });
  repository.recordObservation(config, {
    item: {
      ...regularPrice,
      onSale: true,
      price: {
        ...regularPrice.price,
        finalMinor: 500,
        discountPercent: 50,
      },
    },
    saleKey: 'TRY:1000:500:50',
    observedAt: '2026-08-21T00:02:00.000Z',
  });
}
