import { describe, expect, it, vi } from 'vitest';
import {
  NotificationDeliveryCancelledError,
  NotificationService,
  type NotificationSender,
} from '../src/application/notification-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import type { WishlistItem } from '../src/domain/steam.js';
import { UserConfigurationService } from '../src/application/user-configuration-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';

const saleItem: WishlistItem = {
  appId: 10,
  name: 'Test Game',
  priority: null,
  dateAdded: null,
  price: {
    currency: 'TRY',
    initialMinor: 1_000,
    finalMinor: 750,
    discountPercent: 25,
    isFree: false,
  },
  onSale: true,
};

function createService(
  language: 'tr' | 'en',
  sender: NotificationSender,
) {
  const database = createDatabase(':memory:');
  const userConfigRepository = new UserConfigRepository(database);
  const wishlistStateRepository = new WishlistStateRepository(database);
  const config = userConfigRepository.upsert(
    'discord-user',
    '76561198000000000',
    language,
    '2026-08-21T00:00:00.000Z',
  );
  wishlistStateRepository.recordObservation(config, {
    item: { ...saleItem, onSale: false, price: { ...saleItem.price, finalMinor: 1_000, discountPercent: 0 } },
    saleKey: null,
    observedAt: '2026-08-21T00:01:00.000Z',
  });
  const observation = wishlistStateRepository.recordObservation(config, {
    item: saleItem,
    saleKey: 'TRY:1000:750:25',
    observedAt: '2026-08-21T00:02:00.000Z',
  });

  if (!observation.notificationCandidate) {
    throw new Error('Expected a notification candidate');
  }

  return {
    database,
    config,
    candidate: observation.notificationCandidate,
    userConfigRepository,
    repository: wishlistStateRepository,
    service: new NotificationService(userConfigRepository, wishlistStateRepository, sender),
  };
}

