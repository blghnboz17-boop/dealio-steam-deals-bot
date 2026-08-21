import { describe, expect, it } from 'vitest';
import { loadEnvironment } from '../src/config/environment.js';

const validEnvironment = {
  DISCORD_TOKEN: 'test-token',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '987654321098765432',
};

describe('loadEnvironment', () => {
  it('loads required values and applies defaults', () => {
    expect(loadEnvironment(validEnvironment)).toEqual({
      discordToken: 'test-token',
      discordClientId: '123456789012345678',
      discordGuildId: '987654321098765432',
      databasePath: './data/wishlist.db',
      pollIntervalHours: 6,
    });
  });

  it('stops when a required value is missing', () => {
    const environment = { ...validEnvironment };
    delete environment.DISCORD_GUILD_ID;

    expect(() => loadEnvironment(environment)).toThrow(
      'Missing required environment variable: DISCORD_GUILD_ID',
    );
  });

  it('rejects invalid Discord IDs and polling intervals', () => {
    expect(() => loadEnvironment({ ...validEnvironment, DISCORD_GUILD_ID: 'guild' })).toThrow(
      'Environment variable DISCORD_GUILD_ID must be numeric',
    );
    expect(() =>
      loadEnvironment({ ...validEnvironment, POLL_INTERVAL_HOURS: '0' }),
    ).toThrow('Environment variable POLL_INTERVAL_HOURS must be between 0.25 and 168');
    expect(() =>
      loadEnvironment({ ...validEnvironment, POLL_INTERVAL_HOURS: '1000' }),
    ).toThrow('Environment variable POLL_INTERVAL_HOURS must be between 0.25 and 168');
  });
});
