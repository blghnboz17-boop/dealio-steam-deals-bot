import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createDatabase, databaseBusyTimeoutMs } from '../src/persistence/database.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Another process (like the backup or health-ping script) holds the database lock briefly. */
function holdLock(path: string, milliseconds: number): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN EXCLUSIVE');
    process.stdout.write('locked\\n');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(process.argv[2]));
  `, path, String(milliseconds)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('locked')) resolve(() => exited);
    });
  });
}

it('waits for a short lock held by another process instead of failing the write', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dealio-busy-'));
  directories.push(directory);
  const path = join(directory, 'wishlist.db');
  const database = createDatabase(path);
  try {
    expect((database.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout)
      .toBe(databaseBusyTimeoutMs);
    const released = await holdLock(path, 300);
    const startedAt = Date.now();
    database.prepare("UPDATE wishlist_poll_schedule SET next_scheduled_at = '2026-10-07T00:00:00.000Z'").run();
    expect(Date.now() - startedAt).toBeLessThan(databaseBusyTimeoutMs);
    expect(database.prepare('SELECT next_scheduled_at FROM wishlist_poll_schedule').get())
      .toEqual({ next_scheduled_at: '2026-10-07T00:00:00.000Z' });
    await released();
  } finally {
    database.close();
  }
});
