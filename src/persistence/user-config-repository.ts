import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Language, UserConfig } from '../domain/user-config.js';
import {
  parseStoreCountryCode,
  type StoreCountryCode,
} from '../domain/store-country.js';

interface UserConfigRow {
  discord_user_id: SQLOutputValue;
  configuration_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
  language: SQLOutputValue;
  store_country_code: SQLOutputValue;
  enabled: SQLOutputValue;
  minimum_discount_percent: SQLOutputValue;
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

function percentageValue(value: SQLOutputValue, column: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error(`Invalid ${column} value in user_config`);
  }
  return value;
}

function toUserConfig(row: UserConfigRow): UserConfig {
  const storeCountryCode = parseStoreCountryCode(textValue(
    row.store_country_code,
    'store_country_code',
  ));
  if (!storeCountryCode) {
    throw new Error('Invalid store_country_code value in user_config');
  }

  return {
    discordUserId: textValue(row.discord_user_id, 'discord_user_id'),
    configurationId: textValue(row.configuration_id, 'configuration_id'),
    steamId64: textValue(row.steam_id64, 'steam_id64'),
    configVersion: positiveIntegerValue(row.config_version, 'config_version'),
    language: languageValue(row.language),
    storeCountryCode,
    enabled: row.enabled === 1,
    minimumDiscountPercent: percentageValue(
      row.minimum_discount_percent,
      'minimum_discount_percent',
    ),
    createdAt: textValue(row.created_at, 'created_at'),
    updatedAt: textValue(row.updated_at, 'updated_at'),
  };
}

export class UserConfigRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByDiscordUserId(discordUserId: string): UserConfig | null {
    const row = this.database
      .prepare(
        `SELECT discord_user_id, configuration_id, steam_id64, config_version, language,
                store_country_code, enabled,
                minimum_discount_percent, created_at, updated_at
         FROM user_config
         WHERE discord_user_id = ?`,
      )
      .get(discordUserId) as UserConfigRow | undefined;

