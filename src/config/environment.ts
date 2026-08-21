export interface EnvironmentConfig {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordGuildId: string;
  readonly databasePath: string;
  readonly pollIntervalHours: number;
}

const defaultDatabasePath = './data/wishlist.db';
const defaultPollIntervalHours = 6;
export const minPollIntervalHours = 0.25;
export const maxPollIntervalHours = 24 * 7;

function requiredValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function boundedNumber(
  value: string,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Environment variable ${key} must be between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

export function loadEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const discordClientId = requiredValue(environment, 'DISCORD_CLIENT_ID');
  const discordGuildId = requiredValue(environment, 'DISCORD_GUILD_ID');

  if (!/^\d+$/.test(discordClientId)) {
    throw new Error('Environment variable DISCORD_CLIENT_ID must be numeric');
  }

  if (!/^\d+$/.test(discordGuildId)) {
    throw new Error('Environment variable DISCORD_GUILD_ID must be numeric');
  }

  const databasePath = environment.DATABASE_PATH?.trim() || defaultDatabasePath;
  const pollIntervalHours = environment.POLL_INTERVAL_HOURS
    ? boundedNumber(
        environment.POLL_INTERVAL_HOURS,
        'POLL_INTERVAL_HOURS',
        minPollIntervalHours,
        maxPollIntervalHours,
      )
    : defaultPollIntervalHours;

  return {
    discordToken: requiredValue(environment, 'DISCORD_TOKEN'),
    discordClientId,
    discordGuildId,
    databasePath,
    pollIntervalHours,
  };
}
