import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteractionContextType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { allowedWhileBlocked, registerBotEvents, type BotCommandServices } from '../src/discord/bot-events.js';
import { componentAction, installType, interactionRecord } from '../src/discord/interaction-telemetry.js';
import { createDatabase } from '../src/persistence/database.js';
import { DeletionJournal } from '../src/persistence/deletion-journal.js';
import { TelemetryRepository, type InteractionRecord } from '../src/persistence/telemetry-repository.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { seedUser } from './helpers/admin-seed.js';

function record(overrides: Partial<InteractionRecord> = {}): InteractionRecord {
  return {
    discordUserId: '100000000000000001', guildId: '900000000000000001', context: 'guild', install: 'guild',
    kind: 'command', action: '/dealio', locale: 'tr', occurredAt: '2026-10-05T10:00:00.000Z', ...overrides,
  };
}

/** The pieces of a discord.js interaction that telemetry and the block check read. */
function fakeInteraction(options: { command?: string; customId?: string; userId?: string; guildId?: string | null } = {}) {
  const reply = vi.fn(async () => undefined);
  return {
    user: { id: options.userId ?? '100000000000000001' },
    guildId: options.guildId ?? '900000000000000001',
    context: InteractionContextType.Guild,
    authorizingIntegrationOwners: { 0: '900000000000000001' },
    locale: 'tr',
    commandName: options.command ?? 'dealio',
    customId: options.customId ?? '',
    options: { getSubcommand: () => null },
    isChatInputCommand: () => options.command !== undefined,
    isMessageComponent: () => options.customId !== undefined,
    isModalSubmit: () => false,
    isButton: () => options.customId !== undefined,
    isRepliable: () => true,
    reply,
  };
}

describe('interaction telemetry', () => {
  it('names component actions without session IDs or numbers', () => {
    expect(componentAction('assistant:1300000000000000001:page:12')).toBe('assistant:page:#');
    expect(componentAction('dealio:1300000000000000001:tab:wishlist')).toBe('dealio:tab:wishlist');
    expect(componentAction('dealio-summary:7c9e6679-7425-40de-944b-e07fc1f90ae7:next')).toBe('dealio-summary:next');
    expect(componentAction('dealio-open:home')).toBe('dealio-open:home');
  });

  it('tells server installs from personal installs', () => {
    expect(installType({ 0: '9' })).toBe('guild');
    expect(installType({ 1: '1' })).toBe('user');
    expect(installType({ 0: '9', 1: '1' })).toBe('both');
    expect(installType(null)).toBe('unknown');
  });

  it('maps a slash command to a record with its server and install', () => {
    const interaction = fakeInteraction({ command: 'dealio' });
    expect(interactionRecord(interaction as never, new Date('2026-10-06T00:00:00.000Z'))).toEqual({
      discordUserId: '100000000000000001', guildId: '900000000000000001', context: 'guild', install: 'guild',
      kind: 'command', action: '/dealio', locale: 'tr', occurredAt: '2026-10-06T00:00:00.000Z',
    });
  });
});

