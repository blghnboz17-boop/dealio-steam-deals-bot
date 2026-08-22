import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Language, UserConfig } from '../domain/user-config.js';
import {
  parseStoreCountryCode,
  type StoreCountryCode,
} from '../domain/store-country.js';
import type {
  DurableNotificationBatch,
  NotificationCandidate,
  WishlistItemState,
  WishlistObservation,
  WishlistObservationStatus,
} from '../domain/wishlist-state.js';

type WishlistScope = Pick<
  UserConfig,
  'discordUserId' | 'steamId64' | 'configVersion' | 'storeCountryCode'
>;

interface WishlistItemStateRow {
  discord_user_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
  store_country_code: SQLOutputValue;
  app_id: SQLOutputValue;
  on_sale: SQLOutputValue;
  sale_episode_id: SQLOutputValue;
  sale_started_at: SQLOutputValue;
  sale_key: SQLOutputValue;
  currency: SQLOutputValue;
  normal_price_minor: SQLOutputValue;
  final_price_minor: SQLOutputValue;
  discount_percent: SQLOutputValue;
  last_seen_at: SQLOutputValue;
  observation_status: SQLOutputValue;
}

interface NotificationLogRow {
  discord_user_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
  store_country_code: SQLOutputValue;
  app_id: SQLOutputValue;
  sale_episode_id: SQLOutputValue;
  sale_key: SQLOutputValue;
  game_name: SQLOutputValue;
  currency: SQLOutputValue;
  normal_price_minor: SQLOutputValue;
  final_price_minor: SQLOutputValue;
  discount_percent: SQLOutputValue;
  attempt_count: SQLOutputValue;
  created_at: SQLOutputValue;
}

interface NotificationBatchRow {
  batch_id: SQLOutputValue;
  language: SQLOutputValue;
  attempt_count: SQLOutputValue;
  member_count: SQLOutputValue;
}

interface RecordObservationOptions {
  readonly baseline?: boolean;
}

class BatchClaimConflictError extends Error {}

function textValue(value: SQLOutputValue, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${column} value in wishlist state`);
  }

  return value;
}

function nullableText(value: SQLOutputValue, column: string): string | null {
  return value === null ? null : textValue(value, column);
}

function integerValue(value: SQLOutputValue, column: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid ${column} value in wishlist state`);
  }

  return value;
}

function languageValue(value: SQLOutputValue): Language {
  const language = textValue(value, 'language');
  if (language !== 'tr' && language !== 'en') {
    throw new Error('Invalid language value in notification batch');
  }

  return language;
}

function nullableInteger(value: SQLOutputValue, column: string): number | null {
  return value === null ? null : integerValue(value, column);
}

function storeCountryCodeValue(value: SQLOutputValue): StoreCountryCode {
  const code = parseStoreCountryCode(textValue(value, 'store_country_code'));
  if (!code) {
    throw new Error('Invalid store_country_code value in wishlist state');
  }
  return code;
}

function observationStatusValue(value: SQLOutputValue): WishlistObservationStatus {
  const status = textValue(value, 'observation_status');
  if (!['known', 'unknown', 'error', 'missing'].includes(status)) {
    throw new Error('Invalid observation_status value in wishlist state');
  }
  return status as WishlistObservationStatus;
}

function toState(row: WishlistItemStateRow): WishlistItemState {
  const onSale = integerValue(row.on_sale, 'on_sale');
  if (onSale !== 0 && onSale !== 1) {
    throw new Error('Invalid on_sale value in wishlist state');
  }

  return {
    discordUserId: textValue(row.discord_user_id, 'discord_user_id'),
    steamId64: textValue(row.steam_id64, 'steam_id64'),
    configVersion: integerValue(row.config_version, 'config_version'),
    storeCountryCode: storeCountryCodeValue(row.store_country_code),
    appId: integerValue(row.app_id, 'app_id'),
    onSale: onSale === 1,
    saleEpisodeId: nullableText(row.sale_episode_id, 'sale_episode_id'),
    saleStartedAt: nullableText(row.sale_started_at, 'sale_started_at'),
    saleKey: nullableText(row.sale_key, 'sale_key'),
    currency: nullableText(row.currency, 'currency'),
    normalPriceMinor: nullableInteger(row.normal_price_minor, 'normal_price_minor'),
    finalPriceMinor: nullableInteger(row.final_price_minor, 'final_price_minor'),
    discountPercent: nullableInteger(row.discount_percent, 'discount_percent'),
    lastSeenAt: textValue(row.last_seen_at, 'last_seen_at'),
    observationStatus: observationStatusValue(row.observation_status),
  };
}

