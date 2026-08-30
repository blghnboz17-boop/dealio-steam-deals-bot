import { describe, expect, it } from 'vitest';
import { resolveStoreCountry } from '../src/domain/store-country.js';
import { suggestedStoreCountryFromDiscordLocale } from '../src/discord/language.js';
import {
  buildSetupConfirmationComponents,
  buildSetupConfirmationEmbed,
  buildSetupCountrySelectOptions,
  buildSetupWelcomeComponents,
  buildSetupWelcomeEmbed,
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

  it('builds a branded Turkish welcome card with owner-session controls', () => {
    const embed = buildSetupWelcomeEmbed('tr', {
      bannerUrl: 'https://example.com/dealio.png',
    });
    const components = buildSetupWelcomeComponents('session', 'tr');

    expect(embed).toMatchObject({
      title: expect.stringContaining("Dealio'ya hoş geldin"),
      image: { url: 'https://example.com/dealio.png' },
    });
    expect(components[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        custom_id: 'setup:session:start',
        label: 'Kurulumu Başlat',
      }),
      expect.objectContaining({ custom_id: 'setup:session:how' }),
    ]));
  });

  it('shows the verified profile, region, language, frequency and explicit consent', () => {
    const prepared = {
      discordUserId: 'discord-user',
      steamId64: '76561198000000000',
      language: 'en' as const,
      storeCountryCode: 'US' as const,
    };
    const embed = buildSetupConfirmationEmbed(prepared, {
      pollIntervalHours: 6,
      regionSelectionSource: 'discord-locale',
    });
    const controls = buildSetupConfirmationComponents('session', 'en');
    const serialized = JSON.stringify(embed);

    expect(serialized).toContain('United States (US)');
    expect(serialized).toContain('Every 6 hours');
    expect(serialized).toContain('Suggested automatically from your Discord language');
    expect(serialized).toContain('allow Dealio to send proactive sale DMs');
    expect(serialized).toContain('76561••••••••0000');
    expect(serialized).toContain(`https://steamcommunity.com/profiles/${prepared.steamId64}`);
    expect(controls[0]?.components[0]).toMatchObject({
      custom_id: 'setup:session:confirm',
      label: 'Correct, Enable Notifications',
    });
    expect(controls[0]?.components[1]).toMatchObject({
      custom_id: 'setup:session:region',
      label: 'Change Region',
    });
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
    });
    expect(options).toContainEqual(expect.objectContaining({
      label: 'Almanya (DE)',
      value: 'DE',
    }));
  });
});
