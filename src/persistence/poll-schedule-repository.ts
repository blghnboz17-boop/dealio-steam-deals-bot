import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

interface PollScheduleRow {
  next_scheduled_at: SQLOutputValue;
}

export class PollScheduleRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findNextScheduledAt(): string | null {
    const row = this.database.prepare(
      `SELECT next_scheduled_at
       FROM wishlist_poll_schedule
       WHERE schedule_name = 'wishlist'`,
    ).get() as PollScheduleRow | undefined;
    const value = row?.next_scheduled_at ?? null;
    if (value !== null && typeof value !== 'string') {
      throw new Error('Invalid next_scheduled_at value in wishlist_poll_schedule');
    }
    return value;
  }

  public setNextScheduledAt(nextScheduledAt: string | null): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(
        `INSERT INTO wishlist_poll_schedule (schedule_name, next_scheduled_at)
         VALUES ('wishlist', ?)
         ON CONFLICT(schedule_name) DO UPDATE
         SET next_scheduled_at = excluded.next_scheduled_at`,
      ).run(nextScheduledAt);
      this.database.prepare(
        `UPDATE check_state
         SET next_scheduled_at = CASE
           WHEN EXISTS (
             SELECT 1 FROM user_config
             WHERE user_config.discord_user_id = check_state.discord_user_id
               AND user_config.enabled = 1
           ) THEN ?
           ELSE NULL
         END`,
      ).run(nextScheduledAt);
      this.database.exec('COMMIT');
    } catch (error: unknown) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
