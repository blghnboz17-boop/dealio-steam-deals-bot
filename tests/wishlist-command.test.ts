import { EventEmitter } from 'node:events';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  handleWishlist,
  parseOptionalDiscountPercent,
  wishlistCommand,
} from '../src/discord/commands/wishlist.js';
import type { WishlistItem } from '../src/domain/steam.js';

function componentText(payload: unknown): string {
  return JSON.stringify((payload as { components?: unknown[] } | undefined)?.components ?? []);
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

class FakeCollector extends EventEmitter {
  public stop(reason: string): void {
    this.emit('end', new Map(), reason);
  }
}

const items: WishlistItem[] = Array.from({ length: 6 }, (_, index) => ({
  appId: index + 1,
  name: `Game ${index + 1}`,
  priority: null,
  dateAdded: null,
  price: {
    currency: 'USD',
    initialMinor: 1_000,
    finalMinor: 500,
    discountPercent: 50,
    isFree: false,
  },
  onSale: true,
}));

describe('/wishlist command', () => {
  it('validates game overrides and treats blank input as global reset', () => {
    expect(parseOptionalDiscountPercent('')).toBeNull();
    expect(parseOptionalDiscountPercent('0')).toBe(0);
    expect(parseOptionalDiscountPercent('100')).toBe(100);
    expect(parseOptionalDiscountPercent('-1')).toBeUndefined();
    expect(parseOptionalDiscountPercent('101')).toBeUndefined();
  });

  it('registers a localized command without options', () => {
    expect(wishlistCommand.toJSON()).toMatchObject({
      name: 'wishlist',
      description_localizations: {
        tr: 'Güncel Steam wishlistini göster',
      },
      options: [],
    });
  });

  it('responds ephemerally and recommends setup in the Discord locale', async () => {
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'en-GB',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      load: vi.fn().mockResolvedValue({ status: 'not-configured', language: 'en' }),
    };

    await handleWishlist(interaction as never, service as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(service.load).toHaveBeenCalledWith('invoking-user', 'en');
    expect(componentText(interaction.editReply.mock.calls[0]?.[0])).toContain('/setup');
  });

  it('does not show an unavailable Steam response as an empty wishlist', async () => {
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'tr',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleWishlist(interaction as never, {
      load: vi.fn().mockResolvedValue({
        status: 'unavailable', language: 'tr', errorCode: 'STEAM_TIMEOUT',
      }),
    } as never);

    expect(componentText(interaction.editReply.mock.calls[0]?.[0])).toContain('yüklenemedi');
  });

  it('paginates the initial snapshot without refetch and disables controls on timeout', async () => {
    const collector = new FakeCollector();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    };
    const service = {
      load: vi.fn().mockResolvedValue({
        status: 'success',
        language: 'en',
        items,
        errors: [],
        capturedAt: '2026-08-22T12:00:00.000Z',
        configVersion: 1,
        configurationId: 'configuration-id',
      }),
    };

    const handling = handleWishlist(interaction as never, service as never);
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
    const options = createMessageComponentCollector.mock.calls[0]?.[0];
    expect(options.filter({
      customId: 'wishlist-v2:interaction-id:next', user: { id: 'other-user' },
    })).toBe(false);
    expect(options.filter({
      customId: 'wishlist-v2:interaction-id:next', user: { id: 'invoking-user' },
    })).toBe(true);
    collector.emit('collect', {
      customId: 'wishlist-v2:interaction-id:next',
      user: { id: 'invoking-user' },
      isStringSelectMenu: () => false,
      isButton: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await vi.waitFor(() => expect(interaction.editReply).toHaveBeenCalledTimes(2));
    expect(componentText(interaction.editReply.mock.calls[1]?.[0])).toContain('Game 4');
    expect(service.load).toHaveBeenCalledOnce();

    collector.emit('end', new Map(), 'time');
    await handling;

    const cleanupComponents = interaction.editReply.mock.calls.at(-1)?.[0].components;
    expect(walkComponents(cleanupComponents)
      .filter((component) => component.custom_id)
      .every((component) => component.disabled === true)).toBe(true);
    expect(service.load).toHaveBeenCalledOnce();
  });

  it('removes controls when the owner closes the snapshot', async () => {
    const collector = new FakeCollector();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    };
    const handling = handleWishlist(interaction as never, {
      load: vi.fn().mockResolvedValue({
        status: 'success',
        language: 'en',
        items,
        errors: [],
        capturedAt: '2026-08-22T12:00:00.000Z',
      }),
    } as never);
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    collector.emit('collect', {
      customId: 'wishlist-v2:interaction-id:close',
      user: { id: 'invoking-user' },
      isStringSelectMenu: () => false,
      isButton: () => true,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
    await handling;

    expect(walkComponents(interaction.editReply.mock.calls.at(-1)?.[0].components)
      .some((component) => component.custom_id)).toBe(false);
  });

  it('opens an owner-scoped game modal and updates the captured snapshot without refetching', async () => {
    const collector = new FakeCollector();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    };
    const service = {
      load: vi.fn().mockResolvedValue({
        status: 'success',
        language: 'en',
        items,
        errors: [],
        capturedAt: '2026-08-22T12:00:00.000Z',
        configVersion: 1,
        configurationId: 'configuration-id',
        globalMinimumDiscountPercent: 20,
        gameMinimumDiscountOverrides: new Map(),
      }),
    };
    const thresholdService = {
      setGame: vi.fn().mockResolvedValue({
        appId: 1,
        overridePercent: 65,
        effectivePercent: 65,
        config: { minimumDiscountPercent: 20 },
      }),
    };
    const modal = {
      customId: 'wishlist-threshold:interaction-id:invoking-user:1:1',
      user: { id: 'invoking-user' },
      fields: { getTextInputValue: vi.fn().mockReturnValue('65') },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const component = {
      customId: 'wishlist-v2:interaction-id:game',
      user: { id: 'invoking-user' },
      values: ['1'],
      isStringSelectMenu: () => true,
      isButton: () => false,
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockResolvedValue(modal),
      deferUpdate: vi.fn(),
    };
    const handling = handleWishlist(
      interaction as never,
      service as never,
      undefined,
      thresholdService as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());

    collector.emit('collect', component);
    await vi.waitFor(() => expect(thresholdService.setGame)
      .toHaveBeenCalledWith('invoking-user', 1, 65, 1, 'configuration-id'));

    expect(component.deferUpdate).not.toHaveBeenCalled();
    expect(component.showModal.mock.calls[0]?.[0].toJSON()).toMatchObject({
      custom_id: 'wishlist-threshold:interaction-id:invoking-user:1:1',
      title: 'Game minimum discount',
    });
    expect(service.load).toHaveBeenCalledOnce();
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0])).toContain('65%');
    collector.emit('end', new Map(), 'time');
    await handling;
  });

  it('cancels an active game modal during shutdown without saving', async () => {
    const collector = new FakeCollector();
    const createMessageComponentCollector = vi.fn().mockReturnValue(collector);
    const lifecycle = new AbortController();
    const interaction = {
      id: 'interaction-id',
      user: { id: 'invoking-user' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector }),
    };
    const thresholdService = { setGame: vi.fn() };
    const handling = handleWishlist(
      interaction as never,
      { load: vi.fn().mockResolvedValue({
        status: 'success',
        language: 'en',
        items,
        errors: [],
        capturedAt: '2026-08-22T12:00:00.000Z',
        configVersion: 1,
        configurationId: 'configuration-id',
        globalMinimumDiscountPercent: 0,
        gameMinimumDiscountOverrides: new Map(),
      }) } as never,
      lifecycle.signal,
      thresholdService as never,
    );
    await vi.waitFor(() => expect(createMessageComponentCollector).toHaveBeenCalledOnce());
    const component = {
      customId: 'wishlist-v2:interaction-id:game',
      user: { id: 'invoking-user' },
      values: ['1'],
      isStringSelectMenu: () => true,
      isButton: () => false,
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi.fn().mockReturnValue(new Promise(() => undefined)),
      deferUpdate: vi.fn(),
    };
    collector.emit('collect', component);
    await vi.waitFor(() => expect(component.awaitModalSubmit).toHaveBeenCalledOnce());

    lifecycle.abort();
    await handling;

    expect(thresholdService.setGame).not.toHaveBeenCalled();
  });
});
