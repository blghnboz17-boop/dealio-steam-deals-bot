import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SupportTicketService, type SupportDesk, type SupportThreadState, type SupportTicketOpening,
} from '../src/application/support-ticket-service.js';
import { loadEnvironment } from '../src/config/environment.js';
import { acceptedScreenshots, ticketNumber, type SupportTicket } from '../src/domain/support-ticket.js';
import { RestSupportDesk } from '../src/discord/support/support-desk.js';
import { languages } from '../src/domain/user-config.js';
import {
  buildSupportModal, buildSupportPanel, buildTicketClosedLog, buildTicketClosedNotice, buildTicketHeader,
  buildTicketOpenedLog, ticketThreadName,
} from '../src/discord/support/support-view.js';
import { createDatabase } from '../src/persistence/database.js';
import { SupportTicketRepository } from '../src/persistence/support-ticket-repository.js';
import {
  botInviteUrl, categories, everyonePermissions, infoMessages, onboardingDefaultChannels, onboardingPrompts, roles, thirdPartyBots,
} from '../scripts/support-server/blueprint.js';

const user = '111111111111111111';
const stranger = '222222222222222222';
const staffMember = '333333333333333333';
const guild = '444444444444444444';
const channel = '555555555555555555';

class FakeDesk implements SupportDesk {
  public readonly calls: string[] = [];
  public state: SupportThreadState = 'active';
  public failCreate = false;
  public failAddMember = false;
  private nextThread = 900_000_000_000_000_000n;

  public async threadState(threadId: string): Promise<SupportThreadState> {
    this.calls.push(`state:${threadId}`);
    return this.state;
  }
  public async createThread(channelId: string, opening: SupportTicketOpening): Promise<string> {
    this.calls.push(`create:${channelId}:${opening.ticket.ticketId}`);
    if (this.failCreate) throw new Error('Missing Access');
    return String(this.nextThread++);
  }
  public async addMember(threadId: string, discordUserId: string): Promise<void> {
    this.calls.push(`add:${threadId}:${discordUserId}`);
    if (this.failAddMember) throw new Error('Unknown Member');
  }
  public async postTicketHeader(threadId: string): Promise<void> { this.calls.push(`header:${threadId}`); }
  public async lockThread(threadId: string): Promise<void> { this.calls.push(`lock:${threadId}`); }
  public async logOpened(ticket: SupportTicket): Promise<void> { this.calls.push(`log-open:${ticket.ticketId}`); }
  public async logClosed(ticket: SupportTicket, by: string): Promise<void> { this.calls.push(`log-close:${ticket.ticketId}:${by}`); }
}

let database: DatabaseSync;
let repository: SupportTicketRepository;
let desk: FakeDesk;
let now: Date;
let service: SupportTicketService;
const request = (overrides: Partial<Parameters<SupportTicketService['open']>[0]> = {}) => ({
  discordUserId: user, userName: 'player', guildId: guild, channelId: channel, topic: 'alerts' as const,
  description: 'No DM for Hades', language: 'en' as const, ...overrides,
});

beforeEach(() => {
  database = createDatabase(':memory:');
  repository = new SupportTicketRepository(database);
  desk = new FakeDesk();
  now = new Date('2026-10-09T12:00:00.000Z');
  service = new SupportTicketService(repository, desk, undefined, () => now);
});
afterEach(() => database.close());

