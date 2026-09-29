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

async function summaryPaginationFixture() {
  let listener: ((interaction: unknown) => void) | undefined;
  const post = vi.fn().mockResolvedValueOnce({ id: '123' }).mockResolvedValue({ id: '456' });
  const patch = vi.fn().mockResolvedValue({});
  const lifecycle = new AbortController();
  const sender = new DiscordNotificationSender({
    rest: { post, patch }, on: (_event: unknown, callback: typeof listener) => { listener = callback; }, off: vi.fn(),
  } as never, { lifecycleSignal: lifecycle.signal });
  await sender.sendInitialSummary({
    discordUserId: 'owner', steamId64: '76561198000000000', language: 'en', storeCountryCode: 'US',
    totalGameCount: 3, failedItemCount: 0, minimumDiscountPercent: 0, capturedAt: new Date().toISOString(),
    sales: [1, 2, 3].map(appId => ({ appId, gameName: `Game ${appId}`, currency: 'USD',
      normalPriceMinor: 2000, finalPriceMinor: 1000, discountPercent: 50 })),
  });
  const customId = walkComponents(post.mock.calls[1]?.[1]?.body.components)
    .find(c => typeof c.custom_id === 'string' && c.custom_id.endsWith(':next'))?.custom_id;
  const click = (editReply = vi.fn().mockResolvedValue(undefined), deferUpdate = vi.fn().mockResolvedValue(undefined)) => {
    const interaction = { isButton: () => true, customId, message: { id: '456' }, channelId: '123',
      user: { id: 'owner' }, locale: 'en-US', editReply, update: editReply, deferUpdate };
    listener?.(interaction);
    return interaction;
  };
  return { click, lifecycle, patch };
}

describe('initial-summary pagination ordering', () => {
  it('does not skip a page when the previous edit failed', async () => {
    const f = await summaryPaginationFixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      f.click(vi.fn().mockRejectedValue(new Error('edit failed')));
      await vi.waitFor(() => expect(errors).toHaveBeenCalled());
      const second = f.click();
      await vi.waitFor(() => expect(second.editReply).toHaveBeenCalledOnce());
      expect(componentText(second.editReply.mock.calls[0])).toContain('Game 2');
      expect(componentText(second.editReply.mock.calls[0])).not.toContain('Game 3');
    } finally { f.lifecycle.abort(); errors.mockRestore(); }
  });

  it('acknowledges another click immediately while serializing page edits', async () => {
    const f = await summaryPaginationFixture();
    const gate = Promise.withResolvers<void>();
    try {
      const first = f.click(vi.fn().mockReturnValue(gate.promise));
      await vi.waitFor(() => expect(first.editReply).toHaveBeenCalledOnce());
      const second = f.click();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(second.deferUpdate).toHaveBeenCalledOnce();
      expect(second.editReply).not.toHaveBeenCalled();
      gate.resolve();
      await vi.waitFor(() => expect(second.editReply).toHaveBeenCalledOnce());
      expect(componentText(first.editReply.mock.calls[0])).toContain('Game 2');
      expect(componentText(second.editReply.mock.calls[0])).toContain('Game 3');
    } finally { gate.resolve(); f.lifecycle.abort(); }
  });

  it('observes a queued acknowledgement failure without advancing the page', async () => {
    const f = await summaryPaginationFixture();
    const gate = Promise.withResolvers<void>();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      f.click(vi.fn().mockReturnValue(gate.promise));
      await new Promise<void>(resolve => setImmediate(resolve));
      const failed = f.click(vi.fn(), vi.fn().mockRejectedValue(new Error('ack failed')));
      await new Promise<void>(resolve => setImmediate(resolve));
      gate.resolve();
      await vi.waitFor(() => expect(errors).toHaveBeenCalled());
      expect(failed.editReply).not.toHaveBeenCalled();
      const next = f.click();
      await vi.waitFor(() => expect(next.editReply).toHaveBeenCalledOnce());
      expect(componentText(next.editReply.mock.calls[0])).toContain('Game 3');
    } finally { gate.resolve(); f.lifecycle.abort(); errors.mockRestore(); }
  });

  it('expires after the in-flight edit and drops later queued page changes', async () => {
    vi.useFakeTimers();
    const f = await summaryPaginationFixture();
    const gate = Promise.withResolvers<void>();
    try {
      const first = f.click(vi.fn().mockReturnValue(gate.promise));
      await vi.advanceTimersByTimeAsync(0);
      expect(first.editReply).toHaveBeenCalledOnce();
      const second = f.click();
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(f.patch).not.toHaveBeenCalled();
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(second.deferUpdate).toHaveBeenCalledOnce();
      expect(second.editReply).not.toHaveBeenCalled();
      expect(f.patch).toHaveBeenCalledOnce();
      const expired = f.patch.mock.calls[0]?.[1]?.body.components;
      expect(componentText(expired)).toContain('Game 2');
      const pagination = walkComponents(expired).filter(c => typeof c.custom_id === 'string');
      expect(pagination.every(c => c.disabled === true)).toBe(true);
    } finally { gate.resolve(); f.lifecycle.abort(); vi.useRealTimers(); }
  });
});

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
  it('deduplicates an accepted message with a lost response using the durable batch identity', async () => {
    const accepted = new Map<string, string>();
    const post = vi.fn(async (route: string, request: { body: Record<string, unknown> }) => {
      if (route === '/users/@me/channels') return { id: '123' };
      const nonce = request.body.nonce as string;
      expect(nonce).toMatch(/^[a-f0-9]{24}$/);
      expect(request.body.enforce_nonce).toBe(true);
      if (accepted.has(nonce)) return { id: accepted.get(nonce) };
      accepted.set(nonce, String(accepted.size + 100));
      throw new Error('response lost after acceptance');
    });
    const durable = { ...batch, batchId: 'durable-batch-1' };
    await expect(new DiscordNotificationSender({ rest: { post } } as never).send(durable, 'en'))
      .rejects.toThrow('response lost');
    const receipt = await new DiscordNotificationSender({ rest: { post } } as never)
      .send(durable, 'en');
    expect(receipt.messageId).toBe('100');
    expect(accepted.size).toBe(1);
    await expect(new DiscordNotificationSender({ rest: { post } } as never)
      .send({ ...durable, batchId: 'durable-batch-2' }, 'en')).rejects.toThrow('response lost');
    expect(accepted.size).toBe(2);
  });

  it('gives separate test deliveries different nonces', async () => {
    const post = vi.fn().mockResolvedValue({ id: '123' });
    const sender = new DiscordNotificationSender({ rest: { post } } as never);
    await sender.send(batch, 'en', { test: true });
    await sender.send(batch, 'en', { test: true });
    expect(post.mock.calls[1]?.[1]?.body.nonce).toEqual(expect.any(String));
    expect(post.mock.calls[1]?.[1]?.body.nonce).not.toBe(post.mock.calls[3]?.[1]?.body.nonce);
  });

  it('creates a DM channel and sends a mention-safe Components V2 panel with one signal', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ id: '123456789012345678' })
      .mockResolvedValueOnce({ id: '223456789012345678' });
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
      .mockResolvedValueOnce({ id: '223456789012345678' });
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
    const post = vi.fn((_route: string, _options: { signal: AbortSignal }) => new Promise(() => undefined));
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
      .mockResolvedValueOnce({ id: '223456789012345678' });
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
      editReply: update,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
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
