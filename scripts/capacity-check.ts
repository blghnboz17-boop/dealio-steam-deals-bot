import assert from 'node:assert/strict';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { reliabilityFixture } from '../tests/helpers/reliability-fixture.js';
import { steamBatchSize } from '../src/steam/steam-client.js';
import { maximumGamesPerMessage } from '../src/discord/notification-sender.js';

// This is a controlled local profile, never a live Steam/Discord load generator.
// Every user has 500 wishlist games that all go on sale at once: a worst case, far above
// real use. Set CAPACITY_USERS to the user count to check.
const userCount = Number(process.env.CAPACITY_USERS ?? 50);
assert.ok(Number.isSafeInteger(userCount) && userCount > 0, 'CAPACITY_USERS must be a positive integer');
const gamesPerUser = 500;
const sourcePaths = [
  ...readdirSync('src', { recursive: true, encoding: 'utf8' }).filter(path => path.endsWith('.ts')).map(path => `src/${path.replaceAll('\\', '/')}`),
  'tests/helpers/reliability-fixture.ts', 'scripts/capacity-check.ts',
].sort();
const sourceHash = createHash('sha256');
for (const path of sourcePaths) sourceHash.update(path).update('\0').update(readFileSync(path)).update('\0');
const sourceSha256 = sourceHash.digest('hex');
const f = reliabilityFixture(gamesPerUser);
const users = Array.from({ length: userCount }, (_, index) => {
  const user = `synthetic-${index}`;
  f.addUser(user, index);
  return user;
});
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const started = performance.now();
const phases: Array<{ phase: string; elapsedMs: number; rssMiB: number }> = [];
const observedRss: number[] = [process.memoryUsage().rss];
const sample = setInterval(() => observedRss.push(process.memoryUsage().rss), 25);

async function scan(phase: string, candidatesPerUser: number) {
  const start = performance.now();
  // A burst of fifty different users. The Steam limiter must still cap at three.
  const results = await Promise.all(users.map(user => f.services.check.check(user)));
  for (const result of results) {
    assert.equal(result.status, 'success');
    if (result.status !== 'success') throw new Error('Scan failed');
    assert.equal(result.checkedCount, gamesPerUser);
    assert.equal(result.failedItems.length, 0);
    assert.equal(result.notificationCandidates.length, candidatesPerUser);
  }
  observedRss.push(process.memoryUsage().rss);
  phases.push({ phase, elapsedMs: Math.round(performance.now() - start), rssMiB: Math.round(process.memoryUsage().rss / 1048576) });
  console.error(`[capacity] ${phase} complete`);
}

try {
  await scan('baseline', 0);
  assert.equal(f.steamTransport.priceRequests, Math.ceil(gamesPerUser / steamBatchSize));
  f.steamTransport.mode = 'sale'; f.advance(301_000);
  await scan('sale', gamesPerUser);
  assert.equal(f.steamTransport.priceRequests, Math.ceil(gamesPerUser / steamBatchSize) * 2);
  f.restart();
  assert.deepEqual(f.counts().map(row => ({ ...row })), [{ status: 'candidate', count: userCount * gamesPerUser }]);
  const deliveryStarted = performance.now();
  // Match the production scheduler's three concurrent users, using real batch planning.
  const originalLog = console.log;
  console.log = () => undefined; // Keep 25,000 timing lines out of the evidence report.
  try {
    for (let index = 0; index < users.length; index += 3) {
      const results = await Promise.all(users.slice(index, index + 3).map(user => f.services.notifications.deliverPending(user)));
      for (const result of results) {
        assert.equal(result.sentCount, gamesPerUser);
        assert.equal(result.failedCount, 0);
      }
    }
  } finally { console.log = originalLog; }
  phases.push({ phase: 'delivery', elapsedMs: Math.round(performance.now() - deliveryStarted), rssMiB: Math.round(process.memoryUsage().rss / 1048576) });
  const deliveredMessages = f.discordTransport.accepted.length;
  assert.equal(deliveredMessages, userCount * Math.ceil(gamesPerUser / maximumGamesPerMessage));
  assert.equal(new Set(f.discordTransport.accepted.map(message => message.nonce)).size, deliveredMessages);
  await scan('same-sale', 0);
  for (const user of users) assert.equal((await f.services.notifications.deliverPending(user)).sentCount, 0);
  assert.equal(f.discordTransport.accepted.length, deliveredMessages);
  assert.deepEqual(f.counts().map(row => ({ ...row })), [{ status: 'sent', count: userCount * gamesPerUser }]);
  assert.ok(f.steamTransport.peak <= 3);
  await new Promise<void>(done => setTimeout(done, 20));
  const report = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    sourceSha256, sourceHashScope: 'sorted src/**/*.ts, tests/helpers/reliability-fixture.ts, scripts/capacity-check.ts; path + NUL + bytes + NUL',
    profile: { users: userCount, gamesPerUser, sharedGameCatalog: true, syntheticTransports: true, fileSqlite: true, productionDeliveryRevalidation: true },
    phases, totalMs: Math.round(performance.now() - started),
    sampledPeakRssMiB: Math.round(Math.max(...observedRss) / 1048576),
    eventLoopDelayP99Ms: Math.round(loop.percentile(99) / 1e6), eventLoopDelayMaxMs: Math.round(loop.max / 1e6),
    steam: { peakConcurrency: f.steamTransport.peak, wishlistRequests: f.steamTransport.wishlistRequests, metadataRequests: f.steamTransport.metadataRequests, priceRequests: f.steamTransport.priceRequests },
    notifications: { candidates: userCount * gamesPerUser, sent: userCount * gamesPerUser, messages: deliveredMessages, lost: 0, duplicateMessages: 0 },
    caveats: ['Synthetic shared catalog; not a live API or VM SLA.', 'Memory is sampled process RSS, not whole-host usage.', 'Long ambiguous delivery can duplicate after Discord nonce expiry; see resilience tests.'],
  };
  if (process.argv[2]) writeFileSync(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { clearInterval(sample); loop.disable(); f.close(); }
