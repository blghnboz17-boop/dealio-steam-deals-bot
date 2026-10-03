import { describe, expect, it, vi } from 'vitest';
import { StatusService } from '../src/application/status-service.js';
import { handleStatus, parseDiscountPercent } from '../src/discord/commands/status.js';
import { createDatabase } from '../src/persistence/database.js';
import { StatusDashboardRepository } from '../src/persistence/status-dashboard-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';

describe('status dashboard', () => {
  it('validates whole percentages', () => {
    expect(parseDiscountPercent('0')).toBe(0);
    expect(parseDiscountPercent('100')).toBe(100);
    expect(parseDiscountPercent('10.5')).toBeNull();
    expect(parseDiscountPercent('101')).toBeNull();
    expect(parseDiscountPercent('')).toBeNull();
  });

  it('responds ephemerally and recommends setup using the Discord locale', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      locale: 'en-GB',
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      getDashboard: vi.fn().mockReturnValue({ status: 'not-configured', language: 'en' }),
    };

    await handleStatus(interaction as never, service as never, {} as never);

    expect(service.getDashboard).toHaveBeenCalledWith('discord-user', 'en');
    expect(JSON.stringify(interaction.editReply.mock.calls)).toContain('/setup');
  });

  it('returns a localized fallback instead of leaking database failures', () => {
    const service = new StatusService(
      { findByDiscordUserId: () => { throw new Error('SQL secret details'); } } as never,
      {} as never,
      {} as never,
    );

    expect(service.getDashboard('discord-user', 'tr')).toEqual({
      status: 'unavailable',
      language: 'tr',
    });

    const configuredService = new StatusService(
      { findByDiscordUserId: () => ({ language: 'en' }) } as never,
      { findByDiscordUserId: () => { throw new Error('SQL secret details'); } } as never,
      {} as never,
    );
    expect(configuredService.getDashboard('discord-user', 'tr')).toEqual({
      status: 'unavailable',
      language: 'en',
    });
  });
});

describe('status notification queue query', () => {
  it('counts current-generation games once without batch-item duplication', () => {
    const database = createDatabase(':memory:');
    const config = new UserConfigRepository(database).upsert(
      'discord-user',
      '76561198000000000',
      'en',
      'US',
      '2026-08-21T00:00:00.000Z',
    );
    const insertState = database.prepare(
      `INSERT INTO wishlist_item_state
        (discord_user_id, steam_id64, config_version, app_id, on_sale,
         sale_episode_id, sale_started_at, sale_key, currency,
         normal_price_minor, final_price_minor, discount_percent, last_seen_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'USD:1000:500:50', 'USD', 1000, 500, 50, ?)`,
    );
    const insertNotification = database.prepare(
      `INSERT INTO notification_log
        (discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
         sale_key, game_name, currency, normal_price_minor, final_price_minor,
         discount_percent, status, attempt_count, next_attempt_at, created_at,
         last_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?, 'USD:1000:500:50', ?, 'USD', 1000, 500, 50,
               ?, 0, NULL, ?, NULL, NULL)`,
    );
    const statuses = [
      ['candidate', 10],
      ['failed', 20],
      ['sending', 30],
      ['sent', 40],
      ['terminal_failed', 50],
    ] as const;
    for (const [status, appId] of statuses) {
      const episode = `episode-${appId}`;
      const timestamp = `2026-08-21T00:${String(appId).padStart(2, '0')}:00.000Z`;
      insertState.run(
        config.discordUserId,
        config.steamId64,
        config.configVersion,
        appId,
        episode,
        timestamp,
        timestamp,
      );
      insertNotification.run(
        config.discordUserId,
        config.steamId64,
        config.configVersion,
        appId,
        episode,
        `Game ${appId}`,
        status,
        timestamp,
      );
    }
    insertNotification.run(
      config.discordUserId,
      config.steamId64,
      config.configVersion,
      60,
      'ended-episode',
      'Ended Game',
      'candidate',
      '2026-08-21T01:00:00.000Z',
    );
    insertNotification.run(
      config.discordUserId,
      '76561198000000099',
      99,
      70,
      'old-account-episode',
      'Old Account Game',
      'sent',
      '2026-08-21T01:01:00.000Z',
    );
    insertNotification.run(
      config.discordUserId,
      config.steamId64,
      config.configVersion,
      10,
      'older-sent-episode',
      'Game 10 older sale',
      'sent',
      '2026-08-20T01:00:00.000Z',
    );

    for (const batchId of ['batch-a', 'batch-b']) {
      database.prepare(
        `INSERT INTO notification_batch
          (batch_id, discord_user_id, steam_id64, config_version, language, status,
           member_count, created_at, first_created_at, first_app_id,
           first_sale_episode_id, last_attempt_at)
         VALUES (?, ?, ?, ?, 'en', 'sending', 1, ?, ?, 10, 'episode-10', ?)`,
      ).run(
        batchId,
        config.discordUserId,
        config.steamId64,
        config.configVersion,
        '2026-08-21T02:00:00.000Z',
        '2026-08-21T00:10:00.000Z',
        '2026-08-21T02:00:00.000Z',
      );
      database.prepare(
        `INSERT INTO notification_batch_item
          (batch_id, position, discord_user_id, config_version, app_id, sale_episode_id)
         VALUES (?, 0, ?, ?, 10, 'episode-10')`,
      ).run(batchId, config.discordUserId, config.configVersion);
    }

    try {
      expect(new StatusDashboardRepository(database).findNotificationQueueCounts(config)).toEqual({
        pending: 1,
        retry: 1,
        sending: 1,
        sent: 2,
        terminalFailed: 1,
        expired: 1,
      });
      expect(new StatusDashboardRepository(database).findLatestPriceCurrencies(config))
        .toEqual(['USD']);
    } finally {
      database.close();
    }
  });
});
