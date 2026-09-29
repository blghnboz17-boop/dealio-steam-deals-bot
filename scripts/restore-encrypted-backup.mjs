import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openBackup } from '../dist/operations/backup-envelope.js';
import { createDatabase } from '../dist/persistence/database.js';
import { verifyDatabase } from './backup.mjs';

let directory;
try {
  const input = process.argv[2];
  if (!input || (await stat(input)).size > 23 * 1024 * 1024) throw new Error('Invalid input');
  const bytes = openBackup(await readFile(input, 'utf8'), process.env.DEALIO_BACKUP_PRIVATE_KEY);
  directory = await mkdtemp(join(tmpdir(), 'dealio-restore-'));
  await chmod(directory, 0o700);
  const database = join(directory, 'restored.db');
  await writeFile(database, bytes, { mode: 0o600 });
  await verifyDatabase(database);
  const db = createDatabase(database);
  db.close();
  const verified = await verifyDatabase(database);
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), schemaVersion: verified.schemaVersion,
    sha256: createHash('sha256').update(bytes).digest('hex') }));
} catch {
  console.error('Encrypted backup restore rehearsal failed');
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