function toNotificationCandidate(row: NotificationLogRow): NotificationCandidate {
  return {
    discordUserId: textValue(row.discord_user_id, 'discord_user_id'),
    steamId64: textValue(row.steam_id64, 'steam_id64'),
    configVersion: integerValue(row.config_version, 'config_version'),
    storeCountryCode: storeCountryCodeValue(row.store_country_code),
    appId: integerValue(row.app_id, 'app_id'),
    saleEpisodeId: textValue(row.sale_episode_id, 'sale_episode_id'),
    gameName: textValue(row.game_name, 'game_name'),
    saleKey: textValue(row.sale_key, 'sale_key'),
    currency: textValue(row.currency, 'currency'),
    normalPriceMinor: integerValue(row.normal_price_minor, 'normal_price_minor'),
    finalPriceMinor: integerValue(row.final_price_minor, 'final_price_minor'),
    discountPercent: integerValue(row.discount_percent, 'discount_percent'),
    attemptCount: integerValue(row.attempt_count, 'attempt_count'),
    createdAt: textValue(row.created_at, 'created_at'),
  };
}

export interface ObservationResult {
  readonly firstObservation: boolean;
  readonly notificationCandidate: NotificationCandidate | null;
}

const stateColumns = `discord_user_id, steam_id64, config_version, store_country_code, app_id, on_sale,
  sale_episode_id, sale_started_at, sale_key, currency, normal_price_minor,
  final_price_minor, discount_percent, last_seen_at, observation_status`;

const notificationColumns = `
  notification.discord_user_id AS discord_user_id,
  notification.steam_id64 AS steam_id64,
  notification.config_version AS config_version,
  notification.store_country_code AS store_country_code,
  notification.app_id AS app_id,
  notification.sale_episode_id AS sale_episode_id,
  notification.sale_key AS sale_key,
  notification.game_name AS game_name,
  notification.currency AS currency,
  notification.normal_price_minor AS normal_price_minor,
  notification.final_price_minor AS final_price_minor,
  notification.discount_percent AS discount_percent,
  notification.attempt_count AS attempt_count,
  notification.created_at AS created_at`;

export class WishlistStateRepository {
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

