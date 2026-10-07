import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessLock, ProcessLockError } from '../src/application/process-lock.js';

const fileSystem = undefined;
let directory: string | null = null;

function databasePath(): string {
  directory = mkdtempSync(join(tmpdir(), 'dealio-lock-'));
  return join(directory, 'wishlist.db');
}

function writeLock(path: string, metadata: Record<string, unknown>): void {
  writeFileSync(`${resolve(path)}.lock`, JSON.stringify({
    token: randomUUID(), startedAt: '2026-08-21T00:00:00.000Z', ...metadata,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

describe('process lock after an unclean exit', () => {
  it('reclaims a lock a previous run left with the PID this process now has', () => {
    const path = databasePath();
    // After a reboot the bot can be given the PID its previous run had.
    writeLock(path, { pid: process.pid });

    const lock = ProcessLock.acquire(path, fileSystem, () => null);
    try {
      expect(JSON.parse(readFileSync(`${resolve(path)}.lock`, 'utf8')).pid).toBe(process.pid);
      // A lock this process really holds still excludes a second start.
      expect(() => ProcessLock.acquire(path, fileSystem, () => null)).toThrow(ProcessLockError);
    } finally {
      lock.release();
    }
  });

  it('reclaims a lock from an earlier boot even when its PID now belongs to another process', () => {
    const path = databasePath();
    writeLock(path, { pid: 1_234_569, bootId: 'earlier-boot' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const lock = ProcessLock.acquire(path, fileSystem, () => 'current-boot');
    try {
      expect(kill).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(`${resolve(path)}.lock`, 'utf8')).bootId).toBe('current-boot');
    } finally {
      lock.release();
    }
  });

  it('keeps a lock from the same boot whose owner is alive', () => {
    const path = databasePath();
    writeLock(path, { pid: 1_234_570, bootId: 'current-boot' });
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(() => ProcessLock.acquire(path, fileSystem, () => 'current-boot')).toThrow(ProcessLockError);
  });

  it('keeps a live owner when the boot cannot be compared', () => {
    const path = databasePath();
    writeLock(path, { pid: 1_234_571 });
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(() => ProcessLock.acquire(path, fileSystem, () => 'current-boot')).toThrow(ProcessLockError);
  });
});
