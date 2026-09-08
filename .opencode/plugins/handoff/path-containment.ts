import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSafeRelativePath } from './redaction.js';

export class PathContainmentError extends Error {
  readonly name = 'PathContainmentError';
}

function normalized(path: string): string {
  const absolute = resolve(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

async function requirePhysicalDirectory(root: string, candidate: string): Promise<string> {
  const stats = await lstat(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new PathContainmentError('Handoff path is not a physical directory');
  }
  const canonical = await realpath(candidate);
  if (!isContained(root, canonical) || normalized(canonical) !== normalized(candidate)) {
    throw new PathContainmentError('Handoff path escapes the canonical worktree');
  }
  return canonical;
}

export async function canonicalWorktreeMatches(inputPath: string, canonicalPath: string): Promise<boolean> {
  try {
    return normalized(await realpath(inputPath)) === normalized(canonicalPath);
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export async function prepareHandoffDirectory(canonicalWorktree: string): Promise<string> {
  const root = await realpath(canonicalWorktree);
  if (normalized(root) !== normalized(canonicalWorktree)) {
    throw new PathContainmentError('Git worktree identity is not canonical');
  }
  let current = root;
  for (const segment of ['.omo', 'handoff'] as const) {
    const candidate = join(current, segment);
    try {
      await mkdir(candidate);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    current = await requirePhysicalDirectory(root, candidate);
  }
  return current;
}

export async function assertHandoffTargetContained(directory: string, target: string): Promise<void> {
  const expectedDirectory = resolve(directory);
  const root = await realpath(resolve(expectedDirectory, '..', '..'));
  await requirePhysicalDirectory(root, expectedDirectory);
  const expectedTarget = resolve(target);
  if (expectedTarget !== expectedDirectory && normalized(dirname(expectedTarget)) !== normalized(expectedDirectory)) {
    throw new PathContainmentError('Handoff target escapes its canonical directory');
  }
}

export async function isContainedEvidencePath(canonicalWorktree: string, path: string): Promise<boolean> {
  if (!isSafeRelativePath(path)) return false;
  try {
    const root = await realpath(canonicalWorktree);
    if (normalized(root) !== normalized(canonicalWorktree)) return false;
    let current = root;
    for (const segment of path.split('/')) {
      const candidate = join(current, segment);
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) return false;
      const canonical = await realpath(candidate);
      if (!isContained(root, canonical) || normalized(canonical) !== normalized(candidate)) return false;
      current = canonical;
    }
    const finalStats = await lstat(current);
    return finalStats.isFile() || finalStats.isDirectory();
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || error instanceof PathContainmentError) return false;
    throw error;
  }
}
