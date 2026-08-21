import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProcessLock, ProcessLockError } from '../src/application/process-lock.js';
import { startBot } from '../src/index.js';

describe('process lifecycle', () => {
  it('atomically prevents a second process lock for the same database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-process-lock-'));
    const databasePath = join(directory, 'wishlist.db');
    const first = ProcessLock.acquire(databasePath);

    try {
      expect(() => ProcessLock.acquire(databasePath)).toThrow(ProcessLockError);
    } finally {
      first.release();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reclaims a valid lock only when its owner PID is definitely dead', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-stale-lock-'));
    const databasePath = join(directory, 'wishlist.db');
    const stalePid = 1_234_567;
    writeFileSync(`${resolve(databasePath)}.lock`, JSON.stringify({
      pid: stalePid,
      token: randomUUID(),
      startedAt: '2026-08-21T00:00:00.000Z',
    }));
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === stalePid) {
        throw Object.assign(new Error('missing process'), { code: 'ESRCH' });
      }
      return true;
    });

    try {
      const lock = ProcessLock.acquire(databasePath);
      expect(() => ProcessLock.acquire(databasePath)).toThrow(ProcessLockError);
      lock.release();
    } finally {
      kill.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps a valid lock when process state is uncertain', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-uncertain-lock-'));
    const databasePath = join(directory, 'wishlist.db');
    writeFileSync(`${resolve(databasePath)}.lock`, JSON.stringify({
      pid: 1_234_568,
      token: randomUUID(),
      startedAt: '2026-08-21T00:00:00.000Z',
    }));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
    });

    try {
      expect(() => ProcessLock.acquire(databasePath)).toThrow(ProcessLockError);
    } finally {
      kill.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not delete an incomplete lock that may still be owned by a starting process', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-incomplete-lock-'));
    const databasePath = join(directory, 'wishlist.db');
    writeFileSync(`${resolve(databasePath)}.lock`, '');

    expect(() => ProcessLock.acquire(databasePath)).toThrow(ProcessLockError);
    rmSync(directory, { recursive: true, force: true });
  });

  it('cancels startup before resources or external requests are created', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(startBot({
      discordToken: 'test-token',
      discordClientId: '123456789012345678',
      discordGuildId: '987654321098765432',
      databasePath: ':memory:',
      pollIntervalHours: 6,
      notificationRetryIntervalSeconds: 60,
    }, { signal: controller.signal })).rejects.toThrow('Bot startup was cancelled');
  });

  it('releases database and process lock when initialization fails', async () => {
    const environment = {
      discordToken: 'test-token',
      discordClientId: '123456789012345678',
      discordGuildId: '987654321098765432',
      databasePath: ':memory:',
      pollIntervalHours: 0,
      notificationRetryIntervalSeconds: 60,
    };

    await expect(startBot(environment)).rejects.toThrow(
      'Scheduler interval must be between 0.25 and 168 hours',
    );
    const lock = ProcessLock.acquire(':memory:');
    lock.release();
  });

  it('cleans up startup resources when the Node PID cannot be published', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-pid-publish-'));
    const databasePath = join(directory, 'wishlist.db');
    const environment = {
      discordToken: 'test-token',
      discordClientId: '123456789012345678',
      discordGuildId: '987654321098765432',
      databasePath,
      pollIntervalHours: 6,
      notificationRetryIntervalSeconds: 60,
    };

    try {
      await expect(startBot(environment, { nodePidPath: directory })).rejects.toThrow();
      const lock = ProcessLock.acquire(databasePath);
      lock.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses cooperative Windows shutdown before the force-kill fallback', () => {
    const script = readFileSync(resolve('scripts/bot-control.ps1'), 'utf8');

    expect(script).toContain('shutdown.request');
    expect(script.indexOf('Set-Content -LiteralPath $shutdownRequestPath'))
      .toBeLessThan(script.indexOf('taskkill.exe /PID'));
    expect(script).toContain('Graceful shutdown timed out');
    expect(script).toContain('bot.health.json');
    expect(script).toContain('System.Threading.Mutex');
    expect(script.indexOf("$health.phase -eq 'ready'"))
      .toBeLessThan(script.indexOf('Bot started'));
  });
});