describe('opening a support ticket', () => {
  it('records the ticket before Discord, then creates the thread, adds the user, posts and logs', async () => {
    const result = await service.open(request());
    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') return;
    expect(result.ticket).toMatchObject({ ticketId: 1, status: 'open', topic: 'alerts', channelId: channel, threadId: result.threadId });
    expect(desk.calls).toEqual([
      `create:${channel}:1`, `add:${result.threadId}:${user}`, `header:${result.threadId}`, 'log-open:1',
    ]);
  });

  it('sends the user back to the ticket they already have, even when Discord archived it after a quiet week', async () => {
    const first = await service.open(request());
    for (const state of ['active', 'archived'] as const) {
      desk.state = state;
      const again = await service.open(request({ description: 'Another one' }));
      expect(again).toEqual({ kind: 'already-open', ticket: first.kind === 'opened' ? first.ticket : null });
    }
    expect(desk.calls.filter((call) => call.startsWith('create:'))).toHaveLength(1);
  });

  it('opens a new ticket when the old thread was deleted or locked outside Dealio', async () => {
    for (const [index, state] of (['missing', 'locked'] as const).entries()) {
      await service.open(request());
      desk.state = state;
      const next = await service.open(request());
      expect(next.kind).toBe('opened');
      expect(repository.find(index * 2 + 1)).toMatchObject({ status: 'closed', closedBy: 'expired' });
      desk.state = 'active';
      if (next.kind === 'opened') service.close(next.ticket.ticketId, user, false);
      now = new Date(now.getTime() + 25 * 3600_000);
    }
  });

  it('treats an unreadable thread as still open rather than opening a second one', async () => {
    await service.open(request());
    desk.threadState = async () => { throw new Error('timeout'); };
    expect((await service.open(request())).kind).toBe('already-open');
  });

  it('lets an interrupted opening block only for a few minutes', async () => {
    repository.reserve(user, guild, channel, 'bug', now.toISOString());
    expect((await service.open(request())).kind).toBe('already-open');
    now = new Date(now.getTime() + 6 * 60_000);
    expect((await service.open(request())).kind).toBe('opened');
    expect(repository.find(1)?.status).toBe('failed');
  });

  it('allows three tickets a day and says when the next one is possible', async () => {
    const opened: string[] = [];
    for (let index = 0; index < 3; index++) {
      const result = await service.open(request());
      expect(result.kind).toBe('opened');
      opened.push(now.toISOString());
      if (result.kind === 'opened') service.close(result.ticket.ticketId, user, false);
      now = new Date(now.getTime() + 3600_000);
    }
    expect(await service.open(request())).toEqual({ kind: 'limit', retryAt: '2026-10-10T12:00:00.000Z' });
    now = new Date('2026-10-10T12:00:00.000Z');
    expect((await service.open(request())).kind).toBe('opened');
    expect(opened).toHaveLength(3);
  });

  it('marks the ticket failed when Discord refuses the thread, without using up the daily limit', async () => {
    desk.failCreate = true;
    for (let index = 0; index < 4; index++) expect(await service.open(request())).toEqual({ kind: 'failed' });
    expect(repository.findActive(user)).toBeNull();
    desk.failCreate = false;
    expect((await service.open(request())).kind).toBe('opened');
  });

  it('locks the thread and fails when the user cannot be added to it', async () => {
    desk.failAddMember = true;
    expect(await service.open(request())).toEqual({ kind: 'failed' });
    expect(desk.calls.at(-1)).toMatch(/^lock:/);
    expect(repository.find(1)?.status).toBe('failed');
  });

  it('opens one thread when the same user submits twice at once', async () => {
    const results = await Promise.all([service.open(request()), service.open(request())]);
    expect(results.map((result) => result.kind).sort()).toEqual(['already-open', 'opened']);
    expect(desk.calls.filter((call) => call.startsWith('create:'))).toHaveLength(1);
  });

  it('keeps one unfinished ticket per user in the database itself', () => {
    expect(repository.reserve(user, guild, channel, 'bug', now.toISOString())).not.toBeNull();
    expect(repository.reserve(user, guild, channel, 'other', now.toISOString())).toBeNull();
    expect(repository.reserve(stranger, guild, channel, 'other', now.toISOString())).not.toBeNull();
  });
});

describe('closing a support ticket', () => {
  it('lets the user or the team close it, and nobody else', async () => {
    const opened = await service.open(request());
    if (opened.kind !== 'opened') throw new Error('not opened');
    expect(service.close(opened.ticket.ticketId, stranger, false)).toEqual({ kind: 'forbidden' });
    const closed = service.close(opened.ticket.ticketId, staffMember, true);
    expect(closed).toMatchObject({ kind: 'closed', ticket: { status: 'closed', closedBy: 'staff' } });
    expect(service.close(opened.ticket.ticketId, user, false)).toEqual({ kind: 'already-closed' });
    expect(service.close(999, user, false)).toEqual({ kind: 'not-found' });
    if (closed.kind === 'closed') await service.finishClose(closed.ticket, staffMember);
    expect(desk.calls.slice(-2)).toEqual([`lock:${opened.threadId}`, `log-close:1:${staffMember}`]);
  });

  it('forgets ended tickets after 90 days and keeps open ones', async () => {
    await service.open(request());
    service.close(1, user, false);
    await service.open(request({ discordUserId: stranger }));
    expect(repository.cleanup(new Date('2027-01-06T00:00:00.000Z'))).toBe(0);
    expect(repository.cleanup(new Date('2027-01-08T00:00:00.000Z'))).toBe(1);
    expect(repository.findActive(stranger)).not.toBeNull();
    expect(repository.counts(now)).toEqual({ open: 1, openedToday: 1 });
  });
});

