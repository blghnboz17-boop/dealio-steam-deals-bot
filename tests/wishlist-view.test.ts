import { describe, expect, it } from 'vitest';
import type { APIEmbed } from 'discord.js';
import type { WishlistItem } from '../src/domain/steam.js';
import { embedTextLength } from '../src/discord/notification-messages.js';
import {
  buildWishlistGameEmbed,
  buildWishlistPage,
  canUseWishlistComponent,
  sanitizeWishlistGameName,
  validateWishlistEmbeds,
  wishlistEmbedColors,
  wishlistPageSize,
} from '../src/discord/wishlist-view.js';

function paidItem(appId: number, currency: string): WishlistItem {
  return {
    appId,
    headerImageUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    name: `Game ${appId}`,
    priority: appId,
    dateAdded: 1_700_000_000 + appId,
    price: {
      currency,
      initialMinor: 12_345,
      finalMinor: 9_876,
      discountPercent: 20,
      isFree: false,
    },
    onSale: true,
  };
}

function normalItem(appId: number, currency: string): WishlistItem {
  return {
    ...paidItem(appId, currency),
    priority: null,
    dateAdded: null,
    price: {
      currency,
      initialMinor: 12_345,
      finalMinor: 12_345,
      discountPercent: 0,
      isFree: false,
    },
    onSale: false,
  };
}

function freeItem(appId: number): WishlistItem {
  return {
    ...normalItem(appId, 'USD'),
    price: {
      currency: null,
      initialMinor: 0,
      finalMinor: 0,
      discountPercent: 0,
      isFree: true,
    },
  };
}

function unknownPriceItem(appId: number): WishlistItem {
  return {
    ...normalItem(appId, 'USD'),
    price: null,
    onSale: null,
  };
}

const snapshot = {
  items: [paidItem(10, 'TRY'), paidItem(20, 'USD')],
  failedItemCount: 1,
  capturedAt: '2026-08-22T12:00:00.000Z',
};

