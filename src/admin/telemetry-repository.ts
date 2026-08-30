import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type {
  AdminTelemetryResult,
  BatchStatusCounts,
  CheckStatusCounts,
  NotificationStatusCounts,
  UserTelemetry,
} from './contracts.js';

const busyTimeoutMs = 250;

function aggregate(database: DatabaseSync, sql: string): Record<string, SQLOutputValue> {
  const row = database.prepare(sql).get();
  if (row === undefined) {
    throw new TypeError('Missing aggregate row');
  }
  return row;
}

function count(row: Record<string, SQLOutputValue>, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid aggregate count');
  }
  return value;
}

function timestamp(row: Record<string, SQLOutputValue>, column: string): string | null {
  const value = row[column];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError('Invalid aggregate timestamp');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError('Invalid aggregate timestamp');
  }
  return value;
}

function userTelemetry(row: Record<string, SQLOutputValue>): UserTelemetry {
  const result = {
    configured: count(row, 'configured'),
    enabled: count(row, 'enabled'),
    disabled: count(row, 'disabled'),
    dmBlocked: count(row, 'dm_blocked'),
  };
  if (result.enabled + result.disabled !== result.configured || result.dmBlocked > result.configured) {
    throw new TypeError('Invalid user aggregates');
  }
  return result;
}

function checkStatuses(row: Record<string, SQLOutputValue>): CheckStatusCounts {
  const result = {
    never: count(row, 'never'),
    pending: count(row, 'pending'),
    success: count(row, 'success'),
    unavailable: count(row, 'unavailable'),
    failed: count(row, 'failed'),
  };
  if (Object.values(result).reduce((total, value) => total + value, 0) !== count(row, 'total')) {
    throw new TypeError('Unknown check status');
  }
  return result;
}

function notificationStatuses(row: Record<string, SQLOutputValue>): NotificationStatusCounts {
  const result = {
    candidate: count(row, 'candidate'),
    sending: count(row, 'sending'),
    sent: count(row, 'sent'),
    failed: count(row, 'failed'),
    terminalFailed: count(row, 'terminal_failed'),
    expired: count(row, 'expired'),
  };
  if (Object.values(result).reduce((total, value) => total + value, 0) !== count(row, 'total')) {
    throw new TypeError('Unknown notification status');
  }
  return result;
}

function batchStatuses(row: Record<string, SQLOutputValue>): BatchStatusCounts {
  const result = {
    sending: count(row, 'sending'),
    sent: count(row, 'sent'),
    failed: count(row, 'failed'),
    terminalFailed: count(row, 'terminal_failed'),
    expired: count(row, 'expired'),
  };
  if (Object.values(result).reduce((total, value) => total + value, 0) !== count(row, 'total')) {
    throw new TypeError('Unknown batch status');
  }
  return result;
}

export class AdminTelemetryRepository {
  public constructor(private readonly databasePath: string) {}

  public readSnapshot(): AdminTelemetryResult {
    let database: DatabaseSync | undefined;
    let result: AdminTelemetryResult = { status: 'unavailable', reason: 'database' };
    try {
      database = new DatabaseSync(this.databasePath, { readOnly: true });
      database.exec(`PRAGMA query_only = ON; PRAGMA busy_timeout = ${busyTimeoutMs}; BEGIN;`);
      result = this.readTransaction(database);
      database.exec('COMMIT');
    } catch (error: unknown) {
      if (!(error instanceof Error)) {
        throw error;
      }
      result = { status: 'unavailable', reason: 'database' };
    } finally {
      if (database !== undefined) {
        try {
          database.close();
        } catch (error: unknown) {
          if (!(error instanceof Error)) {
            throw error;
          }
          result = { status: 'unavailable', reason: 'database' };
        }
      }
    }
    return result;
  }

  private readTransaction(database: DatabaseSync): AdminTelemetryResult {
    const users = aggregate(database, `
      SELECT COUNT(*) AS configured,
        COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled,
        COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0) AS disabled,
        COALESCE(SUM(CASE WHEN dm_delivery_blocked_at IS NOT NULL THEN 1 ELSE 0 END), 0)
          AS dm_blocked
      FROM user_config`);
    const checks = aggregate(database, `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN last_status IS NULL THEN 1 ELSE 0 END), 0) AS never,
        COALESCE(SUM(CASE WHEN last_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN last_status = 'success' THEN 1 ELSE 0 END), 0) AS success,
        COALESCE(SUM(CASE WHEN last_status = 'unavailable' THEN 1 ELSE 0 END), 0) AS unavailable,
        COALESCE(SUM(CASE WHEN last_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        MAX(last_completed_at) AS latest_completed_at
      FROM check_state`);
    const notifications = aggregate(database, `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate,
        COALESCE(SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END), 0) AS sending,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN status = 'terminal_failed' THEN 1 ELSE 0 END), 0)
          AS terminal_failed,
        COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired,
        MAX(created_at) AS latest_created_at, MAX(last_attempt_at) AS latest_attempt_at
      FROM notification_log`);
    const batches = aggregate(database, `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END), 0) AS sending,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) AS sent,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN status = 'terminal_failed' THEN 1 ELSE 0 END), 0)
          AS terminal_failed,
        COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired,
        MAX(created_at) AS latest_created_at, MAX(last_attempt_at) AS latest_attempt_at
      FROM notification_batch`);
    const schedule = aggregate(database, `
      SELECT MAX(next_scheduled_at) AS next_scheduled_at
      FROM wishlist_poll_schedule WHERE schedule_name = 'wishlist'`);
    return {
      status: 'available',
      users: userTelemetry(users),
      checks: {
        statuses: checkStatuses(checks),
        latestCompletedAt: timestamp(checks, 'latest_completed_at'),
        nextScheduledAt: timestamp(schedule, 'next_scheduled_at'),
      },
      notifications: {
        statuses: notificationStatuses(notifications),
        latestCreatedAt: timestamp(notifications, 'latest_created_at'),
        latestAttemptAt: timestamp(notifications, 'latest_attempt_at'),
      },
      batches: {
        statuses: batchStatuses(batches),
        latestCreatedAt: timestamp(batches, 'latest_created_at'),
        latestAttemptAt: timestamp(batches, 'latest_attempt_at'),
      },
    };
  }
}
