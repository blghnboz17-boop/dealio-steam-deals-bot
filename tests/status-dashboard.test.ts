import { ButtonStyle, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { StatusService, type StatusDashboardResult } from '../src/application/status-service.js';
import {
  buildStatusDashboardEmbed,
  buildStatusComponents,
  canUseStatusComponent,
  handleStatus,
  statusEmbedColors,
} from '../src/discord/commands/status.js';
import { createDatabase } from '../src/persistence/database.js';
import { StatusDashboardRepository } from '../src/persistence/status-dashboard-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';

const queue = {
  pending: 1,
  retry: 2,
  sending: 3,
  sent: 4,
  terminalFailed: 5,
  expired: 6,
};

function readyResult(
  language: 'tr' | 'en' = 'en',
): Extract<StatusDashboardResult, { status: 'ready' }> {
  return {
    status: 'ready',
    language,
    config: {
      discordUserId: 'discord-user',
      configurationId: 'configuration-id',
      steamId64: '76561198000000000',
      configVersion: 1,
      language,
      storeCountryCode: 'US',
      enabled: true,
      minimumDiscountPercent: 30,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T01:00:00.000Z',
    },
    checkState: {
      discordUserId: 'discord-user',
      lastStartedAt: '2026-08-21T02:00:00.000Z',
      lastCompletedAt: '2026-08-21T02:01:00.000Z',
      lastStatus: 'success',
      lastErrorCode: null,
      nextScheduledAt: '2026-08-21T08:01:00.000Z',
      lastSuccessCompletedAt: '2026-08-21T02:01:00.000Z',
      lastSuccessCheckedCount: 12,
      lastSuccessOnSaleCount: 3,
      lastSuccessFreeCount: 1,
      lastSuccessUnknownPriceCount: 2,
      lastSuccessFailedItemCount: 1,
    },
    notificationQueue: queue,
    latestPriceCurrencies: ['USD'],
    gameDiscountOverrideCount: 2,
  };
}

describe('status dashboard presentation', () => {
  it('builds a healthy English dashboard with masked account and persisted metrics', () => {
    const embed = buildStatusDashboardEmbed(readyResult(), 'https://cdn.example/bot.png');
    const text = JSON.stringify(embed);

    expect(embed).toMatchObject({
      title: 'Your Steam wishlist dashboard',
      color: statusEmbedColors.healthy,
      thumbnail: { url: 'https://cdn.example/bot.png' },
    });
    expect(embed.fields).toHaveLength(4);
    expect(text).toContain('76561********0000');
    expect(text).toContain('https://steamcommunity.com/profiles/76561198000000000');
    expect(text).toContain('Games processed: **12**');
    expect(text).toContain('On sale: **3**');
    expect(text).toContain('Scheduled for retry: **2**');
    expect(text).toContain('Global minimum discount: **30%**');
    expect(text).toContain('Game-specific rules: **2**');
    expect(text).toContain('Steam Store region: **United States (US)**');
    expect(text).toContain('Latest price currency: **USD**');
    expect(text).toContain('<t:');
    expect(text).toContain(':f> (<t:');
    expect(text).toContain(':R>)');
  });

  it('omits the thumbnail safely when no bot avatar URL is available', () => {
    expect(buildStatusDashboardEmbed(readyResult()).thumbnail).toBeUndefined();
  });

  it('localizes toggle controls and restricts them to the owner session', () => {
    const disable = buildStatusComponents('session-id', 'tr', true);
    const enable = buildStatusComponents('session-id', 'en', false);
    const turkishEnable = buildStatusComponents('session-id', 'tr', false);
    const englishDisable = buildStatusComponents('session-id', 'en', true);

    expect(disable[0]?.components[0]).toMatchObject({
      custom_id: 'status:session-id:disable',
      label: 'Bildirimleri Kapat',
      style: ButtonStyle.Danger,
    });
    expect(enable[0]?.components[0]).toMatchObject({
      custom_id: 'status:session-id:enable',
      label: 'Enable notifications',
      style: ButtonStyle.Success,
    });
    expect(turkishEnable[0]?.components[0]?.label).toBe('Bildirimleri Aç');
    expect(englishDisable[0]?.components[0]?.label).toBe('Disable notifications');
    expect(canUseStatusComponent(
      'status:session-id:disable', 'owner', 'owner', 'session-id',
    )).toBe(true);
    expect(canUseStatusComponent(
      'status:session-id:disable', 'other', 'owner', 'session-id',
    )).toBe(false);
    expect(canUseStatusComponent(
      'status:old-session:disable', 'owner', 'owner', 'session-id',
    )).toBe(false);
  });

  it('localizes Turkish fields and hides technical Steam error codes', () => {
    const result = readyResult('tr');
    const embed = buildStatusDashboardEmbed({
      ...result,
      checkState: {
        ...result.checkState!,
        lastStatus: 'unavailable',
        lastErrorCode: 'STEAM_TIMEOUT',
      },
    });
    const text = JSON.stringify(embed);

    expect(embed.color).toBe(statusEmbedColors.unhealthy);
    expect(text).toContain('Steam wishlist dashboardun');
    expect(text).toContain('Wishlist özeti');
    expect(text).toContain('Steam kullanılamıyor');
    expect(text).not.toContain('STEAM_TIMEOUT');

    const failedEmbed = buildStatusDashboardEmbed({
      ...result,
      checkState: {
        ...result.checkState!,
        lastStatus: 'failed',
        lastErrorCode: 'PERSISTENCE_ERROR',
      },
    });
    expect(failedEmbed.color).toBe(statusEmbedColors.unhealthy);
    expect(JSON.stringify(failedEmbed)).toContain('Başarısız');
    expect(JSON.stringify(failedEmbed)).not.toContain('PERSISTENCE_ERROR');
  });

  it('uses pending and disabled colors and handles invalid timestamps safely', () => {
    const pending = readyResult();
    const pendingEmbed = buildStatusDashboardEmbed({
      ...pending,
      checkState: {
        ...pending.checkState!,
        lastStatus: null,
        lastStartedAt: 'invalid-date',
        lastCompletedAt: null,
        lastSuccessCompletedAt: null,
        lastSuccessCheckedCount: null,
      },
    });
    const disabledEmbed = buildStatusDashboardEmbed({
      ...pending,
      config: { ...pending.config, enabled: false },
    });

    expect(pendingEmbed.color).toBe(statusEmbedColors.pending);
    expect(JSON.stringify(pendingEmbed)).toContain('Not yet available');
    expect(disabledEmbed.color).toBe(statusEmbedColors.disabled);
    expect(JSON.stringify(disabledEmbed)).toContain('Disabled');
  });

  it('responds ephemerally and recommends setup using the Discord locale', async () => {
    const interaction = {
      user: { id: 'discord-user' },
      locale: 'en-GB',
      reply: vi.fn().mockResolvedValue(undefined),
    };
    const service = {
      getDashboard: vi.fn().mockReturnValue({ status: 'not-configured', language: 'en' }),
    };

    await handleStatus(interaction as never, service as never, {} as never);

    expect(service.getDashboard).toHaveBeenCalledWith('discord-user', 'en');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('/setup'),
      flags: MessageFlags.Ephemeral,
    });
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
