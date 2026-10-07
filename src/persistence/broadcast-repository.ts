import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Language } from '../domain/user-config.js';
import { preparedStatement } from './prepared-statement.js';

export interface AnnouncementText { readonly title: string; readonly body: string }
export type AnnouncementContent = Partial<Record<Language, AnnouncementText>>;

export interface BroadcastAudience {
  /** Everyone eligible, or only these users (a direct message from the owner). */
  readonly userIds?: readonly string[];
  readonly countries?: readonly string[];
  readonly languages?: readonly Language[];
  readonly onlyEnabled?: boolean;
}

export type BroadcastStatus = 'sending' | 'paused' | 'completed' | 'cancelled';
export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface BroadcastSummary {
  readonly broadcastId: string;
  readonly content: AnnouncementContent;
  readonly audience: BroadcastAudience;
  readonly status: BroadcastStatus;
  readonly recipientCount: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly counts: Readonly<Record<RecipientStatus, number>>;
}

export interface ClaimedRecipient {
  readonly broadcastId: string;
  readonly discordUserId: string;
  readonly language: Language;
  readonly attemptCount: number;
  readonly content: AnnouncementContent;
}

export interface RecipientRow {
  readonly discordUserId: string;
  readonly language: string;
  readonly status: RecipientStatus;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly discordMessageId: string | null;
  readonly updatedAt: string;
}

type Row = Record<string, SQLOutputValue>;
const text = (value: SQLOutputValue): string => (typeof value === 'string' ? value : String(value ?? ''));
const textOrNull = (value: SQLOutputValue): string | null => (value === null || value === undefined ? null : text(value));

export const broadcastRetentionMs = 90 * 24 * 3600_000;

/**
 * Removes a user from owner announcements: their delivery rows, and their Discord ID
 * in an audience that named recipients. A message addressed only to them is deleted
 * with its content. With `createdUpTo`, only announcements created by then are touched
 * (re-applying a deletion after a restore).
 */
export function deleteUserFromBroadcasts(database: DatabaseSync, discordUserId: string, createdUpTo?: string): void {
  const named = preparedStatement(database, `SELECT broadcast_id, audience FROM broadcast
    WHERE (? IS NULL OR created_at <= ?)
      AND EXISTS (SELECT 1 FROM json_each(broadcast.audience, '$.userIds') WHERE value = ?)`)
    .all(createdUpTo ?? null, createdUpTo ?? null, discordUserId) as Row[];
  for (const row of named) {
    const audience = JSON.parse(text(row.audience)) as BroadcastAudience;
    const userIds = (audience.userIds ?? []).filter((id) => id !== discordUserId);
    if (userIds.length === 0) {
      preparedStatement(database, 'DELETE FROM broadcast WHERE broadcast_id = ?').run(row.broadcast_id);
    } else {
      preparedStatement(database, 'UPDATE broadcast SET audience = ? WHERE broadcast_id = ?')
        .run(JSON.stringify({ ...audience, userIds }), row.broadcast_id);
    }
  }
  preparedStatement(database, `DELETE FROM broadcast_recipient WHERE discord_user_id = ?
    AND (? IS NULL OR broadcast_id IN (SELECT broadcast_id FROM broadcast WHERE created_at <= ?))`)
    .run(discordUserId, createdUpTo ?? null, createdUpTo ?? null);
}

/**
 * Owner announcements. Every recipient is written before Discord is called, and a
 * recipient is claimed (`sending`) before each attempt: delivery is at-least-once.
 */
export class BroadcastRepository {
  public constructor(private readonly database: DatabaseSync) {}

