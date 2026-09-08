import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHandoffMarkdown } from '../.opencode/plugins/handoff/render.js';
import { parseHandoffJson, parseHandoffState, type HandoffState } from '../.opencode/plugins/handoff/schema.js';
import {
  retainedCorruptHandoffJson,
  retainedHandoffJson,
  retainedHandoffMarkdown,
  retainedLockFixture,
} from './fixtures/opencode-handoff-storage.js';
import {
  createHandoffStorage,
  nodeStorageFileSystem,
  type StorageDependencies,
  type StorageFileSystem,
  type StorageWritableFile,
} from '../.opencode/plugins/handoff/storage.js';

const fixtureDirectories: string[] = [];
const worktreeHash = 'a'.repeat(64);

const stateAt = (revision: number): HandoffState => parseHandoffState({
  schemaVersion: 1,
  stateId: `state-storage-${revision}`,
  revision,
  capturedAt: `2026-08-31T20:00:0${revision}.000Z`,
  status: 'active',
  worktree: {
    worktreePath: '/mnt/c/work/dealio',
    commonDirHash: worktreeHash,
    branch: 'main',
    head: 'b'.repeat(40),
    dirtyFingerprint: 'c'.repeat(64),
  },
  eventSequence: revision,
  activeTask: `Persist revision ${revision}`,
  todos: [],
  changedPaths: ['.opencode/plugins/handoff/storage.ts'],
  verification: [],
  redaction: { fields: 0, values: 0, paths: 0, truncated: 0 },
  uncertainty: { flags: [], limitations: [] },
});

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dealio-handoff-storage-'));
  fixtureDirectories.push(directory);
  return directory;
}

const dependencies = (fileSystem: StorageFileSystem = nodeStorageFileSystem): StorageDependencies => ({
  fileSystem,
  renderMarkdown: renderHandoffMarkdown,
  runtime: {
    host: 'test-host',
    nonce: () => '11111111-1111-4111-8111-111111111111',
    now: () => '2026-08-31T20:30:00.000Z',
    ownerState: async () => 'dead',
    pid: 101,
    processStart: 'start-101',
  },
});

type FaultPoint =
  | 'lock-acquisition'
  | 'temp-creation'
  | 'write'
  | 'close'
  | 'json-replace'
  | 'readback'
  | 'markdown-generation'
  | 'markdown-replace'
  | 'lock-release';

