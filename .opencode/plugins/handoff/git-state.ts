import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { boundSafeRelativePaths, isSafeRelativePath } from './redaction.js';
import { isCanonicalBranch, safeBranch } from './durable-values.js';

const READ_ONLY_GIT_COMMANDS = [
  ['rev-parse', '--show-toplevel'],
  ['rev-parse', '--git-common-dir'],
  ['branch', '--show-current'],
  ['rev-parse', 'HEAD'],
  ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
] as const;

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const HEAD_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PORCELAIN_V1_STATUS_CODES = new Set([
  ' M', ' T', ' A', ' D', ' R', ' C',
  'M ', 'MM', 'MT', 'MD', 'T ', 'TM', 'TT', 'TD', 'A ', 'AM', 'AT', 'AD', 'D ',
  'R ', 'RM', 'RT', 'RD', 'C ', 'CM', 'CT', 'CD',
  'DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU', '??',
]);

export type GitCommandArgs = (typeof READ_ONLY_GIT_COMMANDS)[number];

export type GitCommandRunner = (
  args: GitCommandArgs,
  cwd: string,
) => Promise<Uint8Array>;

export type GitState = {
  readonly worktreePath: string;
  readonly commonDirHash: string;
  readonly branch: string;
  readonly head: string;
  readonly dirtyFingerprint: string;
  readonly changedPaths: readonly string[];
  readonly changedPathRedaction?: { readonly paths: number; readonly truncated: number };
};

export type GitStateMismatch =
  | 'invalid-state'
  | 'worktree-path'
  | 'common-dir'
  | 'branch'
  | 'head'
  | 'dirty-fingerprint';

export type GitStateValidation =
  | { readonly status: 'safe-to-resume' }
  | { readonly status: 'unsafe-to-resume'; readonly mismatches: readonly GitStateMismatch[] };

export type GitStateCollectorOptions = {
  readonly cwd: string;
  readonly runner: GitCommandRunner;
  readonly canonicalizePath: (path: string) => Promise<string>;
};

type CanonicalGitLayout = {
  readonly worktreePath: string;
  readonly commonDirPath: string;
};

export class GitStateCollectionError extends Error {
  readonly name = 'GitStateCollectionError';
  readonly reason: string;

  constructor(reason: string, cause?: unknown) {
    super(`Unable to collect Git state: ${reason}`, { cause });
    this.reason = reason;
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeLine(bytes: Uint8Array, field: string, allowEmpty = false): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = decoded.endsWith('\r\n') ? decoded.slice(0, -2) : decoded.endsWith('\n') ? decoded.slice(0, -1) : decoded;
  if ((!allowEmpty && value.length === 0) || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new GitStateCollectionError(`invalid ${field}`);
  }
  return value;
}

function isValidStatusCode(statusCode: string): boolean {
  return PORCELAIN_V1_STATUS_CODES.has(statusCode);
}

function parseChangedPaths(bytes: Uint8Array): { readonly paths: readonly string[]; readonly rejected: number; readonly truncated: number } {
  if (bytes.byteLength === 0) return { paths: [], rejected: 0, truncated: 0 };
  const status = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!status.endsWith('\0')) throw new GitStateCollectionError('unterminated porcelain status');

  const records = status.slice(0, -1).split('\0');
  const candidates: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4 || record[2] !== ' ') {
      throw new GitStateCollectionError('malformed porcelain status');
    }
    const statusCode = record.slice(0, 2);
    if (!isValidStatusCode(statusCode)) throw new GitStateCollectionError('unknown porcelain status');

    const path = record.slice(3);
    const isRenameOrCopy = statusCode.includes('R') || statusCode.includes('C');
    candidates.push(path);

    if (isRenameOrCopy) {
      index += 1;
      const source = records[index];
      if (source === undefined || source.length === 0) {
        throw new GitStateCollectionError('missing rename or copy source');
      }
      candidates.push(source);
    }
  }
  return boundSafeRelativePaths(candidates);
}

