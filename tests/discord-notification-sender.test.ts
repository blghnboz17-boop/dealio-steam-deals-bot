import { describe, expect, it, vi } from 'vitest';
import { DiscordNotificationSender } from '../src/discord/notification-sender.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';

const candidate: NotificationCandidate = {
  discordUserId: 'discord-user',
  steamId64: '76561198000000000',
  configVersion: 1,
  appId: 10,
  gameName: 'Test Game',
  saleEpisodeId: 'episode-1',
  saleKey: 'TRY:1000:500:50',
  currency: 'TRY',
  normalPriceMinor: 1_000,
  finalPriceMinor: 500,
  discountPercent: 50,
  attemptCount: 0,
  createdAt: '2026-08-21T00:00:00.000Z',
};

describe('DiscordNotificationSender', () => {
  it('fetches the Discord user through the current client and sends a DM', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn().mockResolvedValue({ send });
    const client = { users: { fetch } } as never;
    const sender = new DiscordNotificationSender(client);

    await sender.send(candidate, 'en');

    expect(fetch).toHaveBeenCalledWith('discord-user');
    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining('Test Game'),
      allowedMentions: { parse: [] },
    });
  });

  it('propagates a Discord DM failure to the application service', async () => {
    const send = vi.fn().mockRejectedValue(new Error('DM blocked'));
    const fetch = vi.fn().mockResolvedValue({ send });
    const sender = new DiscordNotificationSender({ users: { fetch } } as never);

    await expect(sender.send(candidate, 'tr')).rejects.toThrow('DM blocked');
  });
});
