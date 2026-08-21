import { describe, expect, it, vi } from 'vitest';
import { BotRuntime } from '../src/application/bot-runtime.js';
import { ApplicationTaskTracker } from '../src/application/application-task-tracker.js';
import {
  type SchedulerCheckService,
  type SchedulerClock,
  type SchedulerLogger,
  type SchedulerNotificationService,
  WishlistScheduler,
} from '../src/application/scheduler.js';
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

function successResult() {
  return {
    status: 'success' as const,
    checkedCount: 0,
    notificationCandidates: [],
    failedItems: [],
    unknownPriceCount: 0,
  };
}

function createClock() {
  let callback: (() => void) | null = null;
  let handle: object | null = null;

  const clock: SchedulerClock = {
    setInterval: vi.fn((nextCallback) => {
      callback = nextCallback;
      handle = {};
      return handle as ReturnType<typeof setInterval>;
    }),
    clearInterval: vi.fn((receivedHandle) => {
      if (receivedHandle === handle) {
        callback = null;
      }
    }),
  };

  return {
    clock,
    trigger: () => callback?.(),
  };
}

function createLogger(): SchedulerLogger {
  return { info: vi.fn(), error: vi.fn() };
}

function createNotificationService(): SchedulerNotificationService {
  return {
    deliverPending: vi.fn().mockResolvedValue({
      candidateCount: 0,
      sentCount: 0,
      failedCount: 0,
    }),
  };
}

function createScheduler(
  users: UserConfig[],
  checkService: SchedulerCheckService,
  notificationService = createNotificationService(),
  clock = createClock(),
  maxUserConcurrency = 3,
) {
  const logger = createLogger();
  const scheduler = new WishlistScheduler({
    intervalHours: 6,
    userConfigRepository: { findEnabled: () => users },
    checkService,
    notificationService,
    clock: clock.clock,
    logger,
    maxUserConcurrency,
  });

  return { scheduler, clock, logger, notificationService };
}

