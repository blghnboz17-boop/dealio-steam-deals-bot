import { describe, expect, it, vi } from 'vitest';
import { CheckService } from '../src/application/check-service.js';
import { InitialWishlistSummaryService } from '../src/application/initial-wishlist-summary-service.js';
import { SetupCapacityReachedError, SetupService } from '../src/application/setup-service.js';
import { UserConfigurationService } from '../src/application/user-configuration-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

describe('sign-up limit', () => {
  it('is enforced when simultaneous setups finish their Steam reads at the same time', async () => {
    const database = createDatabase(':memory:');
    const users = new UserConfigRepository(database);
    const coordinator = new UserOperationCoordinator();
    const releases: Array<() => void> = [];
    const identity = {
      resolve: vi.fn((value: string) => new Promise<string>((resolve) => {
        releases.push(() => resolve(value));
      })),
    };
    const configuration = new UserConfigurationService(users, identity,
      { validateWishlistAccess: vi.fn().mockResolvedValue(undefined) }, coordinator);
    const check = new CheckService(users, new CheckStateRepository(database), new WishlistStateRepository(database),
      { getWishlistWithErrors: vi.fn().mockResolvedValue({ items: [], errors: [] }) }, coordinator, { cooldownMs: 0 });
    const setup = new SetupService(configuration,
      new InitialWishlistSummaryService(check, { sendInitialSummary: vi.fn().mockResolvedValue(undefined) }),
      coordinator, { maxUsers: 1 });

    const first = setup.configure('first-user', '76561198000000000', 'en', 'US');
    const second = setup.configure('second-user', '76561198000000001', 'en', 'US');
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    for (const release of releases) release();

    const results = await Promise.allSettled([first, second]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(SetupCapacityReachedError);
    expect(users.countUsers()).toBe(1);
    database.close();
  });
});