  public recoverStaleSending(scope: WishlistScope, staleBefore: string): number {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const batches = this.database
        .prepare(
          `SELECT batch_id, member_count
           FROM notification_batch
           WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
             AND status = 'sending'
             AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
        )
        .all(
          scope.discordUserId,
          scope.steamId64,
          scope.configVersion,
          staleBefore,
        ) as Array<{ batch_id: SQLOutputValue; member_count: SQLOutputValue }>;
      let recoveredCount = 0;

      for (const row of batches) {
        const batchId = textValue(row.batch_id, 'batch_id');
        const memberCount = integerValue(row.member_count, 'member_count');
        const items = this.database
          .prepare(
            `UPDATE notification_log AS notification
             SET status = 'failed',
                 next_attempt_at = COALESCE(last_attempt_at, ?),
                 last_error = 'Delivery outcome unknown after process interruption; retrying at least once'
             WHERE status = 'sending'
               AND EXISTS (
                 SELECT 1 FROM notification_batch_item AS item
                 WHERE item.batch_id = ?
                   AND item.discord_user_id = notification.discord_user_id
                   AND item.config_version = notification.config_version
                   AND item.app_id = notification.app_id
                   AND item.sale_episode_id = notification.sale_episode_id
               )`,
          )
          .run(staleBefore, batchId);
        if (Number(items.changes) !== memberCount) {
          throw new Error('Could not recover every notification in a stale batch');
        }

        const parent = this.database
          .prepare(
            `UPDATE notification_batch
             SET status = 'failed',
                 next_attempt_at = COALESCE(last_attempt_at, ?),
                 last_error = 'Delivery outcome unknown after process interruption; retrying at least once'
             WHERE batch_id = ? AND status = 'sending'`,
          )
          .run(staleBefore, batchId);
        if (Number(parent.changes) !== 1) {
          throw new Error('Could not recover a stale notification batch');
        }
        recoveredCount += memberCount;
      }

      const legacy = this.database
        .prepare(
          `UPDATE notification_log AS notification
           SET status = 'failed',
               next_attempt_at = COALESCE(last_attempt_at, ?),
               last_error = 'Delivery outcome unknown after process interruption; retrying at least once'
           WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
             AND status = 'sending'
             AND (last_attempt_at IS NULL OR last_attempt_at <= ?)
             AND NOT EXISTS (
               SELECT 1 FROM notification_batch_item AS item
               JOIN notification_batch AS batch ON batch.batch_id = item.batch_id
               WHERE item.discord_user_id = notification.discord_user_id
                 AND item.config_version = notification.config_version
                 AND item.app_id = notification.app_id
                 AND item.sale_episode_id = notification.sale_episode_id
                 AND batch.status IN ('sending', 'failed')
             )`,
        )
        .run(staleBefore, scope.discordUserId, scope.steamId64, scope.configVersion, staleBefore);
      recoveredCount += Number(legacy.changes);

      this.database.exec('COMMIT');
      return recoveredCount;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public expireInactiveNotifications(scope: WishlistScope): number {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const invalidBatches = this.database
        .prepare(
          `SELECT batch.batch_id
           FROM notification_batch AS batch
           WHERE batch.discord_user_id = ?
             AND batch.steam_id64 = ?
             AND batch.config_version = ?
             AND batch.status = 'failed'
             AND EXISTS (
               SELECT 1
               FROM notification_batch_item AS item
               JOIN notification_log AS notification
                 ON notification.discord_user_id = item.discord_user_id
                AND notification.config_version = item.config_version
                AND notification.app_id = item.app_id
                AND notification.sale_episode_id = item.sale_episode_id
               WHERE item.batch_id = batch.batch_id
                 AND NOT EXISTS (
                   SELECT 1 FROM wishlist_item_state AS state
                   WHERE state.discord_user_id = notification.discord_user_id
                     AND state.steam_id64 = notification.steam_id64
                     AND state.config_version = notification.config_version
                      AND state.app_id = notification.app_id
                      AND state.on_sale = 1
                      AND state.sale_episode_id = notification.sale_episode_id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM wishlist_item_state AS deferred_state
                    WHERE deferred_state.discord_user_id = notification.discord_user_id
                      AND deferred_state.steam_id64 = notification.steam_id64
                      AND deferred_state.config_version = notification.config_version
                      AND deferred_state.app_id = notification.app_id
                      AND (
                        deferred_state.on_sale = 1
                        OR deferred_state.observation_status IN ('unknown', 'error')
                      )
                  )
              )`,
        )
        .all(
          scope.discordUserId,
          scope.steamId64,
          scope.configVersion,
        ) as Array<{ batch_id: SQLOutputValue }>;
      let expiredCount = 0;

      for (const row of invalidBatches) {
        const batchId = textValue(row.batch_id, 'batch_id');
        const items = this.database
          .prepare(
            `UPDATE notification_log AS notification
             SET status = 'expired',
                 next_attempt_at = NULL,
                 last_error = 'Sale episode is no longer active'
             WHERE status = 'failed'
               AND EXISTS (
                 SELECT 1 FROM notification_batch_item AS item
                 WHERE item.batch_id = ?
                   AND item.discord_user_id = notification.discord_user_id
                   AND item.config_version = notification.config_version
                   AND item.app_id = notification.app_id
                   AND item.sale_episode_id = notification.sale_episode_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM wishlist_item_state AS state
                 WHERE state.discord_user_id = notification.discord_user_id
                   AND state.steam_id64 = notification.steam_id64
                   AND state.config_version = notification.config_version
                    AND state.app_id = notification.app_id
                    AND state.on_sale = 1
                    AND state.sale_episode_id = notification.sale_episode_id
                )
                AND NOT EXISTS (
                  SELECT 1 FROM wishlist_item_state AS deferred_state
                  WHERE deferred_state.discord_user_id = notification.discord_user_id
                    AND deferred_state.steam_id64 = notification.steam_id64
                    AND deferred_state.config_version = notification.config_version
                    AND deferred_state.app_id = notification.app_id
                    AND (
                      deferred_state.on_sale = 1
                      OR deferred_state.observation_status IN ('unknown', 'error')
                    )
                )`,
          )
          .run(batchId);
        expiredCount += Number(items.changes);
        this.database
          .prepare(
            `UPDATE notification_batch
             SET status = 'expired', next_attempt_at = NULL,
                 last_error = 'Batch retired because a sale episode is no longer active'
             WHERE batch_id = ? AND status = 'failed'`,
          )
          .run(batchId);
      }

      const unbatched = this.database
        .prepare(
          `UPDATE notification_log AS notification
           SET status = 'expired', next_attempt_at = NULL,
               last_error = 'Sale episode is no longer active'
           WHERE notification.discord_user_id = ?
             AND notification.steam_id64 = ?
             AND notification.config_version = ?
             AND notification.status IN ('candidate', 'failed')
             AND NOT EXISTS (
               SELECT 1 FROM notification_batch_item AS item
               JOIN notification_batch AS batch ON batch.batch_id = item.batch_id
               WHERE item.discord_user_id = notification.discord_user_id
                 AND item.config_version = notification.config_version
                 AND item.app_id = notification.app_id
                 AND item.sale_episode_id = notification.sale_episode_id
                 AND batch.status IN ('sending', 'failed')
             )
             AND NOT EXISTS (
               SELECT 1 FROM wishlist_item_state AS state
               WHERE state.discord_user_id = notification.discord_user_id
                 AND state.steam_id64 = notification.steam_id64
                 AND state.config_version = notification.config_version
                AND state.app_id = notification.app_id
                AND state.on_sale = 1
                AND state.sale_episode_id = notification.sale_episode_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM wishlist_item_state AS deferred_state
                WHERE deferred_state.discord_user_id = notification.discord_user_id
                  AND deferred_state.steam_id64 = notification.steam_id64
                  AND deferred_state.config_version = notification.config_version
                  AND deferred_state.app_id = notification.app_id
                  AND (
                    deferred_state.on_sale = 1
                    OR deferred_state.observation_status IN ('unknown', 'error')
                  )
              )`,
        )
        .run(scope.discordUserId, scope.steamId64, scope.configVersion);
      expiredCount += Number(unbatched.changes);

      this.database.exec('COMMIT');
      return expiredCount;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public findRetryableNotificationCandidates(
    scope: WishlistScope,
    now: string,
  ): NotificationCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT ${notificationColumns}
         FROM notification_log AS notification
         JOIN wishlist_item_state AS state
           ON state.discord_user_id = notification.discord_user_id
          AND state.steam_id64 = notification.steam_id64
          AND state.config_version = notification.config_version
          AND state.app_id = notification.app_id
          AND state.sale_episode_id = notification.sale_episode_id
         WHERE notification.discord_user_id = ?
           AND notification.steam_id64 = ?
           AND notification.config_version = ?
            AND (
              notification.status = 'candidate'
              OR (notification.status = 'failed' AND notification.next_attempt_at <= ?)
            )
             AND state.on_sale = 1
             AND state.observation_status = 'known'
            AND NOT EXISTS (
              SELECT 1 FROM notification_batch_item AS item
              JOIN notification_batch AS batch ON batch.batch_id = item.batch_id
              WHERE item.discord_user_id = notification.discord_user_id
                AND item.config_version = notification.config_version
                AND item.app_id = notification.app_id
                AND item.sale_episode_id = notification.sale_episode_id
                AND batch.status IN ('sending', 'failed')
            )
          ORDER BY notification.created_at ASC,
                   notification.app_id ASC,
                   notification.sale_episode_id COLLATE BINARY ASC`,
      )
      .all(
        scope.discordUserId,
        scope.steamId64,
        scope.configVersion,
        now,
      ) as unknown as NotificationLogRow[];

    return rows.map(toNotificationCandidate);
  }

