import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { storeCountryCodes } from '../src/domain/store-country.js';
import type { WishlistItem } from '../src/domain/steam.js';
import { buildWishlistV2Page } from '../src/discord/wishlist-view.js';
import { buildStatusV2Panel } from '../src/discord/status-view-v2.js';
import { buildSetupCountrySelectOptions } from '../src/discord/setup-view.js';
import {
  buildCountryListPanel,
  buildCountryRangePanel,
  buildStoreCountryRanges,
} from '../src/discord/ui/country-picker.js';
import {
  assertComponentsV2Limit,
  countComponentsV2,
  dealioEphemeralV2Flags,
} from '../src/discord/ui/components-v2.js';
import { buildSaleNotificationPanel } from '../src/discord/notification-components-v2.js';
import { DiscordNotificationSender } from '../src/discord/notification-sender.js';
import { dealioUiSessions } from '../src/discord/ui/session-manager.js';

function wishlistItems(count: number): WishlistItem[] {
  return Array.from({ length: count }, (_, index) => ({
    appId: index + 1,
    name: `A very presentable Dealio game ${index + 1}`,
    priority: index + 1,
    dateAdded: 1_700_000_000 + index,
    price: {
      currency: 'TRY',
      initialMinor: 1_000 + index,
      finalMinor: 500 + index,
      discountPercent: 50,
      isFree: false,
    },
    onSale: true,
  }));
}

function notification(index: number) {
  return {
    discordUserId: 'discord-user',
    appId: index + 1,
    saleEpisodeId: `episode-${index}`,
    gameName: `Game ${index + 1}`,
    currency: 'TRY',
    normalPriceMinor: 1_000,
    finalPriceMinor: 500,
    discountPercent: 50,
    storeCountryCode: 'TR' as const,
    createdAt: '2026-08-29T00:00:00.000Z',
  };
}

