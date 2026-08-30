import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdminHealthReader } from '../src/admin/health-reader.js';

const now = new Date('2026-08-29T12:00:00.000Z');

function healthDocument(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    phase: 'ready',
    pid: 4242,
    startedAt: '2026-08-29T11:00:00.000Z',
    readyAt: '2026-08-29T11:00:05.000Z',
    stoppingAt: null,
    stoppedAt: null,
    failedAt: null,
    heartbeatAt: '2026-08-29T11:59:45.000Z',
    discordReady: true,
    ...overrides,
  });
}

describe('AdminHealthReader', () => {
  it('returns an allowlisted available snapshot for additive schema v1', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-health-'));
    const path = join(directory, 'bot.health.json');
    writeFileSync(path, healthDocument({ guildCount: 7, token: 'secret', path: '/private' }));

    try {
      const result = new AdminHealthReader(path, { now: () => now }).readSnapshot();

      expect(result).toEqual({
        status: 'available',
        phase: 'ready',
        discordReady: true,
        guildCount: 7,
        startedAt: '2026-08-29T11:00:00.000Z',
        readyAt: '2026-08-29T11:00:05.000Z',
        heartbeatAt: '2026-08-29T11:59:45.000Z',
      });
      expect(JSON.stringify(result)).not.toContain('4242');
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(JSON.stringify(result)).not.toContain('/private');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts legacy schema v1 without inventing a guild count', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-health-legacy-'));
    const path = join(directory, 'bot.health.json');
    writeFileSync(path, healthDocument());

    try {
      expect(new AdminHealthReader(path, { now: () => now }).readSnapshot()).toMatchObject({
        status: 'available',
        guildCount: null,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts a fresh stopped schema-v1 document with a null guild count', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-health-stopped-'));
    const path = join(directory, 'bot.health.json');
    writeFileSync(path, healthDocument({
      phase: 'stopped',
      discordReady: false,
      guildCount: null,
      stoppedAt: '2026-08-29T11:59:50.000Z',
      heartbeatAt: '2026-08-29T11:59:50.000Z',
    }));

    try {
      expect(new AdminHealthReader(path, { now: () => now }).readSnapshot()).toMatchObject({
        status: 'available',
        phase: 'stopped',
        discordReady: false,
        guildCount: null,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing', undefined, 'unavailable'],
    ['malformed', '{', 'malformed'],
    ['unsupported', healthDocument({ schemaVersion: 2 }), 'unsupported'],
    ['future', healthDocument({ heartbeatAt: '2026-08-29T12:00:06.000Z' }), 'future'],
    ['stale', healthDocument({ heartbeatAt: '2026-08-29T11:59:29.999Z' }), 'stale'],
    ['oversized', 'x'.repeat(16_385), 'oversized'],
  ])('reports %s health as unavailable instead of healthy', (_case, contents, reason) => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-health-invalid-'));
    const path = join(directory, 'bot.health.json');
    if (contents !== undefined) {
      writeFileSync(path, contents);
    }

    try {
      expect(new AdminHealthReader(path, { now: () => now }).readSnapshot()).toEqual({
        status: 'unavailable',
        reason,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
