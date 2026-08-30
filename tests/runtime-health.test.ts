import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeHealth } from '../src/application/runtime-health.js';

describe('RuntimeHealth', () => {
  it('writes atomic allowlisted lifecycle and heartbeat state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wishlist-health-'));
    const healthPath = join(directory, 'bot.health.json');
    let heartbeat: (() => void) | undefined;
    let now = new Date('2026-08-21T00:00:00.000Z');
    const clock = {
      setInterval: vi.fn((callback: () => void) => {
        heartbeat = callback;
        return {} as ReturnType<typeof setInterval>;
      }),
      clearInterval: vi.fn(),
    };

    try {
      const health = new RuntimeHealth(healthPath, {
        heartbeatIntervalMs: 10_000,
        clock,
        now: () => now,
      });
      let discordReady = true;
      let guildCount = 3;
      health.setDiscordReadyProbe(() => discordReady);
      health.setDiscordGuildCountProbe(() => guildCount);
      expect(JSON.parse(readFileSync(healthPath, 'utf8'))).toMatchObject({
        schemaVersion: 1,
        phase: 'starting',
        pid: process.pid,
        discordReady: false,
        guildCount: null,
      });

      health.markReady();
      now = new Date('2026-08-21T00:00:10.000Z');
      heartbeat?.();
      expect(JSON.parse(readFileSync(healthPath, 'utf8'))).toMatchObject({
        phase: 'ready',
        discordReady: true,
        guildCount: 3,
      });
      guildCount = 0;
      health.refreshDiscordReady();
      expect(JSON.parse(readFileSync(healthPath, 'utf8'))).toMatchObject({
        phase: 'ready',
        discordReady: true,
        guildCount: 0,
      });
      discordReady = false;
      health.refreshDiscordReady();
      expect(JSON.parse(readFileSync(healthPath, 'utf8'))).toMatchObject({
        phase: 'ready',
        discordReady: false,
        guildCount: null,
      });
      health.markStopping();
      health.markStopped();
      const document = JSON.parse(readFileSync(healthPath, 'utf8')) as Record<string, unknown>;

      expect(document).toMatchObject({
        phase: 'stopped',
        heartbeatAt: '2026-08-21T00:00:10.000Z',
        discordReady: false,
        guildCount: null,
      });
      expect(Object.keys(document).sort()).toEqual([
        'discordReady',
        'failedAt',
        'guildCount',
        'heartbeatAt',
        'phase',
        'pid',
        'readyAt',
        'schemaVersion',
        'startedAt',
        'stoppedAt',
        'stoppingAt',
      ]);
      expect(JSON.stringify(document)).not.toContain('test-token');
      expect(existsSync(`${healthPath}.${process.pid}.tmp`)).toBe(false);
      expect(clock.clearInterval).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
