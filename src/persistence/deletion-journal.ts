import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { deleteUserFromBroadcasts } from './broadcast-repository.js';

/** Longer than the backup retention, so every restorable backup predates a kept entry. */
export const deletionJournalRetentionMs = 35 * 24 * 60 * 60 * 1000;

interface DeletionEntry {
  /** SHA-256 of the Discord user ID; the ID itself is not kept after deletion. */
  readonly user: string;
  readonly deletedAt: string;
}

export function hashDiscordUserId(discordUserId: string): string {
  return createHash('sha256').update(`dealio-deletion:${discordUserId}`).digest('hex');
}

/**
 * `/delete-data` requests, kept in a small file beside the database instead of in it.
 * Restoring an older database file therefore cannot bring a deleted user back: at
 * startup every configuration created before its owner's recorded deletion is removed.
 */
export class DeletionJournal {
  public constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public record(discordUserId: string, deletedAt: string): void {
    appendFileSync(this.path, JSON.stringify({ user: hashDiscordUserId(discordUserId), deletedAt }) + '\n',
      { encoding: 'utf8', mode: 0o600 });
  }

  /** Deletions still kept in the journal (the last 35 days), without pruning the file. */
  public count(): number {
    if (!existsSync(this.path)) return 0;
    return readFileSync(this.path, 'utf8').split('\n').filter((line) => line.trim() !== '').length;
  }

  /** Deletes restored configurations of users who deleted their data later; returns how many. */
  public reconcile(database: DatabaseSync): number {
    const entries = this.prune();
    if (entries.length === 0) return 0;
    const deletedAt = new Map<string, string>();
    for (const entry of entries) {
      const previous = deletedAt.get(entry.user);
      if (!previous || previous < entry.deletedAt) deletedAt.set(entry.user, entry.deletedAt);
    }
    const users = database.prepare('SELECT discord_user_id, created_at FROM user_config').all() as Array<{
      discord_user_id: string; created_at: string;
    }>;
    const remove = database.prepare('DELETE FROM user_config WHERE discord_user_id = ? AND created_at <= ?');
    let removed = 0;
    // Restored usage events and announcement deliveries from before a deletion go too.
    const hasTelemetry = database.prepare(
      "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'interaction_event'").get() !== undefined;
    if (hasTelemetry) {
      const removeEvents = database.prepare('DELETE FROM interaction_event WHERE discord_user_id = ? AND occurred_at <= ?');
      const seen = database.prepare(`SELECT DISTINCT discord_user_id FROM interaction_event
        UNION SELECT DISTINCT discord_user_id FROM broadcast_recipient
        UNION SELECT DISTINCT CAST(named.value AS TEXT) FROM broadcast, json_each(broadcast.audience, '$.userIds') AS named`)
        .all() as Array<{ discord_user_id: string }>;
      for (const { discord_user_id: userId } of seen) {
        const at = deletedAt.get(hashDiscordUserId(userId));
        if (!at) continue;
        removeEvents.run(userId, at);
        deleteUserFromBroadcasts(database, userId, at);
      }
    }
    for (const user of users) {
      const at = deletedAt.get(hashDiscordUserId(user.discord_user_id));
      // A setup made after the deletion is a new, wanted configuration.
      if (at && user.created_at <= at) removed += Number(remove.run(user.discord_user_id, at).changes);
    }
    return removed;
  }

  private prune(): DeletionEntry[] {
    if (!existsSync(this.path)) return [];
    const cutoff = new Date(this.now().getTime() - deletionJournalRetentionMs).toISOString();
    const lines = readFileSync(this.path, 'utf8').split('\n').filter((line) => line.trim() !== '');
    const entries = lines.flatMap((line): DeletionEntry[] => {
      try {
        const value = JSON.parse(line) as Partial<DeletionEntry>;
        return typeof value.user === 'string' && typeof value.deletedAt === 'string'
          ? [{ user: value.user, deletedAt: value.deletedAt }] : [];
      } catch {
        return [];
      }
    });
    const kept = entries.filter((entry) => entry.deletedAt >= cutoff);
    if (kept.length !== lines.length) {
      writeFileSync(this.path, kept.map((entry) => JSON.stringify(entry) + '\n').join(''), { encoding: 'utf8', mode: 0o600 });
    }
    return kept;
  }
}
