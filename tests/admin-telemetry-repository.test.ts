import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { AdminTelemetryRepository } from '../src/admin/telemetry-repository.js';

function createTelemetryDatabase(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE user_config (
      discord_user_id TEXT, enabled INTEGER, dm_delivery_blocked_at TEXT
    );
    CREATE TABLE check_state (
      discord_user_id TEXT, last_status TEXT, last_completed_at TEXT
    );
    CREATE TABLE notification_log (
      discord_user_id TEXT, game_name TEXT, status TEXT, created_at TEXT,
      last_attempt_at TEXT, last_error TEXT
    );
    CREATE TABLE notification_batch (
      batch_id TEXT, discord_user_id TEXT, status TEXT, created_at TEXT,
      last_attempt_at TEXT, last_error TEXT
    );
    CREATE TABLE wishlist_poll_schedule (schedule_name TEXT, next_scheduled_at TEXT);
  `);
  return database;
}

describe('AdminTelemetryRepository', () => {
  it('reads only aggregate counts, categories, and timestamps', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-telemetry-'));
    const path = join(directory, 'wishlist.db');
    const database = createTelemetryDatabase(path);
    database.exec(`
      INSERT INTO user_config VALUES
        ('private-user-a', 1, NULL),
        ('private-user-b', 0, NULL),
        ('private-user-c', 1, '2026-08-29T09:00:00.000Z');
      INSERT INTO check_state VALUES
        ('private-user-a', 'success', '2026-08-29T10:00:00.000Z'),
        ('private-user-b', 'failed', '2026-08-29T10:05:00.000Z'),
        ('private-user-c', NULL, NULL);
      INSERT INTO notification_log VALUES
        ('private-user-a', 'Secret Game', 'sent', '2026-08-29T10:10:00.000Z', '2026-08-29T10:11:00.000Z', NULL),
        ('private-user-b', 'Other Game', 'terminal_failed', '2026-08-29T10:12:00.000Z', '2026-08-29T10:13:00.000Z', 'raw Discord error');
      INSERT INTO notification_batch VALUES
        ('private-batch', 'private-user-a', 'sent', '2026-08-29T10:14:00.000Z', '2026-08-29T10:15:00.000Z', NULL),
        ('private-batch-2', 'private-user-b', 'failed', '2026-08-29T10:16:00.000Z', '2026-08-29T10:17:00.000Z', 'raw batch error');
      INSERT INTO wishlist_poll_schedule VALUES ('wishlist', '2026-08-29T16:00:00.000Z');
    `);
    database.close();

    try {
      const result = new AdminTelemetryRepository(path).readSnapshot();

      expect(result).toEqual({
        status: 'available',
        users: { configured: 3, enabled: 2, disabled: 1, dmBlocked: 1 },
        checks: {
          statuses: { never: 1, pending: 0, success: 1, unavailable: 0, failed: 1 },
          latestCompletedAt: '2026-08-29T10:05:00.000Z',
          nextScheduledAt: '2026-08-29T16:00:00.000Z',
        },
        notifications: {
          statuses: { candidate: 0, sending: 0, sent: 1, failed: 0, terminalFailed: 1, expired: 0 },
          latestCreatedAt: '2026-08-29T10:12:00.000Z',
          latestAttemptAt: '2026-08-29T10:13:00.000Z',
        },
        batches: {
          statuses: { sending: 0, sent: 1, failed: 1, terminalFailed: 0, expired: 0 },
          latestCreatedAt: '2026-08-29T10:16:00.000Z',
          latestAttemptAt: '2026-08-29T10:17:00.000Z',
        },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('private-user');
      expect(serialized).not.toContain('Secret Game');
      expect(serialized).not.toContain('raw');
      expect(serialized).not.toContain(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns unavailable rather than false zeroes for a malformed schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-telemetry-bad-'));
    const path = join(directory, 'wishlist.db');
    const database = new DatabaseSync(path);
    database.exec('CREATE TABLE unrelated (secret TEXT)');
    database.close();

    try {
      const result = new AdminTelemetryRepository(path).readSnapshot();

      expect(result).toEqual({ status: 'unavailable', reason: 'database' });
      expect(JSON.stringify(result)).not.toContain(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
