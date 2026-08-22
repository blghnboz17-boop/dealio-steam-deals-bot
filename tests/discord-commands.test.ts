import { describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { commands } from '../src/discord/register-commands.js';
import { handleCheck } from '../src/discord/commands/check.js';
import { handleSetup } from '../src/discord/commands/setup.js';
import { handleTestNotification } from '../src/discord/commands/test-notification.js';
import { SteamWishlistError } from '../src/domain/steam.js';
import { SteamIdentityError } from '../src/domain/steam-identity.js';

describe('Discord slash commands', () => {
  it('registers the supported commands', () => {
    expect(commands.map((command) => command.name)).toEqual([
      'setup',
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

  it('requires explicit confirmation for data deletion', () => {
    const command = commands.find((candidate) => candidate.name === 'delete-data');
    expect(command?.toJSON().options).toEqual([
      expect.objectContaining({ name: 'confirm', required: true, type: 5 }),
    ]);
  });

  it('accepts a Steam profile and offers both notification languages', () => {
    const setup = commands.find((command) => command.name === 'setup');
    const options = setup?.toJSON().options ?? [];

    expect(options[0]).toMatchObject({
      name: 'steam-profile',
      required: true,
      description: 'Steam profile ID, link, or vanity name',
      description_localizations: {
        tr: 'Steam profil ID, bağlantı veya vanity adı',
      },
    });
    expect(options[1]).toMatchObject({
      name: 'language',
      required: true,
      choices: [
        { name: 'Türkçe', value: 'tr' },
        { name: 'English', value: 'en' },
      ],
    });
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

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Game details public'),
    });
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No DM was sent because notifications are disabled'),
    });
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('notifications are disabled'),
    });
  });

  it('rejects setup when Steam reports an inaccessible wishlist', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => name === 'language' ? 'en' : '76561198000000000'),
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
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Game details public'),
    });
  });

  it.each([
    ['tr', 'Steam profilin doğrulandı'],
    ['en', 'Steam profile was verified'],
  ] as const)('confirms a verified setup in %s', async (language, expectedText) => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) =>
          name === 'language' ? language : 'steamcommunity.com/id/example-name'
        ),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockResolvedValue({ language }),
    };

    await handleSetup(interaction as never, service as never);

    expect(service.configure).toHaveBeenCalledWith(
      'discord-user',
      'steamcommunity.com/id/example-name',
      language,
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(expectedText),
    });
  });

  it('accepts the legacy steamid64 payload while global command changes propagate', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'steam-profile') return null;
          if (name === 'steamid64') return '76561198000000000';
          return 'en';
        }),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockResolvedValue({ language: 'en' }),
    };

    await handleSetup(interaction as never, service as never);

    expect(service.configure).toHaveBeenCalledWith(
      'discord-user',
      '76561198000000000',
      'en',
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
        getString: vi.fn((name: string) => name === 'language' ? 'en' : 'example-name'),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    await handleSetup(interaction as never, {
      configure: vi.fn().mockRejectedValue(new SteamIdentityError(code, detail)),
    } as never);

    const content = interaction.editReply.mock.calls[0]?.[0].content;
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
    expect(testNotificationService.send).toHaveBeenCalledWith('invoking-user', 'tr');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('DM olarak gönderildi'),
    });
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

    expect(testNotificationService.send).toHaveBeenCalledWith('invoking-user', 'en');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('sent by DM'),
    });
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

    const reply = interaction.editReply.mock.calls[0]?.[0];
    expect(reply?.content).toContain('geçici bir Discord sorunu');
    expect(reply?.content).not.toContain(technicalMessage);
  });
});
