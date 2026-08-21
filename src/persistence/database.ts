import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class DatabaseInitializationError extends Error {
  public constructor(
    cause: unknown,
    public readonly databaseClosed: boolean,
  ) {
    super(cause instanceof Error ? cause.message : 'Database initialization failed', { cause });
    this.name = 'DatabaseInitializationError';
  }
}

const legacySchema = `
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;

  CREATE TABLE IF NOT EXISTS user_config (
    discord_user_id TEXT PRIMARY KEY NOT NULL,
    steam_id64 TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('tr', 'en')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS check_state (
    discord_user_id TEXT PRIMARY KEY NOT NULL,
    last_started_at TEXT,
    last_completed_at TEXT,
    last_status TEXT CHECK (last_status IN ('pending', 'success', 'unavailable', 'failed')),
    last_error_code TEXT,
    next_scheduled_at TEXT,
    FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wishlist_item_state (
    discord_user_id TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    on_sale INTEGER NOT NULL CHECK (on_sale IN (0, 1)),
    sale_key TEXT,
    currency TEXT,
    normal_price_minor INTEGER,
    final_price_minor INTEGER,
    discount_percent INTEGER,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (discord_user_id, app_id),
    FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    discord_user_id TEXT NOT NULL,
    app_id INTEGER NOT NULL,
    sale_key TEXT NOT NULL,
    game_name TEXT NOT NULL,
    currency TEXT NOT NULL,
    normal_price_minor INTEGER NOT NULL,
    final_price_minor INTEGER NOT NULL,
    discount_percent INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'sending', 'sent', 'failed')),
    created_at TEXT NOT NULL,
    last_attempt_at TEXT,
    last_error TEXT,
    PRIMARY KEY (discord_user_id, app_id, sale_key),
    FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
  );
`;

export function createDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec(legacySchema);
    migrateNotificationLog(database);
    migrateSaleEpisodes(database);
    migrateNotificationBackoff(database);
    return database;
  } catch (error: unknown) {
    try {
      database.close();
    } catch (closeError: unknown) {
      throw new DatabaseInitializationError(
        new AggregateError([error, closeError], 'Database initialization and close failed'),
        false,
      );
    }
    throw new DatabaseInitializationError(error, true);
  }
}

