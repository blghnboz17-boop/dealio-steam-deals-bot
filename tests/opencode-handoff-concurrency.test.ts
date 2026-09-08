import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHandoffMarkdown } from '../.opencode/plugins/handoff/render.js';
import { parseHandoffJson, parseHandoffState, type HandoffState } from '../.opencode/plugins/handoff/schema.js';
import {
  createHandoffStorage,
  nodeStorageFileSystem,
  type LockOwner,
  type StorageDependencies,
  type StorageFileSystem,
  type StorageWriteResult,
} from '../.opencode/plugins/handoff/storage.js';

const fixtureRoot = join(process.cwd(), '.omo', 'evidence', 'durable-opencode-handoff', 'task-4-fixtures');
const fixtureDirectories: string[] = [];
const worktreeHash = 'd'.repeat(64);

const stateAt = (revision: number): HandoffState => parseHandoffState({
  schemaVersion: 1,
  stateId: `state-concurrency-${revision}`,
  revision,
  capturedAt: `2026-08-31T21:00:0${revision}.000Z`,
  status: 'active',
  worktree: { worktreePath: '/mnt/c/work/dealio', commonDirHash: worktreeHash, branch: 'main', head: 'e'.repeat(40), dirtyFingerprint: 'f'.repeat(64) },
  eventSequence: revision,
  activeTask: `Serialize revision ${revision}`,
  todos: [], changedPaths: [], verification: [],
  redaction: { fields: 0, values: 0, paths: 0, truncated: 0 },
  uncertainty: { flags: [], limitations: [] },
});

async function createFixture(): Promise<string> {
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'concurrency-'));
  fixtureDirectories.push(directory);
  return directory;
}

async function runWriter(script: string, state: HandoffState): Promise<number | null> {
  const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, script, Buffer.from(JSON.stringify(state)).toString('base64url')], {
      cwd: process.cwd(), stdio: 'ignore', windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', resolve);
  });
}

function dependencies(overrides: Partial<StorageDependencies> = {}): StorageDependencies {
  return {
    fileSystem: overrides.fileSystem ?? nodeStorageFileSystem,
    renderMarkdown: overrides.renderMarkdown ?? renderHandoffMarkdown,
    runtime: overrides.runtime ?? {
      host: 'test-host', nonce: randomUUID, now: () => '2026-08-31T21:30:00.000Z',
      ownerState: async () => 'dead', pid: 202, processStart: 'start-202',
    },
  };
}

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('serialized handoff writes', () => {
  it('bounds pending work to one latest revision and coalesces the obsolete revision', async () => {
    // Given
    const directory = await createFixture();
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let block = true;
    const fileSystem: StorageFileSystem = {
      ...nodeStorageFileSystem,
      openExclusive: async (path) => {
        const file = await nodeStorageFileSystem.openExclusive(path);
        if (!path.includes('.json.tmp-')) return file;
        return {
          close: file.close,
          writeText: async (contents) => {
            if (block) { block = false; await firstWriteBlocked; }
            await file.writeText(contents);
          },
        };
      },
    };
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies({ fileSystem }));

    // When
    const first = storage.enqueue(stateAt(1));
    const second = storage.enqueue(stateAt(2));
    const third = storage.enqueue(stateAt(3));
    releaseFirstWrite?.();

    // Then
    await expect(first).resolves.toEqual({ kind: 'committed', revision: 1 });
    await expect(second).resolves.toEqual({ kind: 'coalesced', revision: 2 });
    await expect(third).resolves.toEqual({ kind: 'committed', revision: 3 });
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBe(3);
  });

  it('retries the same revision after a transient contained failure', async () => {
    // Given
    const directory = await createFixture();
    let fail = true;
    const fileSystem: StorageFileSystem = {
      ...nodeStorageFileSystem,
      openExclusive: async (path) => {
        if (fail && path.includes('.json.tmp-')) { fail = false; throw new Error('injected'); }
        return nodeStorageFileSystem.openExclusive(path);
      },
    };
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies({ fileSystem }));

    // When
    const failed = await storage.enqueue(stateAt(2));
    const recovered = await storage.enqueue(stateAt(2));

    // Then
    expect(failed).toMatchObject({ kind: 'failed', revision: 2 });
    expect(recovered).toEqual({ kind: 'committed', revision: 2 });
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBe(2);
  });

  it('keeps authoritative JSON and Markdown unmixed when two child processes race', async () => {
    // Given
    const directory = await createFixture();
    const script = join(directory, 'writer.ts');
    const storageUrl = pathToFileURL(join(process.cwd(), '.opencode', 'plugins', 'handoff', 'storage.ts')).href;
    const schemaUrl = pathToFileURL(join(process.cwd(), '.opencode', 'plugins', 'handoff', 'schema.ts')).href;
    await writeFile(script, [
      `import { createHandoffStorage } from ${JSON.stringify(storageUrl)};`,
      `import { parseHandoffJson } from ${JSON.stringify(schemaUrl)};`,
      `const state = parseHandoffJson(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8'));`,
      `const result = await createHandoffStorage({ directory: ${JSON.stringify(directory)}, worktreeHash: ${JSON.stringify(worktreeHash)} }).enqueue(state);`,
      `process.exitCode = result.kind === 'committed' ? 0 : 2;`,
    ].join('\n'), 'utf8');

    // When
    const exitCodes = await Promise.all([runWriter(script, stateAt(1)), runWriter(script, stateAt(2))]);

    // Then
    expect(exitCodes).toContain(0);
    expect(exitCodes.every((exitCode) => exitCode === 0 || exitCode === 2)).toBe(true);
    const committed = parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8'));
    expect([1, 2]).toContain(committed.revision);
    expect(await readFile(join(directory, 'BACKTO.md'), 'utf8')).toBe(renderHandoffMarkdown(committed));
  });
});

