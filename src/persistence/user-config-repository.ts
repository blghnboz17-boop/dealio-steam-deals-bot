import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Language, UserConfig } from '../domain/user-config.js';

interface UserConfigRow {
  discord_user_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
  language: SQLOutputValue;
  enabled: SQLOutputValue;
  created_at: SQLOutputValue;
  updated_at: SQLOutputValue;
}

function textValue(value: SQLOutputValue, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${column} value in user_config`);
  }

  return value;
}

function languageValue(value: SQLOutputValue): Language {
  const language = textValue(value, 'language');

  if (language !== 'tr' && language !== 'en') {
    throw new Error('Invalid language value in user_config');
  }

  return language;
}

function positiveIntegerValue(value: SQLOutputValue, column: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${column} value in user_config`);
  }

  return value;
}

function toUserConfig(row: UserConfigRow): UserConfig {
  return {
    discordUserId: textValue(row.discord_user_id, 'discord_user_id'),
    steamId64: textValue(row.steam_id64, 'steam_id64'),
    configVersion: positiveIntegerValue(row.config_version, 'config_version'),
    language: languageValue(row.language),
    enabled: row.enabled === 1,
    createdAt: textValue(row.created_at, 'created_at'),
    updatedAt: textValue(row.updated_at, 'updated_at'),
  };
}

export class UserConfigRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByDiscordUserId(discordUserId: string): UserConfig | null {
    const row = this.database
      .prepare(
        `SELECT discord_user_id, steam_id64, config_version, language, enabled, created_at, updated_at
         FROM user_config
         WHERE discord_user_id = ?`,
      )
      .get(discordUserId) as UserConfigRow | undefined;

    return row ? toUserConfig(row) : null;
  }

  public findEnabled(): UserConfig[] {
    const rows = this.database
      .prepare(
        `SELECT discord_user_id, steam_id64, config_version, language, enabled, created_at, updated_at
         FROM user_config
         WHERE enabled = 1
         ORDER BY discord_user_id ASC`,
      )
      .all() as unknown as UserConfigRow[];

    return rows.map(toUserConfig);
  }

  public upsert(
    discordUserId: string,
    steamId64: string,
    language: Language,
    now: string,
  ): UserConfig {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const existing = this.findByDiscordUserId(discordUserId);
      const accountChanged = existing !== null && existing.steamId64 !== steamId64;

      this.database
        .prepare(
          `INSERT INTO user_config
            (discord_user_id, steam_id64, language, enabled, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(discord_user_id) DO UPDATE SET
              steam_id64 = excluded.steam_id64,
              config_version = CASE
                WHEN user_config.steam_id64 <> excluded.steam_id64
                  THEN user_config.config_version + 1
                ELSE user_config.config_version
              END,
              language = excluded.language,
              enabled = 1,
              updated_at = excluded.updated_at`,
        )
        .run(discordUserId, steamId64, language, now, now);

      this.database
        .prepare(
          `INSERT INTO check_state (discord_user_id)
           VALUES (?)
           ON CONFLICT(discord_user_id) DO NOTHING`,
        )
        .run(discordUserId);

      if (accountChanged) {
        this.database
          .prepare(
            `UPDATE check_state
             SET last_started_at = NULL,
                 last_completed_at = NULL,
                 last_status = NULL,
                 last_error_code = NULL,
                 next_scheduled_at = NULL
             WHERE discord_user_id = ?`,
          )
          .run(discordUserId);

        this.database
          .prepare(
            `UPDATE notification_log
             SET status = 'expired',
                 next_attempt_at = NULL,
                 last_error = 'Steam account configuration changed'
             WHERE discord_user_id = ?
               AND config_version <> (
                 SELECT config_version FROM user_config WHERE discord_user_id = ?
               )
               AND status IN ('candidate', 'failed', 'sending')`,
          )
          .run(discordUserId, discordUserId);
      }

      const config = this.findByDiscordUserId(discordUserId);
      if (!config) {
        throw new Error('User configuration could not be read after upsert');
      }

      this.database.exec('COMMIT');
      return config;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public deleteByDiscordUserId(discordUserId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM user_config WHERE discord_user_id = ?')
      .run(discordUserId);

    return Number(result.changes) === 1;
  }
}
