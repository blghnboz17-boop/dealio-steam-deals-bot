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
      pollIntervalHours: 0.5,
      notificationRetryIntervalSeconds: 60,
    });
  });

  it('accepts an explicit half-hour polling interval', () => {
    expect(loadEnvironment({
      ...validEnvironment,
      POLL_INTERVAL_HOURS: '0.5',
    }).pollIntervalHours).toBe(0.5);
  });

  it('loads without a guild ID because commands are global', () => {
    const environment = { ...validEnvironment };
    delete environment.DISCORD_GUILD_ID;

    expect(loadEnvironment(environment)).toEqual({
      discordToken: 'test-token',
      discordClientId: '123456789012345678',
      databasePath: './data/wishlist.db',
      pollIntervalHours: 0.5,
      notificationRetryIntervalSeconds: 60,
    });
  });

  it('loads the optional Steam Web API key without requiring it', () => {
    expect(loadEnvironment({
      ...validEnvironment,
      STEAM_WEB_API_KEY: '  optional-steam-key  ',
    })).toMatchObject({ steamWebApiKey: 'optional-steam-key' });

    expect(loadEnvironment({ ...validEnvironment, STEAM_WEB_API_KEY: '   ' }))
      .not.toHaveProperty('steamWebApiKey');
  });

  it('accepts only HTTPS Dealio banner URLs', () => {
    expect(loadEnvironment({
      ...validEnvironment,
      DEALIO_BANNER_URL: 'https://example.com/dealio.png',
    })).toMatchObject({ dealioBannerUrl: 'https://example.com/dealio.png' });
    expect(() => loadEnvironment({
      ...validEnvironment,
      DEALIO_BANNER_URL: 'http://example.com/dealio.png',
    })).toThrow('DEALIO_BANNER_URL must use HTTPS');
    expect(() => loadEnvironment({
      ...validEnvironment,
      DEALIO_BANNER_URL: 'not-a-url',
    })).toThrow('DEALIO_BANNER_URL must be a valid HTTPS URL');
  });

  it('stops when a required value is missing', () => {
    const environment = { ...validEnvironment };
    delete environment.DISCORD_TOKEN;

    expect(() => loadEnvironment(environment)).toThrow(
      'Missing required environment variable: DISCORD_TOKEN',
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
    expect(() => loadEnvironment({
      ...validEnvironment,
      NOTIFICATION_RETRY_INTERVAL_SECONDS: '0',
    })).toThrow(
      'Environment variable NOTIFICATION_RETRY_INTERVAL_SECONDS must be between 1 and 3600',
    );
    expect(() => loadEnvironment({
      ...validEnvironment,
      NOTIFICATION_RETRY_INTERVAL_SECONDS: '1.5',
    })).toThrow('Environment variable NOTIFICATION_RETRY_INTERVAL_SECONDS must be a whole number');
  });
});
