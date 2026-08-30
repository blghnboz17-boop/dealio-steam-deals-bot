// allow: SIZE_OK — Observation transitions, notification eligibility, and candidate creation form one atomic SQLite state machine.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type {
  NotificationCandidate,
  WishlistItemState,
  WishlistObservation,
  WishlistObservationStatus,
} from '../domain/wishlist-state.js';
import {
  integerValue,
  stateColumns,
  toState,
  type WishlistItemStateRow,
  type WishlistScope,
} from './wishlist-state-codecs.js';

export interface RecordObservationOptions {
  readonly baseline?: boolean;
}

export interface ObservationResult {
  readonly firstObservation: boolean;
  readonly notificationCandidate: NotificationCandidate | null;
}

export class WishlistObservationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public runInImmediateTransaction<T>(operation: () => T): T {
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) {
      this.database.exec('BEGIN IMMEDIATE');
    }
    try {
      const result = operation();
      if (ownsTransaction) {
        this.database.exec('COMMIT');
      }
      return result;
    } catch (error: unknown) {
      if (ownsTransaction && this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  public findByDiscordUserAndAppId(
    discordUserId: string,
    appId: number,
    configVersion?: number,
  ): WishlistItemState | null {
    const row = configVersion === undefined
      ? this.database
          .prepare(
            `SELECT ${stateColumns}
             FROM wishlist_item_state
             WHERE discord_user_id = ? AND app_id = ?
             ORDER BY config_version DESC
             LIMIT 1`,
          )
          .get(discordUserId, appId)
      : this.database
          .prepare(
            `SELECT ${stateColumns}
             FROM wishlist_item_state
             WHERE discord_user_id = ? AND config_version = ? AND app_id = ?`,
          )
          .get(discordUserId, configVersion, appId);

    return row ? toState(row as unknown as WishlistItemStateRow) : null;
  }

  public countNotificationCandidates(discordUserId: string, configVersion?: number): number {
    const row = configVersion === undefined
      ? this.database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM notification_log
             WHERE discord_user_id = ? AND status = 'candidate'`,
          )
          .get(discordUserId)
      : this.database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM notification_log
             WHERE discord_user_id = ? AND config_version = ? AND status = 'candidate'`,
          )
          .get(discordUserId, configVersion);

    return integerValue((row as { count: SQLOutputValue }).count, 'count');
  }

  public markMissingItemsInactive(
    scope: WishlistScope,
    seenAppIds: readonly number[],
    observedAt: string,
  ): number {
    const uniqueAppIds = [...new Set(seenAppIds)];
    const exclusion = uniqueAppIds.length > 0
      ? `AND app_id NOT IN (${uniqueAppIds.map(() => '?').join(', ')})`
      : '';
    const result = this.database
      .prepare(
        `UPDATE wishlist_item_state
         SET on_sale = 0,
             sale_episode_id = NULL,
             sale_started_at = NULL,
             sale_key = NULL,
              last_seen_at = ?,
              observation_status = 'missing'
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           ${exclusion}`,
      )
      .run(
        observedAt,
        scope.discordUserId,
        scope.steamId64,
        scope.configVersion,
        ...uniqueAppIds,
      );

    return Number(result.changes);
  }

  public markObservationStatus(
    scope: WishlistScope,
    appIds: readonly number[],
    status: Exclude<WishlistObservationStatus, 'known' | 'missing'>,
    observedAt: string,
  ): number {
    const uniqueAppIds = [...new Set(appIds)];
    if (uniqueAppIds.length === 0) {
      return 0;
    }
    const placeholders = uniqueAppIds.map(() => '?').join(', ');
    const result = this.database.prepare(
      `UPDATE wishlist_item_state
       SET observation_status = ?, last_seen_at = ?
       WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
         AND app_id IN (${placeholders})`,
    ).run(
      status,
      observedAt,
      scope.discordUserId,
      scope.steamId64,
      scope.configVersion,
      ...uniqueAppIds,
    );
    return Number(result.changes);
  }

  public recordObservation(
    scope: WishlistScope,
    observation: WishlistObservation,
    options: RecordObservationOptions = {},
  ): ObservationResult {
    const { item, saleKey, observedAt } = observation;
    const price = item.price;
    let notificationCandidate: NotificationCandidate | null = null;

    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) {
      this.database.exec('BEGIN IMMEDIATE');
    }

    try {
      const existing = this.findByDiscordUserAndAppId(
        scope.discordUserId,
        item.appId,
        scope.configVersion,
      );
      const isFirstObservation = existing === null;
      const continuingSale = existing?.onSale === true && item.onSale === true;
      const existingEligibility = existing === null
        ? false
        : this.findNotificationEligibility(scope, item.appId);
      const notificationEligible = options.baseline
        ? false
        : isFirstObservation
          ? false
          : continuingSale
            ? existingEligibility
            : item.onSale === true;
      const saleEpisodeId = item.onSale
        ? continuingSale
          ? existing.saleEpisodeId ?? randomUUID()
          : randomUUID()
        : null;
      const saleStartedAt = item.onSale
        ? continuingSale
          ? existing.saleStartedAt ?? observedAt
          : observedAt
        : null;

      this.database
        .prepare(
           `INSERT INTO wishlist_item_state
             (discord_user_id, steam_id64, config_version, store_country_code, app_id, on_sale,
               sale_episode_id, sale_started_at, sale_key, currency,
               normal_price_minor, final_price_minor, discount_percent, last_seen_at,
                notification_eligible, observation_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'known')
           ON CONFLICT(discord_user_id, config_version, app_id) DO UPDATE SET
              steam_id64 = excluded.steam_id64,
              store_country_code = excluded.store_country_code,
              on_sale = excluded.on_sale,
             sale_episode_id = excluded.sale_episode_id,
             sale_started_at = excluded.sale_started_at,
             sale_key = excluded.sale_key,
             currency = excluded.currency,
             normal_price_minor = excluded.normal_price_minor,
             final_price_minor = excluded.final_price_minor,
             discount_percent = excluded.discount_percent,
              last_seen_at = excluded.last_seen_at,
               notification_eligible = excluded.notification_eligible,
               observation_status = 'known'`,
        )
        .run(
          scope.discordUserId,
          scope.steamId64,
          scope.configVersion,
          scope.storeCountryCode,
          item.appId,
          item.onSale ? 1 : 0,
          saleEpisodeId,
          saleStartedAt,
          saleKey,
          price?.currency ?? null,
          price?.initialMinor ?? null,
          price?.finalMinor ?? null,
          price?.discountPercent ?? null,
          observedAt,
          notificationEligible ? 1 : 0,
        );

      if (
        !options.baseline &&
        notificationEligible &&
        item.onSale === true &&
        saleEpisodeId !== null &&
        saleKey !== null &&
        price !== null &&
        price.currency !== null &&
        price.discountPercent > 0 &&
        price.finalMinor < price.initialMinor
      ) {
        const notificationExists = this.database
          .prepare(
            `SELECT 1
             FROM notification_log
             WHERE discord_user_id = ? AND config_version = ?
               AND app_id = ? AND sale_episode_id = ?`,
          )
          .get(
            scope.discordUserId,
            scope.configVersion,
            item.appId,
            saleEpisodeId,
          ) !== undefined;
        const meetsThreshold = price.discountPercent >= this.findEffectiveMinimumDiscount(
          scope,
          item.appId,
        );
        if (notificationExists || meetsThreshold) {
          const result = this.database
            .prepare(
             `INSERT INTO notification_log
                  (discord_user_id, steam_id64, config_version, store_country_code,
                   app_id, sale_episode_id,
                    sale_key, game_name, currency, normal_price_minor,
                    final_price_minor, discount_percent, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(discord_user_id, config_version, app_id, sale_episode_id)
                 DO UPDATE SET
                   steam_id64 = excluded.steam_id64,
                   store_country_code = excluded.store_country_code,
                   sale_key = excluded.sale_key,
                   game_name = excluded.game_name,
                   currency = excluded.currency,
                   normal_price_minor = excluded.normal_price_minor,
                   final_price_minor = excluded.final_price_minor,
                   discount_percent = excluded.discount_percent
                 WHERE notification_log.status IN ('candidate', 'failed')`,
            )
            .run(
              scope.discordUserId,
              scope.steamId64,
              scope.configVersion,
              scope.storeCountryCode,
              item.appId,
              saleEpisodeId,
              saleKey,
              item.name,
              price.currency,
              price.initialMinor,
              price.finalMinor,
              price.discountPercent,
              observedAt,
            );

          if (!notificationExists && Number(result.changes) > 0) {
            notificationCandidate = {
              discordUserId: scope.discordUserId,
              steamId64: scope.steamId64,
              configVersion: scope.configVersion,
              storeCountryCode: scope.storeCountryCode,
              appId: item.appId,
              saleEpisodeId,
              gameName: item.name,
              saleKey,
              currency: price.currency,
              normalPriceMinor: price.initialMinor,
              finalPriceMinor: price.finalMinor,
              discountPercent: price.discountPercent,
              attemptCount: 0,
              createdAt: observedAt,
            };
          }
        }
      }

      if (ownsTransaction) {
        this.database.exec('COMMIT');
      }
      return { firstObservation: isFirstObservation, notificationCandidate };
    } catch (error: unknown) {
      if (ownsTransaction && this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  private findNotificationEligibility(scope: WishlistScope, appId: number): boolean {
    const row = this.database.prepare(
      `SELECT notification_eligible
       FROM wishlist_item_state
       WHERE discord_user_id = ? AND config_version = ? AND app_id = ?`,
    ).get(scope.discordUserId, scope.configVersion, appId) as
      | { notification_eligible: SQLOutputValue }
      | undefined;
    if (!row || (row.notification_eligible !== 0 && row.notification_eligible !== 1)) {
      throw new Error('Invalid notification_eligible value in wishlist state');
    }
    return row.notification_eligible === 1;
  }

  private findEffectiveMinimumDiscount(scope: WishlistScope, appId: number): number {
    const row = this.database.prepare(
      `SELECT COALESCE(threshold.minimum_discount_percent, config.minimum_discount_percent)
         AS minimum_discount_percent
       FROM user_config AS config
       LEFT JOIN game_discount_threshold AS threshold
         ON threshold.discord_user_id = config.discord_user_id
        AND threshold.config_version = config.config_version
        AND threshold.app_id = ?
       WHERE config.discord_user_id = ? AND config.config_version = ?`,
    ).get(appId, scope.discordUserId, scope.configVersion) as
      | { minimum_discount_percent: SQLOutputValue }
      | undefined;
    const value = row?.minimum_discount_percent;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) {
      throw new Error('Invalid effective minimum discount threshold');
    }
    return value;
  }
}
