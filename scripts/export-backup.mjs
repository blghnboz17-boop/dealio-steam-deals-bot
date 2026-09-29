import 'dotenv/config';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConsistentBackup } from './backup.mjs';
import { backupByteLimit, sealBackup } from '../dist/operations/backup-envelope.js';

let directory;
try {
  const source = resolve(process.env.DATABASE_PATH ?? './data/wishlist.db');
  if ((await stat(source)).size > backupByteLimit) throw new Error('Backup size limit exceeded');
  const publicKey = await readFile(process.env.DEALIO_BACKUP_PUBLIC_KEY_FILE, 'utf8');
  directory = await mkdtemp(join(tmpdir(), 'dealio-export-'));
  await chmod(directory, 0o700);
  const copy = join(directory, 'wishlist.db');
  await createConsistentBackup(source, copy);
  // Only authenticated ciphertext is emitted. No .env or user counts leave the VM.
  process.stdout.write(sealBackup(await readFile(copy), publicKey));
} catch {
  console.error('Encrypted backup export failed');
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
