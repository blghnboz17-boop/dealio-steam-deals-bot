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
    expect(formatMinorPrice(12_345, 'TRY', 'tr')).toContain('TRY');
  });

  it('displays the Steam currency code without conversion', () => {
    const embed = buildSaleNotificationEmbed({ ...candidate, currency: 'EUR' }, 'en');
    const serialized = JSON.stringify(embed);

    expect(serialized).toContain('EUR');
    expect(serialized).not.toContain('TRY');
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
    expect(serialized).toContain('TRY');
    expect(serialized).toContain('İndirimli fiyat');
  });

  it('builds an English sale embed with all sale details', () => {
    const embed = buildSaleNotificationEmbed(candidate, 'en');
    const serialized = JSON.stringify(embed);

    expect(embed.title).toBe('Test Game');
    expect(serialized).toContain('20%');
    expect(serialized).toContain('123.45');
    expect(serialized).toContain('98.76');
    expect(serialized).toContain('TRY');
    expect(serialized).toContain('https://store.steampowered.com/app/10/');
    expect(serialized).toContain('Sale price');
  });

  it('clearly labels localized test notifications', () => {
    const turkish = buildSaleNotificationEmbed(candidate, 'tr', { test: true });
    const english = buildSaleNotificationEmbed(candidate, 'en', { test: true });

    expect(turkish.author?.name).toBe('Dealio test bildirimi');
    expect(turkish.description).toContain('yalnızca örnektir');
    expect(english.author?.name).toBe('Dealio test notification');
    expect(english.description).toContain('only an example');
  });

  it('removes control characters, escapes formatting, and truncates game names', () => {
    const sanitized = sanitizeGameName(`**[unsafe](url)**\n${'x'.repeat(300)}`);

    expect(sanitized).not.toContain('\n');
    expect(sanitized).toContain('\\*\\*\\[unsafe\\]\\(url\\)\\*\\*');
    expect(sanitized.endsWith('...')).toBe(true);
    expect(sanitized.length).toBeLessThanOrEqual(256);
  });
});
