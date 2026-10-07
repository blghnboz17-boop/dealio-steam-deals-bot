import { expect, it } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

const user = 'retention-user';
const oldSteamId = '76561198000000010';
const newSteamId = '76561198000000011';
const createdAt = '2026-08-01T00:00:00.000Z';

function sale(appId: number) {
  return {
    appId, name: `Game ${appId}`, priority: 0, dateAdded: null, onSale: true,
    price: { currency: 'USD', initialMinor: 1000, finalMinor: 500, discountPercent: 50, isFree: false },
  };
}

function count(database: ReturnType<typeof createDatabase>, sql: string, ...values: Array<string | number>): number {
  return Number((database.prepare(sql).get(...values) as { n: number }).n);
}

it('drops earlier configuration generations, so their state and old alert history age out', () => {
  const database = createDatabase(':memory:');
  try {
    const users = new UserConfigRepository(database);
    const state = new WishlistStateRepository(database);
    const first = users.upsert(user, oldSteamId, 'en', 'US', createdAt);
    const firstScope = { ...first, steamId64: oldSteamId };
    state.recordObservation(firstScope, { item: { ...sale(10), onSale: false, price: { ...sale(10).price,
      finalMinor: 1000, discountPercent: 0 } }, saleKey: null, observedAt: createdAt });
    // The sale starts and is alerted, while the user still follows the first account.
    const alerted = state.recordObservation(firstScope, { item: sale(10), saleKey: 'USD:1000:500:50', observedAt: createdAt });
    expect(alerted.notificationCandidate).not.toBeNull();
    database.prepare("UPDATE notification_log SET status = 'sent' WHERE discord_user_id = ?").run(user);
    state.assistant.saveRule(first, 10, { mode: 'percent', percent: 40, targetMinor: null, currency: null, muted: false }, createdAt);

    // The user switches to another Steam account; the new generation has its own state.
    const second = users.upsert(user, newSteamId, 'en', 'US', '2026-08-02T00:00:00.000Z');
    expect(second.configVersion).toBe(first.configVersion + 1);
    state.recordObservation({ ...second, steamId64: newSteamId },
      { item: sale(20), saleKey: 'USD:1000:500:50', observedAt: '2026-08-02T00:00:00.000Z' });
    state.assistant.saveRule(second, 20, { mode: 'percent', percent: 30, targetMinor: null, currency: null, muted: false },
      '2026-08-02T00:00:00.000Z');

    state.assistant.cleanup(new Date('2026-10-07T00:00:00.000Z'));

    for (const table of ['wishlist_item_state', 'game_rule', 'game_discount_threshold']) {
      expect(count(database, `SELECT COUNT(*) AS n FROM ${table} WHERE discord_user_id = ? AND config_version = ?`,
        user, first.configVersion)).toBe(0);
      expect(count(database, `SELECT COUNT(*) AS n FROM ${table} WHERE discord_user_id = ? AND config_version = ?`,
        user, second.configVersion)).toBe(1);
    }
    // The old account's alert history is older than 30 days and no longer pinned by its sale.
    expect(count(database, 'SELECT COUNT(*) AS n FROM notification_log WHERE steam_id64 = ?', oldSteamId)).toBe(0);
    expect(count(database, 'SELECT COUNT(*) AS n FROM wishlist_item_state WHERE steam_id64 = ?', oldSteamId)).toBe(0);
  } finally {
    database.close();
  }
});