function migrateNotificationLog(database: DatabaseSync): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };

  if (versionRow.user_version >= 1) {
    return;
  }

  database.exec('BEGIN');

  try {
    database.exec('ALTER TABLE notification_log RENAME TO notification_log_legacy');
    database.exec(`
      CREATE TABLE notification_log (
        discord_user_id TEXT NOT NULL,
        app_id INTEGER NOT NULL,
        sale_key TEXT NOT NULL,
        game_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        normal_price_minor INTEGER NOT NULL,
        final_price_minor INTEGER NOT NULL,
        discount_percent INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate', 'sending', 'sent', 'failed')),
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        PRIMARY KEY (discord_user_id, app_id, sale_key),
        FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
      );
    `);
    database.exec(`
      INSERT INTO notification_log
        (discord_user_id, app_id, sale_key, game_name, currency,
         normal_price_minor, final_price_minor, discount_percent,
         status, created_at)
      SELECT discord_user_id, app_id, sale_key, game_name, currency,
             normal_price_minor, final_price_minor, discount_percent,
             status, created_at
      FROM notification_log_legacy;
    `);
    database.exec('DROP TABLE notification_log_legacy');
    database.exec('PRAGMA user_version = 1');
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrateSaleEpisodes(database: DatabaseSync): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };

  if (versionRow.user_version >= 2) {
    return;
  }

  database.exec('BEGIN');

  try {
    database.exec('ALTER TABLE user_config ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1');
    database.exec('ALTER TABLE wishlist_item_state RENAME TO wishlist_item_state_legacy');
    database.exec('ALTER TABLE notification_log RENAME TO notification_log_legacy');
    database.exec(`
      CREATE TABLE wishlist_item_state (
        discord_user_id TEXT NOT NULL,
        steam_id64 TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        app_id INTEGER NOT NULL,
        on_sale INTEGER NOT NULL CHECK (on_sale IN (0, 1)),
        sale_episode_id TEXT,
        sale_started_at TEXT,
        sale_key TEXT,
        currency TEXT,
        normal_price_minor INTEGER,
        final_price_minor INTEGER,
        discount_percent INTEGER,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (discord_user_id, config_version, app_id),
        FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
      );
    `);
    database.exec(`
      INSERT INTO wishlist_item_state
        (discord_user_id, steam_id64, config_version, app_id, on_sale,
         sale_episode_id, sale_started_at, sale_key, currency,
         normal_price_minor, final_price_minor, discount_percent, last_seen_at)
      SELECT s.discord_user_id, u.steam_id64, u.config_version, s.app_id, s.on_sale,
             CASE WHEN s.on_sale = 1
               THEN 'legacy-current:' || s.discord_user_id || ':' || s.app_id
               ELSE NULL
             END,
             CASE WHEN s.on_sale = 1 THEN s.last_seen_at ELSE NULL END,
             s.sale_key, s.currency, s.normal_price_minor, s.final_price_minor,
             s.discount_percent, s.last_seen_at
      FROM wishlist_item_state_legacy s
      JOIN user_config u ON u.discord_user_id = s.discord_user_id;
    `);
    database.exec(`
      CREATE TABLE notification_log (
        discord_user_id TEXT NOT NULL,
        steam_id64 TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        app_id INTEGER NOT NULL,
        sale_episode_id TEXT NOT NULL,
        sale_key TEXT NOT NULL,
        game_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        normal_price_minor INTEGER NOT NULL,
        final_price_minor INTEGER NOT NULL,
        discount_percent INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate', 'sending', 'sent', 'failed', 'expired')),
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        PRIMARY KEY (discord_user_id, config_version, app_id, sale_episode_id),
        FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
      );
    `);
    database.exec(`
      INSERT INTO notification_log
        (discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
         sale_key, game_name, currency, normal_price_minor, final_price_minor,
         discount_percent, status, created_at, last_attempt_at, last_error)
      SELECT n.discord_user_id, u.steam_id64, u.config_version, n.app_id,
             CASE
               WHEN n.status IN ('candidate', 'failed', 'sending')
                AND s.on_sale = 1
                AND n.sale_key = (
                  SELECT n2.sale_key
                  FROM notification_log_legacy n2
                  WHERE n2.discord_user_id = n.discord_user_id
                    AND n2.app_id = n.app_id
                    AND n2.status IN ('candidate', 'failed', 'sending')
                  ORDER BY n2.created_at DESC, n2.sale_key DESC
                  LIMIT 1
                )
               THEN s.sale_episode_id
               ELSE 'legacy:' || n.sale_key
             END,
             n.sale_key, n.game_name, n.currency, n.normal_price_minor,
             n.final_price_minor, n.discount_percent, n.status, n.created_at,
             n.last_attempt_at, n.last_error
      FROM notification_log_legacy n
      JOIN user_config u ON u.discord_user_id = n.discord_user_id
      LEFT JOIN wishlist_item_state s
        ON s.discord_user_id = n.discord_user_id
       AND s.config_version = u.config_version
       AND s.app_id = n.app_id;
    `);
    database.exec('DROP TABLE notification_log_legacy');
    database.exec('DROP TABLE wishlist_item_state_legacy');
    database.exec('PRAGMA user_version = 2');
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function migrateNotificationBackoff(database: DatabaseSync): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };

  if (versionRow.user_version >= 3) {
    return;
  }

  database.exec('BEGIN');

  try {
    database.exec('ALTER TABLE notification_log RENAME TO notification_log_v2');
    database.exec(`
      CREATE TABLE notification_log (
        discord_user_id TEXT NOT NULL,
        steam_id64 TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        app_id INTEGER NOT NULL,
        sale_episode_id TEXT NOT NULL,
        sale_key TEXT NOT NULL,
        game_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        normal_price_minor INTEGER NOT NULL,
        final_price_minor INTEGER NOT NULL,
        discount_percent INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN (
            'candidate', 'sending', 'sent', 'failed', 'terminal_failed', 'expired'
          )),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        PRIMARY KEY (discord_user_id, config_version, app_id, sale_episode_id),
        FOREIGN KEY (discord_user_id) REFERENCES user_config(discord_user_id) ON DELETE CASCADE
      );
    `);
    database.exec(`
      INSERT INTO notification_log
        (discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
         sale_key, game_name, currency, normal_price_minor, final_price_minor,
         discount_percent, status, attempt_count, next_attempt_at, created_at,
         last_attempt_at, last_error)
      SELECT discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
             sale_key, game_name, currency, normal_price_minor, final_price_minor,
             discount_percent, status,
             CASE
               WHEN status = 'failed' AND last_attempt_at IS NOT NULL THEN 1
               ELSE 0
             END,
             CASE WHEN status = 'failed' THEN COALESCE(last_attempt_at, created_at) ELSE NULL END,
             created_at, last_attempt_at, last_error
      FROM notification_log_v2;
    `);
    database.exec('DROP TABLE notification_log_v2');
    database.exec(`
      CREATE INDEX notification_retry_due_idx
      ON notification_log(discord_user_id, config_version, status, next_attempt_at);
    `);
    database.exec('PRAGMA user_version = 3');
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
}