describe('support configuration', () => {
  const base = { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '123456789012345678' };
  const support = {
    DEALIO_SUPPORT_GUILD_ID: guild, DEALIO_SUPPORT_LOG_CHANNEL_ID: channel, DEALIO_SUPPORT_TEAM_ROLE_ID: staffMember,
  };

  it('is off without the IDs and on with all three', () => {
    expect(loadEnvironment(base).support).toBeUndefined();
    expect(loadEnvironment({ ...base, ...support }).support).toEqual({ guildId: guild, logChannelId: channel, teamRoleId: staffMember });
  });

  it('refuses a half-configured or malformed ticket desk', () => {
    expect(() => loadEnvironment({ ...base, DEALIO_SUPPORT_GUILD_ID: guild }))
      .toThrow('DEALIO_SUPPORT_LOG_CHANNEL_ID is required');
    expect(() => loadEnvironment({ ...base, ...support, DEALIO_SUPPORT_TEAM_ROLE_ID: 'Support Team' }))
      .toThrow('DEALIO_SUPPORT_TEAM_ROLE_ID must be a Discord ID');
  });
});

describe('support screens', () => {
  const ticket: SupportTicket = {
    ticketId: 42, discordUserId: user, guildId: guild, channelId: channel, topic: 'bug', status: 'open',
    threadId: '666666666666666666', openedAt: '2026-10-09T12:00:00.000Z', closedAt: null, closedBy: null,
  };

  it.each(languages)('builds every support screen in %s within Discord’s limits', (language) => {
    expect(() => [
      buildSupportPanel(language, { faqChannelId: channel }),
      buildTicketHeader(ticket, 'x'.repeat(1000), language),
      buildTicketClosedNotice({ ...ticket, status: 'closed' }, user, language),
    ]).not.toThrow();
    expect(buildSupportModal(language).toJSON().title.length).toBeLessThanOrEqual(45);
  });

  it('names threads and log lines so the team can scan them', () => {
    expect(ticketNumber(42)).toBe('#0042');
    expect(ticketThreadName(ticket, 'player')).toBe('#0042 · Bug report · player');
    expect(ticketThreadName(ticket, 'p'.repeat(200))).toHaveLength(100);
    const log = JSON.stringify(buildTicketOpenedLog(ticket, 'pla`yer', '666666666666666666', staffMember).toJSON());
    expect(log).toContain(`<@&${staffMember}>`);
    expect(log).toContain('`player`');
    expect(JSON.stringify(buildTicketClosedLog({ ...ticket, closedBy: 'user' }, user).toJSON())).toContain('(the user)');
  });

  it('quotes the user’s description in the ticket header and offers the close button', () => {
    const header = JSON.stringify(buildTicketHeader(ticket, 'line one\nline two', 'tr').toJSON());
    expect(header).toContain('> line one\\n> line two');
    expect(header).toContain('"custom_id":"support:close:42"');
    expect(header).toContain('Ticket’ı kapat');
  });
});

