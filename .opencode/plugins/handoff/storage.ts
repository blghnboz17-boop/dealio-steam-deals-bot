import { randomUUID } from 'node:crypto';
import { open, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { replaceFile } from './node-replace.js';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { renderHandoffMarkdown } from './render.js';
import { assertHandoffTargetContained } from './path-containment.js';
import { parseHandoffJson, type HandoffState } from './schema.js';
import {
  acquireStorageLock,
  atStage,
  errorCode,
  releaseStorageLock,
  StorageOperationError,
  type LockOwner,
  type StorageFileSystem,
  type StorageRuntime,
  type StorageStage,
} from './storage-lock.js';

export type { LockOwner, StorageFileSystem, StorageRuntime, StorageStage, StorageWritableFile } from './storage-lock.js';

export type StorageDependencies = {
  readonly fileSystem: StorageFileSystem;
  readonly renderMarkdown: (state: HandoffState) => string;
  readonly runtime: StorageRuntime;
  readonly assertContained?: (path: string) => Promise<void>;
};

export type StorageWriteResult =
  | { readonly kind: 'committed'; readonly revision: number }
  | { readonly kind: 'coalesced'; readonly revision: number }
  | { readonly kind: 'rejected'; readonly revision: number }
  | { readonly kind: 'failed'; readonly revision: number; readonly stage: StorageStage };

type StorageOptions = { readonly directory: string; readonly worktreeHash: string };
type QueueEntry = { readonly state: HandoffState; readonly resolve: (result: StorageWriteResult) => void };
type ClosedWrite = { readonly path: string; readonly contents: string; readonly prefix: 'json' | 'markdown' };
type ExistingAuthority =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly state: HandoffState }
  | { readonly kind: 'invalid'; readonly serialized: string };
type CleanupFile = { readonly path: string; readonly stage: StorageStage };

const nodeOwnerState = async (owner: LockOwner): Promise<'live' | 'dead' | 'unknown'> => {
  try {
    process.kill(owner.pid, 0);
    return 'unknown';
  } catch (error) {
    return errorCode(error) === 'ESRCH' ? 'dead' : 'unknown';
  }
};

export const nodeStorageFileSystem: StorageFileSystem = {
  ensureDirectory: async (path) => { await mkdir(path, { recursive: true }); },
  listNames: async (path) => readdir(path),
  openExclusive: async (path) => {
    const handle = await open(path, 'wx', 0o600);
    return { writeText: async (contents) => handle.writeFile(contents, 'utf8'), close: async () => handle.close() };
  },
  readText: async (path) => readFile(path, 'utf8'),
  remove: async (path) => rm(path, { force: true }),
  replace: async (source, target) => replaceFile(source, target),
};

const defaultDependencies = (): StorageDependencies => ({
  fileSystem: nodeStorageFileSystem,
  renderMarkdown: renderHandoffMarkdown,
  runtime: {
    host: hostname(),
    nonce: randomUUID,
    now: () => new Date().toISOString(),
    ownerState: nodeOwnerState,
    pid: process.pid,
    processStart: String(Math.round(Date.now() - process.uptime() * 1_000)),
  },
});

function containedFileSystem(directory: string, dependencies: StorageDependencies): StorageFileSystem {
  const assertContained = dependencies.assertContained ?? ((path: string) => assertHandoffTargetContained(directory, path));
  const fileSystem = dependencies.fileSystem;
  return {
    ensureDirectory: async (path) => { await assertContained(path); await fileSystem.ensureDirectory(path); },
    listNames: async (path) => { await assertContained(path); return fileSystem.listNames(path); },
    openExclusive: async (path) => {
      await assertContained(path);
      const file = await fileSystem.openExclusive(path);
      return {
        close: file.close,
        writeText: async (contents) => { await assertContained(path); await file.writeText(contents); },
      };
    },
    readText: async (path) => { await assertContained(path); return fileSystem.readText(path); },
    remove: async (path) => { await assertContained(path); await fileSystem.remove(path); },
    replace: async (source, target) => {
      await assertContained(source);
      await assertContained(target);
      await fileSystem.replace(source, target);
    },
  };
}

