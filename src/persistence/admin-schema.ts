import type { DatabaseSync } from 'node:sqlite';

/**
 * v13: the owner's admin panel. Usage telemetry (which server or install a user
 * came from and what they used), server join/leave history, an audit trail of
 * admin actions, runtime settings, blocks, and owner announcements that are
 * persisted per recipient before Discord is called.
 */
export function migrateAdmin(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= 13) return;
  try {
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS guild_event (
      id INTEGER PRIMARY KEY,
      guild_id TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      member_count INTEGER,
      event TEXT NOT NULL CHECK (event IN ('join', 'leave')),
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS guild_event_guild_idx ON guild_event(guild_id, occurred_at);
    CREATE TABLE IF NOT EXISTS interaction_event (
      id INTEGER PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      guild_id TEXT,
      context TEXT NOT NULL CHECK (context IN ('guild', 'bot_dm', 'private_channel', 'unknown')),
      install TEXT NOT NULL CHECK (install IN ('guild', 'user', 'both', 'unknown')),
      kind TEXT NOT NULL CHECK (kind IN ('command', 'component', 'modal', 'setup')),
      action TEXT NOT NULL,
      locale TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS interaction_event_time_idx ON interaction_event(occurred_at);
    CREATE INDEX IF NOT EXISTS interaction_event_user_idx ON interaction_event(discord_user_id, occurred_at);
    CREATE INDEX IF NOT EXISTS interaction_event_guild_idx ON interaction_event(guild_id, discord_user_id);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'failed')),
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_audit_time_idx ON admin_audit(occurred_at);
    CREATE TABLE IF NOT EXISTS runtime_setting (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_block (
      discord_user_id TEXT PRIMARY KEY NOT NULL,
      reason TEXT,
      blocked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guild_block (
      guild_id TEXT PRIMARY KEY NOT NULL,
      guild_name TEXT,
      reason TEXT,
      blocked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broadcast (
      broadcast_id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      audience TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sending', 'paused', 'completed', 'cancelled')),
      recipient_count INTEGER NOT NULL CHECK (recipient_count >= 0),
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS broadcast_recipient (
      broadcast_id TEXT NOT NULL REFERENCES broadcast(broadcast_id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      next_attempt_at TEXT,
      last_error TEXT,
      discord_message_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (broadcast_id, discord_user_id)
    );
    CREATE INDEX IF NOT EXISTS broadcast_recipient_due_idx ON broadcast_recipient(status, next_attempt_at);
    PRAGMA user_version = 13;
    COMMIT;`);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
