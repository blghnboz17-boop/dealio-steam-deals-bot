import { describe, expect, it, vi } from 'vitest';
import {
  DiscordNotificationSender,
  DiscordNotificationTimeoutError,
  partitionNotificationBatches,
} from '../src/discord/notification-sender.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';
import { NotificationDeliveryCancelledError } from '../src/application/notification-service.js';
import {
  initialWishlistNoSaleMessage,
  initialWishlistSaleMessage,
} from '../src/discord/initial-wishlist-summary-messages.js';

const candidate: NotificationCandidate = {
  discordUserId: 'discord-user',
  steamId64: '76561198000000000',
  configVersion: 1,
  storeCountryCode: 'TR',
  appId: 10,
  gameName: 'Test Game',
  saleEpisodeId: 'episode-1',
  saleKey: 'TRY:1000:500:50',
  currency: 'TRY',
  normalPriceMinor: 1_000,
  finalPriceMinor: 500,
  discountPercent: 50,
  attemptCount: 0,
  createdAt: '2026-08-21T00:00:00.000Z',
};
const batch = { notifications: [candidate] as const };

describe('DiscordNotificationSender', () => {
  it('creates a DM channel and sends a mention-safe embed with one signal', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: 'message' });
    const client = { rest: { post } } as never;
    const sender = new DiscordNotificationSender(client);

    await sender.send(batch, 'en');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: { recipient_id: 'discord-user' },
      signal: expect.any(AbortSignal),
    });
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: {
        embeds: [expect.objectContaining({ title: 'Test Game' })],
        allowed_mentions: { parse: [] },
      },
      signal: post.mock.calls[0]?.[1]?.signal,
    });
  });

  it('sends the localized test design to only the requested recipient', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: 'message' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);

    await sender.send(batch, 'tr', { test: true });

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: { recipient_id: candidate.discordUserId },
    });
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: {
        embeds: [expect.objectContaining({
          author: { name: 'Dealio test bildirimi' },
          title: 'Test Game',
        })],
      },
    });
  });

  it('propagates a Discord DM failure to the application service', async () => {
    const post = vi.fn().mockRejectedValue(new Error('DM blocked'));
    const sender = new DiscordNotificationSender({ rest: { post } } as never);

    await expect(sender.send(batch, 'tr')).rejects.toThrow('DM blocked');
  });

  it('aborts a stalled delivery at the total deadline', async () => {
    vi.useFakeTimers();
    const post = vi.fn(() => new Promise(() => undefined));
    const sender = new DiscordNotificationSender(
      { rest: { post } } as never,
      { timeoutMs: 1_000 },
    );

    try {
      const sending = sender.send(batch, 'en');
      const rejection = expect(sending).rejects.toBeInstanceOf(
        DiscordNotificationTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect((post.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight delivery during application shutdown', async () => {
    const lifecycle = new AbortController();
    const post = vi.fn(() => new Promise(() => undefined));
    const sender = new DiscordNotificationSender(
      { rest: { post } } as never,
      { lifecycleSignal: lifecycle.signal },
    );
    const sending = sender.send(batch, 'en');
    const rejection = expect(sending).rejects.toBeInstanceOf(
      NotificationDeliveryCancelledError,
    );
    lifecycle.abort();

    await rejection;
  });

  it('rejects invalid timeout configuration', () => {
    expect(() => new DiscordNotificationSender(
      { rest: { post: vi.fn() } } as never,
      { timeoutMs: 0 },
    )).toThrow('positive safe integer');
  });

  it('sends multiple games as embeds with their own Steam header images in one DM', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: 'message' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);
    const second = {
      ...candidate,
      appId: 20,
      gameName: 'Second Game',
      saleEpisodeId: 'episode-2',
    };

    await sender.send({ notifications: [candidate, second] }, 'en');

    const body = post.mock.calls[1]?.[1]?.body;
    expect(body.embeds).toHaveLength(2);
    expect(body.embeds[0]).toMatchObject({
      title: 'Test Game',
      image: { url: expect.stringContaining('/steam/apps/10/header.jpg') },
    });
    expect(body.embeds[1]).toMatchObject({
      title: 'Second Game',
      image: { url: expect.stringContaining('/steam/apps/20/header.jpg') },
    });
  });

  it('plans at most 10 embeds with deterministic notification ordering', () => {
    const sender = new DiscordNotificationSender({ rest: { post: vi.fn() } } as never);
    const notifications = Array.from({ length: 11 }, (_, index) => ({
      ...candidate,
      appId: 20 - index,
      gameName: `Game ${index}`,
      saleEpisodeId: `episode-${String(index).padStart(2, '0')}`,
    }));

    const batches = sender.plan(notifications, 'en');

    expect(batches.map((planned) => planned.notifications.length)).toEqual([10, 1]);
    expect(batches.flatMap((planned) => planned.notifications).map((item) => item.appId))
      .toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(notifications[0]?.appId).toBe(20);
  });

  it('uses sale episode ID as the final deterministic ordering key', () => {
    const sender = new DiscordNotificationSender({ rest: { post: vi.fn() } } as never);
    const notifications = ['episode-c', 'episode-a', 'episode-b'].map((saleEpisodeId) => ({
      ...candidate,
      saleEpisodeId,
    }));

    const planned = sender.plan(notifications, 'en');

    expect(planned.flatMap((item) => item.notifications).map((item) => item.saleEpisodeId))
      .toEqual(['episode-a', 'episode-b', 'episode-c']);
  });

  it('splits batches deterministically at the 6000 embed-character limit', () => {
    const exactlyAtLimit = partitionNotificationBatches(
      [1, 2],
      () => ({ description: 'x'.repeat(3_000) }),
    );
    const overLimit = partitionNotificationBatches(
      [1, 2],
      (value) => ({ description: 'x'.repeat(value === 1 ? 3_000 : 3_001) }),
    );

    expect(exactlyAtLimit.map((planned) => planned.notifications)).toEqual([[1, 2]]);
    expect(overLimit.map((planned) => planned.notifications)).toEqual([[1], [2]]);
    expect(() => partitionNotificationBatches(
      [1],
      () => ({ description: 'x'.repeat(6_001) }),
    )).toThrow('exceeds Discord limits');
  });

  it('sends the initial setup summary in limit-safe batches with regional prices', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValue({ id: 'message' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);
    const sales = Array.from({ length: 11 }, (_, index) => ({
      appId: 10 + index,
      gameName: `Setup Game ${index + 1}`,
      currency: 'USD',
      normalPriceMinor: 2_000,
      finalPriceMinor: 1_000,
      discountPercent: 50,
    }));

    await sender.sendInitialSummary({
      discordUserId: 'discord-user',
      storeCountryCode: 'US',
      capturedAt: '2026-08-23T00:00:00.000Z',
      sales,
    });

    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[1]?.[1]?.body).toMatchObject({
      content: initialWishlistSaleMessage,
      embeds: expect.any(Array),
      allowed_mentions: { parse: [] },
    });
    expect(post.mock.calls[1]?.[1]?.body.embeds).toHaveLength(10);
    expect(post.mock.calls[2]?.[1]?.body.embeds).toHaveLength(1);
    expect(post.mock.calls[1]?.[1]?.body.embeds[0]).toMatchObject({
      title: 'Setup Game 1',
      url: 'https://store.steampowered.com/app/10/',
      fields: expect.arrayContaining([
        { name: 'Currency', value: 'USD', inline: true },
        { name: 'Steam Store country', value: 'United States (US)', inline: true },
      ]),
    });
  });

  it('sends the setup-complete no-sale message without embeds', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: 'message' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);

    await sender.sendInitialSummary({
      discordUserId: 'discord-user',
      storeCountryCode: 'TR',
      capturedAt: '2026-08-23T00:00:00.000Z',
      sales: [],
    });

    expect(post.mock.calls[1]?.[1]?.body).toEqual({
      content: initialWishlistNoSaleMessage,
      allowed_mentions: { parse: [] },
    });
  });
});