async function assertCoherentGitLayout(
  options: GitStateCollectorOptions,
  layout: CanonicalGitLayout,
): Promise<void> {
  try {
    const canonicalCwd = await options.canonicalizePath(options.cwd);
    const cwdRelativeToWorktree = relative(layout.worktreePath, canonicalCwd);
    if (
      cwdRelativeToWorktree === '..' ||
      cwdRelativeToWorktree.startsWith(`..${sep}`) ||
      isAbsolute(cwdRelativeToWorktree)
    ) {
      throw new GitStateCollectionError('working directory is outside reported worktree');
    }

    const commonDirStats = await stat(layout.commonDirPath);
    if (!commonDirStats.isDirectory()) throw new GitStateCollectionError('common directory is not a directory');

    const gitMarkerPath = resolve(layout.worktreePath, '.git');
    const gitMarkerStats = await stat(gitMarkerPath);
    if (gitMarkerStats.isDirectory()) {
      const canonicalGitMarker = await options.canonicalizePath(gitMarkerPath);
      if (canonicalGitMarker !== layout.commonDirPath) throw new GitStateCollectionError('common directory does not match worktree');
      return;
    }
    if (!gitMarkerStats.isFile()) throw new GitStateCollectionError('worktree Git marker has an unsupported type');

    const gitMarker = decodeLine(await readFile(gitMarkerPath), 'worktree Git marker');
    if (!gitMarker.startsWith('gitdir: ') || gitMarker.length === 8) {
      throw new GitStateCollectionError('invalid worktree Git marker');
    }
    const gitDirPath = await options.canonicalizePath(resolve(layout.worktreePath, gitMarker.slice(8)));
    const gitDirRelativeToCommon = relative(layout.commonDirPath, gitDirPath);
    const isLinkedWorktreeGitDir = gitDirRelativeToCommon.startsWith(`worktrees${sep}`);
    if (gitDirPath !== layout.commonDirPath && !isLinkedWorktreeGitDir) {
      throw new GitStateCollectionError('worktree Git directory does not belong to common directory');
    }
  } catch (error) {
    if (error instanceof GitStateCollectionError) throw error;
    throw new GitStateCollectionError('incoherent Git layout', error);
  }
}

function isValidState(state: GitState): boolean {
  return (
    isAbsolute(state.worktreePath) &&
    SHA_256_PATTERN.test(state.commonDirHash) &&
    isCanonicalBranch(state.branch) &&
    HEAD_PATTERN.test(state.head) &&
    SHA_256_PATTERN.test(state.dirtyFingerprint) &&
    state.changedPaths.length <= 200 && state.changedPaths.every(isSafeRelativePath)
  );
}

export async function collectGitState(options: GitStateCollectorOptions): Promise<GitState> {
  const topLevelBytes = await options.runner(READ_ONLY_GIT_COMMANDS[0], options.cwd);
  const commonDirBytes = await options.runner(READ_ONLY_GIT_COMMANDS[1], options.cwd);
  const branchBytes = await options.runner(READ_ONLY_GIT_COMMANDS[2], options.cwd);
  const headBytes = await options.runner(READ_ONLY_GIT_COMMANDS[3], options.cwd);
  const statusBytes = await options.runner(READ_ONLY_GIT_COMMANDS[4], options.cwd);

  const topLevel = decodeLine(topLevelBytes, 'worktree path');
  const commonDir = decodeLine(commonDirBytes, 'common directory');
  const worktreePath = await options.canonicalizePath(resolve(options.cwd, topLevel));
  const commonDirPath = await options.canonicalizePath(resolve(options.cwd, commonDir));
  await assertCoherentGitLayout(options, { worktreePath, commonDirPath });
  const head = decodeLine(headBytes, 'HEAD').toLowerCase();
  if (!HEAD_PATTERN.test(head)) throw new GitStateCollectionError('invalid HEAD');

  const changedPaths = parseChangedPaths(statusBytes);
  return {
    worktreePath,
    commonDirHash: sha256(commonDirPath),
    branch: safeBranch(decodeLine(branchBytes, 'branch', true)),
    head,
    dirtyFingerprint: sha256(statusBytes),
    changedPaths: changedPaths.paths,
    changedPathRedaction: { paths: changedPaths.rejected, truncated: changedPaths.truncated },
  };
}

export function validateGitState(expected: GitState, current: GitState): GitStateValidation {
  if (!isValidState(expected) || !isValidState(current)) {
    return { status: 'unsafe-to-resume', mismatches: ['invalid-state'] };
  }

  const mismatches: GitStateMismatch[] = [];
  if (expected.worktreePath !== current.worktreePath) mismatches.push('worktree-path');
  if (expected.commonDirHash !== current.commonDirHash) mismatches.push('common-dir');
  if (expected.branch !== current.branch) mismatches.push('branch');
  if (expected.head !== current.head) mismatches.push('head');
  if (expected.dirtyFingerprint !== current.dirtyFingerprint) mismatches.push('dirty-fingerprint');
  return mismatches.length === 0
    ? { status: 'safe-to-resume' }
    : { status: 'unsafe-to-resume', mismatches };
}