async function writeClosed(fileSystem: StorageFileSystem, write: ClosedWrite): Promise<void> {
  const file = await atStage(`${write.prefix}-create`, () => fileSystem.openExclusive(write.path));
  try { await atStage(`${write.prefix}-write`, () => file.writeText(write.contents)); }
  finally { await atStage(`${write.prefix}-close`, file.close); }
}

class AtomicHandoffStorage {
  private active = false;
  private highestRevision = -1;
  private latestQueuedRevision = -1;
  private pending: QueueEntry | undefined;
  private idle: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | undefined;

  constructor(private readonly options: StorageOptions, private readonly dependencies: StorageDependencies) {}

  enqueue(state: HandoffState): Promise<StorageWriteResult> {
    if (state.revision <= this.latestQueuedRevision) return Promise.resolve({ kind: 'rejected', revision: state.revision });
    this.latestQueuedRevision = state.revision;
    return new Promise((resolve) => {
      const entry = { state, resolve };
      if (this.active) {
        this.pending?.resolve({ kind: 'coalesced', revision: this.pending.state.revision });
        this.pending = entry;
        return;
      }
      this.active = true;
      this.idle = new Promise((idleResolve) => { this.resolveIdle = idleResolve; });
      void this.drain(entry);
    });
  }

  flush(): Promise<void> { return this.idle; }

  private async drain(initial: QueueEntry): Promise<void> {
    let current: QueueEntry | undefined = initial;
    while (current !== undefined) {
      const result = await this.containedCommit(current.state);
      if (result.kind === 'committed') this.highestRevision = Math.max(this.highestRevision, result.revision);
      current.resolve(result);
      current = this.pending;
      this.pending = undefined;
    }
    this.active = false;
    this.latestQueuedRevision = this.highestRevision;
    this.resolveIdle?.();
    this.resolveIdle = undefined;
  }

  private async containedCommit(state: HandoffState): Promise<StorageWriteResult> {
    try { return await this.commit(state); }
    catch (error) {
      return { kind: 'failed', revision: state.revision, stage: error instanceof StorageOperationError ? error.stage : 'lock' };
    }
  }

  private async commit(state: HandoffState): Promise<StorageWriteResult> {
    const { runtime } = this.dependencies;
    const fileSystem = containedFileSystem(this.options.directory, this.dependencies);
    await atStage('directory', () => fileSystem.listNames(this.options.directory).then(() => undefined));
    const owner = await acquireStorageLock(this.options, { fileSystem, runtime });
    let authorityCommitted = false;
    try {
      await atStage('directory', () => fileSystem.listNames(this.options.directory).then(() => undefined));
      await this.cleanArtifacts();
      const existing = await this.readExisting();
      if (existing.kind === 'valid' && existing.state.revision >= state.revision) {
        return { kind: 'rejected', revision: state.revision };
      }
      const jsonTemp = join(this.options.directory, `.BACKTO.json.tmp-${runtime.nonce()}`);
      const markdownTemp = join(this.options.directory, `.BACKTO.md.tmp-${runtime.nonce()}`);
      let quarantinePath: string | undefined;
      let jsonPublished = false;
      let markdownPublished = false;
      try {
        await writeClosed(fileSystem, { path: jsonTemp, contents: `${JSON.stringify(state, null, 2)}\n`, prefix: 'json' });
        const staged = await atStage('json-readback', async () => parseHandoffJson(await fileSystem.readText(jsonTemp)));
        const markdown = await atStage('markdown-render', async () => this.dependencies.renderMarkdown(staged));
        await writeClosed(fileSystem, { path: markdownTemp, contents: markdown, prefix: 'markdown' });
        if (existing.kind === 'invalid') {
          quarantinePath = join(this.options.directory, this.quarantineName());
          await this.writeQuarantine(quarantinePath, existing.serialized);
        }
        await atStage('json-replace', () => fileSystem.replace(jsonTemp, join(this.options.directory, 'BACKTO.json')));
        jsonPublished = true;
        authorityCommitted = true;
        try {
          await atStage('markdown-replace', () => fileSystem.replace(markdownTemp, join(this.options.directory, 'BACKTO.md')));
          markdownPublished = true;
        } catch (error) {
          if (!(error instanceof StorageOperationError)) throw error;
        }
        return { kind: 'committed', revision: staged.revision };
      } finally {
        const cleanup: CleanupFile[] = [];
        if (!jsonPublished) cleanup.push({ path: jsonTemp, stage: 'json-replace' });
        if (!markdownPublished) cleanup.push({ path: markdownTemp, stage: 'markdown-replace' });
        if (!authorityCommitted && quarantinePath !== undefined) cleanup.push({ path: quarantinePath, stage: 'quarantine' });
        try { await this.cleanFiles(cleanup, fileSystem); }
        catch (error) { if (!authorityCommitted) throw error; }
      }
    } finally {
      try { await releaseStorageLock(this.options.directory, owner.nonce, fileSystem); }
      catch (error) { if (!authorityCommitted) throw error; }
    }
  }

