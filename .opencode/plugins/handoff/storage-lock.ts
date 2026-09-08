import { join } from 'node:path';

export type StorageWritableFile = {
  readonly writeText: (contents: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

export type StorageFileSystem = {
  readonly ensureDirectory: (path: string) => Promise<void>;
  readonly listNames: (path: string) => Promise<readonly string[]>;
  readonly openExclusive: (path: string) => Promise<StorageWritableFile>;
  readonly readText: (path: string) => Promise<string>;
  readonly remove: (path: string) => Promise<void>;
  readonly replace: (source: string, target: string) => Promise<void>;
};

export type LockOwner = {
  readonly host: string;
  readonly nonce: string;
  readonly pid: number;
  readonly processStart: string;
  readonly timestamp: string;
  readonly worktreeHash: string;
};

type OwnerState = 'live' | 'dead' | 'unknown';

export type StorageRuntime = {
  readonly host: string;
  readonly nonce: () => string;
  readonly now: () => string;
  readonly ownerState: (owner: LockOwner) => Promise<OwnerState>;
  readonly pid: number;
  readonly processStart: string;
};

export type StorageStage =
  | 'directory' | 'lock' | 'read-existing' | 'quarantine' | 'json-create' | 'json-write'
  | 'json-close' | 'json-replace' | 'json-readback' | 'markdown-render' | 'markdown-create'
  | 'markdown-write' | 'markdown-close' | 'markdown-replace' | 'lock-release';

type PropertyBag = { readonly [key: string]: unknown };
type LockOptions = { readonly directory: string; readonly worktreeHash: string };
type LockDependencies = { readonly fileSystem: StorageFileSystem; readonly runtime: StorageRuntime };

export class StorageOperationError extends Error {
  readonly name = 'StorageOperationError';
  constructor(readonly stage: StorageStage) { super(`Handoff storage failed at ${stage}`); }
}

export const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;

export async function atStage<T>(stage: StorageStage, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof StorageOperationError) throw error;
    throw new StorageOperationError(stage);
  }
}

const isBag = (value: unknown): value is PropertyBag => typeof value === 'object' && value !== null;

const canonicalTime = (value: string): boolean => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const parseLock = (serialized: string): LockOwner | undefined => {
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
  if (!isBag(value) || Object.keys(value).sort().join(',') !== 'host,nonce,pid,processStart,timestamp,worktreeHash') return undefined;
  const { host, nonce, pid, processStart, timestamp, worktreeHash } = value;
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) return undefined;
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(nonce)) return undefined;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (typeof processStart !== 'string' || processStart.length === 0 || processStart.length > 128) return undefined;
  if (typeof timestamp !== 'string' || !canonicalTime(timestamp)) return undefined;
  if (typeof worktreeHash !== 'string' || !/^[a-f0-9]{64}$/.test(worktreeHash)) return undefined;
  return { host, nonce, pid, processStart, timestamp, worktreeHash };
};

const lockOwner = (options: LockOptions, runtime: StorageRuntime): LockOwner => ({
  host: runtime.host,
  nonce: runtime.nonce(),
  pid: runtime.pid,
  processStart: runtime.processStart,
  timestamp: runtime.now(),
  worktreeHash: options.worktreeHash,
});

async function createLock(fileSystem: StorageFileSystem, path: string, owner: LockOwner): Promise<void> {
  const file = await fileSystem.openExclusive(path);
  let complete = false;
  try {
    await file.writeText(JSON.stringify(owner));
    await file.close();
    complete = true;
  } finally {
    if (!complete) {
      try { await file.close(); }
      catch (error) { if (!(error instanceof Error)) throw error; }
      await fileSystem.remove(path);
    }
  }
}

async function reclaimOwnerFile(path: string, stalePath: string, options: LockOptions, dependencies: LockDependencies): Promise<void> {
  const { fileSystem, runtime } = dependencies;
  const observed = await atStage('lock', () => fileSystem.readText(path));
  const owner = parseLock(observed);
  if (owner === undefined || owner.host !== runtime.host || owner.worktreeHash !== options.worktreeHash) {
    throw new StorageOperationError('lock');
  }
  if (await runtime.ownerState(owner) !== 'dead') throw new StorageOperationError('lock');
  if (await atStage('lock', () => fileSystem.readText(path)) !== observed) throw new StorageOperationError('lock');
  try {
    await atStage('lock', () => fileSystem.replace(path, stalePath));
  } finally {
    await atStage('lock', () => fileSystem.remove(stalePath));
  }
}

const reclaimLock = (options: LockOptions, dependencies: LockDependencies): Promise<void> =>
  reclaimOwnerFile(
    join(options.directory, 'BACKTO.lock'),
    join(options.directory, `.BACKTO.lock.stale-${dependencies.runtime.nonce()}`),
    options,
    dependencies,
  );

export async function acquireStorageLock(options: LockOptions, dependencies: LockDependencies): Promise<LockOwner> {
  const { fileSystem, runtime } = dependencies;
  const owner = lockOwner(options, runtime);
  const lockPath = join(options.directory, 'BACKTO.lock');
  const guardPath = join(options.directory, 'BACKTO.lock.reclaim');
  try { await createLock(fileSystem, guardPath, owner); }
  catch (error) {
    if (errorCode(error) !== 'EEXIST') throw new StorageOperationError('lock');
    await reclaimOwnerFile(
      guardPath,
      join(options.directory, `.BACKTO.lock.reclaim-stale-${runtime.nonce()}`),
      options,
      dependencies,
    );
    await atStage('lock', () => createLock(fileSystem, guardPath, owner));
  }
  try {
    try { await createLock(fileSystem, lockPath, owner); }
    catch (error) {
      if (errorCode(error) !== 'EEXIST') throw new StorageOperationError('lock');
      await reclaimLock(options, dependencies);
      await atStage('lock', () => createLock(fileSystem, lockPath, owner));
    }
    return owner;
  } finally {
    await atStage('lock', () => fileSystem.remove(guardPath));
  }
}

export async function releaseStorageLock(directory: string, nonce: string, fileSystem: StorageFileSystem): Promise<void> {
  const path = join(directory, 'BACKTO.lock');
  let serialized: string;
  try { serialized = await fileSystem.readText(path); }
  catch (error) { if (errorCode(error) === 'ENOENT') return; throw new StorageOperationError('lock-release'); }
  if (parseLock(serialized)?.nonce !== nonce) return;
  await atStage('lock-release', () => fileSystem.remove(path));
}
