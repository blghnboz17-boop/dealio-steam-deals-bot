import { Client, GatewayIntentBits, Options, type ClientOptions } from 'discord.js';

/** Users kept for admin-panel profile lookups; the panel fetches any others. */
const cachedUserLimit = 1_000;

/**
 * Dealio reads servers (telemetry, admin panel) and a few users from the cache.
 * Panels are edited through their interactions and DMs go through REST, so
 * messages, members, emojis, stickers and the rest are never cached: with the
 * Guilds intent they would otherwise grow with every server the bot joins.
 * discord.js does not support limiting the server, channel and role caches.
 */
export const discordCacheOptions: Pick<ClientOptions, 'makeCache' | 'sweepers'> = {
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    ApplicationCommandManager: 0,
    AutoModerationRuleManager: 0,
    BaseGuildEmojiManager: 0,
    DMMessageManager: 0,
    EntitlementManager: 0,
    GuildBanManager: 0,
    GuildEmojiManager: 0,
    GuildForumThreadManager: 0,
    GuildInviteManager: 0,
    // Discord.js resolves the bot's own permissions from its member.
    GuildMemberManager: { maxSize: 0, keepOverLimit: (member) => member.id === member.client.user.id },
    GuildMessageManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    GuildTextThreadManager: 0,
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    UserManager: { maxSize: cachedUserLimit, keepOverLimit: (user) => user.id === user.client.user.id },
    VoiceStateManager: 0,
  }),
  sweepers: Options.DefaultSweeperSettings,
};

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    ...discordCacheOptions,
    rest: {
      timeout: 10_000,
      retries: 0,
      rejectOnRateLimit: () => true,
    },
  });
}
