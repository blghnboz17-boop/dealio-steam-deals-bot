import { describe, expect, it, vi } from 'vitest';
import { commands } from '../src/discord/register-commands.js';
import { handleCheck } from '../src/discord/commands/check.js';
import { handleSetup } from '../src/discord/commands/setup.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { SteamWishlistError } from '../src/domain/steam.js';

describe('Discord slash commands', () => {
  it('registers only the first-version commands', () => {
    expect(commands.map((command) => command.name)).toEqual([
      'setup',
      'status',
      'check',
      'delete-data',
    ]);
  });

  it('requires explicit confirmation for data deletion', () => {
    const command = commands.find((candidate) => candidate.name === 'delete-data');
    expect(command?.toJSON().options).toEqual([
      expect.objectContaining({ name: 'confirm', required: true, type: 5 }),
    ]);
  });

  it('requires SteamID64 and offers both notification languages', () => {
    const setup = commands.find((command) => command.name === 'setup');
    const options = setup?.toJSON().options ?? [];

    expect(options[0]).toMatchObject({ name: 'steamid64', required: true });
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

  it('rejects setup when Steam reports an inaccessible wishlist', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      options: {
        getString: vi.fn((name: string) => name === 'language' ? 'en' : '76561198000000000'),
      },
      reply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      configure: vi.fn().mockRejectedValue(
        new SteamWishlistError('STEAM_WISHLIST_INACCESSIBLE', 'private wishlist'),
      ),
    };

    await handleSetup(interaction as never, service as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Game details public'),
      ephemeral: true,
    });
  });

  it('shows the persisted accessibility error in status', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      reply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      get: vi.fn().mockReturnValue({
        config: {
          steamId64: '76561198000000000',
          language: 'en',
          enabled: true,
        },
        checkState: {
          lastCompletedAt: null,
          lastStatus: 'unavailable',
          lastErrorCode: 'STEAM_WISHLIST_INACCESSIBLE',
          nextScheduledAt: null,
        },
      }),
    };

    await handleStatus(interaction as never, service as never);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Access error:'),
      ephemeral: true,
    });
  });
});
