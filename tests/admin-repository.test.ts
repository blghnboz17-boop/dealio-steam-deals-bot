import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { AdminRepository } from '../src/persistence/admin-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { seedNotification, seedUser } from './helpers/admin-seed.js';

const now = new Date('2026-10-06T12:00:00.000Z');

describe('AdminRepository', () => {
  let database: DatabaseSync;
  let repository: AdminRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    repository = new AdminRepository(database);
    seedUser(database, { id: '100000000000000001', createdAt: '2026-10-06T08:00:00.000Z',
      games: [{ appId: 10, name: 'Alpha', discount: 50 }, { appId: 20, name: 'Beta' }] });
    seedUser(database, { id: '100000000000000002', country: 'DE', language: 'de', enabled: false,
      createdAt: '2026-09-01T00:00:00.000Z', games: [{ appId: 10, name: 'Alpha', discount: 50 }] });
    seedUser(database, { id: '100000000000000003', blocked: true, createdAt: '2026-10-02T00:00:00.000Z' });
    seedNotification(database, '100000000000000001', 10, 'sent', '2026-10-06T10:00:00.000Z');
    seedNotification(database, '100000000000000002', 10, 'sent', '2026-09-20T10:00:00.000Z');
    seedNotification(database, '100000000000000001', 20, 'candidate', '2026-10-06T11:00:00.000Z');
  });

  afterEach(() => database.close());

  it('counts users, alerts and the queue', () => {
    expect(repository.overviewCounts(now)).toMatchObject({
      users: 3, enabled: 1, paused: 1, dmBlocked: 1, newUsers24h: 1, newUsers7d: 2,
      alertsSent24h: 1, alertsSent7d: 1, alertsSentTotal: 2, queuePending: 1,
      trackedGames: 2, gamesOnSale: 1,
    });
  });

  it('lists users with wishlist, sale and alert summaries', () => {
    const users = repository.users();
    expect(users.map((user) => user.discordUserId)).toEqual([
      '100000000000000001', '100000000000000003', '100000000000000002',
    ]);
    expect(users[0]).toMatchObject({ wishlistCount: 2, onSaleCount: 1, alertsSent: 1, pendingAlerts: 1, enabled: true });
    expect(users[2]).toMatchObject({ storeCountryCode: 'DE', enabled: false, wishlistCount: 1 });
    expect(users[1]).toMatchObject({ dmDeliveryErrorCode: '50007', wishlistCount: 0 });
  });

  it('ignores state left from an older configuration generation', () => {
    database.prepare('UPDATE user_config SET config_version = 2 WHERE discord_user_id = ?').run('100000000000000002');
    expect(repository.users().find((user) => user.discordUserId === '100000000000000002'))
      .toMatchObject({ onSaleCount: 0, wishlistCount: null });
    expect(repository.topWishlistedGames(10)).toEqual([
      { appId: 10, name: 'Alpha', count: 1 }, { appId: 20, name: 'Beta', count: 1 },
    ]);
  });

  it('ranks games across wishlists', () => {
    expect(repository.topWishlistedGames(10)[0]).toEqual({ appId: 10, name: 'Alpha', count: 2 });
    expect(repository.topGamesOnSale(10)).toEqual([{ appId: 10, name: 'Alpha', count: 2, maxDiscountPercent: 50 }]);
    expect(repository.topAlertedGames(30, 10, now)).toEqual([
      { appId: 10, name: 'Game 10', count: 2, maxDiscountPercent: 50 },
    ]);
  });

  it('groups days and distributions', () => {
    expect(repository.signupsByDay(10, now)).toEqual([
      { day: '2026-10-02', count: 1 }, { day: '2026-10-06', count: 1 },
    ]);
    expect(repository.alertsByDay(30, now)).toEqual([
      { day: '2026-09-20', count: 1 }, { day: '2026-10-06', count: 1 },
    ]);
    expect(repository.distribution('store_country_code')).toEqual([
      { key: 'TR', count: 2 }, { key: 'DE', count: 1 },
    ]);
    expect(repository.notificationModes()).toEqual([{ key: 'instant', count: 3 }]);
    expect(repository.schemaVersion()).toBeGreaterThanOrEqual(12);
  });
});
