import { describe, expect, it } from 'vitest';
import { resolveStoreCountry } from '../src/domain/store-country.js';
import { suggestedStoreCountryFromDiscordLocale } from '../src/discord/language.js';
import {
  buildSetupConfirmationPanel,
  buildSetupCountrySelectOptions,
  buildSetupWelcomePanel,
  canUseSetupComponent,
  parseSetupAction,
} from '../src/discord/setup-view.js';

describe('guided setup presentation', () => {
  it('accepts exact Turkish and English country names as well as codes', () => {
    expect(resolveStoreCountry('TR')).toBe('TR');
    expect(resolveStoreCountry('Türkiye')).toBe('TR');
    expect(resolveStoreCountry('Turkey')).toBe('TR');
    expect(resolveStoreCountry('United States')).toBe('US');
    expect(resolveStoreCountry('not-a-country')).toBeNull();
  });

  it('suggests a store country from Discord locale without forcing it', () => {
    expect(suggestedStoreCountryFromDiscordLocale('tr')).toBe('TR');
    expect(suggestedStoreCountryFromDiscordLocale('en-US')).toBe('US');
    expect(suggestedStoreCountryFromDiscordLocale('en-GB')).toBe('GB');
    expect(suggestedStoreCountryFromDiscordLocale('pt-BR')).toBe('BR');
    expect(suggestedStoreCountryFromDiscordLocale('es-419')).toBe('MX');
    expect(suggestedStoreCountryFromDiscordLocale('en')).toBeUndefined();
  });

  it('builds a branded Turkish welcome panel that says what Dealio does', () => {
    const json = JSON.stringify(buildSetupWelcomePanel('tr', 'session', {
      bannerUrl: 'https://example.com/dealio.png',
    }).toJSON());

    expect(json).toContain("Dealio'ya hoş geldin");
    expect(json).toContain('https://example.com/dealio.png');
    expect(json).toContain('İndirim başlayınca DM');
    expect(json).toContain('"custom_id":"setup:session:start"');
    expect(json).toContain('"label":"Kurulumu Başlat"');
    expect(json).toContain('"custom_id":"setup:session:how"');
  });

  it('shows the verified profile, region, language, frequency and explicit consent', () => {
    const prepared = {
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'en' as const,
      storeCountryCode: 'US' as const,
    };
    const json = JSON.stringify(buildSetupConfirmationPanel(prepared, 'session', {
      pollIntervalHours: 6,
      regionSelectionSource: 'discord-locale',
    }).toJSON());

    expect(json).toContain('United States');
    expect(json).toContain('Every 6 hours');
    expect(json).toContain('Suggested automatically from your Discord language');
    expect(json).toContain('allow Dealio to send proactive sale DMs');
    expect(json).toContain('76561••••••••0000');
    expect(json).toContain(`https://steamcommunity.com/profiles/${prepared.steamId64}`);
    expect(json).toMatch(/"custom_id":"setup:session:confirm"[^}]*"label":"Correct, Enable Notifications"|"label":"Correct, Enable Notifications"[^}]*"custom_id":"setup:session:confirm"/);
    expect(json).toContain('"custom_id":"setup:session:region"');
  });

  it.each([
    ['tr', 'Her 30 dakikada bir'],
    ['en', 'Every 30 minutes'],
  ] as const)('shows the default half-hour schedule in %s', (language, expected) => {
    const panel = buildSetupConfirmationPanel({
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language,
      storeCountryCode: 'TR',
    }, 'session');
    expect(JSON.stringify(panel.toJSON())).toContain(expected);
  });

  it('binds setup actions to the owner and rejects stale or unknown controls', () => {
    expect(parseSetupAction('setup:session:confirm', 'session')).toBe('confirm');
    expect(parseSetupAction('setup:other:confirm', 'session')).toBeNull();
    expect(parseSetupAction('setup:session:unknown', 'session')).toBeNull();
    expect(canUseSetupComponent('setup:session:start', 'owner', 'owner', 'session')).toBe(true);
    expect(canUseSetupComponent('setup:session:start', 'other', 'owner', 'session')).toBe(false);
  });

  it('builds a localized modal country list with the suggested region selected', () => {
    const options = buildSetupCountrySelectOptions('tr', 'TR');

    expect(options.length).toBeLessThanOrEqual(25);
    expect(options).toContainEqual({
      label: 'Türkiye (TR)',
      value: 'TR',
      default: true,
      emoji: { name: '🇹🇷' },
    });
    expect(options.at(-1)).toMatchObject({ value: 'OTHER', label: 'Listede yok · tüm ülkeler ve arama' });
    expect(options).toContainEqual(expect.objectContaining({
      label: 'Almanya (DE)',
      value: 'DE',
    }));
  });
});
