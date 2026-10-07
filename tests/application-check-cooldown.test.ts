import { describe, expect, it, vi } from 'vitest';
import { CheckService } from '../src/application/check-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

describe('check cooldown', () => {
  it('does not hold automatic checks off for hours after the system clock moves back', async () => {
    const database = createDatabase(':memory:');
    const users = new UserConfigRepository(database);
    users.upsert('discord-user', '76561198000000000', 'en', 'US', '2026-08-21T00:00:00.000Z');
    let now = Date.parse('2026-08-21T12:00:00.000Z');
    const steam = { getWishlistWithErrors: vi.fn().mockResolvedValue({ items: [], errors: [] }) };
    const service = new CheckService(users, new CheckStateRepository(database), new WishlistStateRepository(database),
      steam, undefined, { cooldownMs: 5 * 60_000, now: () => new Date(now) });

    await expect(service.check('discord-user', 'automatic')).resolves.toMatchObject({ status: 'success' });
    // Within the cooldown a second check is still refused.
    now += 60_000;
    await expect(service.check('discord-user', 'automatic')).resolves.toMatchObject({ status: 'cooldown' });

    // NTP or a host move sets the clock two hours back.
    now -= 2 * 60 * 60_000;
    await expect(service.check('discord-user', 'automatic')).resolves.toMatchObject({ status: 'success' });
    expect(steam.getWishlistWithErrors).toHaveBeenCalledTimes(2);
    database.close();
  });
});