  public findRetryableNotificationBatches(
    scope: WishlistScope,
    now: string,
  ): DurableNotificationBatch[] {
    const rows = this.database
      .prepare(
        `SELECT batch_id, language, attempt_count, member_count
         FROM notification_batch
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
            AND status = 'failed' AND next_attempt_at <= ?
            AND NOT EXISTS (
              SELECT 1
              FROM notification_batch_item AS item
              JOIN notification_log AS notification
                ON notification.discord_user_id = item.discord_user_id
               AND notification.config_version = item.config_version
               AND notification.app_id = item.app_id
               AND notification.sale_episode_id = item.sale_episode_id
              WHERE item.batch_id = notification_batch.batch_id
                AND NOT EXISTS (
                  SELECT 1 FROM wishlist_item_state AS state
                  WHERE state.discord_user_id = notification.discord_user_id
                    AND state.steam_id64 = notification.steam_id64
                    AND state.config_version = notification.config_version
                    AND state.app_id = notification.app_id
                    AND state.on_sale = 1
                    AND state.observation_status = 'known'
                    AND state.sale_episode_id = notification.sale_episode_id
                )
            )
         ORDER BY first_created_at ASC, first_app_id ASC,
                  first_sale_episode_id COLLATE BINARY ASC`,
      )
      .all(
        scope.discordUserId,
        scope.steamId64,
        scope.configVersion,
        now,
      ) as unknown as NotificationBatchRow[];

    return rows.map((row) => this.toDurableBatch(row));
  }