function withFault(point: FaultPoint): StorageDependencies {
  let targetReads = 0;
  const fileSystem: StorageFileSystem = {
    ensureDirectory: nodeStorageFileSystem.ensureDirectory,
    listNames: nodeStorageFileSystem.listNames,
    openExclusive: async (path) => {
      if (point === 'lock-acquisition' && path.endsWith('BACKTO.lock')) throw new Error('injected');
      if (point === 'temp-creation' && path.includes('.json.tmp-')) throw new Error('injected');
      const file = await nodeStorageFileSystem.openExclusive(path);
      if (!path.includes('.json.tmp-')) return file;
      const wrapped: StorageWritableFile = {
        writeText: point === 'write' ? async () => { throw new Error('injected'); } : file.writeText,
        close: point === 'close' ? async () => { await file.close(); throw new Error('injected'); } : file.close,
      };
      return wrapped;
    },
    readText: async (path) => {
      if (point === 'readback' && path.includes('.json.tmp-')) throw new Error('injected');
      if (path.endsWith('BACKTO.json')) {
        targetReads += 1;
        if (point === 'readback' && targetReads === 2) throw new Error('injected');
      }
      return nodeStorageFileSystem.readText(path);
    },
    remove: async (path) => {
      if (point === 'lock-release' && path.endsWith('BACKTO.lock')) throw new Error('injected');
      await nodeStorageFileSystem.remove(path);
    },
    replace: async (source, target) => {
      if (point === 'json-replace' && target.endsWith('BACKTO.json')) throw new Error('injected');
      if (point === 'markdown-replace' && target.endsWith('BACKTO.md')) throw new Error('injected');
      await nodeStorageFileSystem.replace(source, target);
    },
  };
  return {
    ...dependencies(fileSystem),
    renderMarkdown: point === 'markdown-generation' ? () => { throw new Error('injected'); } : renderHandoffMarkdown,
  };
}

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('atomic handoff storage', () => {
  it('retains bounded synthetic artifacts for independent read-only inspection', async () => {
    // Given
    const retainedJson = retainedHandoffJson;
    const retainedMarkdown = retainedHandoffMarkdown;
    const quarantine = retainedCorruptHandoffJson;
    const lock = retainedLockFixture;

    // When
    const retained = parseHandoffJson(retainedJson);

    // Then
    expect(retainedMarkdown).toBe(renderHandoffMarkdown(retained));
    expect(() => parseHandoffJson(quarantine)).toThrow();
    expect(lock).toMatchObject({ host: 'retained-fixture.invalid', processStart: 'synthetic-not-live' });
    expect(JSON.stringify({ retained, lock })).not.toMatch(/gh[pousr]_|github_pat_|AKIA|ASIA|password\s*[:=]|\b\d{17,20}\b/i);
  });

  it('commits validated JSON before Markdown generated from the exact read-back state', async () => {
    // Given
    const directory = await createFixture();
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies());

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 1 });
    const committed = parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8'));
    expect(await readFile(join(directory, 'BACKTO.md'), 'utf8')).toBe(renderHandoffMarkdown(committed));
  });

  it('fails closed when the initialized handoff directory is swapped for an external junction', async () => {
    // Given
    const directory = await createFixture();
    const external = await createFixture();
    const storage = createHandoffStorage({ directory, worktreeHash });
    await rm(directory, { recursive: true, force: true });
    await symlink(external, directory, 'junction');

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toMatchObject({ kind: 'failed', revision: 1 });
    await expect(readFile(join(external, 'BACKTO.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps committed JSON authoritative when derived Markdown publication is interrupted', async () => {
    // Given
    const directory = await createFixture();
    await writeFile(join(directory, 'BACKTO.json'), `${JSON.stringify(stateAt(1))}\n`, 'utf8');
    await writeFile(join(directory, 'BACKTO.md'), renderHandoffMarkdown(stateAt(1)), 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, withFault('markdown-replace'));

    // When
    const result = await storage.enqueue(stateAt(2));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 2 });
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBe(2);
    expect(await readFile(join(directory, 'BACKTO.md'), 'utf8')).toBe(renderHandoffMarkdown(stateAt(1)));
  });

  it.each([
    'lock-acquisition', 'temp-creation', 'write', 'close', 'json-replace', 'readback',
    'markdown-generation',
  ] satisfies readonly FaultPoint[])('preserves exact prior authority bytes after an injected %s failure', async (point) => {
    // Given
    const directory = await createFixture();
    const prior = stateAt(1);
    const priorBytes = `  ${JSON.stringify(prior)}\r\n`;
    await writeFile(join(directory, 'BACKTO.json'), priorBytes, 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, withFault(point));

    // When
    const result = await storage.enqueue(stateAt(2));

    // Then
    expect(result).toMatchObject({ kind: 'failed', revision: 2 });
    expect(await readFile(join(directory, 'BACKTO.json'), 'utf8')).toBe(priorBytes);
    expect((await nodeStorageFileSystem.listNames(directory)).filter((name) =>
      name.includes('.tmp-') || name.includes('.reclaim-') || name.includes('.stale-'))).toEqual([]);
  });

  it('reports committed when lock cleanup fails after final authority publication', async () => {
    // Given
    const directory = await createFixture();
    const priorBytes = `${JSON.stringify(stateAt(1))}\n`;
    await writeFile(join(directory, 'BACKTO.json'), priorBytes, 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, withFault('lock-release'));

    // When
    const result = await storage.enqueue(stateAt(2));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 2 });
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBe(2);
  });

  it('retains invalid authority bytes when replacement publication fails', async () => {
    // Given
    const directory = await createFixture();
    const invalidBytes = '{ invalid authority';
    await writeFile(join(directory, 'BACKTO.json'), invalidBytes, 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, withFault('json-replace'));

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toMatchObject({ kind: 'failed', revision: 1, stage: 'json-replace' });
    expect(await readFile(join(directory, 'BACKTO.json'), 'utf8')).toBe(invalidBytes);
  });

  it.each(['{', JSON.stringify({ schemaVersion: 2 })])('quarantines invalid existing JSON before a valid replacement', async (corrupt) => {
    // Given
    const directory = await createFixture();
    await writeFile(join(directory, 'BACKTO.json'), corrupt, 'utf8');
    await writeFile(join(directory, 'BACKTO.corrupt-20260830-old.json'), 'older corrupt bytes', 'utf8');
    const storage = createHandoffStorage({ directory, worktreeHash }, dependencies());

    // When
    const result = await storage.enqueue(stateAt(1));

    // Then
    expect(result).toEqual({ kind: 'committed', revision: 1 });
    const names = await nodeStorageFileSystem.listNames(directory);
    const quarantine = names.filter((name) => name.startsWith('BACKTO.corrupt-'));
    expect(quarantine).toHaveLength(1);
    expect(await readFile(join(directory, quarantine[0] ?? ''), 'utf8')).toBe(corrupt);
    expect(parseHandoffJson(await readFile(join(directory, 'BACKTO.json'), 'utf8')).revision).toBe(1);
  });
});
