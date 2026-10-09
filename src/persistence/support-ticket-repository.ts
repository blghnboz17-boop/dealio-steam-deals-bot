import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  isSupportTopic, supportTicketRetentionMs,
  type SupportTicket, type SupportTicketCloser, type SupportTicketStatus, type SupportTopic,
} from '../domain/support-ticket.js';
import { preparedStatement } from './prepared-statement.js';

type Row = Record<string, SQLOutputValue>;
const text = (value: SQLOutputValue): string => (typeof value === 'string' ? value : String(value ?? ''));
const textOrNull = (value: SQLOutputValue): string | null => (value === null || value === undefined ? null : text(value));

function ticketFromRow(row: Row): SupportTicket {
  const topic = text(row.topic);
  return {
    ticketId: Number(row.ticket_id),
    discordUserId: text(row.discord_user_id),
    guildId: text(row.guild_id),
    channelId: text(row.channel_id),
    topic: isSupportTopic(topic) ? topic : 'other',
    status: text(row.status) as SupportTicketStatus,
    threadId: textOrNull(row.thread_id),
    openedAt: text(row.opened_at),
    closedAt: textOrNull(row.closed_at),
    closedBy: textOrNull(row.closed_by) as SupportTicketCloser | null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/** Support ticket bookkeeping. The conversation is never stored, only who opened what and when. */
export class SupportTicketRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public find(ticketId: number): SupportTicket | null {
    const row = preparedStatement(this.database, 'SELECT * FROM support_ticket WHERE ticket_id = ?').get(ticketId) as Row | undefined;
    return row ? ticketFromRow(row) : null;
  }

  /** The user's unfinished ticket (`opening` or `open`), if any. */
  public findActive(discordUserId: string): SupportTicket | null {
    const row = preparedStatement(this.database,
      "SELECT * FROM support_ticket WHERE discord_user_id = ? AND status IN ('opening', 'open')").get(discordUserId) as Row | undefined;
    return row ? ticketFromRow(row) : null;
  }

  /** Opening times of the user's tickets after `since`, oldest first; failed attempts do not count. */
  public openedSince(discordUserId: string, since: string): string[] {
    return (preparedStatement(this.database, `SELECT opened_at FROM support_ticket
      WHERE discord_user_id = ? AND opened_at > ? AND status <> 'failed' ORDER BY opened_at`)
      .all(discordUserId, since) as Row[]).map((row) => text(row.opened_at));
  }

  /**
   * Records a new ticket before Discord is called. Returns null when the user already
   * has an unfinished one, which the unique index decides even for simultaneous calls.
   */
  public reserve(discordUserId: string, guildId: string, channelId: string, topic: SupportTopic, at: string): SupportTicket | null {
    try {
      const result = preparedStatement(this.database, `INSERT INTO support_ticket
        (discord_user_id, guild_id, channel_id, topic, status, opened_at) VALUES (?, ?, ?, ?, 'opening', ?)`)
        .run(discordUserId, guildId, channelId, topic, at);
      return this.find(Number(result.lastInsertRowid));
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  public attachThread(ticketId: number, threadId: string): void {
    preparedStatement(this.database,
      "UPDATE support_ticket SET status = 'open', thread_id = ? WHERE ticket_id = ? AND status = 'opening'")
      .run(threadId, ticketId);
  }

  public markFailed(ticketId: number, at: string): void {
    preparedStatement(this.database,
      "UPDATE support_ticket SET status = 'failed', closed_at = ? WHERE ticket_id = ? AND status IN ('opening', 'open')")
      .run(at, ticketId);
  }

  /** Closes an unfinished ticket; false when it was already closed. */
  public close(ticketId: number, closedBy: SupportTicketCloser, at: string): boolean {
    return Number(preparedStatement(this.database, `UPDATE support_ticket SET status = 'closed', closed_at = ?, closed_by = ?
      WHERE ticket_id = ? AND status IN ('opening', 'open')`).run(at, closedBy, ticketId).changes) === 1;
  }

  /** Tickets opened in the last day and still open, for the owner's overview. */
  public counts(now: Date = new Date()): { readonly open: number; readonly openedToday: number } {
    const day = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const row = preparedStatement(this.database, `SELECT
      SUM(CASE WHEN status IN ('opening', 'open') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN opened_at >= ? AND status <> 'failed' THEN 1 ELSE 0 END) AS today
      FROM support_ticket`).get(day) as Row;
    return { open: Number(row.open ?? 0), openedToday: Number(row.today ?? 0) };
  }

  /** Ended tickets are forgotten after the retention period. */
  public cleanup(now: Date = new Date()): number {
    const cutoff = new Date(now.getTime() - supportTicketRetentionMs).toISOString();
    return Number(preparedStatement(this.database,
      "DELETE FROM support_ticket WHERE status IN ('closed', 'failed') AND closed_at < ?").run(cutoff).changes);
  }
}

/** `/delete-data`: the user's tickets go with the rest. With `openedUpTo`, only older ones (a restore). */
export function deleteUserSupportTickets(database: DatabaseSync, discordUserId: string, openedUpTo?: string): void {
  preparedStatement(database, 'DELETE FROM support_ticket WHERE discord_user_id = ? AND (? IS NULL OR opened_at <= ?)')
    .run(discordUserId, openedUpTo ?? null, openedUpTo ?? null);
}
