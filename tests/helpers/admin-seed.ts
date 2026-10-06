import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface SeedUser {
  readonly id: string;
  readonly country?: string;
  readonly language?: string;
  readonly enabled?: boolean;
  readonly blocked?: boolean;
  readonly createdAt?: string;
  readonly configVersion?: number;
  readonly games?: ReadonlyArray<{ appId: number; name: string; discount?: number; headerImageUrl?: string }>;
}

/** Inserts a configured user with a snapshot and item states, as the check path would. */
export function seedUser(database: DatabaseSync, user: SeedUser): void {
  const createdAt = user.createdAt ?? '2026-10-01T00:00:00.000Z';
  const version = user.configVersion ?? 1;
  database.prepare(`INSERT INTO user_config (discord_user_id, steam_id64, language, enabled, created_at, updated_at,
      config_version, minimum_discount_percent, configuration_id, store_country_code, dm_opt_in_at,
      dm_delivery_blocked_at, dm_delivery_error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`).run(user.id, `7656119800000${user.id.slice(-4)}`,
    user.language ?? 'tr', user.enabled === false || user.blocked ? 0 : 1, createdAt, createdAt, version, randomUUID(),
    user.country ?? 'TR', createdAt, user.blocked ? createdAt : null, user.blocked ? '50007' : null);
  const games = user.games ?? [];
  const items = games.map((game) => ({
    appId: game.appId, name: game.name, priority: 0, dateAdded: null, onSale: (game.discount ?? 0) > 0,
    price: { currency: 'USD', initialMinor: 1000, finalMinor: 1000 - (game.discount ?? 0) * 10,
      discountPercent: game.discount ?? 0, isFree: false },
    ...(game.headerImageUrl ? { headerImageUrl: game.headerImageUrl } : {}),
  }));
  database.prepare('INSERT INTO wishlist_snapshot VALUES (?, ?, ?, ?, ?)')
    .run(user.id, version, user.language ?? 'tr', createdAt, JSON.stringify({ items, errors: [] }));
  for (const item of items) {
    database.prepare(`INSERT INTO wishlist_item_state (discord_user_id, steam_id64, config_version, app_id, on_sale,
        sale_episode_id, currency, normal_price_minor, final_price_minor, discount_percent, last_seen_at, store_country_code)
      VALUES (?, 'x', ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?)`).run(user.id, version, item.appId, item.onSale ? 1 : 0,
      item.onSale ? `episode-${item.appId}` : null, item.price.initialMinor, item.price.finalMinor,
      item.price.discountPercent, createdAt, user.country ?? 'TR');
  }
}

export function seedNotification(database: DatabaseSync, userId: string, appId: number, status: string,
  at: string, configVersion = 1): void {
  database.prepare(`INSERT INTO notification_log (discord_user_id, steam_id64, config_version, app_id, sale_episode_id,
      sale_key, game_name, currency, normal_price_minor, final_price_minor, discount_percent, status, attempt_count,
      created_at, last_attempt_at, delivered_at, store_country_code)
    VALUES (?, 'x', ?, ?, ?, 'k', ?, 'USD', 1000, 500, 50, ?, 1, ?, ?, ?, 'TR')`)
    .run(userId, configVersion, appId, `episode-${appId}-${at}`, `Game ${appId}`, status, at, at, status === 'sent' ? at : null);
}
