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
    expect(json).toContain('"label":"Hadi başlayalım"');
    expect(json).toContain('"custom_id":"setup:session:how"');
  });

  it('shows the Steam name under the ID and the avatar on the right when Steam sends them', () => {
    const json = JSON.stringify(buildSetupConfirmationPanel({
      discordUserId: 'discord-user', steamId64: '76561198000000000', language: 'tr', storeCountryCode: 'TR',
      profile: { personaName: 'Gabe_*N*', avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg' },
    }, 'session').toJSON());
    expect(json).toContain('👤 **Steam hesabı:** [76561198000000000]');
    // The name sits under the ID, with Markdown in it escaped (JSON doubles each backslash).
    expect(json).toContain('\\n🏷️ **Steam adın:** Gabe\\\\_\\\\*N\\\\*');
    expect(json).toMatch(/"type":9,[^]*"accessory":\{"type":11,"media":\{"url":"https:\/\/avatars\.steamstatic\.com\/abc_full\.jpg"/);
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
    expect(json).toContain('Guessed from your Discord language');
    expect(json).toContain('I can DM you when a game on your wishlist goes on sale');
    // The full ID, so the user can check it is theirs; no name or avatar when Steam did not send them.
    expect(json).toContain(`[${prepared.steamId64}](https://steamcommunity.com/profiles/${prepared.steamId64})`);
    expect(json).not.toContain('Steam name');
    expect(json).not.toContain('"type":11');
    expect(json).toContain(`https://steamcommunity.com/profiles/${prepared.steamId64}`);
    expect(json).toMatch(/"custom_id":"setup:session:confirm"[^}]*"label":"Looks good, turn on alerts"|"label":"Looks good, turn on alerts"[^}]*"custom_id":"setup:session:confirm"/);
    expect(json).toContain('"custom_id":"setup:session:region"');
  });

  it.each([
    ['tr', '30 dakikada bir'],
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
