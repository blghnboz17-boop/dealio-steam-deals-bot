import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { UserConfig } from '../domain/user-config.js';

export interface NotificationQueueCounts {
  readonly pending: number;
  readonly retry: number;
  readonly sending: number;
  readonly sent: number;
  readonly terminalFailed: number;
  readonly expired: number;
}

interface QueueCountRow {
  pending_count: SQLOutputValue;
  retry_count: SQLOutputValue;
  sending_count: SQLOutputValue;
  sent_count: SQLOutputValue;
  terminal_failed_count: SQLOutputValue;
  expired_count: SQLOutputValue;
}

function count(value: SQLOutputValue, column: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${column} dashboard count`);
  }
  return value;
}

export class StatusDashboardRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findNotificationQueueCounts(config: UserConfig): NotificationQueueCounts {
    const row = this.database.prepare(
      `WITH current_notifications AS (
         SELECT notification.*,
                EXISTS (
                  SELECT 1
                  FROM wishlist_item_state AS state
                  WHERE state.discord_user_id = notification.discord_user_id
                    AND state.steam_id64 = notification.steam_id64
                    AND state.config_version = notification.config_version
                    AND state.app_id = notification.app_id
                    AND state.on_sale = 1
                    AND state.sale_episode_id = notification.sale_episode_id
                ) AS episode_active
         FROM notification_log AS notification
         WHERE notification.discord_user_id = ?
           AND notification.steam_id64 = ?
           AND notification.config_version = ?
       )
       SELECT
         COUNT(CASE WHEN status = 'candidate' AND episode_active = 1 THEN 1 END)
           AS pending_count,
         COUNT(CASE WHEN status = 'failed' AND episode_active = 1 THEN 1 END)
           AS retry_count,
         COUNT(CASE WHEN status = 'sending' AND episode_active = 1 THEN 1 END)
           AS sending_count,
         COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent_count,
         COUNT(CASE WHEN status = 'terminal_failed' THEN 1 END)
           AS terminal_failed_count,
         COUNT(CASE
           WHEN status = 'expired'
             OR (status IN ('candidate', 'failed', 'sending') AND episode_active = 0)
           THEN 1
         END) AS expired_count
       FROM current_notifications`,
    ).get(
      config.discordUserId,
      config.steamId64,
      config.configVersion,
    ) as unknown as QueueCountRow;

    return {
      pending: count(row.pending_count, 'pending'),
      retry: count(row.retry_count, 'retry'),
      sending: count(row.sending_count, 'sending'),
      sent: count(row.sent_count, 'sent'),
      terminalFailed: count(row.terminal_failed_count, 'terminal_failed'),
      expired: count(row.expired_count, 'expired'),
    };
  }
}
