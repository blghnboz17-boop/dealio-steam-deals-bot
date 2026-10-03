import { buildSaleNotificationPanel } from '../src/discord/notification-components-v2.js';
import { describe, expect, it } from 'vitest';
import {
  buildSaleNotificationEmbed,
  formatMinorPrice,
  sanitizeGameName,
} from '../src/discord/notification-messages.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';

const candidate: NotificationCandidate = {
  discordUserId: 'discord-user',
  steamId64: '76561198000000000',
  configVersion: 1,
  storeCountryCode: 'TR',
  appId: 10,
  headerImageUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/10/header.jpg',
  gameName: 'Test Game',
  saleEpisodeId: 'episode-1',
  saleKey: 'TRY:12345:9876:20',
  currency: 'TRY',
  normalPriceMinor: 12_345,
  finalPriceMinor: 9_876,
  discountPercent: 20,
  attemptCount: 0,
  createdAt: '2026-08-21T00:00:00.000Z',
};

describe('notification messages', () => {
  it('formats minor unit prices using the selected locale and currency', () => {
    expect(formatMinorPrice(12_345, 'TRY', 'tr')).toContain('123,45');
    expect(formatMinorPrice(12_345, 'TRY', 'en')).toContain('123.45');
    expect(formatMinorPrice(12_345, 'TRY', 'tr')).toBe('₺123,45');
    expect(formatMinorPrice(399, 'USD', 'tr')).toBe('$3,99');
    // Dollars other than USD keep a distinct prefix rather than a bare "$".
    expect(formatMinorPrice(399, 'CAD', 'tr')).toBe('CA$3,99');
    expect(formatMinorPrice(399, 'CNY', 'en')).toBe('CN¥3.99');
  });

  it('displays the Steam currency without conversion', () => {
    const embed = buildSaleNotificationEmbed({ ...candidate, currency: 'EUR' }, 'en');
    const serialized = JSON.stringify(embed);

    expect(serialized).toContain('€');
    expect(serialized).not.toContain('₺');
    expect(serialized).toContain('123.45');
  });

  it('builds a Turkish sale embed with all sale details', () => {
    const embed = buildSaleNotificationEmbed(candidate, 'tr');
    const serialized = JSON.stringify(embed);

    expect(embed.title).toBe('Test Game');
    expect(embed.url).toBe('https://store.steampowered.com/app/10/');
    expect(embed.image?.url).toContain('/steam/apps/10/header.jpg');
    expect(serialized).toContain('%20');
    expect(serialized).toContain('123,45');
    expect(serialized).toContain('98,76');
    expect(serialized).toContain('₺');
    expect(serialized).toContain('İndirimli fiyat');
  });

  it('builds an English sale embed with all sale details', () => {
    const embed = buildSaleNotificationEmbed(candidate, 'en');
    const serialized = JSON.stringify(embed);

    expect(embed.title).toBe('Test Game');
    expect(serialized).toContain('20%');
    expect(serialized).toContain('123.45');
    expect(serialized).toContain('98.76');
    expect(serialized).toContain('₺');
    expect(serialized).toContain('https://store.steampowered.com/app/10/');
    expect(serialized).toContain('Sale price');
  });

  it('clearly labels localized test notifications and says where the game came from', () => {
    const text = (language: 'tr' | 'en', testSource: 'wishlist' | 'example') => JSON.stringify(
      buildSaleNotificationPanel([candidate], language, { test: true, testSource }).toJSON());

    expect(text('tr', 'wishlist')).toContain('DEALIO · TEST');
    expect(text('tr', 'wishlist')).toContain('senin istek listenden');
    expect(text('tr', 'example')).toContain('örnek bir oyun');
    expect(text('en', 'wishlist')).toContain('come from your wishlist');
    expect(text('en', 'example')).toContain('here’s an example game');
  });

  it('keeps the flame for hot deals of 60% or more', () => {
    const header = (discountPercent: number) => JSON.stringify(
      buildSaleNotificationPanel([{ ...candidate, discountPercent }], 'en').toJSON());

    expect(header(60)).toContain('# 🔥');
    expect(header(60)).toContain('## 🔥 [Test Game]');
    expect(header(59)).not.toContain('🔥');
    expect(header(59)).toContain('# 🔔');
  });

  it('removes control characters, escapes formatting, and truncates game names', () => {
    const sanitized = sanitizeGameName(`**[unsafe](url)**\n${'x'.repeat(300)}`);

    expect(sanitized).not.toContain('\n');
    expect(sanitized).toContain('\\*\\*\\[unsafe\\]\\(url\\)\\*\\*');
    expect(sanitized.endsWith('...')).toBe(true);
    expect(sanitized.length).toBeLessThanOrEqual(256);
  });
});
