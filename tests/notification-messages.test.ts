import { describe, expect, it } from 'vitest';
import {
  buildSaleNotificationMessage,
  formatMinorPrice,
  sanitizeGameName,
} from '../src/discord/notification-messages.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';

const candidate: NotificationCandidate = {
  discordUserId: 'discord-user',
  steamId64: '76561198000000000',
  configVersion: 1,
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

  it('builds a Turkish sale message with all sale details', () => {
    const message = buildSaleNotificationMessage(candidate, 'tr');

    expect(message).toContain('Test Game');
    expect(message).toContain('%20');
    expect(message).toContain('123,45');
    expect(message).toContain('98,76');
    expect(message).toContain('TRY');
    expect(message).toContain('https://store.steampowered.com/app/10/');
    expect(message).toContain('İndirimli fiyat');
  });

  it('builds an English sale message with all sale details', () => {
    const message = buildSaleNotificationMessage(candidate, 'en');

    expect(message).toContain('Test Game');
    expect(message).toContain('20%');
    expect(message).toContain('123.45');
    expect(message).toContain('98.76');
    expect(message).toContain('TRY');
    expect(message).toContain('https://store.steampowered.com/app/10/');
    expect(message).toContain('Sale price');
  });

  it('removes control characters, escapes formatting, and truncates game names', () => {
    const sanitized = sanitizeGameName(`**[unsafe](url)**\n${'x'.repeat(300)}`);

    expect(sanitized).not.toContain('\n');
    expect(sanitized).toContain('\\*\\*\\[unsafe\\]\\(url\\)\\*\\*');
    expect(sanitized.endsWith('...')).toBe(true);
    expect(sanitized.length).toBeLessThanOrEqual(280);
  });
});