describe('NotificationService', () => {
  it('sends a candidate and marks it sent', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('tr', sender);

    const result = await services.service.deliverPending('discord-user');

    expect(result).toEqual({ candidateCount: 1, sentCount: 1, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ appId: 10 }), 'tr');
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('sent');
    services.database.close();
  });

  it('does not send the same sale key twice', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('en', sender);

    await services.service.deliverPending('discord-user');
    const secondResult = await services.service.deliverPending('discord-user');

    expect(secondResult).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);
    services.database.close();
  });

  it('marks failed DMs failed and retries them later', async () => {
    const sender = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error('DM disabled'))
        .mockResolvedValueOnce(undefined),
    };
    const services = createService('en', sender);
    let now = new Date('2026-08-21T00:10:00.000Z');
    const service = new NotificationService(
      services.userConfigRepository,
      services.repository,
      sender,
      {
        now: () => now,
        retryBaseDelayMs: 60_000,
      },
    );

    const firstResult = await service.deliverPending('discord-user');
    const earlyResult = await service.deliverPending('discord-user');
    now = new Date('2026-08-21T00:11:00.000Z');
    const secondResult = await service.deliverPending('discord-user');

    expect(firstResult).toMatchObject({ sentCount: 0, failedCount: 1 });
    expect(earlyResult).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(secondResult).toMatchObject({ sentCount: 1, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('sent');
    services.database.close();
  });

  it('marks permanent Discord DM failures terminal without retrying', async () => {
    const permanentError = Object.assign(new Error('Cannot send messages to this user'), {
      code: 50_007,
      status: 403,
    });
    const sender = { send: vi.fn().mockRejectedValue(permanentError) };
    const services = createService('en', sender);

    await services.service.deliverPending('discord-user');
    const secondResult = await services.service.deliverPending('discord-user');

    expect(services.repository.findNotificationStatus(services.candidate)).toBe('terminal_failed');
    expect(secondResult).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledOnce();
    services.database.close();
  });

  it('stops transient DM retries after the maximum attempt count', async () => {
    const sender = { send: vi.fn().mockRejectedValue(new Error('temporary network failure')) };
    const services = createService('en', sender);
    let now = new Date('2026-08-21T00:10:00.000Z');
    const service = new NotificationService(
      services.userConfigRepository,
      services.repository,
      sender,
      {
        now: () => now,
        maxAttempts: 2,
        retryBaseDelayMs: 1_000,
      },
    );

    await service.deliverPending('discord-user');
    now = new Date('2026-08-21T00:10:01.000Z');
    await service.deliverPending('discord-user');
    const finalResult = await service.deliverPending('discord-user');

    expect(services.repository.findNotificationStatus(services.candidate)).toBe('terminal_failed');
    expect(finalResult).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    services.database.close();
  });

  it('claims a candidate so concurrent delivery cannot send two DMs', async () => {
    let resolveSend: (() => void) | undefined;
    const sender = {
      send: vi.fn().mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
      ),
    };
    const services = createService('tr', sender);

    const firstDelivery = services.service.deliverPending('discord-user');
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledOnce());
    const secondDelivery = services.service.deliverPending('discord-user');
    await Promise.resolve();
    expect(sender.send).toHaveBeenCalledTimes(1);
    resolveSend?.();
    const firstResult = await firstDelivery;
    const secondResult = await secondDelivery;

    expect(secondResult).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(firstResult).toEqual({ candidateCount: 1, sentCount: 1, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);
    services.database.close();
  });

  it('does not claim candidates after application shutdown starts', async () => {
    const lifecycle = new AbortController();
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('en', sender);
    const service = new NotificationService(
      services.userConfigRepository,
      services.repository,
      sender,
      { lifecycleSignal: lifecycle.signal },
    );
    lifecycle.abort();

    await expect(service.deliverPending('discord-user')).resolves.toEqual({
      candidateCount: 0,
      sentCount: 0,
      failedCount: 0,
    });
    expect(sender.send).not.toHaveBeenCalled();
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('candidate');
    services.database.close();
  });

  it('leaves an uncertain in-flight delivery sending when shutdown cancels it', async () => {
    const lifecycle = new AbortController();
    let rejectSend: ((error: Error) => void) | undefined;
    const sender = {
      send: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectSend = reject;
      })),
    };
    const services = createService('en', sender);
    const service = new NotificationService(
      services.userConfigRepository,
      services.repository,
      sender,
      { lifecycleSignal: lifecycle.signal },
    );
    const delivery = service.deliverPending('discord-user');
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledOnce());
    lifecycle.abort();
    rejectSend?.(new NotificationDeliveryCancelledError('shutdown'));

    await expect(delivery).resolves.toMatchObject({ sentCount: 0, failedCount: 0 });
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('sending');
    services.database.close();
  });

  it('recovers and retries a stale sending candidate after a process interruption', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('en', sender);
    services.repository.claimNotificationCandidate(
      services.candidate,
      '2026-08-21T00:05:00.000Z',
    );
    const service = new NotificationService(
      new UserConfigRepository(services.database),
      services.repository,
      sender,
      {
        sendingTimeoutMs: 10 * 60 * 1000,
        maxAttempts: 1,
        now: () => new Date('2026-08-21T00:20:00.000Z'),
      },
    );

    const result = await service.deliverPending('discord-user');

    expect(result).toEqual({ candidateCount: 1, sentCount: 1, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('sent');
    services.database.close();
  });

  it('does not reclaim a fresh sending candidate', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('en', sender);
    services.repository.claimNotificationCandidate(
      services.candidate,
      '2026-08-21T00:15:00.000Z',
    );
    const service = new NotificationService(
      new UserConfigRepository(services.database),
      services.repository,
      sender,
      {
        sendingTimeoutMs: 10 * 60 * 1000,
        now: () => new Date('2026-08-21T00:20:00.000Z'),
      },
    );

    const result = await service.deliverPending('discord-user');

    expect(result).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('sending');
    services.database.close();
  });

  it('expires a pending notification when its sale episode has ended', async () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('tr', sender);
    services.repository.recordObservation(services.config, {
      item: {
        ...saleItem,
        onSale: false,
        price: { ...saleItem.price, finalMinor: 1_000, discountPercent: 0 },
      },
      saleKey: null,
      observedAt: '2026-08-21T00:03:00.000Z',
    });

    const result = await services.service.deliverPending('discord-user');

    expect(result).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).not.toHaveBeenCalled();
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('expired');
    services.database.close();
  });

  it('does not retry a failed notification after its sale episode ends', async () => {
    const sender = { send: vi.fn().mockRejectedValue(new Error('DM blocked')) };
    const services = createService('tr', sender);
    await services.service.deliverPending('discord-user');
    services.repository.recordObservation(services.config, {
      item: {
        ...saleItem,
        onSale: false,
        price: { ...saleItem.price, finalMinor: 1_000, discountPercent: 0 },
      },
      saleKey: null,
      observedAt: '2026-08-21T00:03:00.000Z',
    });

    const result = await services.service.deliverPending('discord-user');

    expect(result).toEqual({ candidateCount: 0, sentCount: 0, failedCount: 0 });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(services.repository.findNotificationStatus(services.candidate)).toBe('expired');
    services.database.close();
  });

  it('does not switch Steam accounts while an old-account DM is being delivered', async () => {
    let resolveSend: (() => void) | undefined;
    const sender = {
      send: vi.fn().mockImplementation(
        () => new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
      ),
    };
    const services = createService('en', sender);
    const coordinator = new UserOperationCoordinator();
    const notificationService = new NotificationService(
      services.userConfigRepository,
      services.repository,
      sender,
      { coordinator },
    );
    const configurationService = new UserConfigurationService(
      services.userConfigRepository,
      { validateWishlistAccess: vi.fn().mockResolvedValue(undefined) },
      coordinator,
    );
    const delivery = notificationService.deliverPending('discord-user');
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledOnce());
    let accountChanged = false;
    const configuration = configurationService
      .configure('discord-user', '76561198000000001', 'en')
      .then((config) => {
        accountChanged = true;
        return config;
      });
    await Promise.resolve();

    expect(accountChanged).toBe(false);
    expect(services.userConfigRepository.findByDiscordUserId('discord-user')?.configVersion).toBe(1);

    resolveSend?.();
    await delivery;
    const changedConfig = await configuration;
    expect(changedConfig).toMatchObject({
      steamId64: '76561198000000001',
      configVersion: 2,
    });
    services.database.close();
  });

  it('expires retryable notifications from an earlier account generation', () => {
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const services = createService('en', sender);

    services.userConfigRepository.upsert(
      'discord-user',
      '76561198000000001',
      'en',
      '2026-08-21T01:00:00.000Z',
    );

    expect(services.repository.findNotificationStatus(services.candidate)).toBe('expired');
    services.database.close();
  });
});
