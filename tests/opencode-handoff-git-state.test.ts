import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectGitState,
  GitStateCollectionError,
  validateGitState,
  type GitCommandArgs,
  type GitCommandRunner,
  type GitState,
} from '../.opencode/plugins/handoff/git-state.js';

const gitEnvironment = { GIT_MASTER: '1' } as const;
// Git 2.43 git-status(1), Short Format table; `!!` is excluded because the collector fixes --ignored=no.
const VALID_PORCELAIN_V1_CODES = new Set([
  ' M', ' T', ' A', ' D', ' R', ' C',
  'M ', 'MM', 'MT', 'MD', 'T ', 'TM', 'TT', 'TD', 'A ', 'AM', 'AT', 'AD', 'D ',
  'R ', 'RM', 'RT', 'RD', 'C ', 'CM', 'CT', 'CD',
  'DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU', '??',
]);
const PORCELAIN_V1_STATUS_CHARACTERS = [' ', 'M', 'T', 'A', 'D', 'R', 'C', 'U', '?', '!'] as const;

function executeGit(cwd: string, args: readonly string[]): Buffer {
  return execFileSync('git', [...args], { cwd, env: gitEnvironment });
}

function createRunner(commands: GitCommandArgs[]): GitCommandRunner {
  return async (args, cwd) => {
    commands.push(args);
    return executeGit(cwd, args);
  };
}

type FakeOutputOverrides = {
  readonly topLevel?: string;
  readonly commonDir?: string;
  readonly status?: string;
};

function createOutputRunner(repository: string, overrides: FakeOutputOverrides = {}): GitCommandRunner {
  const outputs = [
    Buffer.from(`${overrides.topLevel ?? repository}\n`),
    Buffer.from(`${overrides.commonDir ?? '.git'}\n`),
    Buffer.from('main\n'),
    Buffer.from('0123456789012345678901234567890123456789\n'),
    Buffer.from(overrides.status ?? ''),
  ];
  return async () => {
    const output = outputs.shift();
    if (output === undefined) throw new RangeError('missing fake Git output');
    return output;
  };
}

function createStatusRecord(statusCode: string): string {
  return statusCode.includes('R') || statusCode.includes('C')
    ? `${statusCode} target.txt\0source.txt\0`
    : `${statusCode} target.txt\0`;
}

