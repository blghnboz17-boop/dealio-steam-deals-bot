import { describe, expect, it, vi } from 'vitest';
import {
  NotificationRetryScheduler,
  type NotificationRetryClock,
} from '../src/application/notification-retry-scheduler.js';
import type { UserConfig } from '../src/domain/user-config.js';

function user(discordUserId: string): UserConfig {
  return {
    discordUserId,
    steamId64: '76561198000000000',
    configVersion: 1,
    language: 'en',
    enabled: true,
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