  /** Joins a transaction that is already open instead of nesting one. */
  private transaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public create(broadcastId: string, content: AnnouncementContent, audience: BroadcastAudience,
    recipients: ReadonlyArray<{ discordUserId: string; language: Language }>, at: string): void {
    this.transaction(() => {
      preparedStatement(this.database, `INSERT INTO broadcast (broadcast_id, content, audience, status, recipient_count, created_at)
        VALUES (?, ?, ?, 'sending', ?, ?)`).run(broadcastId, JSON.stringify(content), JSON.stringify(audience),
        recipients.length, at);
      const insert = preparedStatement(this.database, `INSERT INTO broadcast_recipient
        (broadcast_id, discord_user_id, language, status, next_attempt_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`);
      for (const recipient of recipients) insert.run(broadcastId, recipient.discordUserId, recipient.language, at, at);
      if (recipients.length === 0) {
        preparedStatement(this.database, "UPDATE broadcast SET status = 'completed', completed_at = ? WHERE broadcast_id = ?")
          .run(at, broadcastId);
      }
    });
  }

  /** The next due recipient of a sending broadcast, marked `sending` with one more attempt. */
  public claimNext(now: string): ClaimedRecipient | null {
    return this.transaction(() => {
      const row = preparedStatement(this.database, `SELECT recipient.broadcast_id, recipient.discord_user_id, recipient.language,
          recipient.attempt_count, broadcast.content
        FROM broadcast_recipient AS recipient
        JOIN broadcast ON broadcast.broadcast_id = recipient.broadcast_id
        WHERE broadcast.status = 'sending' AND recipient.status IN ('pending', 'failed')
          AND (recipient.next_attempt_at IS NULL OR recipient.next_attempt_at <= ?)
        ORDER BY broadcast.created_at, recipient.discord_user_id LIMIT 1`).get(now) as Row | undefined;
      if (!row) return null;
      preparedStatement(this.database, `UPDATE broadcast_recipient SET status = 'sending', attempt_count = attempt_count + 1,
        updated_at = ? WHERE broadcast_id = ? AND discord_user_id = ?`).run(now, row.broadcast_id, row.discord_user_id);
      return {
        broadcastId: text(row.broadcast_id),
        discordUserId: text(row.discord_user_id),
        language: text(row.language) as Language,
        attemptCount: Number(row.attempt_count) + 1,
        content: JSON.parse(text(row.content)) as AnnouncementContent,
      };
    });
  }

  public markSent(broadcastId: string, discordUserId: string, messageId: string, at: string): void {
    preparedStatement(this.database, `UPDATE broadcast_recipient SET status = 'sent', discord_message_id = ?, last_error = NULL,
      next_attempt_at = NULL, updated_at = ? WHERE broadcast_id = ? AND discord_user_id = ?`).run(messageId, at, broadcastId, discordUserId);
    this.completeIfDone(broadcastId, at);
  }

  /** A failed attempt: retried at `nextAttemptAt`, or final (`skipped`) when null. */
  public markFailed(broadcastId: string, discordUserId: string, error: string, nextAttemptAt: string | null, at: string): void {
    preparedStatement(this.database, `UPDATE broadcast_recipient SET status = ?, last_error = ?, next_attempt_at = ?,
      updated_at = ? WHERE broadcast_id = ? AND discord_user_id = ?`).run(nextAttemptAt ? 'failed' : 'skipped',
      error.slice(0, 300), nextAttemptAt, at, broadcastId, discordUserId);
    this.completeIfDone(broadcastId, at);
  }

  /** Discord asked to wait: the attempt does not count. */
  public defer(broadcastId: string, discordUserId: string, nextAttemptAt: string, at: string): void {
    preparedStatement(this.database, `UPDATE broadcast_recipient SET status = 'failed', attempt_count = MAX(0, attempt_count - 1),
      last_error = 'DISCORD_RATE_LIMITED', next_attempt_at = ?, updated_at = ? WHERE broadcast_id = ? AND discord_user_id = ?`)
      .run(nextAttemptAt, at, broadcastId, discordUserId);
  }

  /** After a restart, a `sending` recipient may or may not have received it; send again. */
  public recoverInterrupted(at: string): number {
    return Number(preparedStatement(this.database, `UPDATE broadcast_recipient SET status = 'failed',
      last_error = 'INTERRUPTED', next_attempt_at = ?, updated_at = ? WHERE status = 'sending'`).run(at, at).changes);
  }

