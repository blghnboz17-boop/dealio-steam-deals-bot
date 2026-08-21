import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

describe('database migration', () => {
  it('preserves version 1 state and retryable notifications', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-bot-migration-'));
    const databasePath = join(directory, 'wishlist.db');

    try {
      const legacy = new DatabaseSync(databasePath);
      legacy.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE user_config (
          discord_user_id TEXT PRIMARY KEY NOT NULL,
          steam_id64 TEXT NOT NULL,
          language TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE wishlist_item_state (
          discord_user_id TEXT NOT NULL,
          app_id INTEGER NOT NULL,
          on_sale INTEGER NOT NULL,
          sale_key TEXT,
          currency TEXT,
          normal_price_minor INTEGER,
          final_price_minor INTEGER,
          discount_percent INTEGER,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (discord_user_id, app_id)
        );
        CREATE TABLE notification_log (
          discord_user_id TEXT NOT NULL,
          app_id INTEGER NOT NULL,
          sale_key TEXT NOT NULL,
          game_name TEXT NOT NULL,
          currency TEXT NOT NULL,
          normal_price_minor INTEGER NOT NULL,
          final_price_minor INTEGER NOT NULL,
          discount_percent INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_attempt_at TEXT,
          last_error TEXT,
          PRIMARY KEY (discord_user_id, app_id, sale_key)
        );
        PRAGMA user_version = 1;
      `);
      legacy.prepare(
        `INSERT INTO user_config
          (discord_user_id, steam_id64, language, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'discord-user',
        '76561198000000000',
        'tr',
        1,
        '2026-08-20T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z',
      );
      legacy.prepare(
        `INSERT INTO wishlist_item_state
          (discord_user_id, app_id, on_sale, sale_key, currency,
           normal_price_minor, final_price_minor, discount_percent, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'discord-user', 10, 1, 'TRY:1000:750:25', 'TRY', 1_000, 750, 25,
        '2026-08-21T00:02:00.000Z',
      );
      legacy.prepare(
        `INSERT INTO notification_log
          (discord_user_id, app_id, sale_key, game_name, currency,
           normal_price_minor, final_price_minor, discount_percent,
           status, created_at, last_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'discord-user', 10, 'TRY:1000:750:25', 'Legacy Game', 'TRY',
        1_000, 750, 25, 'failed', '2026-08-21T00:02:00.000Z',
        '2026-08-21T00:03:00.000Z', 'DM blocked',
      );
      legacy.close();

      const database = createDatabase(databasePath);
      const userRepository = new UserConfigRepository(database);
      const stateRepository = new WishlistStateRepository(database);
      const config = userRepository.findByDiscordUserId('discord-user');

      expect(config).toMatchObject({
        steamId64: '76561198000000000',
        configVersion: 1,
      });
      if (!config) {
        throw new Error('Expected migrated user configuration');
      }

      const state = stateRepository.findByDiscordUserAndAppId('discord-user', 10, 1);
      const candidates = stateRepository.findRetryableNotificationCandidates(
        config,
        '2026-08-21T00:04:00.000Z',
      );
      expect(state).toMatchObject({
        steamId64: '76561198000000000',
        configVersion: 1,
        onSale: true,
      });
      expect(state?.saleEpisodeId).toBeTruthy();
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        gameName: 'Legacy Game',
        saleEpisodeId: state?.saleEpisodeId,
      });
      expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(3);
      database.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves version 2 episodes and makes legacy failed delivery retryable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-bot-v2-migration-'));
    const databasePath = join(directory, 'wishlist.db');

    try {
      const legacy = new DatabaseSync(databasePath);
      legacy.exec(`
        CREATE TABLE user_config (
          discord_user_id TEXT PRIMARY KEY NOT NULL,
          steam_id64 TEXT NOT NULL,
          language TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          config_version INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE wishlist_item_state (
          discord_user_id TEXT NOT NULL,
          steam_id64 TEXT NOT NULL,
          config_version INTEGER NOT NULL,
          app_id INTEGER NOT NULL,
          on_sale INTEGER NOT NULL,
          sale_episode_id TEXT,
          sale_started_at TEXT,
          sale_key TEXT,
          currency TEXT,
          normal_price_minor INTEGER,
          final_price_minor INTEGER,
          discount_percent INTEGER,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (discord_user_id, config_version, app_id)
        );
        CREATE TABLE notification_log (
          discord_user_id TEXT NOT NULL,
          steam_id64 TEXT NOT NULL,
          config_version INTEGER NOT NULL,
          app_id INTEGER NOT NULL,
          sale_episode_id TEXT NOT NULL,
          sale_key TEXT NOT NULL,
          game_name TEXT NOT NULL,
          currency TEXT NOT NULL,
          normal_price_minor INTEGER NOT NULL,
          final_price_minor INTEGER NOT NULL,
          discount_percent INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_attempt_at TEXT,
          last_error TEXT,
          PRIMARY KEY (discord_user_id, config_version, app_id, sale_episode_id)
        );
        PRAGMA user_version = 2;
        INSERT INTO user_config VALUES (
          'discord-user', '76561198000000000', 'en', 1,
          '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 1
        );
        INSERT INTO wishlist_item_state VALUES (
          'discord-user', '76561198000000000', 1, 10, 1,
          'episode-v2', '2026-08-21T00:00:00.000Z', 'TRY:1000:750:25',
          'TRY', 1000, 750, 25, '2026-08-21T00:00:00.000Z'
        );
        INSERT INTO notification_log VALUES (
          'discord-user', '76561198000000000', 1, 10, 'episode-v2',
          'TRY:1000:750:25', 'V2 Game', 'TRY', 1000, 750, 25,
          'failed', '2026-08-21T00:01:00.000Z',
          '2026-08-21T00:01:30.000Z', 'legacy failure'
        );
        INSERT INTO notification_log VALUES (
          'discord-user', '76561198000000000', 1, 20, 'sending-v2',
          'TRY:2000:1000:50', 'Interrupted V2 Game', 'TRY', 2000, 1000, 50,
          'sending', '2026-08-21T00:01:00.000Z',
          '2026-08-21T00:01:30.000Z', NULL
        );
      `);
      legacy.close();

      const database = createDatabase(databasePath);
      try {
        const config = new UserConfigRepository(database).findByDiscordUserId('discord-user');
        if (!config) {
          throw new Error('Expected migrated user configuration');
        }
        const candidates = new WishlistStateRepository(database)
          .findRetryableNotificationCandidates(config, '2026-08-21T00:02:00.000Z');

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
          saleEpisodeId: 'episode-v2',
          attemptCount: 1,
          gameName: 'V2 Game',
        });
        expect(
          database.prepare(
            `SELECT attempt_count
             FROM notification_log
             WHERE discord_user_id = ? AND app_id = ?`,
          ).get('discord-user', 20),
        ).toEqual({ attempt_count: 0 });
        expect(
          (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        ).toBe(3);
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
