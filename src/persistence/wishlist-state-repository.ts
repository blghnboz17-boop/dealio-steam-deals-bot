import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { UserConfig } from '../domain/user-config.js';
import type {
  NotificationCandidate,
  WishlistItemState,
  WishlistObservation,
} from '../domain/wishlist-state.js';

type WishlistScope = Pick<UserConfig, 'discordUserId' | 'steamId64' | 'configVersion'>;

interface WishlistItemStateRow {
  discord_user_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
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
}

interface NotificationLogRow {
  discord_user_id: SQLOutputValue;
  steam_id64: SQLOutputValue;
  config_version: SQLOutputValue;
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

function nullableInteger(value: SQLOutputValue, column: string): number | null {
  return value === null ? null : integerValue(value, column);
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
  };
}

function toNotificationCandidate(row: NotificationLogRow): NotificationCandidate {
  return {
    discordUserId: textValue(row.discord_user_id, 'discord_user_id'),
    steamId64: textValue(row.steam_id64, 'steam_id64'),
    configVersion: integerValue(row.config_version, 'config_version'),
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

const stateColumns = `discord_user_id, steam_id64, config_version, app_id, on_sale,
  sale_episode_id, sale_started_at, sale_key, currency, normal_price_minor,
  final_price_minor, discount_percent, last_seen_at`;

const notificationColumns = `
  notification.discord_user_id AS discord_user_id,
  notification.steam_id64 AS steam_id64,
  notification.config_version AS config_version,
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
             last_seen_at = ?
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

  public recoverStaleSending(scope: WishlistScope, staleBefore: string): number {
    const result = this.database
      .prepare(
        `UPDATE notification_log
         SET status = 'failed',
             next_attempt_at = COALESCE(last_attempt_at, ?),
             last_error = 'Delivery outcome unknown after process interruption; retrying at least once'
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           AND status = 'sending'
           AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`,
      )
      .run(staleBefore, scope.discordUserId, scope.steamId64, scope.configVersion, staleBefore);

    return Number(result.changes);
  }

  public expireInactiveNotifications(scope: WishlistScope): number {
    const result = this.database
      .prepare(
        `UPDATE notification_log AS notification
         SET status = 'expired', last_error = 'Sale episode is no longer active'
         WHERE notification.discord_user_id = ?
           AND notification.steam_id64 = ?
           AND notification.config_version = ?
           AND notification.status IN ('candidate', 'failed')
           AND NOT EXISTS (
             SELECT 1
             FROM wishlist_item_state AS state
             WHERE state.discord_user_id = notification.discord_user_id
               AND state.steam_id64 = notification.steam_id64
               AND state.config_version = notification.config_version
               AND state.app_id = notification.app_id
               AND state.on_sale = 1
               AND state.sale_episode_id = notification.sale_episode_id
           )`,
      )
      .run(scope.discordUserId, scope.steamId64, scope.configVersion);

    return Number(result.changes);
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
         ORDER BY notification.created_at ASC`,
      )
      .all(
        scope.discordUserId,
        scope.steamId64,
        scope.configVersion,
        now,
      ) as unknown as NotificationLogRow[];

    return rows.map(toNotificationCandidate);
  }

  public claimNotificationCandidate(candidate: NotificationCandidate, attemptedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE notification_log AS notification
         SET status = 'sending',
             last_attempt_at = ?,
             next_attempt_at = NULL,
             last_error = NULL
         WHERE notification.discord_user_id = ?
           AND notification.steam_id64 = ?
           AND notification.config_version = ?
           AND notification.app_id = ?
           AND notification.sale_episode_id = ?
           AND notification.status IN ('candidate', 'failed')
           AND EXISTS (
             SELECT 1
             FROM wishlist_item_state AS state
             WHERE state.discord_user_id = notification.discord_user_id
               AND state.steam_id64 = notification.steam_id64
               AND state.config_version = notification.config_version
               AND state.app_id = notification.app_id
               AND state.on_sale = 1
               AND state.sale_episode_id = notification.sale_episode_id
           )`,
      )
      .run(
        attemptedAt,
        candidate.discordUserId,
        candidate.steamId64,
        candidate.configVersion,
        candidate.appId,
        candidate.saleEpisodeId,
      );

    return Number(result.changes) === 1;
  }

  public markNotificationSent(candidate: NotificationCandidate): void {
    this.updateNotificationStatus(candidate, 'sent', null);
  }

  public markNotificationFailed(
    candidate: NotificationCandidate,
    errorMessage: string,
    nextAttemptAt: string | null,
    terminal: boolean,
  ): void {
    this.database
      .prepare(
        `UPDATE notification_log
         SET status = ?,
             attempt_count = attempt_count + 1,
             next_attempt_at = ?,
             last_error = ?
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           AND app_id = ? AND sale_episode_id = ? AND status = 'sending'`,
      )
      .run(
        terminal ? 'terminal_failed' : 'failed',
        nextAttemptAt,
        errorMessage,
        candidate.discordUserId,
        candidate.steamId64,
        candidate.configVersion,
        candidate.appId,
        candidate.saleEpisodeId,
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
  ): ObservationResult {
    const { item, saleKey, observedAt } = observation;
    const price = item.price;
    let notificationCandidate: NotificationCandidate | null = null;

    this.database.exec('BEGIN IMMEDIATE');

    try {
      const existing = this.findByDiscordUserAndAppId(
        scope.discordUserId,
        item.appId,
        scope.configVersion,
      );
      const isFirstObservation = existing === null;
      const shouldCreateCandidate = existing?.onSale === false && item.onSale === true;
      const continuingSale = existing?.onSale === true && item.onSale === true;
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
             (discord_user_id, steam_id64, config_version, app_id, on_sale,
              sale_episode_id, sale_started_at, sale_key, currency,
              normal_price_minor, final_price_minor, discount_percent, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(discord_user_id, config_version, app_id) DO UPDATE SET
             steam_id64 = excluded.steam_id64,
             on_sale = excluded.on_sale,
             sale_episode_id = excluded.sale_episode_id,
             sale_started_at = excluded.sale_started_at,
             sale_key = excluded.sale_key,
             currency = excluded.currency,
             normal_price_minor = excluded.normal_price_minor,
             final_price_minor = excluded.final_price_minor,
             discount_percent = excluded.discount_percent,
             last_seen_at = excluded.last_seen_at`,
        )
        .run(
          scope.discordUserId,
          scope.steamId64,
          scope.configVersion,
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
        );

      if (
        shouldCreateCandidate &&
        saleEpisodeId !== null &&
        saleKey !== null &&
        price !== null &&
        price.currency !== null
      ) {
        const result = this.database
          .prepare(
            `INSERT OR IGNORE INTO notification_log
               (discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
                sale_key, game_name, currency, normal_price_minor,
                final_price_minor, discount_percent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            scope.discordUserId,
            scope.steamId64,
            scope.configVersion,
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

        if (Number(result.changes) > 0) {
          notificationCandidate = {
            discordUserId: scope.discordUserId,
            steamId64: scope.steamId64,
            configVersion: scope.configVersion,
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

      this.database.exec('COMMIT');
      return { firstObservation: isFirstObservation, notificationCandidate };
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private updateNotificationStatus(
    candidate: NotificationCandidate,
    status: 'sent',
    errorMessage: string | null,
  ): void {
    this.database
      .prepare(
        `UPDATE notification_log
         SET status = ?, last_error = ?
         WHERE discord_user_id = ? AND steam_id64 = ? AND config_version = ?
           AND app_id = ? AND sale_episode_id = ? AND status = 'sending'`,
      )
      .run(
        status,
        errorMessage,
        candidate.discordUserId,
        candidate.steamId64,
        candidate.configVersion,
        candidate.appId,
        candidate.saleEpisodeId,
      );
  }
}
