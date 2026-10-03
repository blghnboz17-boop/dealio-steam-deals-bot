import { afterEach, describe, expect, it, vi } from 'vitest';
import { reliabilityFixture, SteamFixture } from './helpers/reliability-fixture.js';
import { SteamClient } from '../src/steam/steam-client.js';
import { SteamRequestLimiter } from '../src/steam/request-limiter.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

afterEach(() => vi.restoreAllMocks());

it('batches 50 distinct 500-game wishlists into 100-app Steam requests without relying on cache overlap', async () => {
  const transport = new SteamFixture(500, false);
  const client = new SteamClient({ fetchImpl: transport.fetch, requestLimiter: new SteamRequestLimiter(3) });
  const results = await Promise.all(Array.from({ length: 50 }, (_, n) =>
    client.getWishlistWithErrors(String(76561198000000000n + BigInt(n)), 'US', 'en')));
  expect(results.every(result => result.items.length === 500 && result.errors.length === 0)).toBe(true);
  // One request per 100 games instead of one per game (previously 25,000 price requests).
  expect(transport.priceRequests).toBe(250);
  expect(transport.metadataRequests).toBe(250);
  expect(transport.peak).toBeLessThanOrEqual(3);
  expect(new Set(results.flatMap(result => result.items.map(item => item.appId))).size).toBe(25_000);
}, 20_000);

async function sale(f: ReturnType<typeof reliabilityFixture>) {
  f.addUser();
  await expect(f.services.check.check('fixture-user')).resolves.toMatchObject({ status: 'success', notificationCandidates: [] });
  f.steamTransport.mode = 'sale';
  f.advance(301_000);
  await expect(f.services.check.check('fixture-user')).resolves.toMatchObject({ status: 'success' });
}

