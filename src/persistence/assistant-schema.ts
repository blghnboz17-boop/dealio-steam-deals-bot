
import type { DatabaseSync } from 'node:sqlite';

export function migrateAssistant(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version >= 10) return;
  try { db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE game_rule (
      discord_user_id TEXT NOT NULL REFERENCES user_config(discord_user_id) ON DELETE CASCADE,
      config_version INTEGER NOT NULL, app_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('inherit','percent','target')),
      percent INTEGER CHECK(percent BETWEEN 0 AND 100),
      target_minor INTEGER CHECK(target_minor >= 0), currency TEXT,
      muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 1,
      eligible INTEGER NOT NULL DEFAULT 0 CHECK(eligible IN (0,1)),
      initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN (0,1)),
      event_id TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY(discord_user_id, config_version, app_id),
      CHECK(mode != 'target' OR (target_minor IS NOT NULL AND currency IS NOT NULL)),
      CHECK(mode != 'percent' OR percent IS NOT NULL)
    );
    INSERT INTO game_rule(discord_user_id,config_version,app_id,mode,percent,target_minor,currency,muted,revision,eligible,initialized,event_id,updated_at)
      SELECT discord_user_id,config_version,app_id,'percent',minimum_discount_percent,NULL,NULL,0,1,0,0,NULL,updated_at FROM game_discount_threshold;
    CREATE TABLE notification_preference (
      discord_user_id TEXT PRIMARY KEY REFERENCES user_config(discord_user_id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'instant' CHECK(mode IN ('instant','quiet','digest')),
      timezone TEXT, quiet_start INTEGER, quiet_end INTEGER, digest_minute INTEGER,
      last_digest_date TEXT,
      CHECK(mode = 'instant' OR timezone IS NOT NULL),
      CHECK(mode != 'quiet' OR (quiet_start BETWEEN 0 AND 1439 AND quiet_end BETWEEN 0 AND 1439 AND quiet_start != quiet_end)),
      CHECK(mode != 'digest' OR digest_minute BETWEEN 0 AND 1439)
    );
    CREATE TABLE wishlist_snapshot (
      discord_user_id TEXT NOT NULL REFERENCES user_config(discord_user_id) ON DELETE CASCADE,
      config_version INTEGER NOT NULL, language TEXT NOT NULL,
      captured_at TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(discord_user_id, config_version, language)
    );
    CREATE TABLE price_observation (
      id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, country TEXT NOT NULL,
      currency TEXT NOT NULL, initial_minor INTEGER NOT NULL, final_minor INTEGER NOT NULL,
      observed_at TEXT NOT NULL
    );
    CREATE INDEX price_history ON price_observation(app_id,country,currency,observed_at);
    ALTER TABLE wishlist_item_state ADD COLUMN rule_event_id TEXT;
    ALTER TABLE notification_log ADD COLUMN rule_revision INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE notification_log ADD COLUMN reason TEXT NOT NULL DEFAULT 'discount';
    ALTER TABLE notification_log ADD COLUMN discord_message_id TEXT;
    ALTER TABLE notification_log ADD COLUMN delivered_at TEXT;
    PRAGMA user_version = 10;
    COMMIT;`); } catch(error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
