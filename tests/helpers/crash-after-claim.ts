import assert from 'node:assert/strict';
import { createDatabase } from '../../src/persistence/database.js';
import { UserConfigRepository } from '../../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../../src/persistence/wishlist-state-repository.js';

const database = createDatabase(process.argv[2]);
const users = new UserConfigRepository(database);
const states = new WishlistStateRepository(database);
const user = users.findByDiscordUserId('fixture-user');
assert.ok(user);
// The parent advances its synthetic clock five minutes when creating the sale.
const claimedAt = new Date(Date.now() + 301_000).toISOString();
const candidates = states.findRetryableNotificationCandidates(user, claimedAt);
assert.equal(candidates.length, 3);
assert.ok(states.createAndClaimNotificationBatch(user, 'en', candidates as [typeof candidates[number], ...typeof candidates], claimedAt));
// Intentionally skip close/finally: exercise recovery from a process interruption.
process.exit(23);
