import type { DatabaseSync } from 'node:sqlite';

/**
 * v14: support tickets opened from the Dealio support server. Only the ticket's
 * bookkeeping is stored here; the conversation itself is a private Discord thread.
 * The partial unique index allows one unfinished ticket per user, so two quick
 * submissions cannot open two threads.
 */
export function migrateSupport(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= 14) return;
  try {
    db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS support_ticket (
      ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      topic TEXT NOT NULL CHECK (topic IN ('setup', 'alerts', 'bug', 'account', 'other')),
      status TEXT NOT NULL CHECK (status IN ('opening', 'open', 'closed', 'failed')),
      thread_id TEXT UNIQUE,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      closed_by TEXT CHECK (closed_by IS NULL OR closed_by IN ('user', 'staff', 'expired'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS support_ticket_one_active_idx
      ON support_ticket(discord_user_id) WHERE status IN ('opening', 'open');
    CREATE INDEX IF NOT EXISTS support_ticket_user_idx ON support_ticket(discord_user_id, opened_at);
    PRAGMA user_version = 14;
    COMMIT;`);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
