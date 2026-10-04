import { preparedStatement } from './prepared-statement.js';
import type { DeliveryReceipt } from '../domain/wishlist-state.js';
// SIZE_OK: Durable batch SQL and transactions form one atomic state machine.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Language } from '../domain/user-config.js';
import type {
  DurableNotificationBatch,
  NotificationCandidate,
} from '../domain/wishlist-state.js';
import {
  integerValue,
  languageValue,
  notificationColumns,
  textValue,
  toNotificationCandidate,
  type NotificationBatchRow,
  type NotificationLogRow,
  type WishlistScope,
} from './wishlist-state-codecs.js';

class BatchClaimConflictError extends Error {}

export class NotificationBatchRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findRetryableNotificationBatches(
    scope: WishlistScope,
    now: string,
  ): DurableNotificationBatch[] {
    const rows = preparedStatement(this.database,
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
                    AND (state.on_sale = 1 OR state.rule_event_id IS NOT NULL)
                    AND state.observation_status = 'known'
                    AND (state.rule_event_id = notification.sale_episode_id OR (notification.reason = 'discount' AND state.sale_episode_id = notification.sale_episode_id))
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
      preparedStatement(this.database,
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
        const claimed = preparedStatement(this.database,
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
                    AND (state.on_sale = 1 OR state.rule_event_id IS NOT NULL)
                    AND state.observation_status = 'known'
                    AND (state.rule_event_id = notification.sale_episode_id OR (notification.reason = 'discount' AND state.sale_episode_id = notification.sale_episode_id))
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

        preparedStatement(this.database,
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
      const parent = preparedStatement(this.database,
          `UPDATE notification_batch
           SET status = 'sending', last_attempt_at = ?, next_attempt_at = NULL, last_error = NULL
           WHERE batch_id = ? AND status = 'failed' AND next_attempt_at <= ?`,
        )
        .run(attemptedAt, batch.batchId, attemptedAt);
      if (Number(parent.changes) !== 1) {
        throw new BatchClaimConflictError('Notification batch is no longer retryable');
      }

      const members = preparedStatement(this.database,
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
                  AND (state.on_sale = 1 OR state.rule_event_id IS NOT NULL)
                  AND state.observation_status = 'known'
                  AND (state.rule_event_id = notification.sale_episode_id OR (notification.reason = 'discount' AND state.sale_episode_id = notification.sale_episode_id))
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

  public markNotificationBatchSent(batch: DurableNotificationBatch, receipt?: DeliveryReceipt): void {
    this.updateBatchOutcome(batch, 'sent', null, null, false, receipt);
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

  /** A send Discord asked to delay (rate limit): retried later without using up an attempt. */
  public deferNotificationBatch(
    batch: DurableNotificationBatch,
    errorMessage: string,
    nextAttemptAt: string,
  ): void {
    this.updateBatchOutcome(batch, 'failed', nextAttemptAt, errorMessage, false);
  }

  public markNotificationBatchTerminal(
    batch: DurableNotificationBatch,
    errorMessage: string,
  ): void {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const members = preparedStatement(this.database,
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
      const parent = preparedStatement(this.database,
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

  private toDurableBatch(row: NotificationBatchRow): DurableNotificationBatch {
    const batchId = textValue(row.batch_id, 'batch_id');
    const memberCount = integerValue(row.member_count, 'member_count');
    const rows = preparedStatement(this.database,
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
    receipt?: DeliveryReceipt,
  ): void {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      const members = preparedStatement(this.database,
          `UPDATE notification_log AS notification
           SET status = ?,
               attempt_count = attempt_count + ?,
               next_attempt_at = ?,
               last_error = ?, discord_message_id=COALESCE(?,discord_message_id), delivered_at=COALESCE(?,delivered_at)
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
          receipt?.messageId ?? null,
          receipt?.deliveredAt ?? null,
          batch.batchId,
        );
      const parent = preparedStatement(this.database,
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