describe('exclusive handoff lock recovery', () => {
  const lockOwner = (fields: Partial<LockOwner> = {}): LockOwner => ({
    host: 'test-host', nonce: '22222222-2222-4222-8222-222222222222', pid: 303,
    processStart: 'start-303', timestamp: '2026-08-31T21:10:00.000Z', worktreeHash, ...fields,
  });

  it.each([
    ['live', lockOwner(), 'live'],
    ['unknown', lockOwner(), 'unknown'],
    ['invalid', '{', 'dead'],
    ['foreign-host', JSON.stringify(lockOwner({ host: 'other-host' })), 'dead'],
    ['foreign-namespace', JSON.stringify(lockOwner({ worktreeHash: '9'.repeat(64) })), 'dead'],
  ] as const)('fails closed without removing a %s lock', async (_caseName, lock, ownerState) => {
    // Given
    const directory = await createFixture();
    const serialized = typeof lock === 'string' ? lock : JSON.stringify(lock);
    await writeFile(join(directory, 'BACKTO.lock'), serialized, 'utf8');
    const runtime = { ...dependencies().runtime, ownerState: async () => ownerState };
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies({ runtime }));

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toMatchObject({ kind: 'failed', revision: 1 });
    expect(await readFile(join(directory, 'BACKTO.lock'), 'utf8')).toBe(serialized);
  });

  it('reclaims only a byte-stable deterministically dead same-namespace owner', async () => {
    // Given
    const directory = await createFixture();
    await writeFile(join(directory, 'BACKTO.lock'), JSON.stringify(lockOwner()), 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies());

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 1 });
    await expect(readFile(join(directory, 'BACKTO.lock'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims a crash-orphaned byte-stable dead reclaim guard on restart', async () => {
    // Given
    const directory = await createFixture();
    await writeFile(join(directory, 'BACKTO.lock.reclaim'), JSON.stringify(lockOwner()), 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies());

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 1 });
    await expect(readFile(join(directory, 'BACKTO.lock.reclaim'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows at most one of two reclaimers to own a dead reclaim guard', async () => {
    // Given
    const directory = await createFixture();
    await writeFile(join(directory, 'BACKTO.lock.reclaim'), JSON.stringify(lockOwner()), 'utf8');
    let deadChecks = 0;
    let releaseChecks: (() => void) | undefined;
    const bothObserved = new Promise<void>((resolve) => { releaseChecks = resolve; });
    const createRuntime = (pid: number, nonce: string) => ({
      ...dependencies().runtime,
      nonce: () => nonce,
      pid,
      processStart: `start-${pid}`,
      ownerState: async (owner: LockOwner) => {
        if (owner.pid !== 303) return 'live' as const;
        deadChecks += 1;
        if (deadChecks === 2) releaseChecks?.();
        await bothObserved;
        return 'dead' as const;
      },
    });
    const first = createHandoffStorage({ directory, worktreeHash }, dependencies({ runtime: createRuntime(401, '66666666-6666-4666-8666-666666666666') }));
    const second = createHandoffStorage({ directory, worktreeHash }, dependencies({ runtime: createRuntime(402, '77777777-7777-4777-8777-777777777777') }));

    // When
    const results = await Promise.all([first.enqueue(stateAt(1)), second.enqueue(stateAt(2))]);

    // Then
    expect(results.filter((result) => result.kind === 'committed')).toHaveLength(1);
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBeGreaterThanOrEqual(1);
  });

  it('fails closed when stale-lock bytes change during verified recovery', async () => {
    // Given
    const directory = await createFixture();
    const lockPath = join(directory, 'BACKTO.lock');
    const observed = JSON.stringify(lockOwner());
    const replacement = JSON.stringify(lockOwner({ nonce: '33333333-3333-4333-8333-333333333333' }));
    await writeFile(lockPath, observed, 'utf8');
    let lockReads = 0;
    const fileSystem: StorageFileSystem = {
      ...nodeStorageFileSystem,
      readText: async (path) => {
        if (path === lockPath && ++lockReads === 2) await writeFile(lockPath, replacement, 'utf8');
        return nodeStorageFileSystem.readText(path);
      },
    };
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies({ fileSystem }));

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toMatchObject({ kind: 'failed', revision: 1 });
    expect(await readFile(lockPath, 'utf8')).toBe(replacement);
  });

  it('excludes a replacement live owner between stale validation and reclaim', async () => {
    // Given
    const directory = await createFixture();
    const lockPath = join(directory, 'BACKTO.lock');
    const staleOwner = JSON.stringify(lockOwner());
    const liveNonce = '55555555-5555-4555-8555-555555555555';
    await writeFile(lockPath, staleOwner, 'utf8');
    let releaseLiveWrite: (() => void) | undefined;
    const liveWriteBlocked = new Promise<void>((resolve) => { releaseLiveWrite = resolve; });
    let announceLiveOwner: (() => void) | undefined;
    const liveOwnerCreated = new Promise<void>((resolve) => { announceLiveOwner = resolve; });
    let runReplacement: (() => Promise<StorageWriteResult>) | undefined;
    let interceptReclaim = true;
    let movedLiveOwner = false;
    const fileSystem: StorageFileSystem = {
      ...nodeStorageFileSystem,
      openExclusive: async (path) => {
        const file = await nodeStorageFileSystem.openExclusive(path);
        if (path === lockPath) {
          return {
            close: file.close,
            writeText: async (contents) => {
              await file.writeText(contents);
              if (contents.includes(liveNonce)) announceLiveOwner?.();
            },
          };
        }
        if (!path.includes('.json.tmp-')) return file;
        return {
          close: file.close,
          writeText: async (contents) => {
            if ((await nodeStorageFileSystem.readText(lockPath)).includes(liveNonce)) await liveWriteBlocked;
            await file.writeText(contents);
          },
        };
      },
      replace: async (source, target) => {
        if (source !== lockPath || !interceptReclaim) {
          await nodeStorageFileSystem.replace(source, target);
          return;
        }
        interceptReclaim = false;
        const replacement = runReplacement;
        if (replacement === undefined) throw new Error('replacement writer is not configured');
        const replacementWrite = replacement();
        const contender = await Promise.race([
          replacementWrite.then((result) => ({ kind: 'result', result }) as const),
          liveOwnerCreated.then(() => ({ kind: 'live' }) as const),
        ]);
        await nodeStorageFileSystem.replace(source, target);
        movedLiveOwner = contender.kind === 'live' && (await nodeStorageFileSystem.readText(target)).includes(liveNonce);
        releaseLiveWrite?.();
        await replacementWrite;
      },
    };
    const replacementRuntime = {
      ...dependencies().runtime,
      nonce: () => liveNonce,
      ownerState: async (owner: LockOwner) => owner.pid === 202 ? 'live' as const : 'dead' as const,
      pid: 404,
      processStart: 'start-404',
    };
    const replacementStorage = createHandoffStorage(
      { directory, worktreeHash }, dependencies({ fileSystem, runtime: replacementRuntime }),
    );
    runReplacement = () => replacementStorage.enqueue(stateAt(2));
    const staleReclaimer = createHandoffStorage({ directory, worktreeHash }, dependencies({ fileSystem }));

    // When
    await staleReclaimer.enqueue(stateAt(1));

    // Then
    expect(movedLiveOwner).toBe(false);
  });

  it('releases no lock whose nonce differs from the acquired nonce', async () => {
    // Given
    const directory = await createFixture();
    const lockPath = join(directory, 'BACKTO.lock');
    const replacement = JSON.stringify(lockOwner({ nonce: '44444444-4444-4444-8444-444444444444' }));
    const fileSystem: StorageFileSystem = {
      ...nodeStorageFileSystem,
      replace: async (source, target) => {
        await nodeStorageFileSystem.replace(source, target);
        if (target.endsWith('BACKTO.md')) await writeFile(lockPath, replacement, 'utf8');
      },
    };
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies({ fileSystem }));

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 1 });
    expect(await readFile(lockPath, 'utf8')).toBe(replacement);
  });
});