describe('wishlist Discord presentation', () => {
  it('builds localized summary and game embeds without currency conversion', () => {
    const turkish = buildWishlistPage(snapshot, 'tr', 0, 'interaction-id');
    const english = buildWishlistPage(snapshot, 'en', 0, 'interaction-id');
    const turkishText = JSON.stringify(turkish.embeds);
    const englishText = JSON.stringify(english.embeds);

    expect(turkish.embeds[0]).toMatchObject({ title: 'Steam wishlistin' });
    expect(turkishText).toContain('1 oyunun ayrıntıları');
    expect(turkishText).toContain('123,45');
    expect(turkishText).toContain('TRY');
    expect(turkishText).toContain('USD');
    expect(english.embeds[0]).toMatchObject({ title: 'Your Steam wishlist' });
    expect(englishText).toContain('123.45');
    expect(englishText).toContain('Steam details could not be loaded for 1 games');
  });

  it('renders free and unknown prices explicitly with distinct colors', () => {
    const freeEmbed = buildWishlistGameEmbed(freeItem(30), 'en');
    const unknownEmbed = buildWishlistGameEmbed(unknownPriceItem(40), 'tr');

    expect(freeEmbed.color).toBe(wishlistEmbedColors.free);
    expect(JSON.stringify(freeEmbed)).toContain('Free');
    expect(unknownEmbed.color).toBe(wishlistEmbedColors.unknown);
    expect(JSON.stringify(unknownEmbed)).toContain('Fiyat bilgisi Steam tarafından sağlanmadı');
  });

  it('paginates exactly three games per page and leaves one game on page two', () => {
    const largeSnapshot = {
      ...snapshot,
      items: Array.from({ length: 4 }, (_, index) => paidItem(index + 1, 'USD')),
      failedItemCount: 0,
    };
    const first = buildWishlistPage(largeSnapshot, 'en', 0, 'interaction-id');
    const last = buildWishlistPage(largeSnapshot, 'en', 1, 'interaction-id');
    const firstGameButtons = first.components[0]?.components ?? [];
    const firstButtons = first.components[1]?.components ?? [];
    const lastButtons = last.components[1]?.components ?? [];

    expect(wishlistPageSize).toBe(3);
    expect(first.embeds).toHaveLength(4);
    expect(last.embeds).toHaveLength(2);
    expect(first.embeds.slice(1).map((embed) => embed.title)).toEqual([
      'Game 1',
      'Game 2',
      'Game 3',
    ]);
    expect(last.embeds[1]?.title).toBe('Game 4');
    expect(firstButtons[0]?.disabled).toBe(true);
    expect(firstButtons[1]?.disabled).toBe(false);
    expect(lastButtons[0]?.disabled).toBe(false);
    expect(lastButtons[1]?.disabled).toBe(true);
    expect(firstButtons.map((button) => button.label)).toEqual(['Previous', 'Next', 'Close']);
    expect(firstGameButtons.map((button) => button.custom_id)).toEqual([
      'wishlist:interaction-id:game:1',
      'wishlist:interaction-id:game:2',
      'wishlist:interaction-id:game:3',
    ]);
  });

  it('uses green for real sales and Steam blue for normal paid games', () => {
    expect(buildWishlistGameEmbed(paidItem(10, 'TRY'), 'tr').color)
      .toBe(wishlistEmbedColors.sale);
    expect(buildWishlistGameEmbed(normalItem(20, 'USD'), 'en').color)
      .toBe(wishlistEmbedColors.normal);
  });

  it('strikes only a real sale normal price and highlights localized discounts', () => {
    const turkish = buildWishlistGameEmbed(paidItem(10, 'TRY'), 'tr');
    const english = buildWishlistGameEmbed(paidItem(20, 'USD'), 'en');
    const turkishNormalPrice = turkish.fields?.find((field) => field.name === 'Normal fiyat');
    const englishNormalPrice = english.fields?.find((field) => field.name === 'Normal price');
    const englishCurrentPrice = english.fields?.find((field) => field.name === 'Current price');

    expect(turkishNormalPrice?.value).toMatch(/^~~.*TRY.*~~$/);
    expect(englishNormalPrice?.value).toMatch(/^~~.*USD.*~~$/);
    expect(englishCurrentPrice?.value).toMatch(/^\*\*.*USD.*\*\*$/);
    expect(turkish.fields).toContainEqual({
      name: 'İndirim',
      value: '🟢 **%20 indirim**',
      inline: true,
    });
    expect(english.fields).toContainEqual({
      name: 'Discount',
      value: '🟢 **20% discount**',
      inline: true,
    });
  });

  it('shows one compact price without strikethrough when there is no discount', () => {
    const embed = buildWishlistGameEmbed({ ...normalItem(20, 'USD'), onSale: true }, 'en');
    const text = JSON.stringify(embed);

    expect(text).toContain('USD');
    expect(text).not.toContain('~~');
    expect(embed.fields?.filter((field) => field.name === 'Price')).toHaveLength(1);
  });

  it('omits zero and null priorities and localizes positive Steam priority', () => {
    const zero = buildWishlistGameEmbed({ ...normalItem(10, 'USD'), priority: 0 }, 'tr');
    const none = buildWishlistGameEmbed({ ...normalItem(20, 'USD'), priority: null }, 'en');
    const positive = buildWishlistGameEmbed({ ...normalItem(30, 'USD'), priority: 3 }, 'tr');

    expect(zero.fields?.some((field) => field.name === 'Öncelik')).toBe(false);
    expect(JSON.stringify(zero)).not.toContain('Öncelik: 0');
    expect(none.fields?.some((field) => field.name === 'Priority')).toBe(false);
    expect(positive.fields).toContainEqual({
      name: 'Öncelik',
      value: '#3',
      inline: true,
    });
  });

  it('uses a separate Steam header image and store URL for every game', () => {
    const page = buildWishlistPage(snapshot, 'en', 0, 'interaction-id');

    expect(page.embeds[1]).toMatchObject({
      url: 'https://store.steampowered.com/app/10/',
      image: { url: expect.stringContaining('/steam/apps/10/header.jpg') },
    });
    expect(page.embeds[2]).toMatchObject({
      url: 'https://store.steampowered.com/app/20/',
      image: { url: expect.stringContaining('/steam/apps/20/header.jpg') },
    });
  });

  it('sanitizes markdown, mentions, controls, and oversized game names', () => {
    const sanitized = sanitizeWishlistGameName(`@everyone **[bad](url)**\n${'x'.repeat(300)}`);

    expect(sanitized).not.toContain('@everyone');
    expect(sanitized).not.toContain('\n');
    expect(sanitized).toContain('\\*\\*\\[bad\\]\\(url\\)\\*\\*');
    expect(sanitized.length).toBeLessThanOrEqual(256);
  });

  it('enforces Discord aggregate, field, and embed count limits', () => {
    const validPage = buildWishlistPage(snapshot, 'en', 0, 'interaction-id');
    expect(validPage.embeds.reduce((total, embed) => total + embedTextLength(embed), 0))
      .toBeLessThanOrEqual(6_000);
    expect(() => validateWishlistEmbeds(
      Array.from({ length: 11 }, () => ({ title: 'x' })),
    )).toThrow('embed count');
    expect(() => validateWishlistEmbeds([
      { description: 'x'.repeat(4_000) },
      { description: 'x'.repeat(2_001) },
    ])).toThrow('character limit');
    expect(() => validateWishlistEmbeds([
      { fields: [{ name: 'x', value: 'x'.repeat(1_025) }] } as APIEmbed,
    ])).toThrow('field limit');
  });

  it('allows controls only for the invoking user and matching session', () => {
    expect(canUseWishlistComponent(
      'wishlist:interaction-id:next', 'owner', 'owner', 'interaction-id',
    )).toBe(true);
    expect(canUseWishlistComponent(
      'wishlist:interaction-id:next', 'other-user', 'owner', 'interaction-id',
    )).toBe(false);
    expect(canUseWishlistComponent(
      'wishlist:other-session:next', 'owner', 'owner', 'interaction-id',
    )).toBe(false);
  });
});