describe('Dealio Components V2 UI', () => {
  it('distinguishes active, foreign, and genuinely expired panels without timing guesses', () => {
    const close = dealioUiSessions.open('session-test', 'owner', ['dealio', 'country'], 60_000);
    expect(dealioUiSessions.resolve('dealio:session-test:wishlist', 'owner')).toBe('active-owner');
    expect(dealioUiSessions.resolve('country:session-test:range', 'other')).toBe('active-other-user');
    close();
    expect(dealioUiSessions.resolve('dealio:session-test:wishlist', 'owner')).toBe('expired');
  });

  it('rejects combined text over the Discord message limit', () => {
    expect(() => assertComponentsV2Limit([
      { type: 17, components: [
        { type: 10, content: 'a'.repeat(2000) },
        { type: 9, components: [{ type: 10, content: 'b'.repeat(2001) }] },
      ] },
    ] as never)).toThrow('4000');
  });

  it.each(['tr', 'en'] as const)('fits legacy ten-game alerts with long names in %s', (language) => {
    const panel = buildSaleNotificationPanel(Array.from({ length: 10 }, (_, index) => ({
      ...notification(index), appId: 2147483647 - index,
      gameName: 'A'.repeat(256),
      normalPriceMinor: 99999999, finalPriceMinor: 49999999,
    })), language);
    const json = JSON.stringify(panel.toJSON());
    let length = 0;
    JSON.stringify(panel.toJSON(), (key, value: unknown) => {
      if (key === 'content' && typeof value === 'string') length += value.length;
      return value;
    });
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThanOrEqual(4000);
    for (let index = 0; index < 10; index += 1) {
      expect(json).toContain('/app/' + (2147483647 - index) + '/');
    }
  });

  it('uses the combined ephemeral and Components V2 message flags', () => {
    expect(dealioEphemeralV2Flags)
      .toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
  });

  it('makes every supported Store country reachable without exceeding 25 options', () => {
    for (const language of ['tr', 'en'] as const) {
      const ranges = buildStoreCountryRanges(language);
      expect(ranges.every((range) => range.countries.length <= 25)).toBe(true);
      expect(ranges.flatMap((range) => range.countries).sort())
        .toEqual([...storeCountryCodes].sort());
      expect(countComponentsV2([buildCountryRangePanel(language, 'session')])).toBeLessThanOrEqual(40);
      for (const range of ranges) {
        expect(countComponentsV2([
          buildCountryListPanel(language, 'session', range.index),
        ])).toBeLessThanOrEqual(40);
      }
    }
  });

  it('keeps the setup modal quick list at 24 countries plus Other', () => {
    const options = buildSetupCountrySelectOptions('tr', 'TR');
    expect(options).toHaveLength(25);
    expect(options).toContainEqual(expect.objectContaining({ value: 'TR', default: true }));
    expect(options).toContainEqual(expect.objectContaining({ value: 'OTHER' }));
  });

  it.each([0, 1, 3, 4, 10, 11])(
    'renders a three-game wishlist panel safely for %i games',
    (count) => {
      const page = buildWishlistV2Page({
        items: wishlistItems(count),
        failedItemCount: 0,
        capturedAt: '2026-08-29T00:00:00.000Z',
        storeCountryCode: 'TR',
        globalMinimumDiscountPercent: 20,
      }, 'tr', 0, 'session');
      expect(page.items).toHaveLength(Math.min(3, count));
      expect(page.pageCount).toBe(Math.max(1, Math.ceil(count / 3)));
      expect(countComponentsV2(page.components)).toBeLessThanOrEqual(40);
    },
  );

  it.each(['home', 'status'] as const)('renders the %s dashboard with valid action rows', (mode) => {
    const panel = buildStatusV2Panel({
      status: 'ready',
      language: 'tr',
      config: {
        discordUserId: 'discord-user',
        configurationId: 'configuration-id',
        steamId64: '76561198000000000',
        configVersion: 1,
        language: 'tr',
        storeCountryCode: 'TR',
        enabled: true,
        minimumDiscountPercent: 20,
        dmOptInAt: '2026-08-29T00:00:00.000Z',
        dmDeliveryBlockedAt: null,
        dmDeliveryErrorCode: null,
        createdAt: '2026-08-29T00:00:00.000Z',
        updatedAt: '2026-08-29T00:00:00.000Z',
      },
      checkState: null,
      notificationQueue: {
        pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0,
      },
      latestPriceCurrencies: ['TRY'],
      gameDiscountOverrideCount: 0,
    }, 'session', {
      mode,
      bannerUrl: 'https://i.imgur.com/JsawzhP.png',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(countComponentsV2([panel])).toBeLessThanOrEqual(40);
    const serialized = JSON.stringify(panel.toJSON());
    expect(serialized).toContain(mode === 'home' ? 'İndirim radarın' : 'Dealio Durum ve Ayarlar');
    expect(serialized).toContain('İlk kontrol bekleniyor');
    const rows = panel.toJSON().components.filter((component) => component.type === 1);
    expect(rows.map((row) => row.components.length)).toEqual(mode === 'home' ? [2, 3, 3] : [2, 3]);
    expect(serialized).not.toContain('↻');
  });

  it.each([1, 5, 10])('renders a safe grouped notification panel for %i games', (count) => {
    const panel = buildSaleNotificationPanel(
      Array.from({ length: count }, (_, index) => notification(index)),
      'tr',
    );
    expect(countComponentsV2([panel])).toBeLessThanOrEqual(40);
  });

  it.each([
    [1, [1]],
    [5, [5]],
    [6, [5, 1]],
    [11, [5, 5, 1]],
  ] as const)('partitions %i new sale alerts into five-game DMs', (count, expected) => {
    const sender = new DiscordNotificationSender({ rest: { post: vi.fn() } } as never);
    expect(sender.plan(
      Array.from({ length: count }, (_, index) => notification(index)),
      'tr',
    ).map((batch) => batch.notifications.length)).toEqual(expected);
  });
});