  public createAndClaimNotificationBatch(
    scope: WishlistScope,
    language: Language,
    notifications: readonly [NotificationCandidate, ...NotificationCandidate[]],
    attemptedAt: string,
  ): DurableNotificationBatch | null {
    if (notifications.length > 10) {
      throw new Error('A notification batch cannot contain more than 10 items');
    }

    const attemptCount = notifications[0].attemptCount;
    if (notifications.some((notification) =>
      notification.discordUserId !== scope.discordUserId
      || notification.steamId64 !== scope.steamId64
      || notification.configVersion !== scope.configVersion
      || notification.attemptCount !== attemptCount
    )) {
      throw new Error('Notification batch members must share recipient, generation, and attempts');
    }

    const batchId = randomUUID();
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const first = notifications[0];
      this.database
        .prepare(
          `INSERT INTO notification_batch
             (batch_id, discord_user_id, steam_id64, config_version, language,
              status, member_count, attempt_count, created_at,
              first_created_at, first_app_id, first_sale_episode_id, last_attempt_at)
           VALUES (?, ?, ?, ?, ?, 'sending', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batchId,
          scope.discordUserId,
          scope.steamId64,
          scope.configVersion,
          language,
          notifications.length,
          attemptCount,
          attemptedAt,
          first.createdAt,
          first.appId,
          first.saleEpisodeId,
          attemptedAt,
        );

      for (const [position, notification] of notifications.entries()) {
        const claimed = this.database
          .prepare(
            `UPDATE notification_log AS notification
             SET status = 'sending', last_attempt_at = ?,
                 next_attempt_at = NULL, last_error = NULL
             WHERE notification.discord_user_id = ?
               AND notification.steam_id64 = ?
               AND notification.config_version = ?
               AND notification.app_id = ?
               AND notification.sale_episode_id = ?
               AND (
                 notification.status = 'candidate'
                 OR (notification.status = 'failed' AND notification.next_attempt_at <= ?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM notification_batch_item AS item
                 JOIN notification_batch AS batch ON batch.batch_id = item.batch_id
                 WHERE item.discord_user_id = notification.discord_user_id
                   AND item.config_version = notification.config_version
                   AND item.app_id = notification.app_id
                   AND item.sale_episode_id = notification.sale_episode_id
                   AND batch.status IN ('sending', 'failed')
               )
               AND EXISTS (
                 SELECT 1 FROM wishlist_item_state AS state
                 WHERE state.discord_user_id = notification.discord_user_id
                   AND state.steam_id64 = notification.steam_id64
                   AND state.config_version = notification.config_version
                    AND state.app_id = notification.app_id
                    AND state.on_sale = 1
                    AND state.observation_status = 'known'
                    AND state.sale_episode_id = notification.sale_episode_id
               )`,
          )
          .run(
            attemptedAt,
            notification.discordUserId,
            notification.steamId64,
            notification.configVersion,
            notification.appId,
            notification.saleEpisodeId,
            attemptedAt,
          );
        if (Number(claimed.changes) !== 1) {
          throw new BatchClaimConflictError('Notification batch claim lost a member');
        }

        this.database
          .prepare(
            `INSERT INTO notification_batch_item
               (batch_id, position, discord_user_id, config_version, app_id, sale_episode_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            batchId,
            position,
            notification.discordUserId,
            notification.configVersion,
            notification.appId,
            notification.saleEpisodeId,
          );
      }

      this.database.exec('COMMIT');
      return { batchId, language, attemptCount, notifications };
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      if (error instanceof BatchClaimConflictError) {
        return null;
      }
      throw error;
    }
  }

