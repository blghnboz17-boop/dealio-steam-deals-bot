import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

export class ProcessLockError extends Error {}

interface LockMetadata {
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

export class ProcessLock {
  private released = false;

  private constructor(
    private readonly lockPath: string,
    private readonly descriptor: number,
    private readonly token: string,
  ) {}

  public static acquire(databasePath: string): ProcessLock {
    const lockPath = lockPathForDatabase(databasePath);
    const token = randomUUID();
    let descriptor: number;

    try {
      descriptor = openSync(lockPath, 'wx');
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const owner = readMetadata(lockPath);
      const ownerDescription = owner
        ? `PID ${owner.pid}${isProcessRunning(owner.pid) ? '' : ' (not running)'}`
        : 'unknown owner';
      throw new ProcessLockError(
        `A process lock already exists for database ${databasePath}: ${ownerDescription}. ` +
        'Remove the lock only after verifying that no bot process is using the database.',
      );
    }

    try {
      writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }),
        'utf8',
      );
    } catch (error: unknown) {
      closeSync(descriptor);
      unlinkSync(lockPath);
      throw error;
    }

    return new ProcessLock(lockPath, descriptor, token);
  }

  public release(): void {
    if (this.released) {
      return;
    }

    this.released = true;
    closeSync(this.descriptor);
    const metadata = readMetadata(this.lockPath);
    if (metadata?.token === this.token) {
      unlinkSync(this.lockPath);
    }
  }
}

function lockPathForDatabase(databasePath: string): string {
  if (databasePath === ':memory:') {
    const runtimeDirectory = resolve('.runtime');
    mkdirSync(runtimeDirectory, { recursive: true });
    return join(realpathSync.native(runtimeDirectory), 'bot-memory.lock');
  }

  const resolvedDatabasePath = resolve(databasePath);
  const parentDirectory = dirname(resolvedDatabasePath);
  mkdirSync(parentDirectory, { recursive: true });
  const canonicalDatabasePath = existsSync(resolvedDatabasePath)
    ? realpathSync.native(resolvedDatabasePath)
    : join(realpathSync.native(parentDirectory), basename(resolvedDatabasePath));
  return `${canonicalDatabasePath}.lock`;
}

function readMetadata(lockPath: string): LockMetadata | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<LockMetadata>;
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.token !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }

    return parsed as LockMetadata;
  } catch (_error: unknown) {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return errorCode(error) === 'EPERM';
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

function isAlreadyExistsError(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}
