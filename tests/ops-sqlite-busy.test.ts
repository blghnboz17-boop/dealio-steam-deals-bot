import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createDatabase } from '../src/persistence/database.js';

const run = promisify(execFile);

// The health ping reads the live database while the bot writes. A commit that
// holds the lock for a moment must delay the read, not raise a false
// "database-unavailable" alarm. (Uses the built dist, like the other ops tests.)
it('health ping waits for a short write lock instead of reporting the database unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dealio-busy-'));
  const path = join(directory, 'wishlist.db');
  const db = createDatabase(path);
  try {
    // Rollback-journal mode makes an exclusive writer block readers outright.
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('BEGIN EXCLUSIVE');
    const ping = run(process.execPath, [resolve('scripts/health-ping.mjs'), '--preview'], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, env: { ...process.env, DATABASE_PATH: path },
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    db.exec('COMMIT');
    const { stdout } = await ping;
    const report = JSON.parse(stdout.trim().split('\n').at(-1)!) as { problems: string[] };
    expect(report.problems).not.toContain('database-unavailable');
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