  public claimNotificationBatch(batch: DurableNotificationBatch, attemptedAt: string): boolean {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const parent = this.database
        .prepare(
          `UPDATE notification_batch
           SET status = 'sending', last_attempt_at = ?, next_attempt_at = NULL, last_error = NULL
           WHERE batch_id = ? AND status = 'failed' AND next_attempt_at <= ?`,
        )
        .run(attemptedAt, batch.batchId, attemptedAt);
      if (Number(parent.changes) !== 1) {
        throw new BatchClaimConflictError('Notification batch is no longer retryable');
      }

      const members = this.database
        .prepare(
          `UPDATE notification_log AS notification
           SET status = 'sending', last_attempt_at = ?, next_attempt_at = NULL, last_error = NULL
           WHERE status = 'failed'
             AND EXISTS (
               SELECT 1 FROM notification_batch_item AS item
               WHERE item.batch_id = ?
                 AND item.discord_user_id = notification.discord_user_id
                 AND item.config_version = notification.config_version
                 AND item.app_id = notification.app_id
                 AND item.sale_episode_id = notification.sale_episode_id
             )
             AND EXISTS (
               SELECT 1 FROM wishlist_item_state AS state
               WHERE state.discord_user_id = notification.discord_user_id
                 AND state.steam_id64 = notification.steam_id64
                 AND state.config_version = notification.config_version
                  AND state.app_id = notification.app_id
                  AND state.on_sale = 1
                  AND state.observation_status = 'known'
                  AND state.sale_episode_id = notification.sale_episode_id
             )`,
        )
        .run(attemptedAt, batch.batchId);
      if (Number(members.changes) !== batch.notifications.length) {
        throw new BatchClaimConflictError('Notification batch members are no longer retryable');
      }

      this.database.exec('COMMIT');
      return true;
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      if (error instanceof BatchClaimConflictError) {
        return false;
      }
      throw error;
    }
  }

  public markNotificationBatchSent(batch: DurableNotificationBatch): void {
    this.updateBatchOutcome(batch, 'sent', null, null, false);
  }

  public markNotificationBatchFailed(
    batch: DurableNotificationBatch,
    errorMessage: string,
    nextAttemptAt: string | null,
    terminal: boolean,
  ): void {
    this.updateBatchOutcome(
      batch,
      terminal ? 'terminal_failed' : 'failed',
      nextAttemptAt,
      errorMessage,
      true,
    );
  }

  public markNotificationTerminal(
    candidate: NotificationCandidate,
    errorMessage: string,
  ): void {
    this.database
      .prepare(
        `UPDATE notification_log
         SET status = 'terminal_failed', next_attempt_at = NULL, last_error = ?
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           AND app_id = ? AND sale_episode_id = ?
           AND status IN ('candidate', 'failed')`,
      )
      .run(
        errorMessage,
        candidate.discordUserId,
        candidate.steamId64,
        candidate.configVersion,
        candidate.appId,
        candidate.saleEpisodeId,
      );
  }

  public markNotificationBatchTerminal(
    batch: DurableNotificationBatch,
    errorMessage: string,
  ): void {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const members = this.database
        .prepare(
          `UPDATE notification_log AS notification
           SET status = 'terminal_failed', next_attempt_at = NULL, last_error = ?
           WHERE status = 'failed'
             AND EXISTS (
               SELECT 1 FROM notification_batch_item AS item
               WHERE item.batch_id = ?
                 AND item.discord_user_id = notification.discord_user_id
                 AND item.config_version = notification.config_version
                 AND item.app_id = notification.app_id
                 AND item.sale_episode_id = notification.sale_episode_id
             )`,
        )
        .run(errorMessage, batch.batchId);
      const parent = this.database
        .prepare(
          `UPDATE notification_batch
           SET status = 'terminal_failed', next_attempt_at = NULL, last_error = ?
           WHERE batch_id = ? AND status = 'failed'`,
        )
        .run(errorMessage, batch.batchId);
      if (Number(members.changes) !== batch.notifications.length || Number(parent.changes) !== 1) {
        throw new Error('Could not mark every notification in a batch terminal');
      }
      this.database.exec('COMMIT');
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public findNotificationStatus(
    candidate: Pick<
      NotificationCandidate,
      'discordUserId' | 'steamId64' | 'configVersion' | 'appId' | 'saleEpisodeId'
    >,
  ): string | null {
    const row = this.database
      .prepare(
        `SELECT status
         FROM notification_log
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           AND app_id = ? AND sale_episode_id = ?`,
      )
      .get(
        candidate.discordUserId,
        candidate.steamId64,
        candidate.configVersion,
        candidate.appId,
        candidate.saleEpisodeId,
      ) as { status: SQLOutputValue } | undefined;

    return row ? textValue(row.status, 'status') : null;
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

  private toDurableBatch(row: NotificationBatchRow): DurableNotificationBatch {
    const batchId = textValue(row.batch_id, 'batch_id');
    const memberCount = integerValue(row.member_count, 'member_count');
    const rows = this.database
      .prepare(
        `SELECT ${notificationColumns}
         FROM notification_batch_item AS item
         JOIN notification_log AS notification
           ON notification.discord_user_id = item.discord_user_id
          AND notification.config_version = item.config_version
          AND notification.app_id = item.app_id
          AND notification.sale_episode_id = item.sale_episode_id
         WHERE item.batch_id = ?
         ORDER BY item.position ASC`,
      )
      .all(batchId) as unknown as NotificationLogRow[];
    const notifications = rows.map(toNotificationCandidate);
    if (notifications.length !== memberCount || notifications.length === 0) {
      throw new Error('Notification batch membership is incomplete');
    }

    return {
      batchId,
      language: languageValue(row.language),
      attemptCount: integerValue(row.attempt_count, 'attempt_count'),
      notifications: notifications as [NotificationCandidate, ...NotificationCandidate[]],
    };
  }

  private updateBatchOutcome(
    batch: DurableNotificationBatch,
    status: 'sent' | 'failed' | 'terminal_failed',
    nextAttemptAt: string | null,
    errorMessage: string | null,
    incrementAttempts: boolean,
  ): void {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const members = this.database
        .prepare(
          `UPDATE notification_log AS notification
           SET status = ?,
               attempt_count = attempt_count + ?,
               next_attempt_at = ?,
               last_error = ?
           WHERE status = 'sending'
             AND EXISTS (
               SELECT 1 FROM notification_batch_item AS item
               WHERE item.batch_id = ?
                 AND item.discord_user_id = notification.discord_user_id
                 AND item.config_version = notification.config_version
                 AND item.app_id = notification.app_id
                 AND item.sale_episode_id = notification.sale_episode_id
             )`,
        )
        .run(
          status,
          incrementAttempts ? 1 : 0,
          nextAttemptAt,
          errorMessage,
          batch.batchId,
        );
      const parent = this.database
        .prepare(
          `UPDATE notification_batch
           SET status = ?,
               attempt_count = attempt_count + ?,
               next_attempt_at = ?,
               last_error = ?
           WHERE batch_id = ? AND status = 'sending'`,
        )
        .run(
          status,
          incrementAttempts ? 1 : 0,
          nextAttemptAt,
          errorMessage,
          batch.batchId,
        );
      if (Number(members.changes) !== batch.notifications.length || Number(parent.changes) !== 1) {
        throw new Error('Could not update every notification in a batch');
      }

      this.database.exec('COMMIT');
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
