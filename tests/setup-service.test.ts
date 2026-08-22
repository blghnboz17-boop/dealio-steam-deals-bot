import { describe, expect, it, vi } from 'vitest';
import { CheckService } from '../src/application/check-service.js';
import { InitialWishlistSummaryService } from '../src/application/initial-wishlist-summary-service.js';
import { SetupService } from '../src/application/setup-service.js';
import { UserConfigurationService } from '../src/application/user-configuration-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import type { WishlistItem } from '../src/domain/steam.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { DiscountThresholdRepository } from '../src/persistence/discount-threshold-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

const saleItem: WishlistItem = {
  appId: 10,
  name: 'Setup Sale',
  priority: null,
  dateAdded: null,
  price: {
    currency: 'USD',
    initialMinor: 2_000,
    finalMinor: 1_000,
    discountPercent: 50,
    isFree: false,
  },
  onSale: true,
};

function services(identityResolver = { resolve: vi.fn(async (value: string) => value) }) {
  const database = createDatabase(':memory:');
  const userConfigRepository = new UserConfigRepository(database);
  const checkStateRepository = new CheckStateRepository(database);
  const wishlistStateRepository = new WishlistStateRepository(database);
  const discountThresholdRepository = new DiscountThresholdRepository(database);
  const coordinator = new UserOperationCoordinator();
  const steamClient = {
    getWishlistWithErrors: vi.fn().mockResolvedValue({ items: [saleItem], errors: [] }),
  };
  const configurationService = new UserConfigurationService(
    userConfigRepository,
    identityResolver,
    { validateWishlistAccess: vi.fn().mockResolvedValue(undefined) },
    coordinator,
  );
  const checkService = new CheckService(
    userConfigRepository,
    checkStateRepository,
    wishlistStateRepository,
    steamClient,
    coordinator,
    { cooldownMs: 0 },
  );
  const sender = { sendInitialSummary: vi.fn().mockResolvedValue(undefined) };
  const setupService = new SetupService(
    configurationService,
    new InitialWishlistSummaryService(checkService, sender),
    coordinator,
  );
  return {
    database,
    userConfigRepository,
    wishlistStateRepository,
    discountThresholdRepository,
    checkService,
    setupService,
    steamClient,
    sender,
  };
}

describe('SetupService', () => {
  it('starts a fresh baseline generation and retires old pending alerts on repeated setup', async () => {
    const fixture = services();
    const oldConfig = fixture.userConfigRepository.upsert(
      'discord-user',
      '76561198000000000',
      'en',
      'US',
      '2026-08-23T00:00:00.000Z',
    );
    fixture.wishlistStateRepository.recordObservation(oldConfig, {
      item: {
        ...saleItem,
        onSale: false,
        price: { ...saleItem.price!, finalMinor: 2_000, discountPercent: 0 },
      },
      saleKey: null,
      observedAt: '2026-08-23T00:01:00.000Z',
    });
    const oldCandidate = fixture.wishlistStateRepository.recordObservation(oldConfig, {
      item: saleItem,
      saleKey: 'USD:2000:1000:50',
      observedAt: '2026-08-23T00:02:00.000Z',
    }).notificationCandidate;
    if (!oldCandidate) {
      throw new Error('Expected old setup candidate');
    }
    fixture.discountThresholdRepository.setGameOverride(
      oldConfig,
      10,
      70,
      '2026-08-23T00:02:10.000Z',
    );

    const result = await fixture.setupService.configure(
      'discord-user',
      '76561198000000000',
      'en',
      'US',
    );

    expect(result).toMatchObject({
      config: { configVersion: 2, storeCountryCode: 'US' },
      summary: { status: 'sent', saleCount: 1 },
    });
    expect(fixture.wishlistStateRepository.findNotificationStatus(oldCandidate)).toBe('expired');
    expect(fixture.wishlistStateRepository.countNotificationCandidates('discord-user', 2)).toBe(0);
    expect(fixture.wishlistStateRepository.findByDiscordUserAndAppId('discord-user', 10, 2))
      .toMatchObject({ onSale: true, observationStatus: 'known' });
    expect(fixture.discountThresholdRepository.findGameOverride(result.config, 10)).toBe(70);
    expect(fixture.sender.sendInitialSummary).toHaveBeenCalledOnce();
    fixture.database.close();
  });

  it('serializes configure and baseline ahead of a queued automatic check', async () => {
    let resolveIdentity: ((steamId64: string) => void) | undefined;
    const identityResolver = {
      resolve: vi.fn(() => new Promise<string>((resolve) => {
        resolveIdentity = resolve;
      })),
    };
    const fixture = services(identityResolver);
    const setup = fixture.setupService.configure(
      'discord-user',
      'profile-name',
      'en',
      'US',
    );
    await vi.waitFor(() => expect(identityResolver.resolve).toHaveBeenCalledOnce());
    const automaticCheck = fixture.checkService.check('discord-user', 'automatic');

    resolveIdentity?.('76561198000000000');
    await expect(setup).resolves.toMatchObject({ summary: { status: 'sent' } });
    await expect(automaticCheck).resolves.toMatchObject({
      status: 'success',
      notificationCandidates: [],
    });
    expect(fixture.sender.sendInitialSummary).toHaveBeenCalledOnce();
    expect(fixture.wishlistStateRepository.countNotificationCandidates('discord-user')).toBe(0);
    expect(fixture.steamClient.getWishlistWithErrors).toHaveBeenCalledTimes(2);
    fixture.database.close();
  });
});
