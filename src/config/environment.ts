export interface EnvironmentConfig {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordGuildId?: string;
  readonly databasePath: string;
  readonly pollIntervalHours: number;
  readonly notificationRetryIntervalSeconds: number;
  readonly steamWebApiKey?: string;
}

const defaultDatabasePath = './data/wishlist.db';
const defaultPollIntervalHours = 6;
const defaultNotificationRetryIntervalSeconds = 60;
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

function boundedInteger(
  value: string,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = boundedNumber(value, key, minimum, maximum);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Environment variable ${key} must be a whole number`);
  }
  return parsed;
}

export function loadEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const discordClientId = requiredValue(environment, 'DISCORD_CLIENT_ID');
  const discordGuildId = environment.DISCORD_GUILD_ID?.trim() || undefined;
  const steamWebApiKey = environment.STEAM_WEB_API_KEY?.trim() || undefined;

  if (!/^\d+$/.test(discordClientId)) {
    throw new Error('Environment variable DISCORD_CLIENT_ID must be numeric');
  }

  if (discordGuildId !== undefined && !/^\d+$/.test(discordGuildId)) {
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
  const notificationRetryIntervalSeconds = environment.NOTIFICATION_RETRY_INTERVAL_SECONDS
    ? boundedInteger(
        environment.NOTIFICATION_RETRY_INTERVAL_SECONDS,
        'NOTIFICATION_RETRY_INTERVAL_SECONDS',
        1,
        3_600,
      )
    : defaultNotificationRetryIntervalSeconds;

  return {
    discordToken: requiredValue(environment, 'DISCORD_TOKEN'),
    discordClientId,
    ...(discordGuildId ? { discordGuildId } : {}),
    databasePath,
    pollIntervalHours,
    notificationRetryIntervalSeconds,
    ...(steamWebApiKey ? { steamWebApiKey } : {}),
  };
}
