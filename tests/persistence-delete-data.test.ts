import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AdminControlRepository } from '../src/persistence/admin-control-repository.js';
import { BroadcastRepository } from '../src/persistence/broadcast-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { DeletionJournal, hashDiscordUserId } from '../src/persistence/deletion-journal.js';
import { TelemetryRepository } from '../src/persistence/telemetry-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

const user = '111111111111111111';
const steamId = '76561198011111111';
const other = '222222222222222222';
const at = '2026-10-01T00:00:00.000Z';
const content = { en: { title: 'Hello', body: 'Personal note' } };

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Every stored value that still holds the user's Discord or Steam ID, outside records the policy keeps. */
function remainingReferences(database: DatabaseSync): string[] {
  // The privacy policy keeps the block record until the block is lifted.
  const retained = new Set(['user_block']);
  const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const found: string[] = [];
  for (const { name } of tables) {
    if (retained.has(name)) continue;
    const columns = database.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    for (const column of columns) {
      const row = database.prepare(`SELECT COUNT(*) AS n FROM ${name}
        WHERE instr(CAST(${column.name} AS TEXT), ?) > 0 OR instr(CAST(${column.name} AS TEXT), ?) > 0`)
        .get(user, steamId) as { n: number };
      if (row.n > 0) found.push(`${name}.${column.name}`);
    }
  }
  return found;
}

function seed(database: DatabaseSync): void {
  const users = new UserConfigRepository(database);
  const config = users.upsert(user, steamId, 'en', 'US', at);
  users.upsert(other, '76561198022222222', 'en', 'US', at);
  const state = new WishlistStateRepository(database);
  const scope = { ...config, steamId64: steamId };
  const item = {
    appId: 10, name: 'Game', priority: 0, dateAdded: null, onSale: true,
    price: { currency: 'USD', initialMinor: 1000, finalMinor: 500, discountPercent: 50, isFree: false },
  };
  state.recordObservation(scope, { item, saleKey: 'USD:1000:500:50', observedAt: at }, { baseline: true });
  state.recordObservation(scope, {
    item: { ...item, appId: 11, price: { ...item.price, finalMinor: 400, discountPercent: 60 } },
    saleKey: 'USD:1000:400:60', observedAt: at,
  });
  state.recordObservation(scope, {
    item: { ...item, appId: 11, price: { ...item.price, finalMinor: 400, discountPercent: 60 } },
    saleKey: 'USD:1000:400:60', observedAt: at,
  });
  state.assistant.saveRule(config, 10, { mode: 'percent', percent: 70, targetMinor: null, currency: null, muted: false }, at);
  state.assistant.savePreference(user, { mode: 'quiet', timezone: 'Europe/Istanbul', quietStart: 0, quietEnd: 60, digestMinute: null });
  state.assistant.saveSnapshot(config, { items: [item], errors: [] } as never, at);
  const telemetry = new TelemetryRepository(database);
  for (const id of [user, other]) {
    telemetry.recordInteraction({ discordUserId: id, guildId: '333333333333333333', context: 'guild', install: 'guild',
      kind: 'command', action: 'dealio', locale: 'en-US', occurredAt: at });
  }
  const broadcasts = new BroadcastRepository(database);
  broadcasts.create('direct', content, { userIds: [user] }, [{ discordUserId: user, language: 'en' }], at);
  broadcasts.create('named', content, { userIds: [user, other] },
    [{ discordUserId: user, language: 'en' }, { discordUserId: other, language: 'en' }], at);
  broadcasts.create('everyone', content, {},
    [{ discordUserId: user, language: 'en' }, { discordUserId: other, language: 'en' }], at);
  const controls = new AdminControlRepository(database);
  controls.audit('user.message', user, 'en', 'ok', at);
  controls.audit('broadcast.create', null, JSON.stringify({ userIds: [user, other] }), 'ok', at);
}

it('/delete-data leaves no trace of the user outside the records the policy keeps', () => {
  const database = createDatabase(':memory:');
  try {
    seed(database);
    expect(remainingReferences(database).length).toBeGreaterThan(5);
    expect(new UserConfigRepository(database).deleteByDiscordUserId(user)).toBe(true);

    expect(remainingReferences(database)).toEqual([]);
    const broadcasts = new BroadcastRepository(database);
    // A message addressed only to them goes with its content; the others keep their other recipients.
    expect(broadcasts.get('direct')).toBeNull();
    expect(broadcasts.get('named')?.audience).toEqual({ userIds: [other] });
    expect(broadcasts.recipients('named').map((row) => row.discordUserId)).toEqual([other]);
    expect(broadcasts.recipients('everyone').map((row) => row.discordUserId)).toEqual([other]);
    expect(new UserConfigRepository(database).findByDiscordUserId(other)).not.toBeNull();
    // The owner's audit rows stay (one year), naming the user only by the journal's hash.
    expect(new AdminControlRepository(database).auditEntries(10).map((entry) => [entry.action, entry.target, entry.detail]))
      .toEqual([
        ['broadcast.create', null, JSON.stringify({ userIds: [hashDiscordUserId(user), other] })],
        ['user.message', hashDiscordUserId(user), 'en'],
      ]);
  } finally {
    database.close();
  }
});

it('rolls the whole deletion back when one step fails', () => {
  const database = createDatabase(':memory:');
  try {
    seed(database);
    database.exec(`CREATE TRIGGER refuse_user_delete BEFORE DELETE ON user_config
      BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
    expect(() => new UserConfigRepository(database).deleteByDiscordUserId(user)).toThrow('disk failure');
    expect(database.isTransaction).toBe(false);
    expect(database.prepare('SELECT COUNT(*) AS n FROM interaction_event WHERE discord_user_id = ?').get(user))
      .toEqual({ n: 1 });
    expect(new BroadcastRepository(database).get('direct')).not.toBeNull();
  } finally {
    database.close();
  }
});

it('re-applies the announcement part of a deletion to a restored database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dealio-delete-'));
  directories.push(directory);
  const database = createDatabase(':memory:');
  try {
    seed(database);
    const journal = new DeletionJournal(join(directory, 'deletions.jsonl'), () => new Date('2026-10-05T00:00:00.000Z'));
    journal.record(user, '2026-10-02T00:00:00.000Z');
    // A message sent after the deletion (to a new setup) is kept.
    new BroadcastRepository(database).create('later', content, { userIds: [user] },
      [{ discordUserId: user, language: 'en' }], '2026-10-03T00:00:00.000Z');

    expect(journal.reconcile(database)).toBe(1);
    const broadcasts = new BroadcastRepository(database);
    expect(broadcasts.get('direct')).toBeNull();
    expect(broadcasts.get('named')?.audience).toEqual({ userIds: [other] });
    expect(broadcasts.get('later')?.audience).toEqual({ userIds: [user] });
    expect(broadcasts.recipients('everyone').map((row) => row.discordUserId)).toEqual([other]);
    expect(new AdminControlRepository(database).auditEntries(10, hashDiscordUserId(user)).map((entry) => entry.action))
      .toEqual(['user.message']);
    expect(remainingReferences(database).filter((reference) => reference.startsWith('admin_audit'))).toEqual([]);
  } finally {
    database.close();
  }
});

it('records a completed owner deletion without the deleted Discord ID', () => {
  const database = createDatabase(':memory:');
  try {
    const controls = new AdminControlRepository(database);
    controls.audit('user.delete', user, null, 'ok', at);
    controls.audit('user.delete', other, null, 'failed', at);
    expect(controls.auditEntries(10).map((entry) => entry.target)).toEqual([other, hashDiscordUserId(user)]);
  } finally {
    database.close();
  }
});
