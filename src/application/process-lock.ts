import { homedir } from 'node:os';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

export class ProcessLockError extends Error {}

export interface ProcessLockFileSystem {
  readonly closeSync: typeof closeSync;
  readonly readFileSync: typeof readFileSync;
  readonly unlinkSync: typeof unlinkSync;
}

const defaultFileSystem: ProcessLockFileSystem = { closeSync, readFileSync, unlinkSync };

interface LockMetadata {
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

export class ProcessLock {
  private released = false;
  private descriptorClosed = false;

  private constructor(
    private readonly lockPath: string,
    private readonly descriptor: number,
    private readonly token: string,
    private readonly fileSystem: ProcessLockFileSystem,
  ) {}

  public static acquire(
    databasePath: string,
    fileSystem: ProcessLockFileSystem = defaultFileSystem,
  ): ProcessLock {
    const lockPath = lockPathForDatabase(databasePath);
    const token = randomUUID();
    let descriptor: number;

    try {
      descriptor = openSync(lockPath, 'wx');
    } catch (error: unknown) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      reclaimStaleLock(lockPath, databasePath);
      try {
        descriptor = openSync(lockPath, 'wx');
      } catch (retryError: unknown) {
        if (isAlreadyExistsError(retryError)) {
          throw lockExistsError(lockPath, databasePath);
        }
        throw retryError;
      }
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

    return new ProcessLock(lockPath, descriptor, token, fileSystem);
  }

  public static acquireForApplication(
    databasePath: string,
    applicationId: string,
    lockDirectory = join(homedir(), '.local', 'state', 'dealio'),
  ): Pick<ProcessLock, 'release'> {
    if (!/^\d+$/.test(applicationId)) throw new ProcessLockError('Invalid application ID');
    const applicationLock = ProcessLock.acquire(join(lockDirectory, applicationId));
    let databaseLock: ProcessLock;
    try {
      databaseLock = ProcessLock.acquire(databasePath);
    } catch (error: unknown) {
      applicationLock.release();
      throw error;
    }
    return {
      release: () => {
        databaseLock.release();
        applicationLock.release();
      },
    };
  }

  public release(): void {
    if (this.released) {
      return;
    }

    if (!this.descriptorClosed) {
      this.fileSystem.closeSync(this.descriptor);
      this.descriptorClosed = true;
    }
    const metadata = readMetadata(this.lockPath, this.fileSystem, true);
    if (metadata?.token === this.token) {
      this.fileSystem.unlinkSync(this.lockPath);
    }
    this.released = true;
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

function readMetadata(
  lockPath: string,
  fileSystem: ProcessLockFileSystem = defaultFileSystem,
  strict = false,
): LockMetadata | null {
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(lockPath, 'utf8')) as Partial<LockMetadata>;
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.token !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.token,
      ) ||
      typeof parsed.startedAt !== 'string' ||
      !isCanonicalIsoTimestamp(parsed.startedAt)
    ) {
      if (strict) {
        throw new ProcessLockError(`Invalid process lock metadata at ${lockPath}.`);
      }
      return null;
    }

    return parsed as LockMetadata;
  } catch (error: unknown) {
    if (!strict || errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

type ProcessState = 'live' | 'dead' | 'uncertain';

function processState(pid: number): ProcessState {
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error: unknown) {
    return errorCode(error) === 'ESRCH' ? 'dead' : 'uncertain';
  }
}

function reclaimStaleLock(lockPath: string, databasePath: string): void {
  const observed = readMetadata(lockPath);
  if (!observed || processState(observed.pid) !== 'dead') {
    throw lockExistsError(lockPath, databasePath);
  }

  const claimPath = `${lockPath}.reclaim-${createHash('sha256')
    .update(observed.token)
    .digest('hex')}`;
  let claimDescriptor: number;
  try {
    claimDescriptor = openSync(claimPath, 'wx');
  } catch (error: unknown) {
    if (isAlreadyExistsError(error)) {
      throw new ProcessLockError(
        `Stale-lock recovery is already in progress or was interrupted for database ${databasePath}.`,
      );
    }
    throw error;
  }

  let quarantineDirectory: string | null = null;
  try {
    writeFileSync(
      claimDescriptor,
      JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() }),
      'utf8',
    );
    const current = readMetadata(lockPath);
    if (!current || !sameMetadata(observed, current) || processState(current.pid) !== 'dead') {
      throw new ProcessLockError(
        `Process lock ownership changed during stale-lock recovery for database ${databasePath}.`,
      );
    }

    quarantineDirectory = mkdtempSync(`${lockPath}.stale-`);
    renameSync(lockPath, join(quarantineDirectory, 'lock'));
  } finally {
    closeSync(claimDescriptor);
    unlinkSync(claimPath);
    if (quarantineDirectory !== null) {
      rmSync(quarantineDirectory, { recursive: true, force: true });
    }
  }
}

function lockExistsError(lockPath: string, databasePath: string): ProcessLockError {
  const owner = readMetadata(lockPath);
  const state = owner ? processState(owner.pid) : 'uncertain';
  const ownerDescription = owner
    ? `PID ${owner.pid} (${state})`
    : 'unknown owner';
  return new ProcessLockError(
    `A process lock already exists for database ${databasePath}: ${ownerDescription}. ` +
    'Remove it only after verifying that no bot process is using the database.',
  );
}

function sameMetadata(left: LockMetadata, right: LockMetadata): boolean {
  return left.pid === right.pid && left.token === right.token && left.startedAt === right.startedAt;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

function isAlreadyExistsError(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}
