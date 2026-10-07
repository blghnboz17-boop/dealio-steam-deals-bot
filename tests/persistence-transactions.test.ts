import { expect, it } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';
import { DiscountThresholdRepository } from '../src/persistence/discount-threshold-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

const at = '2026-10-01T00:00:00.000Z';

function withOngoingSale() {
  const database = createDatabase(':memory:');
  const config = new UserConfigRepository(database).upsert('tx-user', '76561198000000020', 'en', 'US', at);
  new WishlistStateRepository(database).recordObservation({ ...config, steamId64: '76561198000000020' }, {
    item: {
      appId: 10, name: 'Game', priority: 0, dateAdded: null, onSale: true,
      price: { currency: 'USD', initialMinor: 1000, finalMinor: 500, discountPercent: 50, isFree: false },
    },
    saleKey: 'USD:1000:500:50',
    observedAt: at,
  }, { baseline: true });
  // The alert baseline step fails (for example the disk fills up mid-change).
  database.exec(`CREATE TRIGGER fail_baseline BEFORE UPDATE OF alerted_discount_percent ON wishlist_item_state
    BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
  return { database, config, thresholds: new DiscountThresholdRepository(database) };
}

it('keeps a game threshold and its alert baseline together when the baseline step fails', () => {
  const { database, config, thresholds } = withOngoingSale();
  try {
    expect(() => thresholds.setGameOverride(config, 10, 40, at)).toThrow('disk failure');
    expect(database.isTransaction).toBe(false);
    expect(thresholds.findGameOverride(config, 10)).toBeNull();
  } finally {
    database.close();
  }
});

it('keeps a removed game threshold when the baseline step fails', () => {
  const { database, config, thresholds } = withOngoingSale();
  try {
    database.exec('DROP TRIGGER fail_baseline');
    expect(thresholds.setGameOverride(config, 10, 60, at)).toBe(true);
    database.exec(`CREATE TRIGGER fail_baseline BEFORE UPDATE OF alerted_discount_percent ON wishlist_item_state
      BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
    expect(() => thresholds.deleteGameOverride(config, 10)).toThrow('disk failure');
    expect(database.isTransaction).toBe(false);
    expect(thresholds.findGameOverride(config, 10)).toBe(60);
  } finally {
    database.close();
  }
});
