import { describe, expect, it, vi } from 'vitest';
import { CheckService } from '../src/application/check-service.js';
import { StatusService } from '../src/application/status-service.js';
import {
  InvalidUserConfigurationError,
  UserConfigurationService,
} from '../src/application/user-configuration-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import type { SteamClient } from '../src/steam/steam-client.js';
import { SteamWishlistError } from '../src/domain/steam.js';

function createServices(
  steamClient: Pick<SteamClient, 'getWishlistWithErrors'> = {
    getWishlistWithErrors: async () => ({ items: [], errors: [] }),
  },
  wishlistAccessValidator = {
    validateWishlistAccess: vi.fn().mockResolvedValue(undefined),
  },
) {
  const database = createDatabase(':memory:');
  const userConfigRepository = new UserConfigRepository(database);
  const checkStateRepository = new CheckStateRepository(database);
  const wishlistStateRepository = new WishlistStateRepository(database);

  return {
    database,
    userConfigurationService: new UserConfigurationService(
      userConfigRepository,
      wishlistAccessValidator,
    ),
    statusService: new StatusService(userConfigRepository, checkStateRepository),
    checkService: new CheckService(
      userConfigRepository,
      checkStateRepository,
      wishlistStateRepository,
      steamClient,
    ),
    checkStateRepository,
    userConfigRepository,
    wishlistStateRepository,
  };
}

describe('user configuration', () => {
  it('creates and updates a user configuration', async () => {
    const services = createServices();

    const created = await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'tr',
    );
    expect(created.steamId64).toBe('76561198000000000');
    expect(created.language).toBe('tr');

    const updated = await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000001',
      'en',
    );
    expect(updated.steamId64).toBe('76561198000000001');
    expect(updated.configVersion).toBe(2);
    expect(updated.language).toBe('en');

    const status = services.statusService.get('discord-user');
    expect(status.config?.steamId64).toBe('76561198000000001');
    expect(status.checkState?.lastStatus).toBeNull();
    services.database.close();
  });

  it('rejects an invalid SteamID64', () => {
    const services = createServices();

    expect(() =>
      services.userConfigurationService.configure('discord-user', '123', 'tr'),
    ).toThrow(InvalidUserConfigurationError);
    services.database.close();
  });

  it('clears the previous account check status when the Steam account changes', async () => {
    const services = createServices();
    await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'tr',
    );
    await services.checkService.check('discord-user');
    expect(services.statusService.get('discord-user').checkState?.lastStatus).toBe('success');

    await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000001',
      'tr',
    );

    expect(services.statusService.get('discord-user').checkState).toMatchObject({
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      lastErrorCode: null,
    });
    services.database.close();
  });

  it('does not replace an existing account when the new wishlist is inaccessible', async () => {
    const wishlistAccessValidator = {
      validateWishlistAccess: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new SteamWishlistError('STEAM_WISHLIST_INACCESSIBLE', 'private wishlist'),
        ),
    };
    const services = createServices(undefined, wishlistAccessValidator);
    await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'tr',
    );

    await expect(
      services.userConfigurationService.configure(
        'discord-user',
        '76561198000000001',
        'en',
      ),
    ).rejects.toMatchObject({ code: 'STEAM_WISHLIST_INACCESSIBLE' });
    expect(services.userConfigRepository.findByDiscordUserId('discord-user')).toMatchObject({
      steamId64: '76561198000000000',
      configVersion: 1,
      language: 'tr',
    });
    services.database.close();
  });

  it('deletes configuration and all cascaded user data', async () => {
    const services = createServices();
    const config = await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'tr',
    );
    const baseItem = {
      appId: 10,
      name: 'Deletion Test Game',
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
    } as const;
    services.wishlistStateRepository.recordObservation(config, {
      item: baseItem,
      saleKey: null,
      observedAt: '2026-08-21T00:00:00.000Z',
    });
    services.wishlistStateRepository.recordObservation(config, {
      item: {
        ...baseItem,
        onSale: true,
        price: { ...baseItem.price, finalMinor: 500, discountPercent: 50 },
      },
      saleKey: 'TRY:1000:500:50',
      observedAt: '2026-08-21T01:00:00.000Z',
    });

    await expect(services.userConfigurationService.deleteData('discord-user')).resolves.toBe(true);

    expect(
      (services.database.prepare('PRAGMA secure_delete').get() as { secure_delete: number })
        .secure_delete,
    ).toBe(1);

    for (const table of [
      'user_config',
      'check_state',
      'wishlist_item_state',
      'notification_log',
    ]) {
      const row = services.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    }
    services.database.close();
  });
});

describe('check service', () => {
  it('reports a successful empty check', async () => {
    const services = createServices();
    await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'en',
    );

    const result = await services.checkService.check('discord-user');

    expect(result).toMatchObject({
      status: 'success',
      checkedCount: 0,
      notificationCandidates: [],
    });
    expect(services.statusService.get('discord-user').checkState).toMatchObject({
      lastStatus: 'success',
      lastErrorCode: null,
    });
    services.database.close();
  });

  it('rejects a concurrent check for the same user', async () => {
    const services = createServices();
    await services.userConfigurationService.configure(
      'discord-user',
      '76561198000000000',
      'tr',
    );

    const firstCheck = services.checkService.check('discord-user');
    const secondCheck = await services.checkService.check('discord-user');

    expect(secondCheck).toEqual({ status: 'already-running' });
    expect(await firstCheck).toMatchObject({ status: 'success', checkedCount: 0 });
    services.database.close();
  });
});