describe('ticket screenshots', () => {
  const image = (name: string, size = 1000, contentType: string | null = 'image/png') => ({ url: `https://cdn/${name}`, name, size, contentType });

  it('keeps up to three images within the size limit and renames them', () => {
    expect(acceptedScreenshots([
      image('notes.txt', 10, 'text/plain'), image('huge.png', 9 * 1024 * 1024), image('a.JPG', 10, 'image/jpeg'),
      image('b.webp', 10, 'image/webp'), image('c', 10), image('d.png'),
    ]).map((file) => file.name)).toEqual(['screenshot-1.jpg', 'screenshot-2.webp', 'screenshot-3.png']);
  });

  it('copies readable screenshots into the ticket header and skips one that fails', async () => {
    const posts: Array<{ body: { components: unknown[]; attachments: unknown[] }; files: Array<{ name: string }> }> = [];
    const rest = { post: async (_route: string, options: never) => { posts.push(options); return {}; } } as never;
    const fetchFile = (async (url: string) => url.endsWith('broken')
      ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
    const desk = new RestSupportDesk(rest, { guildId: guild, logChannelId: channel, teamRoleId: staffMember }, fetchFile);
    const ticket: SupportTicket = {
      ticketId: 5, discordUserId: user, guildId: guild, channelId: channel, topic: 'bug', status: 'open',
      threadId: '7', openedAt: '2026-10-09T12:00:00.000Z', closedAt: null, closedBy: null,
    };
    await desk.postTicketHeader('7', { ticket, userName: 'player', description: 'Broken', language: 'en',
      screenshots: [image('screenshot-1.png'), { ...image('screenshot-2.png'), url: 'https://cdn/broken' }] });
    expect(posts[0]!.files.map((file) => file.name)).toEqual(['screenshot-1.png']);
    expect(posts[0]!.body.attachments).toEqual([{ id: 0, filename: 'screenshot-1.png' }]);
    expect(JSON.stringify(posts[0]!.body.components)).toContain('attachment://screenshot-1.png');
  });
});

describe('support server blueprint', () => {
  const channels = categories.flatMap((category) => category.channels);
  const flag = (value: string | undefined, permission: bigint) => (BigInt(value ?? '0') & permission) === permission;

  it('lets members write only in their own ticket thread, never start threads, and lets Dealio run them', () => {
    const tickets = channels.find((spec) => spec.key === 'tickets')!;
    const everyone = tickets.overwrites.find((overwrite) => overwrite.audience === 'everyone')!;
    expect(flag(everyone.allow, PermissionFlagsBits.SendMessagesInThreads)).toBe(true);
    expect(flag(everyone.deny, PermissionFlagsBits.SendMessages)).toBe(true);
    expect(flag(everyone.deny, PermissionFlagsBits.CreatePrivateThreads)).toBe(true);
    expect(flag(everyone.deny, PermissionFlagsBits.CreatePublicThreads)).toBe(true);
    const bot = tickets.overwrites.find((overwrite) => overwrite.audience === 'bot')!;
    for (const permission of [PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.SendMessagesInThreads]) {
      expect(flag(bot.allow, permission)).toBe(true);
    }
    for (const role of ['admins', 'moderators', 'support'] as const) {
      expect(flag(tickets.overwrites.find((overwrite) => overwrite.audience === role)?.allow, PermissionFlagsBits.ManageThreads)).toBe(true);
    }
  });

  it('hides the staff channels and never lets members ping everyone', () => {
    for (const key of ['ticketLog', 'modLog', 'staffChat', 'adminChat', 'discordUpdates', 'staffVoice'] as const) {
      const spec = channels.find((candidate) => candidate.key === key)!;
      expect(flag(spec.overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny, PermissionFlagsBits.ViewChannel)).toBe(true);
    }
    expect(flag(everyonePermissions, PermissionFlagsBits.MentionEveryone)).toBe(false);
    expect(flag(everyonePermissions, PermissionFlagsBits.Administrator)).toBe(false);
    expect(roles.filter((role) => flag(role.permissions, PermissionFlagsBits.Administrator)).map((role) => role.key)).toEqual(['owner', 'admins', 'dealioBot']);
    expect(roles.filter((role) => !['dealioBot', 'owner', 'admins'].includes(role.key)).every((role) => !flag(role.permissions, PermissionFlagsBits.ManageGuild))).toBe(true);
  });

  it('ranks staff over supporters and opens the lounge to donators and boosters only', () => {
    expect(roles.map((role) => role.key)).toEqual(['owner', 'admins', 'moderators', 'support', 'dealioBot', 'bots', 'booster', 'legend', 'superDonator', 'donator', 'updates']);
    expect(roles.find((role) => role.key === 'support')?.aliases).toContain('Support Team');
    const lounge = channels.find((spec) => spec.key === 'lounge')!;
    expect(flag(lounge.overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny, PermissionFlagsBits.ViewChannel)).toBe(true);
    for (const audience of ['booster', 'legend', 'superDonator', 'donator', 'support'] as const) {
      expect(flag(lounge.overwrites.find((overwrite) => overwrite.audience === audience)?.allow, PermissionFlagsBits.ViewChannel)).toBe(true);
    }
  });

  it('meets Discord’s onboarding rules: seven default channels, five open for everyone to post', () => {
    const blocked = (overwrites: readonly { audience: string; deny?: string; allow?: string }[] = []) =>
      flag(overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny, PermissionFlagsBits.SendMessages)
      || flag(overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny, PermissionFlagsBits.ViewChannel);
    const defaults = onboardingDefaultChannels.map((key) => {
      const category = categories.find((candidate) => candidate.channels.some((spec) => spec.key === key))!;
      return { spec: category.channels.find((spec) => spec.key === key)!, category };
    });
    expect(defaults.length).toBeGreaterThanOrEqual(7);
    expect(defaults.filter(({ spec, category }) => !blocked(spec.overwrites) && !blocked(category.overwrites)
      && spec.type === ChannelType.GuildText).length).toBeGreaterThanOrEqual(5);
    // Every option leads somewhere members can see.
    const hidden = new Set(channels.filter((spec) => flag(spec.overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny,
      PermissionFlagsBits.ViewChannel)).map((spec) => spec.key));
    for (const option of onboardingPrompts.flatMap((prompt) => prompt.options)) {
      expect((option.channels ?? []).filter((key) => hidden.has(key))).toEqual([]);
      expect((option.channels?.length ?? 0) + (option.roles?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('only lets Admins and the Owner into admin chat, and keeps member-free channels read-only', () => {
    const adminChat = channels.find((spec) => spec.key === 'adminChat')!;
    expect(adminChat.overwrites).toEqual([{ audience: 'everyone', deny: PermissionFlagsBits.ViewChannel.toString() }]);
    for (const key of ['welcome', 'rules', 'announcements', 'faq', 'supportDealio', 'tickets', 'giveaways'] as const) {
      const spec = channels.find((candidate) => candidate.key === key)!;
      expect(flag(spec.overwrites.find((overwrite) => overwrite.audience === 'everyone')?.deny, PermissionFlagsBits.SendMessages)).toBe(true);
    }
  });

  it('invites other bots without Administrator and keeps game bots in channels that exist', () => {
    const keys = new Set(channels.map((spec) => spec.key));
    for (const bot of thirdPartyBots) {
      expect(flag(bot.permissions, PermissionFlagsBits.Administrator)).toBe(false);
      expect(bot.clientId).toMatch(/^\d{17,20}$/);
      for (const home of [...(bot.homeChannels ?? []), ...(bot.inviteChannel ? [bot.inviteChannel] : [])]) expect(keys.has(home)).toBe(true);
      expect(botInviteUrl(bot, guild)).toBe(`https://discord.com/oauth2/authorize?client_id=${bot.clientId}`
        + `&scope=bot%20applications.commands&permissions=${bot.permissions}&integration_type=0&guild_id=${guild}`);
    }
    const panel = infoMessages('123456789012345678', (key) => `9${key.length}`.padEnd(18, '0'), 'banner.png', () => undefined, guild);
    expect(panel[0]!.channel).toBe('staffChat');
    expect(JSON.stringify(panel[0]!.container.toJSON())).toContain('client_id=408785106942164992');
  });

  it('has voice, stage and AFK channels and a channel for each other language', () => {
    expect(channels.filter((spec) => spec.type === ChannelType.GuildVoice).length).toBeGreaterThanOrEqual(5);
    expect(channels.some((spec) => spec.type === ChannelType.GuildStageVoice)).toBe(true);
    expect(channels.filter((spec) => ['turkish', 'german', 'french'].includes(spec.key)).map((spec) => spec.name))
      .toEqual(['🇹🇷・türkçe', '🇩🇪・deutsch', '🇫🇷・français']);
  });

  it('has unique channel names and keys, an announcement channel and a forum', () => {
    expect(new Set(channels.map((spec) => spec.name)).size).toBe(channels.length);
    expect(new Set(channels.map((spec) => spec.key)).size).toBe(channels.length);
    expect(channels.find((spec) => spec.key === 'announcements')?.type).toBe(ChannelType.GuildAnnouncement);
    expect(channels.find((spec) => spec.key === 'suggestions')?.type).toBe(ChannelType.GuildForum);
  });

  it('builds the info messages within Discord’s limits, linking real channels', () => {
    const messages = infoMessages('123456789012345678', (key) => `9${key.length}`.padEnd(18, '0'), 'banner.png');
    expect(messages.map((message) => message.channel)).toEqual(['welcome', 'rules', 'faq', 'supportDealio', 'tickets']);
    const ticketPanel = JSON.stringify(messages.at(-1)!.container.toJSON());
    expect(ticketPanel).toContain('"custom_id":"support:open"');
    expect(JSON.stringify(messages[0]!.container.toJSON())).toContain('attachment://dealio-banner.png');
  });
});
