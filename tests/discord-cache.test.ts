import { Client, GatewayIntentBits, GuildEmojiManager, GuildEmoji, GuildManager, Guild, LimitedCollection, MessageManager, Message } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { discordCacheOptions } from '../src/discord/client.js';

describe('Discord cache limits', () => {
  it('keeps a bounded user cache and no per-server emojis or messages', async () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds], ...discordCacheOptions });
    try {
      expect(client.users.cache).toBeInstanceOf(LimitedCollection);
      expect((client.users.cache as LimitedCollection<string, unknown>).maxSize).toBe(1_000);

      const makeCache = discordCacheOptions.makeCache!;
      const emojis = makeCache(GuildEmojiManager as never, GuildEmoji as never, GuildEmojiManager as never);
      const messages = makeCache(MessageManager as never, Message as never, MessageManager as never);
      expect((emojis as LimitedCollection<string, unknown>).maxSize).toBe(0);
      expect((messages as LimitedCollection<string, unknown>).maxSize).toBe(0);
      // Servers stay fully cached: telemetry and the admin panel read them.
      expect(makeCache(GuildManager as never, Guild as never, GuildManager as never)).not.toBeInstanceOf(LimitedCollection);
    } finally {
      await client.destroy();
    }
  });
});
