import { describe, expect, it, vi } from 'vitest';
import {
  DiscordNotificationSender,
  DiscordNotificationTimeoutError,
  partitionNotificationBatches,
} from '../src/discord/notification-sender.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';
import { NotificationDeliveryCancelledError } from '../src/application/notification-service.js';
import { MessageFlags } from 'discord.js';

function componentText(value: unknown): string {
  return JSON.stringify(value);
}

function walkComponents(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(walkComponents);
  if (!value || typeof value !== 'object') return [];
  if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return walkComponents((value as { toJSON: () => unknown }).toJSON());
  }
  const component = value as Record<string, unknown>;
  const children = Array.isArray(component.components) ? component.components : [];
  const accessory = component.accessory ? [component.accessory] : [];
  return [component, ...[...children, ...accessory].flatMap(walkComponents)];
}

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
  it('creates a DM channel and sends a mention-safe Components V2 panel with one signal', async () => {
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
        flags: MessageFlags.IsComponentsV2,
        components: expect.any(Array),
        allowed_mentions: { parse: [] },
      },
      signal: post.mock.calls[0]?.[1]?.signal,
    });
    expect(componentText(post.mock.calls[1]?.[1]?.body.components)).toContain('Test Game');
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
    expect(post.mock.calls[1]?.[1]?.body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(componentText(post.mock.calls[1]?.[1]?.body.components)).toContain('Dealio test bildirimi');
    expect(componentText(post.mock.calls[1]?.[1]?.body.components)).toContain('Test Game');
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

  it('sends multiple games as compact sections with their own Steam images in one DM', async () => {
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
    const serialized = componentText(body.components);
    expect(serialized).toContain('Test Game');
    expect(serialized).toContain('Second Game');
    expect(serialized).toContain('/steam/apps/10/header.jpg');
    expect(serialized).toContain('/steam/apps/20/header.jpg');
    expect(walkComponents(body.components).filter((component) => component.type === 9)).toHaveLength(2);
  });

  it('plans at most five games per modern notification panel with deterministic ordering', () => {
    const sender = new DiscordNotificationSender({ rest: { post: vi.fn() } } as never);
    const notifications = Array.from({ length: 11 }, (_, index) => ({
      ...candidate,
      appId: 20 - index,
      gameName: `Game ${index}`,
      saleEpisodeId: `episode-${String(index).padStart(2, '0')}`,
    }));

    const batches = sender.plan(notifications, 'en');

    expect(batches.map((planned) => planned.notifications.length)).toEqual([5, 5, 1]);
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

  it('sends the initial setup summary as one banner plus one game with navigation', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValue({ id: '987654321098765432' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);
    const sales = Array.from({ length: 3 }, (_, index) => ({
      appId: 10 + index,
      gameName: `Setup Game ${index + 1}`,
      currency: 'USD',
      normalPriceMinor: 2_000,
      finalPriceMinor: 1_000,
      discountPercent: 50,
    }));

    await sender.sendInitialSummary({
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'en',
      storeCountryCode: 'US',
      totalGameCount: 3,
      failedItemCount: 0,
      minimumDiscountPercent: 0,
      capturedAt: '2026-08-23T00:00:00.000Z',
      sales,
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[1]?.body.allowed_mentions).toEqual({ parse: [] });
    const body = post.mock.calls[1]?.[1]?.body;
    expect(body.flags).toBe(MessageFlags.IsComponentsV2);
    expect(componentText(body.components)).toContain('Dealio is ready');
    expect(componentText(body.components)).toContain('Setup Game 1');
    expect(componentText(body.components)).toContain('/steam/apps/10/header.jpg');
    const controls = walkComponents(body.components);
    expect(controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ custom_id: expect.stringMatching(/:previous$/), disabled: true }),
      expect.objectContaining({ label: '1 / 3', disabled: true }),
      expect.objectContaining({ custom_id: expect.stringMatching(/:next$/), disabled: false }),
    ]));
  });

  it('sends a branded setup-complete no-sale embed', async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: '987654321098765432' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);

    await sender.sendInitialSummary({
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'tr',
      storeCountryCode: 'TR',
      totalGameCount: 4,
      failedItemCount: 0,
      minimumDiscountPercent: 20,
      capturedAt: '2026-08-23T00:00:00.000Z',
      sales: [],
    });

    const body = post.mock.calls[1]?.[1]?.body;
    expect(body).toMatchObject({ flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } });
    expect(componentText(body.components)).toContain('Dealio hazır');
    expect(componentText(body.components)).toContain('indirimde oyun yok');
  });

  it('turns the initial summary into an owner-bound single-message paginator', async () => {
    let interactionListener: ((interaction: unknown) => void) | undefined;
    const post = vi.fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: '987654321098765432' });
    const lifecycle = new AbortController();
    const client = {
      rest: { post, patch: vi.fn().mockResolvedValue({}) },
      on: vi.fn((_event, listener) => { interactionListener = listener; }),
      off: vi.fn(),
    };
    const sender = new DiscordNotificationSender(client as never, {
      lifecycleSignal: lifecycle.signal,
      bannerUrl: 'https://example.com/dealio.png',
    });
    const sales = Array.from({ length: 11 }, (_, index) => ({
      appId: 10 + index,
      gameName: `Setup Game ${index + 1}`,
      currency: 'TRY',
      normalPriceMinor: 2_000,
      finalPriceMinor: 1_000,
      discountPercent: 50,
    }));

    await sender.sendInitialSummary({
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'tr',
      storeCountryCode: 'TR',
      totalGameCount: 11,
      failedItemCount: 0,
      minimumDiscountPercent: 0,
      capturedAt: '2026-08-23T00:00:00.000Z',
      sales,
    });

    const nextButton = walkComponents(post.mock.calls[1]?.[1]?.body.components)
      .find((component) => typeof component.custom_id === 'string'
        && component.custom_id.endsWith(':next'));
    const update = vi.fn().mockResolvedValue(undefined);
    interactionListener?.({
      isButton: () => true,
      customId: nextButton?.custom_id,
      message: { id: '987654321098765432' },
      channelId: '123456789012345678',
      user: { id: 'discord-user' },
      locale: 'tr',
      update,
      reply: vi.fn().mockResolvedValue(undefined),
    });

    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const updated = update.mock.calls[0]?.[0];
    expect(componentText(updated.components)).toContain('Setup Game 2');
    expect(componentText(updated.components)).toContain('2 / 11');
    expect(walkComponents(updated.components)).toContainEqual(expect.objectContaining({
      custom_id: expect.stringMatching(/:next$/), disabled: false,
    }));
    lifecycle.abort();
  });
});
