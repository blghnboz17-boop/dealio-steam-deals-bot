import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealBackup, openBackup } from '../src/operations/backup-envelope.js';
import { healthProblems, OLDEST_SCAN_SQL } from '../src/operations/health-check.js';
import { CheckStateRepository } from '../src/persistence/check-state-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('encrypted offsite backup', () => {
  it('recovers exact bytes without exposing data and randomizes each export', () => {
    const database = Buffer.from('SQLite private wishlist and Discord identifiers');
    const first = sealBackup(database, keys.publicKey);
    expect(first).not.toContain('private wishlist');
    expect(first).not.toEqual(sealBackup(database, keys.publicKey));
    expect(openBackup(first, keys.privateKey)).toEqual(database);
  });

  it('rejects corrupted ciphertext and unsupported envelopes', () => {
    const envelope = JSON.parse(sealBackup(Buffer.from('database'), keys.publicKey));
    const cipher = Buffer.from(envelope.data, 'base64');
    cipher[0] ^= 1;
    envelope.data = cipher.toString('base64');
    expect(() => openBackup(JSON.stringify(envelope), keys.privateKey)).toThrow();
    envelope.version = 2;
    expect(() => openBackup(JSON.stringify(envelope), keys.privateKey)).toThrow();
  });

  it('rejects a different recovery key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKey = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => openBackup(sealBackup(Buffer.from('db'), keys.publicKey), privateKey)).toThrow();
  });

  it('refuses exports above the fixed free-tier size limit', () => {
    expect(() => sealBackup(Buffer.alloc(16 * 1024 * 1024 + 1), keys.publicKey)).toThrow(/limit/);
  });
});

describe('independent health assessment', () => {
  const now = Date.parse('2026-09-29T20:00:00Z');
  const iso = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  const ready = { phase: 'ready', discordReady: true, heartbeatAt: iso(10) };

  it('accepts fresh service and no configured users or queued notifications', () => {
    expect(healthProblems(ready, null, null, now)).toEqual([]);
  });

  it('fails closed for missing, invalid or future heartbeat timestamps', () => {
    for (const heartbeat of [null, { ...ready, heartbeatAt: 'invalid' }, { ...ready, heartbeatAt: iso(-120) }]) {
      expect(healthProblems(heartbeat, null, null, now)).toContain('heartbeat');
    }
  });

  it('reports stale heartbeat, lost Discord, stale scans and queued delivery', () => {
    expect(healthProblems({ ...ready, discordReady: false, heartbeatAt: iso(181) }, iso(7201), iso(93601), now))
      .toEqual(['heartbeat', 'discord', 'scan', 'queue']);
  });

  it('allows a daily digest to wait up to the configured queue threshold', () => {
    expect(healthProblems(ready, iso(7000), iso(86400), now)).toEqual([]);
  });

  it('does not count a private wishlist as a stalled scan, but still notices when its checks stop', () => {
    const database = createDatabase(':memory:');
    const users = new UserConfigRepository(database);
    const checks = new CheckStateRepository(database);
    const metrics = { checkedCount: 1, onSaleCount: 0, freeCount: 0, unknownPriceCount: 0, failedItemCount: 0 };
    const oldestScan = () => (database.prepare(OLDEST_SCAN_SQL).get() as { at: string | null }).at;
    try {
      users.upsert('public', '76561198000000001', 'tr', 'TR', iso(30 * 86400));
      users.upsert('private', '76561198000000002', 'tr', 'TR', iso(30 * 86400));
      checks.markSuccess('public', iso(60), iso(50), 1, metrics);
      checks.markSuccess('private', iso(8 * 86400), iso(8 * 86400), 1, metrics);
      checks.markUnavailable('private', iso(40), iso(30), 'STEAM_WISHLIST_INACCESSIBLE', 1);
      expect(oldestScan()).toBe(iso(50));
      expect(healthProblems(ready, oldestScan(), null, now)).toEqual([]);

      checks.markUnavailable('private', iso(7300), iso(7290), 'STEAM_WISHLIST_INACCESSIBLE', 1);
      expect(healthProblems(ready, oldestScan(), null, now)).toEqual(['scan']);

      checks.markUnavailable('private', iso(40), iso(30), 'STEAM_TIMEOUT', 1);
      expect(oldestScan()).toBe(iso(8 * 86400));
    } finally {
      database.close();
    }
  });
});
