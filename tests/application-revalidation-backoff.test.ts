import { afterEach, describe, expect, it, vi } from 'vitest';
import { reliabilityFixture } from './helpers/reliability-fixture.js';
import { NotificationService } from '../src/application/notification-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import { CheckService } from '../src/application/check-service.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { DiscordNotificationSender } from '../src/discord/notification-sender.js';

afterEach(() => vi.restoreAllMocks());

async function pendingSale(f: ReturnType<typeof reliabilityFixture>) {
  f.addUser();
  await expect(f.services.check.check('fixture-user')).resolves.toMatchObject({ status: 'success' });
  f.steamTransport.mode = 'sale';
  f.advance(301_000);
  await expect(f.services.check.check('fixture-user')).resolves.toMatchObject({ status: 'success' });
  expect(f.counts()).toEqual([{ status: 'candidate', count: 3 }]);
}

describe('revalidation before delivery', () => {
  it('backs off instead of reading the whole wishlist on every retry tick while Steam keeps failing', async () => {
    const f = reliabilityFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await pendingSale(f);
      f.steamTransport.mode = 'wishlist-outage';
      const before = f.steamTransport.wishlistRequests;
      // One hour of 60-second retry ticks against a wishlist Steam will not return.
      for (let tick = 0; tick < 60; tick++) {
        f.advance(60_000);
        await f.services.notifications.deliverPending('fixture-user');
      }
      const attempts = f.steamTransport.wishlistRequests - before;
      expect(attempts).toBeGreaterThan(1);
      // 1, 2, 4, 8 minutes, then every 15 minutes: a handful, not 60.
      expect(attempts).toBeLessThanOrEqual(8);
      expect(f.discordTransport.accepted).toHaveLength(0);
      expect(f.counts()).toEqual([{ status: 'candidate', count: 3 }]);

      // Once Steam answers again, the waiting alert is still delivered.
      f.steamTransport.mode = 'sale';
      for (let tick = 0; tick < 16 && f.discordTransport.accepted.length === 0; tick++) {
        f.advance(60_000);
        await f.services.notifications.deliverPending('fixture-user');
      }
      expect(f.discordTransport.accepted).toHaveLength(1);
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
    } finally { f.close(); }
  });

  it('clears the backoff after a successful revalidation and counts a thrown revalidation as failed', async () => {
    const f = reliabilityFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await pendingSale(f);
      let now = Date.now() + 10 * 60_000;
      const coordinator = new UserOperationCoordinator();
      const check = new CheckService(f.services.users, new CheckStateRepository(f.services.db), f.services.states,
        f.steam, coordinator, { cooldownMs: 0, now: () => new Date(now) });
      const outcomes: Array<'throw' | 'fail' | 'check'> = ['throw', 'fail', 'check'];
      const revalidate = vi.fn(async (user: string) => {
        const outcome = outcomes.shift();
        if (outcome === 'throw') throw new Error('unexpected');
        if (outcome === 'fail') return false;
        return (await check.checkWithinUserOperation(user, 'automatic', { bypassCooldown: true })).status === 'success';
      });
      const sender = new DiscordNotificationSender({ rest: { post: f.discordTransport.post } } as never);
      const service = new NotificationService(f.services.users, f.services.states, sender, {
        coordinator, now: () => new Date(now), revalidate,
        revalidationRetryBaseMs: 60_000, revalidationRetryMaxMs: 600_000,
      });

      await expect(service.deliverPending('fixture-user')).rejects.toThrow('unexpected');
      // Within the first backoff no revalidation is attempted at all.
      now += 30_000;
      await service.deliverPending('fixture-user');
      expect(revalidate).toHaveBeenCalledTimes(1);
      now += 31_000;
      await service.deliverPending('fixture-user');
      expect(revalidate).toHaveBeenCalledTimes(2);
      // The second failure doubles the wait.
      now += 61_000;
      await service.deliverPending('fixture-user');
      expect(revalidate).toHaveBeenCalledTimes(2);
      now += 60_000;
      f.steam.clearPriceCache();
      f.steamTransport.mode = 'sale';
      const delivered = await service.deliverPending('fixture-user');
      expect(revalidate).toHaveBeenCalledTimes(3);
      expect(delivered.sentCount).toBe(3);
    } finally { f.close(); }
  });

  it('rejects a non-positive revalidation backoff', () => {
    const f = reliabilityFixture();
    try {
      const sender = { plan: () => [], send: async () => undefined };
      expect(() => new NotificationService(f.services.users, f.services.states, sender,
        { revalidationRetryBaseMs: 0 })).toThrow(/revalidation retry delay/);
      expect(() => new NotificationService(f.services.users, f.services.states, sender,
        { revalidationRetryMaxMs: Number.NaN })).toThrow(/maximum revalidation retry delay/);
    } finally { f.close(); }
  });
});