describe('WishlistScheduler', () => {
  it('checks every enabled configured user', async () => {
    const checkService = { check: vi.fn().mockResolvedValue(successResult()) };
    const { scheduler } = createScheduler(
      [user('user-a'), user('user-b')],
      checkService,
    );

    const summary = await scheduler.runOnce();

    expect(checkService.check).toHaveBeenCalledTimes(2);
    expect(checkService.check).toHaveBeenCalledWith('user-a');
    expect(checkService.check).toHaveBeenCalledWith('user-b');
    expect(summary).toEqual({ userCount: 2, completedCount: 2, errorCount: 0 });
  });

  it('continues with other users when one check fails', async () => {
    const checkService = {
      check: vi.fn().mockImplementation(async (discordUserId: string) => {
        if (discordUserId === 'user-a') {
          throw new Error('test failure');
        }

        return successResult();
      }),
    };
    const { scheduler } = createScheduler(
      [user('user-a'), user('user-b')],
      checkService,
    );

    const summary = await scheduler.runOnce();

    expect(checkService.check).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ userCount: 2, completedCount: 2, errorCount: 1 });
  });

  it('uses the configured interval and clears it on stop', async () => {
    const checkService = { check: vi.fn().mockResolvedValue(successResult()) };
    const { scheduler, clock } = createScheduler([user('user-a')], checkService);

    scheduler.start();
    scheduler.start();
    await scheduler.stop();

    expect(scheduler.intervalMilliseconds).toBe(6 * 60 * 60 * 1000);
    expect(clock.clock.setInterval).toHaveBeenCalledTimes(1);
    expect(clock.clock.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      6 * 60 * 60 * 1000,
    );
    expect(clock.clock.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('does not start a parallel scheduler run for the same users', async () => {
    let resolveCheck: (() => void) | undefined;
    const checkService = {
      check: vi.fn().mockImplementation(
        () => new Promise((resolve) => {
          resolveCheck = () => resolve(successResult());
        }),
      ),
    };
    const { scheduler } = createScheduler([user('user-a')], checkService);

    const firstRun = scheduler.runOnce();
    const secondRun = await scheduler.runOnce();
    resolveCheck?.();
    await firstRun;

    expect(secondRun).toEqual({ userCount: 0, completedCount: 0, errorCount: 0 });
    expect(checkService.check).toHaveBeenCalledTimes(1);
  });

  it('triggers an initial run and later interval runs', async () => {
    const checkService = { check: vi.fn().mockResolvedValue(successResult()) };
    const { scheduler, clock } = createScheduler([user('user-a')], checkService);

    scheduler.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    clock.trigger();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(checkService.check).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it('waits for the active run and blocks new runs during shutdown', async () => {
    let resolveCheck: (() => void) | undefined;
    const checkService = {
      check: vi.fn().mockImplementation(
        () => new Promise((resolve) => {
          resolveCheck = () => resolve(successResult());
        }),
      ),
    };
    const { scheduler } = createScheduler([user('user-a')], checkService);
    const activeRun = scheduler.runOnce();
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });

    expect(stopped).toBe(false);
    await expect(scheduler.runOnce()).resolves.toEqual({
      userCount: 0,
      completedCount: 0,
      errorCount: 0,
    });
    resolveCheck?.();
    await activeRun;
    await stopping;

    expect(stopped).toBe(true);
    expect(checkService.check).toHaveBeenCalledTimes(1);
  });

  it('limits the number of users processed concurrently', async () => {
    let activeCount = 0;
    let maximumActiveCount = 0;
    const checkService = {
      check: vi.fn().mockImplementation(async () => {
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeCount -= 1;
        return successResult();
      }),
    };
    const users = Array.from({ length: 6 }, (_, index) => user(`user-${index}`));
    const { scheduler } = createScheduler(
      users,
      checkService,
      createNotificationService(),
      createClock(),
      2,
    );

    await scheduler.runOnce();

    expect(maximumActiveCount).toBe(2);
  });

  it('rejects timer intervals outside the safe operational range', () => {
    const checkService = { check: vi.fn().mockResolvedValue(successResult()) };

    expect(() => new WishlistScheduler({
      intervalHours: 1_000,
      userConfigRepository: { findEnabled: () => [] },
      checkService,
      notificationService: createNotificationService(),
    })).toThrow('Scheduler interval must be between 0.25 and 168 hours');
  });
});

describe('BotRuntime', () => {
  it('stops scheduler, Discord client, and database once', async () => {
    const calls: string[] = [];
    const scheduler = { stop: vi.fn(async () => { calls.push('scheduler'); }) };
    const client = { destroy: vi.fn(async () => { calls.push('client'); }) };
    const database = { close: vi.fn(() => calls.push('database')) };
    const runtime = new BotRuntime(scheduler, client, database);

    await Promise.all([runtime.stop(), runtime.stop()]);

    expect(calls).toEqual(['scheduler', 'client', 'database']);
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it('keeps resources open after the timeout until scheduler work finishes', async () => {
    let resolveStop: (() => void) | undefined;
    const scheduler = {
      stop: vi.fn(() => new Promise<void>((resolve) => {
        resolveStop = resolve;
      })),
    };
    const client = { destroy: vi.fn().mockResolvedValue(undefined) };
    const database = { close: vi.fn() };
    const logger = { error: vi.fn() };
    const runtime = new BotRuntime(scheduler, client, database, {
      shutdownTimeoutMs: 1,
      logger,
    });
    const stopping = runtime.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));

    expect(logger.error).toHaveBeenCalledOnce();
    expect(client.destroy).not.toHaveBeenCalled();
    expect(database.close).not.toHaveBeenCalled();

    resolveStop?.();
    await stopping;
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('waits for interaction work and rejects new work during shutdown', async () => {
    const taskTracker = new ApplicationTaskTracker();
    let resolveTask: (() => void) | undefined;
    taskTracker.run(
      () => new Promise<void>((resolve) => {
        resolveTask = resolve;
      }),
    );
    const scheduler = { stop: vi.fn().mockResolvedValue(undefined) };
    const client = { destroy: vi.fn().mockResolvedValue(undefined) };
    const database = { close: vi.fn() };
    const runtime = new BotRuntime(scheduler, client, database, { taskTracker });
    const stopping = runtime.stop();
    await Promise.resolve();

    expect(taskTracker.run(async () => undefined)).toBe(false);
    expect(client.destroy).not.toHaveBeenCalled();
    expect(database.close).not.toHaveBeenCalled();

    resolveTask?.();
    await stopping;
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it('waits for all stop operations and retains the lock when database close fails', async () => {
    let resolveTasks: (() => void) | undefined;
    const scheduler = { stop: vi.fn(() => { throw new Error('scheduler stop failed'); }) };
    const taskTracker = {
      stop: vi.fn(() => new Promise<void>((resolve) => {
        resolveTasks = resolve;
      })),
    };
    const client = { destroy: vi.fn().mockRejectedValue(new Error('client destroy failed')) };
    const database = { close: vi.fn(() => { throw new Error('database close failed'); }) };
    const processLock = { release: vi.fn() };
    const runtime = new BotRuntime(scheduler, client, database, {
      taskTracker,
      processLock,
      shutdownTimeoutMs: 1,
      logger: { error: vi.fn() },
    });
    const stopping = runtime.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(client.destroy).not.toHaveBeenCalled();

    resolveTasks?.();
    await expect(stopping).rejects.toThrow('Bot shutdown completed with errors');
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(processLock.release).not.toHaveBeenCalled();
  });
});