    return row ? toUserConfig(row) : null;
  }

  public findEnabled(): UserConfig[] {
    const rows = this.database
      .prepare(
        `SELECT discord_user_id, configuration_id, steam_id64, config_version, language,
                store_country_code, enabled,
                minimum_discount_percent, created_at, updated_at
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
    storeCountryCode: StoreCountryCode,
    now: string,
    options: { readonly forcePricingReset?: boolean } = {},
  ): UserConfig {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const existing = this.findByDiscordUserId(discordUserId);
      const accountChanged = existing !== null && existing.steamId64 !== steamId64;
      const countryChanged = existing !== null
        && existing.storeCountryCode !== storeCountryCode;
      const pricingContextChanged = accountChanged
        || countryChanged
        || options.forcePricingReset === true;

      this.database
        .prepare(
           `INSERT INTO user_config
            (discord_user_id, configuration_id, steam_id64, language, store_country_code,
             enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(discord_user_id) DO UPDATE SET
              steam_id64 = excluded.steam_id64,
              config_version = CASE
                WHEN user_config.steam_id64 <> excluded.steam_id64
                  OR user_config.store_country_code <> excluded.store_country_code
                  OR ? = 1
                  THEN user_config.config_version + 1
                ELSE user_config.config_version
              END,
              language = excluded.language,
              store_country_code = excluded.store_country_code,
              enabled = 1,
              updated_at = excluded.updated_at`,
        )
        .run(
          discordUserId,
          randomUUID(),
          steamId64,
          language,
          storeCountryCode,
          now,
          now,
          options.forcePricingReset ? 1 : 0,
        );

      this.database
        .prepare(
          `INSERT INTO check_state (discord_user_id, next_scheduled_at)
           VALUES (?, (
             SELECT next_scheduled_at
             FROM wishlist_poll_schedule
             WHERE schedule_name = 'wishlist'
           ))
           ON CONFLICT(discord_user_id) DO UPDATE SET
             next_scheduled_at = excluded.next_scheduled_at`,
        )
        .run(discordUserId);

      if (pricingContextChanged && existing) {
        this.resetPricingContext(
          discordUserId,
          existing.configVersion,
          !accountChanged,
        );
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

  public setStoreCountryCode(
    discordUserId: string,
    storeCountryCode: StoreCountryCode,
    now: string,
  ): UserConfig | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.findByDiscordUserId(discordUserId);
      if (!existing) {
        this.database.exec('COMMIT');
        return null;
      }
      if (existing.storeCountryCode === storeCountryCode) {
        this.database.exec('COMMIT');
        return existing;
      }

      const result = this.database.prepare(
        `UPDATE user_config
         SET store_country_code = ?, config_version = config_version + 1, updated_at = ?
         WHERE discord_user_id = ? AND config_version = ?`,
      ).run(storeCountryCode, now, discordUserId, existing.configVersion);
      if (Number(result.changes) !== 1) {
        throw new Error('User store country changed concurrently');
      }

      this.resetPricingContext(discordUserId, existing.configVersion, true);
      const config = this.findByDiscordUserId(discordUserId);
      if (!config) {
        throw new Error('User configuration could not be read after store-country update');
      }
      this.database.exec('COMMIT');
      return config;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public setEnabled(
    discordUserId: string,
    enabled: boolean,
    now: string,
  ): UserConfig | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(
        `UPDATE user_config
         SET enabled = ?, updated_at = ?
         WHERE discord_user_id = ?`,
      ).run(enabled ? 1 : 0, now, discordUserId);
      if (Number(result.changes) === 0) {
        this.database.exec('COMMIT');
        return null;
      }

      this.database.prepare(
        `UPDATE check_state
         SET next_scheduled_at = CASE
           WHEN ? = 1 THEN (
             SELECT next_scheduled_at
             FROM wishlist_poll_schedule
             WHERE schedule_name = 'wishlist'
           )
           ELSE NULL
         END
         WHERE discord_user_id = ?`,
      ).run(enabled ? 1 : 0, discordUserId);

      const config = this.findByDiscordUserId(discordUserId);
      if (!config) {
        throw new Error('User configuration could not be read after enabled-state update');
      }
      this.database.exec('COMMIT');
      return config;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public setMinimumDiscountPercent(
    discordUserId: string,
    minimumDiscountPercent: number,
    now: string,
    expectedConfigurationId?: string,
  ): UserConfig | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(
        `UPDATE user_config
         SET minimum_discount_percent = ?, updated_at = ?
         WHERE discord_user_id = ?
           AND (? IS NULL OR configuration_id = ?)`,
      ).run(
        minimumDiscountPercent,
        now,
        discordUserId,
        expectedConfigurationId ?? null,
        expectedConfigurationId ?? null,
      );
      if (Number(result.changes) === 0) {
        this.database.exec('COMMIT');
        return null;
      }
      const config = this.findByDiscordUserId(discordUserId);
      if (!config) {
        throw new Error('User configuration could not be read after threshold update');
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

  private resetPricingContext(
    discordUserId: string,
    previousConfigVersion: number,
    preserveGameThresholds: boolean,
  ): void {
    this.database.prepare(
      `UPDATE check_state
       SET last_started_at = NULL,
           last_completed_at = NULL,
           last_status = NULL,
           last_error_code = NULL,
           next_scheduled_at = CASE
             WHEN (SELECT enabled FROM user_config WHERE discord_user_id = ?) = 1
             THEN (
               SELECT next_scheduled_at
               FROM wishlist_poll_schedule
               WHERE schedule_name = 'wishlist'
             )
             ELSE NULL
           END,
           last_success_completed_at = NULL,
           last_success_checked_count = NULL,
           last_success_on_sale_count = NULL,
           last_success_free_count = NULL,
           last_success_unknown_price_count = NULL,
           last_success_failed_item_count = NULL
       WHERE discord_user_id = ?`,
    ).run(discordUserId, discordUserId);

    if (preserveGameThresholds) {
      this.database.prepare(
        `INSERT INTO game_discount_threshold
           (discord_user_id, config_version, app_id, minimum_discount_percent, updated_at)
         SELECT discord_user_id, ?, app_id, minimum_discount_percent, updated_at
         FROM game_discount_threshold
         WHERE discord_user_id = ? AND config_version = ?`,
      ).run(previousConfigVersion + 1, discordUserId, previousConfigVersion);
    }

    this.database.prepare(
      `UPDATE notification_batch
       SET status = 'expired', next_attempt_at = NULL,
           last_error = 'Steam pricing context changed'
       WHERE discord_user_id = ?
         AND config_version <> (
           SELECT config_version FROM user_config WHERE discord_user_id = ?
         )
         AND status IN ('failed', 'sending')`,
    ).run(discordUserId, discordUserId);

    this.database.prepare(
      `UPDATE notification_log
       SET status = 'expired', next_attempt_at = NULL,
           last_error = 'Steam pricing context changed'
       WHERE discord_user_id = ?
         AND config_version <> (
           SELECT config_version FROM user_config WHERE discord_user_id = ?
         )
         AND status IN ('candidate', 'failed', 'sending')`,
    ).run(discordUserId, discordUserId);
  }
}