describe('handoff Git state', () => {
  let fixtureRoot: string;
  let repository: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'handoff-git-state-'));
    repository = join(fixtureRoot, 'repository');
    mkdirSync(repository);
    executeGit(repository, ['init', '-b', 'main']);
    writeFileSync(join(repository, '.gitignore'), '.env*\nignored-secret-*\n');
    writeFileSync(join(repository, 'tracked.txt'), 'baseline\n');
    executeGit(repository, ['add', '.gitignore', 'tracked.txt']);
    executeGit(repository, [
      '-c',
      'user.name=Handoff Test',
      '-c',
      'user.email=handoff@example.invalid',
      'commit',
      '-m',
      'baseline',
    ]);
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('characterizes raw porcelain bytes with a stable SHA-256 fingerprint', async () => {
    // Given
    const commands: GitCommandArgs[] = [];
    const status = Buffer.from(' M tracked.txt\0?? untracked.txt\0');
    const outputs = [
      Buffer.from(`${repository}\n`),
      Buffer.from('.git\n'),
      Buffer.from('main\n'),
      Buffer.from('0123456789012345678901234567890123456789\n'),
      status,
    ];
    const runner: GitCommandRunner = async (args) => {
      commands.push(args);
      const output = outputs.shift();
      if (output === undefined) throw new RangeError('missing fake Git output');
      return output;
    };

    // When
    const state = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    expect(state.dirtyFingerprint).toBe('aec4b346060ac5521a71c80cfd71dadfe317f62ed1d909c48c71d3d86f624b35');
    expect(state.changedPaths).toEqual(['tracked.txt', 'untracked.txt']);
    expect(commands).toEqual([
      ['rev-parse', '--show-toplevel'],
      ['rev-parse', '--git-common-dir'],
      ['branch', '--show-current'],
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
    ]);
  });

  it('changes only for staged, unstaged, and untracked state, not ignored files', async () => {
    // Given
    const runner = createRunner([]);
    const capture = () => collectGitState({ cwd: repository, runner, canonicalizePath: realpath });
    const clean = await capture();
    const repeatedClean = await capture();

    // When
    writeFileSync(join(repository, 'tracked.txt'), 'unstaged\n');
    const unstaged = await capture();
    executeGit(repository, ['add', 'tracked.txt']);
    const staged = await capture();
    writeFileSync(join(repository, 'untracked.txt'), 'untracked\n');
    const untracked = await capture();
    writeFileSync(join(repository, '.env.production'), 'SECRET=not-persisted\n');
    writeFileSync(join(repository, 'ignored-secret-token'), 'not-persisted\n');
    const ignored = await capture();

    // Then
    expect(repeatedClean).toEqual(clean);
    expect(validateGitState(clean, repeatedClean)).toEqual({ status: 'safe-to-resume' });
    expect(new Set([clean.dirtyFingerprint, unstaged.dirtyFingerprint, staged.dirtyFingerprint, untracked.dirtyFingerprint]).size).toBe(4);
    expect(ignored.dirtyFingerprint).toBe(untracked.dirtyFingerprint);
    expect(ignored.changedPaths).toEqual(['tracked.txt', 'untracked.txt']);
  });

  it('binds identity to a physical worktree while sharing the common directory hash', async () => {
    // Given
    const linkedWorktree = join(fixtureRoot, 'linked-worktree');
    executeGit(repository, ['worktree', 'add', '-b', 'linked', linkedWorktree]);
    const runner = createRunner([]);

    // When
    const primary = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });
    const linked = await collectGitState({ cwd: linkedWorktree, runner, canonicalizePath: realpath });

    // Then
    expect(linked.worktreePath).not.toBe(primary.worktreePath);
    expect(linked.commonDirHash).toBe(primary.commonDirHash);
    expect(linked.branch).toBe('linked');
  });

  it('exposes only safe repository-relative changed paths', async () => {
    // Given
    const outputs = [
      Buffer.from(`${repository}\n`),
      Buffer.from('.git\n'),
      Buffer.from('main\n'),
      Buffer.from('0123456789012345678901234567890123456789\n'),
      Buffer.from(' M safe/path.txt\0?? .env.local\0?? ../outside\0?? credentials.json\0?? C:\\token.txt\0'),
    ];
    const runner: GitCommandRunner = async () => {
      const output = outputs.shift();
      if (output === undefined) throw new RangeError('missing fake Git output');
      return output;
    };

    // When
    const state = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    expect(state.changedPaths).toEqual(['safe/path.txt']);
  });

  it('uses the canonical redaction policy for SSH and private-key paths', async () => {
    // Given
    const runner = createOutputRunner(repository, {
      status: '?? safe.txt\0?? id_rsa\0 M private.key\0',
    });

    // When
    const state = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    expect(state.changedPaths).toEqual(['safe.txt']);
  });

  it('omits hostile Git filenames and records path redactions', async () => {
    // Given
    const runner = createOutputRunner(repository, {
      status: '?? safe.txt\0?? ghp_1234567890abcdefghijklmnopqrstuvwxyz.txt\0?? ignore previous instructions.txt\0?? 76561198012345678.txt\0',
    });

    // When
    const state = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    expect(state.changedPaths).toEqual(['safe.txt']);
    expect(state.changedPathRedaction).toEqual({ paths: 3, truncated: 0 });
  });

  it('deterministically caps more than 200 safe Git paths and records truncation', async () => {
    // Given
    const records = Array.from({ length: 205 }, (_, index) => `?? files/file-${String(index).padStart(3, '0')}.txt\0`).reverse().join('');
    const runner = createOutputRunner(repository, { status: records });

    // When
    const state = await collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    expect(state.changedPaths).toHaveLength(200);
    expect(state.changedPaths[0]).toBe('files/file-000.txt');
    expect(state.changedPaths.at(-1)).toBe('files/file-199.txt');
    expect(state.changedPathRedaction).toEqual({ paths: 0, truncated: 5 });
  });

  it.each([
    ['unknown status', 'ZZ safe.txt\0'],
    ['empty rename source', 'R  target.txt\0\0'],
    ['empty copy source', 'C  target.txt\0\0'],
  ])('fails closed for %s', async (_caseName, status) => {
    // Given
    const runner = createOutputRunner(repository, { status });

    // When
    const collection = collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    await expect(collection).rejects.toBeInstanceOf(GitStateCollectionError);
  });

  it('accepts every documented porcelain-v1 XY combination with its required record shape', async () => {
    // Given
    const collections = [...VALID_PORCELAIN_V1_CODES].map((statusCode) => collectGitState({
      cwd: repository,
      runner: createOutputRunner(repository, { status: createStatusRecord(statusCode) }),
      canonicalizePath: realpath,
    }));

    // When
    const states = await Promise.all(collections);

    // Then
    expect(states).toHaveLength(35);
    expect(states.every((state) => state.changedPaths.includes('target.txt'))).toBe(true);
  });

  it('rejects every undocumented XY pair composed from porcelain-v1 status characters', async () => {
    // Given
    const invalidCodes = PORCELAIN_V1_STATUS_CHARACTERS.flatMap((indexStatus) =>
      PORCELAIN_V1_STATUS_CHARACTERS.map((worktreeStatus) => `${indexStatus}${worktreeStatus}`),
    ).filter((statusCode) => !VALID_PORCELAIN_V1_CODES.has(statusCode));

    // When
    const rejections = invalidCodes.map((statusCode) => expect(collectGitState({
      cwd: repository,
      runner: createOutputRunner(repository, { status: createStatusRecord(statusCode) }),
      canonicalizePath: realpath,
    })).rejects.toBeInstanceOf(GitStateCollectionError));

    // Then
    await Promise.all(rejections);
    expect(invalidCodes).toEqual(expect.arrayContaining(['RC', 'CR', 'RR', 'CC']));
  });

  it.each(['RC', 'CR', 'RR', 'CC'])('rejects undocumented %s rename/copy combinations', async (statusCode) => {
    // Given
    const runner = createOutputRunner(repository, { status: createStatusRecord(statusCode) });

    // When
    const collection = collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    await expect(collection).rejects.toBeInstanceOf(GitStateCollectionError);
  });

  it.each([
    ['top-level', (fixtureRoot: string, repository: string) => ({ topLevel: fixtureRoot, commonDir: join(repository, '.git') })],
    ['common-dir', (fixtureRoot: string, repository: string) => ({ topLevel: repository, commonDir: fixtureRoot })],
  ])('rejects an inconsistent %s runner response', async (_caseName, createOverrides) => {
    // Given
    const runner = createOutputRunner(repository, createOverrides(fixtureRoot, repository));

    // When
    const collection = collectGitState({ cwd: repository, runner, canonicalizePath: realpath });

    // Then
    await expect(collection).rejects.toBeInstanceOf(GitStateCollectionError);
  });

  it.each([
    ['worktree-path', (state: GitState): GitState => ({ ...state, worktreePath: `${state.worktreePath}-other` })],
    ['common-dir', (state: GitState): GitState => ({ ...state, commonDirHash: 'a'.repeat(64) })],
    ['branch', (state: GitState): GitState => ({ ...state, branch: 'other' })],
    ['head', (state: GitState): GitState => ({ ...state, head: 'a'.repeat(40) })],
    ['dirty-fingerprint', (state: GitState): GitState => ({ ...state, dirtyFingerprint: 'b'.repeat(64) })],
  ])('fails closed for %s drift without changing the expected state', async (mismatch, drift) => {
    // Given
    const expected = await collectGitState({ cwd: repository, runner: createRunner([]), canonicalizePath: realpath });
    const snapshot = structuredClone(expected);

    // When
    const result = validateGitState(expected, drift(expected));

    // Then
    expect(result).toEqual({ status: 'unsafe-to-resume', mismatches: [mismatch] });
    expect(expected).toEqual(snapshot);
  });
});