describe('offline service integration with a reopened SQLite file', () => {
  it('does not repeatedly compile the same SQL for every game and scan', async () => {
    const f = reliabilityFixture(20);
    try {
      const prepare = vi.spyOn(f.services.db, 'prepare');
      const users = Array.from({ length: 5 }, (_, n) => `sql-${n}`);
      users.forEach((user, n) => f.addUser(user, n));
      for (const mode of ['regular', 'sale', 'sale'] as const) {
        f.steamTransport.mode = mode; f.advance(301_000);
        const results = await Promise.all(users.map(user => f.services.check.check(user)));
        expect(results.every(result => result.status === 'success')).toBe(true);
      }
      expect(f.counts()).toEqual([{ status: 'candidate', count: 100 }]);
      expect(prepare.mock.calls.length).toBeLessThan(200);
    } finally { f.close(); }
  });

  it('revalidates a pending sale at delivery and waits through a Steam outage', async () => {
    const f = reliabilityFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f); f.steamTransport.mode = 'outage'; f.advance(301_000);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.discordTransport.accepted).toHaveLength(0);
      expect(f.counts()).toEqual([{ status: 'candidate', count: 3 }]);
      f.restart(); f.steamTransport.mode = 'sale'; f.advance(301_000);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.discordTransport.accepted).toHaveLength(1);
    } finally { f.close(); }
  });

  it('allows queued event-loop work between simultaneous users database commits', async () => {
    const f = reliabilityFixture(100);
    try {
      const users = Array.from({ length: 12 }, (_, n) => `burst-${n}`);
      users.forEach((user, n) => f.addUser(user, n));
      const fixtureResult = await f.steam.getWishlistWithErrors('76561198000000000', 'US', 'en');
      // Cached network results can resolve together; real SQLite work still runs.
      vi.spyOn(f.steam, 'getWishlistWithErrors').mockResolvedValue(fixtureResult);
      const original = f.services.states.runInImmediateTransaction.bind(f.services.states);
      let pendingEventLoopWork = false;
      let starvedCommits = 0;
      vi.spyOn(f.services.states, 'runInImmediateTransaction').mockImplementation(operation => {
        if (pendingEventLoopWork) starvedCommits++;
        pendingEventLoopWork = true;
        setImmediate(() => { pendingEventLoopWork = false; });
        return original(operation);
      });
      const results = await Promise.all(users.map(user => f.services.check.check(user)));
      expect(results.every(result => result.status === 'success')).toBe(true);
      expect(starvedCommits).toBe(0);
    } finally { f.close(); }
  });

  it('recovers a committed sending claim after abrupt process exit without database close', async () => {
    const f = reliabilityFixture(3, { sendingTimeoutMs: 1_000 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f);
      const child = spawnSync(process.execPath, ['--import', 'tsx',
        fileURLToPath(new URL('./helpers/crash-after-claim.ts', import.meta.url)), f.path], { encoding: 'utf8', timeout: 15_000 });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(23);
      f.restart();
      expect(f.counts()).toEqual([{ status: 'sending', count: 3 }]);
      f.advance(901_000);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.discordTransport.accepted).toHaveLength(1);
    } finally { f.close(); }
  });

  it('preserves the sale episode across unknown prices and Steam outages without false or duplicate sales', async () => {
    const f = reliabilityFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      f.addUser();
      await f.services.check.check('fixture-user');
      for (const mode of ['outage', 'unknown', 'wishlist-outage'] as const) {
        f.steamTransport.mode = mode; f.advance(301_000);
        await f.services.check.check('fixture-user');
        expect(f.counts()).toEqual([]);
      }
      f.steamTransport.mode = 'sale'; f.advance(301_000);
      await f.services.check.check('fixture-user');
      expect(f.counts()).toEqual([{ status: 'candidate', count: 3 }]);
      await f.services.notifications.deliverPending('fixture-user');
      for (const mode of ['outage', 'unknown', 'wishlist-outage', 'sale'] as const) {
        f.steamTransport.mode = mode; f.advance(301_000);
        await f.services.check.check('fixture-user');
        await f.services.notifications.deliverPending('fixture-user');
      }
      f.restart();
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.discordTransport.accepted).toHaveLength(1);
    } finally { f.close(); }
  });

  it('keeps all pending notifications through restart and concurrent delivery attempts', async () => {
    const f = reliabilityFixture(17);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f); f.restart();
      expect(f.counts()).toEqual([{ status: 'candidate', count: 17 }]);
      const results = await Promise.all(Array.from({ length: 20 }, () => f.services.notifications.deliverPending('fixture-user')));
      expect(results.reduce((sum, r) => sum + r.sentCount, 0)).toBe(17);
      expect(f.counts()).toEqual([{ status: 'sent', count: 17 }]);
      expect(f.discordTransport.accepted).toHaveLength(4);
      f.restart();
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.discordTransport.accepted).toHaveLength(4);
    } finally { f.close(); }
  });

  it.each(['before-accept', 'lost-response'] as const)('recovers %s after restart while retaining the same batch identity', async failure => {
    const f = reliabilityFixture(3, { retryDelayMs: 1_000 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f); f.discordTransport.failure = failure;
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'failed', count: 3 }]);
      const batch = f.services.db.prepare('SELECT batch_id FROM notification_batch').get();
      f.restart(); f.discordTransport.failure = 'none';
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.discordTransport.attempts).toBe(1);
      f.advance(1_001);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.services.db.prepare('SELECT batch_id FROM notification_batch').get()).toEqual(batch);
      expect(f.discordTransport.accepted).toHaveLength(1);
    } finally { f.close(); }
  });

  it('recovers a sending batch after successful Discord delivery and a rolled-back receipt write', async () => {
    const f = reliabilityFixture(3, { sendingTimeoutMs: 1_000 });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f);
      f.services.db.exec(`CREATE TRIGGER injected_receipt_failure BEFORE UPDATE OF status ON notification_batch
        WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END;`);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sending', count: 3 }]);
      f.restart();
      f.services.db.exec('DROP TRIGGER injected_receipt_failure');
      f.advance(1_001);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.discordTransport.accepted).toHaveLength(1);
    } finally { f.close(); }
  });

  it('retains blocked DM outcomes after restart without an infinite retry loop', async () => {
    const f = reliabilityFixture();
    try {
      await sale(f); f.discordTransport.failure = 'blocked';
      await f.services.notifications.deliverPending('fixture-user');
      f.restart(); f.advance(86_400_000);
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'terminal_failed', count: 3 }]);
      expect(f.discordTransport.attempts).toBe(1);
      expect(f.services.users.findByDiscordUserId('fixture-user')?.dmDeliveryBlockedAt).toEqual(expect.any(String));
    } finally { f.close(); }
  });

  it('documents at-least-once delivery beyond the Discord nonce window with production retry timing', async () => {
    const f = reliabilityFixture();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await sale(f); f.discordTransport.failure = 'lost-response';
      await f.services.notifications.deliverPending('fixture-user');
      f.restart(); f.advance(301_000); f.discordTransport.failure = 'none';
      await f.services.notifications.deliverPending('fixture-user');
      expect(f.counts()).toEqual([{ status: 'sent', count: 3 }]);
      expect(f.discordTransport.accepted).toHaveLength(2);
      expect(f.discordTransport.accepted[0].nonce).toBe(f.discordTransport.accepted[1].nonce);
    } finally { f.close(); }
  });
});

it('pauses all users behind Steam 429 and recovers without exceeding the shared request limit', async () => {
  const transport = new SteamFixture(20);
  transport.rateLimitsRemaining = 1;
  const gate = Promise.withResolvers<void>();
  const sleep = vi.fn(() => gate.promise);
  const client = new SteamClient({ fetchImpl: transport.fetch, requestLimiter: new SteamRequestLimiter(3, sleep) });
  const scans = Array.from({ length: 20 }, (_, n) => client.getWishlistWithErrors(String(76561198000000000n + BigInt(n)), 'US', 'en'));
  try {
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(1_000, undefined));
    const requestsBefore = transport.wishlistRequests + transport.metadataRequests + transport.priceRequests;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(transport.wishlistRequests + transport.metadataRequests + transport.priceRequests).toBe(requestsBefore);
  } finally { gate.resolve(); }
  const results = await Promise.all(scans);
  expect(results.every(result => result.items.length === 20 && result.errors.length === 0)).toBe(true);
  expect(transport.peak).toBeLessThanOrEqual(3);
  // Twenty users share one in-flight batch for the same twenty games.
  expect(transport.priceRequests).toBe(1);
  expect(transport.metadataRequests).toBe(1);
});
