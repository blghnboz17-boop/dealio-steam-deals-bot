import { describe, expect, it, vi } from 'vitest';
import { WishlistScheduler } from '../src/application/scheduler.js';
import { NotificationRetryScheduler } from '../src/application/notification-retry-scheduler.js';
import type { UserConfig } from '../src/domain/user-config.js';

function users(count: number): UserConfig[] {
  return Array.from({ length: count }, (_, index) => ({ discordUserId: `user-${index}` }) as UserConfig);
}

const emptyDelivery = { candidateCount: 0, sentCount: 0, failedCount: 0 };

describe('shutdown during a scan', () => {
  it('finishes the users in progress but starts no new wishlist checks', async () => {
    const releases: Array<() => void> = [];
    const check = vi.fn(() => new Promise<never>((_resolve, reject) => {
      releases.push(() => reject(new Error('cancelled')));
    }));
    const scheduler = new WishlistScheduler({
      intervalHours: 1,
      userConfigRepository: { findEnabled: () => users(200) },
      checkService: { check },
      notificationService: { deliverPending: vi.fn().mockResolvedValue(emptyDelivery) },
      scheduleRepository: { findNextScheduledAt: () => null, setNextScheduledAt: () => undefined },
      clock: { setTimeout: () => ({}) as ReturnType<typeof setTimeout>, clearTimeout: () => undefined },
      logger: { info: () => undefined, error: () => undefined },
      maxUserConcurrency: 3,
    });

    const run = scheduler.runOnce();
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(3);
    const stopped = scheduler.stop();
    for (const release of releases.splice(0)) release();
    await expect(run).resolves.toMatchObject({ userCount: 200, completedCount: 3 });
    await stopped;
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('stops the notification retry pass from visiting further users', async () => {
    const releases: Array<() => void> = [];
    const deliverPending = vi.fn(() => new Promise<typeof emptyDelivery>((resolve) => {
      releases.push(() => resolve(emptyDelivery));
    }));
    const scheduler = new NotificationRetryScheduler({
      intervalSeconds: 60,
      userConfigRepository: { findEnabled: () => users(50) },
      notificationService: { deliverPending },
      clock: { setInterval: () => ({}) as ReturnType<typeof setInterval>, clearInterval: () => undefined },
      logger: { info: () => undefined, error: () => undefined },
      maxUserConcurrency: 2,
    });

    const run = scheduler.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(deliverPending).toHaveBeenCalledTimes(2);
    const stopped = scheduler.stop();
    for (const release of releases.splice(0)) release();
    await expect(run).resolves.toMatchObject({ userCount: 50, completedCount: 2 });
    await stopped;
    expect(deliverPending).toHaveBeenCalledTimes(2);
  });
});
