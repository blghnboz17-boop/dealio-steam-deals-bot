import { describe, expect, it, vi } from 'vitest';
import { WishlistViewService } from '../src/application/wishlist-view-service.js';
import { SteamWishlistError, type WishlistItem } from '../src/domain/steam.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import { DiscountThresholdRepository } from '../src/persistence/discount-threshold-repository.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';

const item: WishlistItem = {
  appId: 10,
  name: 'Test Game',
  priority: 1,
  dateAdded: 1_700_000_000,
  price: {
    currency: 'USD',
    initialMinor: 2_000,
    finalMinor: 1_000,
    discountPercent: 50,
    isFree: false,
  },
  onSale: true,
};

describe('WishlistViewService', () => {
  it('returns the locale fallback without calling Steam for an unconfigured user', async () => {
    const wishlistReader = { getWishlistWithErrors: vi.fn() };
    const service = new WishlistViewService(
      { findByDiscordUserId: vi.fn().mockReturnValue(null) },
      wishlistReader,
    );

    await expect(service.load('invoking-user', 'tr')).resolves.toEqual({
      status: 'not-configured',
      language: 'tr',
    });
    expect(wishlistReader.getWishlistWithErrors).not.toHaveBeenCalled();
  });

  it('uses only the invoking user configuration and preserves partial app errors', async () => {
    const configReader = {
      findByDiscordUserId: vi.fn().mockReturnValue({
        discordUserId: 'invoking-user',
        steamId64: '76561198000000000',
        configVersion: 1,
        configurationId: 'configuration-id',
        language: 'en',
        storeCountryCode: 'US',
        minimumDiscountPercent: 0,
      }),
    };
    const wishlistReader = {
      getWishlistWithErrors: vi.fn().mockResolvedValue({
        items: [item],
        errors: [{ appId: 20, code: 'STEAM_APP_NOT_FOUND' }],
      }),
    };
    const service = new WishlistViewService(
      configReader as never,
      wishlistReader,
      () => new Date('2026-08-22T12:00:00.000Z'),
    );

    await expect(service.load('invoking-user', 'tr')).resolves.toEqual({
      status: 'success',
      language: 'en',
      items: [item],
      errors: [{ appId: 20, code: 'STEAM_APP_NOT_FOUND' }],
      capturedAt: '2026-08-22T12:00:00.000Z',
      configVersion: 1,
      configurationId: 'configuration-id',
      storeCountryCode: 'US',
      globalMinimumDiscountPercent: 0,
      gameMinimumDiscountOverrides: new Map(),
    });
    expect(configReader.findByDiscordUserId).toHaveBeenCalledWith('invoking-user');
    expect(wishlistReader.getWishlistWithErrors)
      .toHaveBeenCalledWith('76561198000000000', 'US', 'en');
  });

  it('does not turn a complete Steam failure into an empty successful wishlist', async () => {
    const service = new WishlistViewService(
      { findByDiscordUserId: vi.fn().mockReturnValue({
        steamId64: '76561198000000000', language: 'tr', storeCountryCode: 'TR',
      }) } as never,
      {
        getWishlistWithErrors: vi.fn().mockRejectedValue(
          new SteamWishlistError(
            'STEAM_SCHEMA_INVALID',
            'Steam app details were unavailable for the entire wishlist',
          ),
        ),
      },
    );

    await expect(service.load('invoking-user', 'en')).resolves.toEqual({
      status: 'unavailable',
      language: 'tr',
      errorCode: 'STEAM_SCHEMA_INVALID',
    });
  });

  it('treats a reader result containing only app errors as unavailable', async () => {
    const service = new WishlistViewService(
      { findByDiscordUserId: vi.fn().mockReturnValue({
        steamId64: '76561198000000000', language: 'en', storeCountryCode: 'US',
      }) } as never,
      {
        getWishlistWithErrors: vi.fn().mockResolvedValue({
          items: [],
          errors: [{ appId: 10, code: 'STEAM_UPSTREAM_ERROR' }],
        }),
      },
    );

    await expect(service.load('invoking-user', 'tr')).resolves.toEqual({
      status: 'unavailable',
      language: 'en',
      errorCode: 'STEAM_UPSTREAM_ERROR',
    });
  });

  it('waits for a concurrent region change before requesting live prices', async () => {
    const coordinator = new UserOperationCoordinator();
    let storeCountryCode: 'US' | 'DE' = 'US';
    let releaseRegion: (() => void) | undefined;
    const regionChange = coordinator.runExclusive('invoking-user', async () => {
      storeCountryCode = 'DE';
      await new Promise<void>((resolve) => {
        releaseRegion = resolve;
      });
    });
    const wishlistReader = {
      getWishlistWithErrors: vi.fn().mockResolvedValue({ items: [item], errors: [] }),
    };
    const service = new WishlistViewService(
      {
        findByDiscordUserId: vi.fn(() => ({
          discordUserId: 'invoking-user',
          steamId64: '76561198000000000',
          configVersion: 2,
          configurationId: 'configuration-id',
          language: 'en',
          storeCountryCode,
          minimumDiscountPercent: 0,
        })),
      } as never,
      wishlistReader,
      undefined,
      undefined,
      coordinator,
    );

    const loading = service.load('invoking-user', 'tr');
    await Promise.resolve();
    expect(wishlistReader.getWishlistWithErrors).not.toHaveBeenCalled();

    releaseRegion?.();
    await regionChange;
    await expect(loading).resolves.toMatchObject({
      status: 'success',
      storeCountryCode: 'DE',
      configVersion: 2,
    });
    expect(wishlistReader.getWishlistWithErrors)
      .toHaveBeenCalledWith('76561198000000000', 'DE', 'en');
  });

  it('reads live data without changing check, sale, or notification persistence', async () => {
    const database = createDatabase(':memory:');
    const configRepository = new UserConfigRepository(database);
    const stateRepository = new WishlistStateRepository(database);
    const thresholdRepository = new DiscountThresholdRepository(database);
    const config = configRepository.upsert(
      'invoking-user',
      '76561198000000000',
      'en',
      'US',
      '2026-08-22T00:00:00.000Z',
    );
    stateRepository.recordObservation(config, {
      item: { ...item, onSale: false },
      saleKey: null,
      observedAt: '2026-08-22T00:01:00.000Z',
    });
    thresholdRepository.setGameOverride(
      config,
      item.appId,
      40,
      '2026-08-22T00:02:00.000Z',
    );
    const tables = [
      'user_config',
      'check_state',
      'wishlist_item_state',
      'notification_log',
      'notification_batch',
      'notification_batch_item',
      'game_discount_threshold',
    ] as const;
    const before = new Map(tables.map((table) => [
      table,
      database.prepare(`SELECT * FROM ${table}`).all(),
    ]));
    const service = new WishlistViewService(
      configRepository,
      { getWishlistWithErrors: vi.fn().mockResolvedValue({ items: [item], errors: [] }) },
      () => new Date('2026-08-22T12:00:00.000Z'),
      thresholdRepository,
    );

    try {
      await expect(service.load('invoking-user', 'tr')).resolves.toMatchObject({
        globalMinimumDiscountPercent: 0,
        gameMinimumDiscountOverrides: new Map([[10, 40]]),
      });
      for (const table of tables) {
        expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(before.get(table));
      }
    } finally {
      database.close();
    }
  });
});