describe('TelemetryRepository', () => {
  let database: DatabaseSync;
  let telemetry: TelemetryRepository;

  beforeEach(() => {
    database = createDatabase(':memory:');
    telemetry = new TelemetryRepository(database);
  });
  afterEach(() => database.close());

  it('summarizes activity, sources and the setup funnel', () => {
    seedUser(database, { id: '100000000000000001' });
    telemetry.recordInteraction(record());
    telemetry.recordInteraction(record({ action: 'dealio:tab:wishlist', kind: 'component' }));
    telemetry.recordInteraction(record({ discordUserId: '100000000000000002', occurredAt: '2026-10-04T10:00:00.000Z' }));
    telemetry.recordInteraction(record({ discordUserId: '100000000000000003', guildId: null, context: 'bot_dm', install: 'user' }));
    telemetry.recordInteraction(record({ discordUserId: '100000000000000002', kind: 'setup', action: 'prepare-failed:STEAM_NOT_FOUND',
      guildId: null, context: 'unknown', install: 'unknown' }));
    const since = '2026-10-01T00:00:00.000Z';
    expect(telemetry.dailyActiveUsers(since)).toEqual([
      { day: '2026-10-04', count: 1 }, { day: '2026-10-05', count: 2 },
    ]);
    expect(telemetry.usageBy('action', since)[0]).toEqual({ key: '/dealio', count: 3, users: 3 });
    expect(telemetry.usageBy('install', since)).toEqual([
      { key: 'guild', count: 3, users: 2 }, { key: 'user', count: 1, users: 1 },
    ]);
    expect(telemetry.setupFunnel(since)).toEqual([{ key: 'prepare-failed:STEAM_NOT_FOUND', count: 1, users: 1 }]);
    expect(telemetry.guildSources()).toEqual([{
      guildId: '900000000000000001', users: 2, registeredUsers: 1, lastSeenAt: '2026-10-05T10:00:00.000Z',
    }]);
    expect(telemetry.firstGuildByUser().get('100000000000000001')).toBe('900000000000000001');
    expect(telemetry.userUsage('100000000000000001')).toMatchObject({ interactions: 2, installs: ['guild'] });
  });

  it('keeps server history and counts servers per day', () => {
    telemetry.recordGuildEvent({ guildId: '1', guildName: 'One', memberCount: 5, event: 'join', occurredAt: '2026-10-01T00:00:00.000Z' });
    telemetry.recordGuildEvent({ guildId: '2', guildName: 'Two', memberCount: 9, event: 'join', occurredAt: '2026-10-02T00:00:00.000Z' });
    telemetry.recordGuildEvent({ guildId: '1', guildName: 'One', memberCount: 5, event: 'leave', occurredAt: '2026-10-03T00:00:00.000Z' });
    expect(telemetry.guildCountByDay()).toEqual([
      { day: '2026-10-01', count: 1 }, { day: '2026-10-02', count: 2 }, { day: '2026-10-03', count: 1 },
    ]);
    expect(telemetry.departedGuilds().map((event) => event.guildName)).toEqual(['One']);
    expect(telemetry.latestGuildEvents().get('1')).toEqual({ event: 'leave', guildName: 'One' });
  });

  it('drops events older than 90 days', () => {
    telemetry.recordInteraction(record({ occurredAt: '2026-06-01T00:00:00.000Z' }));
    telemetry.recordInteraction(record());
    expect(telemetry.cleanup(new Date('2026-10-06T00:00:00.000Z'))).toBe(1);
  });

  it('tells when the kept usage record begins, so the panel never reads a gap as "no use"', () => {
    expect(telemetry.firstEventAt()).toBeNull();
    telemetry.recordInteraction(record({ occurredAt: '2026-10-06T17:19:40.953Z' }));
    telemetry.recordInteraction(record({ occurredAt: '2026-10-06T19:11:40.602Z' }));
    expect(telemetry.firstEventAt()).toBe('2026-10-06T17:19:40.953Z');
  });

  it('is deleted with the user’s data, also for a visitor who never set up', () => {
    seedUser(database, { id: '100000000000000001' });
    telemetry.recordInteraction(record());
    telemetry.recordInteraction(record({ discordUserId: '100000000000000002' }));
    expect(new UserConfigRepository(database).deleteByDiscordUserId('100000000000000001')).toBe(true);
    expect(telemetry.userUsage('100000000000000001').interactions).toBe(0);
    expect(telemetry.deleteUser('100000000000000002')).toBe(1);
  });
});

describe('deletion journal and telemetry', () => {
  let directory: string;
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('removes restored usage events from before a deletion, but keeps later ones', () => {
    directory = mkdtempSync(join(tmpdir(), 'dealio-telemetry-'));
    const journal = new DeletionJournal(join(directory, 'deletions.jsonl'), () => new Date('2026-10-06T00:00:00.000Z'));
    journal.record('100000000000000001', '2026-10-05T12:00:00.000Z');
    const database = createDatabase(':memory:');
    const telemetry = new TelemetryRepository(database);
    telemetry.recordInteraction(record({ occurredAt: '2026-10-05T10:00:00.000Z' }));
    telemetry.recordInteraction(record({ occurredAt: '2026-10-05T18:00:00.000Z' }));
    journal.reconcile(database);
    expect(telemetry.userUsage('100000000000000001').interactions).toBe(1);
    database.close();
  });
});

describe('blocked users', () => {
  function client() {
    const emitter = new EventEmitter();
    return Object.assign(emitter, { isReady: () => true });
  }

  it('answers a blocked user with one notice and records the attempt', async () => {
    const fakeClient = client();
    const recorded: InteractionRecord[] = [];
    const tasks: Promise<unknown>[] = [];
    registerBotEvents({
      client: fakeClient as never,
      scheduler: { start: () => undefined },
      notificationRetryScheduler: { start: () => undefined },
      taskTracker: { run: (task: () => Promise<unknown>) => { tasks.push(task()); } } as never,
      services: {} as BotCommandServices,
      telemetry: { recordInteraction: (entry) => recorded.push(entry) },
      blocks: { isUserBlocked: () => true },
    });
    const interaction = fakeInteraction({ command: 'dealio' });
    fakeClient.emit('interactionCreate', interaction);
    await Promise.all(tasks);
    expect(recorded).toHaveLength(1);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(interaction.reply.mock.calls[0])).toContain('/delete-data');
  });

  it('still lets a blocked user delete their data', () => {
    expect(allowedWhileBlocked(fakeInteraction({ command: 'delete-data' }) as never)).toBe(true);
    expect(allowedWhileBlocked(fakeInteraction({ customId: 'delete-v2:1:confirm' }) as never)).toBe(true);
    expect(allowedWhileBlocked(fakeInteraction({ command: 'dealio' }) as never)).toBe(false);
    expect(allowedWhileBlocked(fakeInteraction({ customId: 'dealio-open:home' }) as never)).toBe(false);
  });
});