  public setStatus(broadcastId: string, status: 'sending' | 'paused' | 'cancelled', at: string): boolean {
    const changes = Number(preparedStatement(this.database, `UPDATE broadcast SET status = ?,
      completed_at = CASE WHEN ? = 'cancelled' THEN ? ELSE completed_at END
      WHERE broadcast_id = ? AND status IN ('sending', 'paused')`).run(status, status, at, broadcastId).changes);
    if (changes > 0 && status === 'cancelled') {
      preparedStatement(this.database, `UPDATE broadcast_recipient SET status = 'skipped', last_error = 'CANCELLED', updated_at = ?
        WHERE broadcast_id = ? AND status IN ('pending', 'failed')`).run(at, broadcastId);
    }
    return changes > 0;
  }

  public list(limit: number): BroadcastSummary[] {
    const rows = this.database.prepare('SELECT * FROM broadcast ORDER BY created_at DESC LIMIT ?').all(limit) as Row[];
    return rows.map((row) => this.summary(row));
  }

  public get(broadcastId: string): BroadcastSummary | null {
    const row = preparedStatement(this.database, 'SELECT * FROM broadcast WHERE broadcast_id = ?').get(broadcastId) as Row | undefined;
    return row ? this.summary(row) : null;
  }

  public recipients(broadcastId: string): RecipientRow[] {
    return (this.database.prepare(`SELECT * FROM broadcast_recipient WHERE broadcast_id = ?
      ORDER BY updated_at DESC`).all(broadcastId) as Row[]).map((row) => ({
      discordUserId: text(row.discord_user_id),
      language: text(row.language),
      status: text(row.status) as RecipientStatus,
      attemptCount: Number(row.attempt_count),
      lastError: textOrNull(row.last_error),
      discordMessageId: textOrNull(row.discord_message_id),
      updatedAt: text(row.updated_at),
    }));
  }

  /** Messages the owner sent to one user (a single-recipient broadcast). */
  public forUser(discordUserId: string, limit: number): Array<BroadcastSummary & { readonly recipientStatus: RecipientStatus }> {
    return (this.database.prepare(`SELECT broadcast.*, recipient.status AS recipient_status FROM broadcast
      JOIN broadcast_recipient AS recipient ON recipient.broadcast_id = broadcast.broadcast_id
      WHERE recipient.discord_user_id = ? ORDER BY broadcast.created_at DESC LIMIT ?`).all(discordUserId, limit) as Row[])
      .map((row) => ({ ...this.summary(row), recipientStatus: text(row.recipient_status) as RecipientStatus }));
  }

  public cleanup(now: Date = new Date()): void {
    const cutoff = new Date(now.getTime() - broadcastRetentionMs).toISOString();
    preparedStatement(this.database, `DELETE FROM broadcast WHERE created_at < ? AND status IN ('completed', 'cancelled')`).run(cutoff);
  }

  private completeIfDone(broadcastId: string, at: string): void {
    preparedStatement(this.database, `UPDATE broadcast SET status = 'completed', completed_at = ?
      WHERE broadcast_id = ? AND status = 'sending' AND NOT EXISTS (
        SELECT 1 FROM broadcast_recipient WHERE broadcast_id = ? AND status IN ('pending', 'failed', 'sending'))`)
      .run(at, broadcastId, broadcastId);
  }

  private summary(row: Row): BroadcastSummary {
    const broadcastId = text(row.broadcast_id);
    const counts: Record<RecipientStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const count of preparedStatement(this.database, `SELECT status, COUNT(*) AS n FROM broadcast_recipient
      WHERE broadcast_id = ? GROUP BY status`).all(broadcastId) as Row[]) {
      counts[text(count.status) as RecipientStatus] = Number(count.n);
    }
    return {
      broadcastId,
      content: JSON.parse(text(row.content)) as AnnouncementContent,
      audience: JSON.parse(text(row.audience)) as BroadcastAudience,
      status: text(row.status) as BroadcastStatus,
      recipientCount: Number(row.recipient_count),
      createdAt: text(row.created_at),
      completedAt: textOrNull(row.completed_at),
      counts,
    };
  }
}
