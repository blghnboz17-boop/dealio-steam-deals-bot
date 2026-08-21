import { Client, GatewayIntentBits } from 'discord.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    rest: {
      timeout: 10_000,
      retries: 0,
      rejectOnRateLimit: () => true,
    },
  });
}