  private async readExisting(): Promise<ExistingAuthority> {
    const path = join(this.options.directory, 'BACKTO.json');
    let serialized: string;
    try { serialized = await containedFileSystem(this.options.directory, this.dependencies).readText(path); }
    catch (error) {
      if (errorCode(error) === 'ENOENT') return { kind: 'missing' };
      throw new StorageOperationError('read-existing');
    }
    try { return { kind: 'valid', state: parseHandoffJson(serialized) }; }
    catch (error) { if (error instanceof Error) return { kind: 'invalid', serialized }; throw error; }
  }

  private quarantineName(): string {
    const { runtime } = this.dependencies;
    const stamp = runtime.now().replace(/[^0-9]/g, '').slice(0, 17);
    return `BACKTO.corrupt-${stamp}-${runtime.nonce()}.json`;
  }

  private async writeQuarantine(path: string, contents: string): Promise<void> {
    const fileSystem = containedFileSystem(this.options.directory, this.dependencies);
    const file = await atStage('quarantine', () => fileSystem.openExclusive(path));
    try { await atStage('quarantine', () => file.writeText(contents)); }
    finally { await atStage('quarantine', file.close); }
  }

  private async cleanArtifacts(): Promise<void> {
    const fileSystem = containedFileSystem(this.options.directory, this.dependencies);
    const names = await atStage('quarantine', () => fileSystem.listNames(this.options.directory));
    for (const name of names) {
      if (name.startsWith('BACKTO.corrupt-') ||
        (name.startsWith('.BACKTO.') && (name.includes('.tmp-') || name.includes('.reclaim-') || name.includes('.stale-')))) {
        await atStage('quarantine', () => fileSystem.remove(join(this.options.directory, name)));
      }
    }
  }

  private async cleanFiles(files: readonly CleanupFile[], fileSystem = containedFileSystem(this.options.directory, this.dependencies)): Promise<void> {
    let firstFailure: StorageOperationError | undefined;
    for (const file of files) {
      try { await atStage(file.stage, () => fileSystem.remove(file.path)); }
      catch (error) {
        if (error instanceof StorageOperationError) firstFailure ??= error;
        else throw error;
      }
    }
    if (firstFailure !== undefined) throw firstFailure;
  }
}

export type HandoffStorage = Pick<AtomicHandoffStorage, 'enqueue' | 'flush'>;

export const createHandoffStorage = (options: StorageOptions, dependencies: StorageDependencies = defaultDependencies()): HandoffStorage =>
  new AtomicHandoffStorage(options, dependencies);
