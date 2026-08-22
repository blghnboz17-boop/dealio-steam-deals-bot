import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { CheckState, CheckStatus } from '../domain/check-state.js';

interface CheckStateRow {
  discord_user_id: SQLOutputValue;
  last_started_at: SQLOutputValue;
  last_completed_at: SQLOutputValue;
  last_status: SQLOutputValue;
  last_error_code: SQLOutputValue;
  next_scheduled_at: SQLOutputValue;
  last_success_completed_at: SQLOutputValue;
  last_success_checked_count: SQLOutputValue;
  last_success_on_sale_count: SQLOutputValue;
  last_success_free_count: SQLOutputValue;
  last_success_unknown_price_count: SQLOutputValue;
  last_success_failed_item_count: SQLOutputValue;
}

export interface SuccessfulCheckMetrics {
  readonly checkedCount: number;
  readonly onSaleCount: number;
  readonly freeCount: number;
  readonly unknownPriceCount: number;
  readonly failedItemCount: number;
}

function nullableText(value: SQLOutputValue, column: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid ${column} value in check_state`);
  }

  return value;
}

function nullableStatus(value: SQLOutputValue): CheckStatus | null {
  const status = nullableText(value, 'last_status');

  if (status === null) {
    return null;
  }

  if (!['pending', 'success', 'unavailable', 'failed'].includes(status)) {
    throw new Error('Invalid last_status value in check_state');
  }

  return status as CheckStatus;
}

function nullableCount(value: SQLOutputValue, column: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${column} value in check_state`);
  }
  return value;
}

function toCheckState(row: CheckStateRow): CheckState {
  if (typeof row.discord_user_id !== 'string') {
    throw new Error('Invalid discord_user_id value in check_state');
  }

  return {
    discordUserId: row.discord_user_id,
    lastStartedAt: nullableText(row.last_started_at, 'last_started_at'),
    lastCompletedAt: nullableText(row.last_completed_at, 'last_completed_at'),
    lastStatus: nullableStatus(row.last_status),
    lastErrorCode: nullableText(row.last_error_code, 'last_error_code'),
    nextScheduledAt: nullableText(row.next_scheduled_at, 'next_scheduled_at'),
    lastSuccessCompletedAt: nullableText(
      row.last_success_completed_at,
      'last_success_completed_at',
    ),
    lastSuccessCheckedCount: nullableCount(
      row.last_success_checked_count,
      'last_success_checked_count',
    ),
    lastSuccessOnSaleCount: nullableCount(
      row.last_success_on_sale_count,
      'last_success_on_sale_count',
    ),
    lastSuccessFreeCount: nullableCount(
      row.last_success_free_count,
      'last_success_free_count',
    ),
    lastSuccessUnknownPriceCount: nullableCount(
      row.last_success_unknown_price_count,
      'last_success_unknown_price_count',
    ),
    lastSuccessFailedItemCount: nullableCount(
      row.last_success_failed_item_count,
      'last_success_failed_item_count',
    ),
  };
}

export class CheckStateRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByDiscordUserId(discordUserId: string): CheckState | null {
    const row = this.database
      .prepare(
        `SELECT discord_user_id, last_started_at, last_completed_at, last_status,
                last_error_code, next_scheduled_at, last_success_completed_at,
                last_success_checked_count, last_success_on_sale_count,
                last_success_free_count, last_success_unknown_price_count,
                last_success_failed_item_count
         FROM check_state
         WHERE discord_user_id = ?`,
      )
      .get(discordUserId) as CheckStateRow | undefined;

    return row ? toCheckState(row) : null;
  }

  public markUnavailable(
    discordUserId: string,
    startedAt: string,
    completedAt: string,
    errorCode: string,
    configVersion: number,
  ): void {
    this.database
      .prepare(
        `UPDATE check_state
         SET last_started_at = ?,
             last_completed_at = ?,
             last_status = 'unavailable',
             last_error_code = ?
          WHERE discord_user_id = ?
            AND EXISTS (
              SELECT 1 FROM user_config
              WHERE user_config.discord_user_id = check_state.discord_user_id
                AND user_config.config_version = ?
            )`,
      )
      .run(startedAt, completedAt, errorCode, discordUserId, configVersion);
  }

  public markSuccess(
    discordUserId: string,
    startedAt: string,
    completedAt: string,
    configVersion: number,
    metrics: SuccessfulCheckMetrics,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE check_state
         SET last_started_at = ?,
              last_completed_at = ?,
              last_status = 'success',
              last_error_code = NULL,
              last_success_completed_at = ?,
              last_success_checked_count = ?,
              last_success_on_sale_count = ?,
              last_success_free_count = ?,
              last_success_unknown_price_count = ?,
              last_success_failed_item_count = ?
          WHERE discord_user_id = ?
            AND EXISTS (
              SELECT 1 FROM user_config
              WHERE user_config.discord_user_id = check_state.discord_user_id
                AND user_config.config_version = ?
            )`,
      )
      .run(
        startedAt,
        completedAt,
        completedAt,
        metrics.checkedCount,
        metrics.onSaleCount,
        metrics.freeCount,
        metrics.unknownPriceCount,
        metrics.failedItemCount,
        discordUserId,
        configVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new Error('Successful check belongs to a stale user configuration');
    }
  }

  public markFailed(
    discordUserId: string,
    startedAt: string,
    completedAt: string,
    errorCode: string,
    configVersion: number,
  ): void {
    this.database
      .prepare(
        `UPDATE check_state
         SET last_started_at = ?,
             last_completed_at = ?,
             last_status = 'failed',
             last_error_code = ?
         WHERE discord_user_id = ?
           AND EXISTS (
             SELECT 1 FROM user_config
             WHERE user_config.discord_user_id = check_state.discord_user_id
               AND user_config.config_version = ?
           )`,
      )
      .run(startedAt, completedAt, errorCode, discordUserId, configVersion);
  }
}
