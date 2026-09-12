import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProcessLock } from '../src/application/process-lock.js';

it('rejects the same production application even with a different database', () => {
  const root = mkdtempSync(join(tmpdir(), 'dealio-app-lock-'));
  const locks = join(root, 'locks');
  const first = ProcessLock.acquireForApplication(join(root, 'one.db'), '12345', locks);
  try {
    expect(() => ProcessLock.acquireForApplication(join(root, 'two.db'), '12345', locks))
      .toThrow('process lock already exists');
    const otherApp = ProcessLock.acquireForApplication(join(root, 'two.db'), '67890', locks);
    otherApp.release();
    first.release();
    const restarted = ProcessLock.acquireForApplication(join(root, 'one.db'), '12345', locks);
    restarted.release();
  } finally {
    first.release();
    rmSync(root, { recursive: true, force: true });
  }
});

it('releases the application lock when the database is already occupied', () => {
  const root = mkdtempSync(join(tmpdir(), 'dealio-app-lock-'));
  const locks = join(root, 'locks');
  const existing = ProcessLock.acquire(join(root, 'one.db'));
  try {
    expect(() => ProcessLock.acquireForApplication(join(root, 'one.db'), '12345', locks)).toThrow();
    const recovered = ProcessLock.acquireForApplication(join(root, 'two.db'), '12345', locks);
    recovered.release();
  } finally {
    existing.release();
    rmSync(root, { recursive: true, force: true });
  }
});
