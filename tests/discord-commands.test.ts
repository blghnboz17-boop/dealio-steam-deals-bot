import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { commands } from '../src/discord/register-commands.js';
import { handleCheck } from '../src/discord/commands/check.js';
import { handleSetup } from '../src/discord/commands/setup.js';
import { handleRegion } from '../src/discord/commands/region.js';
import { handleTestNotification } from '../src/discord/commands/test-notification.js';
import {
  findStoreCountryChoices,
  handleStoreCountryAutocomplete,
} from '../src/discord/store-country-options.js';
import { SteamWishlistError } from '../src/domain/steam.js';
import { SteamIdentityError } from '../src/domain/steam-identity.js';

describe('Discord slash commands', () => {
  const componentText = (payload: unknown): string => JSON.stringify(
    (payload as { components?: unknown[] } | undefined)?.components ?? [],
  );

  it('registers the supported commands', () => {
    expect(commands.map((command) => command.name)).toEqual([
      'dealio',
      'setup',
      'region',
      'status',
      'check',
      'wishlist',
      'test-notification',
      'delete-data',
    ]);
  });

  it('registers the test notification command without options', () => {
    const command = commands.find((candidate) => candidate.name === 'test-notification');

    expect(command?.toJSON()).toMatchObject({
      name: 'test-notification',
      description_localizations: {
        tr: 'Kendine DM ile örnek bir indirim bildirimi gönder',
      },
      options: [],
    });
  });

  it('uses an option-free interactive confirmation flow for data deletion', () => {
    const command = commands.find((candidate) => candidate.name === 'delete-data');
    expect(command?.toJSON()).toMatchObject({
      name: 'delete-data',
      description_localizations: { tr: 'Dealio verilerini kalıcı olarak sil' },
      options: [],
    });
  });

  it('registers setup as a guided command without technical options', () => {
    const setup = commands.find((command) => command.name === 'setup');
    expect(setup?.toJSON()).toMatchObject({
      name: 'setup',
      description: 'Start the guided Steam wishlist setup',
      options: [],
    });
  });

  it('blocks repeated setup before opening the wizard and points to data deletion', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      locale: 'tr',
      client: { user: null },
      reply: vi.fn().mockResolvedValue(undefined),
      options: { getString: vi.fn() },
    };
    const service = {
      hasExistingConfiguration: vi.fn().mockReturnValue(true),
      prepare: vi.fn(),
      confirm: vi.fn(),
      configure: vi.fn(),
    };

    await handleSetup(interaction as never, service as never);

    expect(service.hasExistingConfiguration).toHaveBeenCalledWith('discord-user');
    const reply = interaction.reply.mock.calls[0]?.[0];
    expect(componentText(reply)).toContain('zaten kurulu');
    expect(componentText(reply)).toContain('/delete-data');
    expect(reply.flags).toBe(MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.confirm).not.toHaveBeenCalled();
    expect(service.configure).not.toHaveBeenCalled();
  });

  it('registers autocomplete country selection for setup and region', () => {
    const region = commands.find((command) => command.name === 'region')?.toJSON();
    expect(region?.options).toEqual([
      expect.objectContaining({ name: 'country', required: true, autocomplete: true }),
    ]);
    expect(findStoreCountryChoices('united st', 'en')[0]).toEqual({
      name: 'United States (US)',
      value: 'US',
    });
    expect(findStoreCountryChoices('almanya', 'tr')).toContainEqual({
      name: 'Almanya (DE)',
      value: 'DE',
    });
    expect(findStoreCountryChoices('', 'en')).toHaveLength(25);
  });

  it('responds to store-country autocomplete without an external request', async () => {
    const interaction = {
      commandName: 'setup',
      locale: 'en-US',
      options: { getFocused: vi.fn().mockReturnValue({ name: 'store-country', value: 'jap' }) },
      respond: vi.fn().mockResolvedValue(undefined),
    };

    await handleStoreCountryAutocomplete(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith(expect.arrayContaining([
      { name: 'Japan (JP)', value: 'JP' },
    ]));
  });

  it('changes the configured Steam Store country through /region', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      locale: 'en-US',
      options: { getString: vi.fn().mockReturnValue('DE') },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      get: vi.fn().mockReturnValue({
        language: 'en', storeCountryCode: 'US', configVersion: 1,
      }),
      setStoreCountry: vi.fn().mockResolvedValue({
        language: 'en', storeCountryCode: 'DE', configVersion: 2,
      }),
    };

    await handleRegion(interaction as never, service as never);

    expect(service.setStoreCountry).toHaveBeenCalledWith('discord-user', 'DE');
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0])).toContain('Germany (DE)');
  });

  it('explains an inaccessible wishlist after a manual check', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const checkService = {
      check: vi.fn().mockResolvedValue({
        status: 'unavailable',
        errorCode: 'STEAM_WISHLIST_INACCESSIBLE',
      }),
    };
    const statusService = {
      get: vi.fn().mockReturnValue({
        config: { language: 'en' },
        checkState: null,
      }),
    };
    const notificationService = { deliverPending: vi.fn() };

    await handleCheck(
      interaction as never,
      checkService as never,
      statusService as never,
      notificationService as never,
    );

    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('Game details public');
    expect(notificationService.deliverPending).not.toHaveBeenCalled();
  });

  it('checks a disabled user manually without delivering queued notifications', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const checkService = {
      check: vi.fn().mockResolvedValue({
        status: 'success',
        checkedCount: 2,
        notificationCandidates: [{ appId: 10 }],
        failedItems: [],
        unknownPriceCount: 0,
      }),
    };
    const notificationService = { deliverPending: vi.fn() };

    await handleCheck(
      interaction as never,
      checkService as never,
      { get: vi.fn().mockReturnValue({
        config: { language: 'en', enabled: false },
        checkState: null,
      }) } as never,
      notificationService as never,
    );

    expect(checkService.check).toHaveBeenCalledWith('discord-user');
    expect(notificationService.deliverPending).not.toHaveBeenCalled();
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('No DM was sent because notifications are disabled');
  });

  it('re-reads notification state after a manual check before delivering DMs', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const statusService = {
      get: vi.fn()
        .mockReturnValueOnce({ config: { language: 'en', enabled: true } })
        .mockReturnValueOnce({ config: { language: 'en', enabled: false } }),
    };
    const notificationService = { deliverPending: vi.fn() };

    await handleCheck(
      interaction as never,
      { check: vi.fn().mockResolvedValue({
        status: 'success',
        checkedCount: 1,
        notificationCandidates: [],
        failedItems: [],
        unknownPriceCount: 0,
      }) } as never,
      statusService as never,
      notificationService as never,
    );

    expect(statusService.get).toHaveBeenCalledTimes(2);
    expect(notificationService.deliverPending).not.toHaveBeenCalled();
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('notifications are disabled');
  });

  it('rejects setup when Steam reports an inaccessible wishlist', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'language') return 'en';
          if (name === 'store-country') return 'US';
          return '76561198000000000';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockRejectedValue(
        new SteamWishlistError('STEAM_WISHLIST_INACCESSIBLE', 'private wishlist'),
      ),
    };

    await handleSetup(interaction as never, service as never);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0]))
      .toContain('Game details public');
  });

  it.each([
    ['tr', 'Steam profilin doğrulandı'],
    ['en', 'Steam profile was verified'],
  ] as const)('confirms a verified setup in %s', async (language, expectedText) => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'language') return language;
          if (name === 'store-country') return 'US';
          return 'steamcommunity.com/id/example-name';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockResolvedValue({
        config: { language },
        summary: { status: 'sent', saleCount: 2 },
      }),
    };

    await handleSetup(interaction as never, service as never);

    expect(service.configure).toHaveBeenCalledWith(
      'discord-user',
      'steamcommunity.com/id/example-name',
      language,
      'US',
    );
    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0])).toContain(expectedText);
  });

  it.each([
    ['steam-unavailable', 'Steam prices are currently unavailable'],
    ['persistence-error', 'Steam prices are currently unavailable'],
    ['dm-transient-failed', 'welcome DM could not be sent'],
  ] as const)('keeps setup successful when the initial summary result is %s', async (
    status,
    expectedText,
  ) => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'language') return 'en';
          if (name === 'store-country') return 'US';
          return '76561198000000000';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleSetup(
      interaction as never,
      {
        configure: vi.fn().mockResolvedValue({
          config: { language: 'en' },
          summary: { status },
        }),
      } as never,
    );

    expect(componentText(interaction.editReply.mock.calls.at(-1)?.[0])).toContain(expectedText);
    expect(componentText(interaction.editReply.mock.calls[0]?.[0]))
      .toContain('wishlist notifications are configured');
  });

  it('accepts the legacy steamid64 payload while global command changes propagate', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'steam-profile') return null;
          if (name === 'steamid64') return '76561198000000000';
          if (name === 'store-country') return null;
          return 'en';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockResolvedValue({
        config: { language: 'en' },
        summary: { status: 'sent', saleCount: 0 },
      }),
    };

    await handleSetup(interaction as never, service as never);

    expect(service.configure).toHaveBeenCalledWith(
      'discord-user',
      '76561198000000000',
      'en',
      undefined,
    );
  });

  it.each([
    [
      'STEAM_PROFILE_INVALID',
      'Invalid Steam profile input',
      'Enter a valid SteamID64',
    ],
    [
      'STEAM_VANITY_NOT_FOUND',
      'Vanity not found',
      'vanity profile was not found',
    ],
    [
      'STEAM_VANITY_UNAVAILABLE',
      'technical endpoint detail secret-api-key',
      'cannot be resolved right now',
    ],
    [
      'STEAM_WEB_API_KEY_MISSING',
      'secret-api-key is absent',
      'not configured right now',
    ],
  ] as const)('localizes safe setup identity error %s', async (code, detail, expectedText) => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'language') return 'en';
          if (name === 'store-country') return 'US';
          return 'example-name';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleSetup(
      interaction as never,
      {
        configure: vi.fn().mockRejectedValue(new SteamIdentityError(code, detail)),
      } as never,
    );

    const content = componentText(interaction.editReply.mock.calls[0]?.[0]);
    expect(content).toContain(expectedText);
    expect(content).not.toContain('secret-api-key');
    expect(content).not.toContain('endpoint');
  });

  it('sends a test notification only to the invoking user in the configured language', async () => {
    const interaction = {
      user: { id: 'invoking-user' },
      locale: 'en-US',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const userConfigurationService = {
      get: vi.fn().mockReturnValue({ language: 'tr' }),
    };
    const testNotificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleTestNotification(
      interaction as never,
      userConfigurationService as never,
      testNotificationService as never,
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(testNotificationService.send).toHaveBeenCalledWith('invoking-user', 'tr', 'TR');
    expect(componentText(interaction.editReply.mock.calls[0]?.[0])).toContain('DM’i gönderildi');
  });

  it('uses the Discord locale when the user has no saved configuration', async () => {
    const interaction = {
      user: { id: 'invoking-user' },
      locale: 'en-GB',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const testNotificationService = { send: vi.fn().mockResolvedValue(undefined) };

    await handleTestNotification(
      interaction as never,
      { get: vi.fn().mockReturnValue(null) } as never,
      testNotificationService as never,
    );

    expect(testNotificationService.send).toHaveBeenCalledWith('invoking-user', 'en', 'TR');
    expect(componentText(interaction.editReply.mock.calls[0]?.[0])).toContain('Test DM sent');
  });

  it('hides technical Discord errors behind an understandable localized result', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const interaction = {
      user: { id: 'invoking-user' },
      locale: 'tr',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const technicalMessage = 'Discord API 50007: secret diagnostic';

    try {
      await handleTestNotification(
        interaction as never,
        { get: vi.fn().mockReturnValue(null) } as never,
        { send: vi.fn().mockRejectedValue(new Error(technicalMessage)) } as never,
      );
    } finally {
      errorLog.mockRestore();
    }

    const reply = componentText(interaction.editReply.mock.calls[0]?.[0]);
    expect(reply).toContain('geçici bir Discord sorunu');
    expect(reply).not.toContain(technicalMessage);
  });
});
