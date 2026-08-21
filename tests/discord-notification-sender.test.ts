import { describe, expect, it, vi } from 'vitest';
import {
  DiscordNotificationSender,
  DiscordNotificationTimeoutError,
} from '../src/discord/notification-sender.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';
import { NotificationDeliveryCancelledError } from '../src/application/notification-service.js';

const candidate: NotificationCandidate = {
  discordUserId: 'discord-user',
  steamId64: '76561198000000000',
  configVersion: 1,
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

describe('DiscordNotificationSender', () => {
  it('creates a DM channel and sends a mention-safe message with one signal', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: 'message' });
    const client = { rest: { post } } as never;
    const sender = new DiscordNotificationSender(client);

    await sender.send(candidate, 'en');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      body: { recipient_id: 'discord-user' },
      signal: expect.any(AbortSignal),
    });
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      body: {
        content: expect.stringContaining('Test Game'),
        allowed_mentions: { parse: [] },
      },
      signal: post.mock.calls[0]?.[1]?.signal,
    });
  });

  it('propagates a Discord DM failure to the application service', async () => {
    const post = vi.fn().mockRejectedValue(new Error('DM blocked'));
    const sender = new DiscordNotificationSender({ rest: { post } } as never);

    await expect(sender.send(candidate, 'tr')).rejects.toThrow('DM blocked');
  });

  it('aborts a stalled delivery at the total deadline', async () => {
    vi.useFakeTimers();
    const post = vi.fn(() => new Promise(() => undefined));
    const sender = new DiscordNotificationSender(
      { rest: { post } } as never,
      { timeoutMs: 1_000 },
    );

    try {
      const sending = sender.send(candidate, 'en');
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
    const sending = sender.send(candidate, 'en');
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
});
