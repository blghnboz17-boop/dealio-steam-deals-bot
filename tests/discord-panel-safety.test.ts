import { EventEmitter } from 'node:events';
import { InteractionContextType, type ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { allowedWhileBlocked, registerBotEvents, type BotCommandServices } from '../src/discord/bot-events.js';
import { buildAssistantView } from '../src/discord/assistant-view.js';
import { handleAssistant } from '../src/discord/commands/assistant.js';
import { handleCheck } from '../src/discord/commands/check.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { isFromUser, isRefusedInteraction } from '../src/discord/ui/refused-interactions.js';
import { AssistantService } from '../src/application/assistant-service.js';
import { TestNotificationCooldownError } from '../src/application/test-notification-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import type { WishlistViewService } from '../src/application/wishlist-view-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';

const text = (value: unknown) => JSON.stringify(value).replace(/ /g, ' ');

/** The parts of a discord.js interaction the block check reads. */
function interaction(options: { command?: string; customId?: string; modal?: boolean }) {
  const component = options.customId !== undefined && !options.modal;
  return {
    user: { id: '100000000000000001' }, guildId: null, context: InteractionContextType.BotDM,
    authorizingIntegrationOwners: { 1: '100000000000000001' }, locale: 'en-US',
    commandName: options.command ?? '', customId: options.customId ?? '',
    options: { getSubcommand: () => null },
    isChatInputCommand: () => options.command !== undefined,
    isMessageComponent: () => component,
    isModalSubmit: () => options.modal === true,
    isButton: () => component,
    isRepliable: () => true,
    reply: vi.fn(async () => undefined),
  };
}

function blockedBot() {
  const client = Object.assign(new EventEmitter(), { isReady: () => true });
  const tasks: Promise<unknown>[] = [];
  registerBotEvents({
    client: client as never,
    scheduler: { start: () => undefined },
    notificationRetryScheduler: { start: () => undefined },
    taskTracker: { run: (task: () => Promise<unknown>) => { tasks.push(task()); } } as never,
    services: {} as BotCommandServices,
    blocks: { isUserBlocked: () => true },
  });
  return { client, settled: () => Promise.all(tasks) };
}

describe('blocked accounts', () => {
  it('can submit the deletion confirmation form, which the deletion itself needs', async () => {
    const form = interaction({ customId: 'delete-confirm:1300000000000000001:100000000000000001', modal: true });
    expect(allowedWhileBlocked(form as never)).toBe(true);
    const bot = blockedBot();
    bot.client.emit('interactionCreate', form);
    await bot.settled();
    // Answering it with the block notice would make the deletion's own answer fail.
    expect(form.reply).not.toHaveBeenCalled();
    expect(isRefusedInteraction(form)).toBe(false);
  });

  it('cannot set Dealio up again from the deletion result', () => {
    expect(allowedWhileBlocked(interaction({ customId: 'delete-v2:1300000000000000001:setup' }) as never)).toBe(false);
    expect(allowedWhileBlocked(interaction({ customId: 'delete-v2:1300000000000000001:cancel' }) as never)).toBe(true);
    expect(allowedWhileBlocked(interaction({ customId: 'setup-modal:1:100000000000000001:1', modal: true }) as never)).toBe(false);
    expect(allowedWhileBlocked(interaction({ customId: 'delete-v2:1300000000000000001:confirm', modal: true }) as never)).toBe(false);
  });

  it('marks a refused click so open panels ignore it', async () => {
    const click = interaction({ customId: 'assistant:1300000000000000001:mute' });
    const bot = blockedBot();
    bot.client.emit('interactionCreate', click);
    await bot.settled();
    expect(click.reply).toHaveBeenCalledOnce();
    expect(isRefusedInteraction(click)).toBe(true);
    expect(isFromUser(click, '100000000000000001')).toBe(false);
    expect(isFromUser(interaction({ customId: 'x' }), '100000000000000001')).toBe(true);
    expect(isFromUser(interaction({ customId: 'x' }), '100000000000000002')).toBe(false);
  });
});

function assistantFixture(sendTest: () => Promise<void>) {
  const db = createDatabase(':memory:');
  const users = new UserConfigRepository(db);
  users.upsert('owner', '76561198000000000', 'en', 'DE', new Date().toISOString());
  const service = new AssistantService(new AssistantRepository(db), users, new UserOperationCoordinator(), sendTest);
  const collector = Object.assign(new EventEmitter(), { ended: false, stop() { this.ended = true; this.emit('end'); } });
  let filter: ((component: unknown) => boolean) | undefined;
  const interaction = {
    id: 'safety', user: { id: 'owner' }, locale: 'en-US',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({
      createMessageComponentCollector: (options: { filter: (component: unknown) => boolean }) => {
        filter = options.filter;
        return collector;
      },
    }),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const click = (action: string) => {
    collector.emit('collect', {
      customId: `assistant:safety:${action}`, user: { id: 'owner' }, isStringSelectMenu: () => false,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    });
  };
  const start = () => handleAssistant(interaction as unknown as ChatInputCommandInteraction, service,
    {} as WishlistViewService, undefined, 'history');
  return { db, collector, interaction, click, start, filter: () => filter, last: () => text(interaction.editReply.mock.calls.at(-1)) };
}

describe('Test DM access in the alert history', () => {
  it('says the DM could not be delivered instead of a generic input error', async () => {
    const f = assistantFixture(async () => { throw new Error('Cannot send messages to this user'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.click('retry');
      await vi.waitFor(() => expect(f.last()).toContain('couldn’t send the test message'));
      expect(f.interaction.followUp).not.toHaveBeenCalled();
    } finally { f.collector.stop(); await task; f.db.close(); log.mockRestore(); }
  });

  it('shows the cooldown in the panel', async () => {
    const f = assistantFixture(async () => { throw new TestNotificationCooldownError(42); });
    const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.click('retry');
      await vi.waitFor(() => expect(f.last()).toContain('42 seconds'));
    } finally { f.collector.stop(); await task; f.db.close(); }
  });

  it('ignores clicks refused for a blocked account', async () => {
    const f = assistantFixture(async () => undefined);
    const task = f.start();
    try {
      await vi.waitFor(() => expect(f.filter()).toBeDefined());
      const own = { customId: 'assistant:safety:mute', user: { id: 'owner' } };
      expect(f.filter()!(own)).toBe(true);
      const bot = blockedBot();
      const refused = Object.assign(interaction({ customId: 'assistant:safety:mute' }), { user: { id: 'owner' } });
      bot.client.emit('interactionCreate', refused);
      await bot.settled();
      expect(f.filter()!(refused)).toBe(false);
    } finally { f.collector.stop(); await task; f.db.close(); }
  });
});

describe('game names from Steam', () => {
  it('cannot turn into masked links, mentions or headings in the wishlist panel', () => {
    const name = '[Free gift](https://example.invalid) <@&123> # big';
    const rendered = text(buildAssistantView({
      config: { discordUserId: 'u', configurationId: 'c', steamId64: '7', configVersion: 1, language: 'en', storeCountryCode: 'DE',
        enabled: true, minimumDiscountPercent: 20, createdAt: '', updatedAt: '' } as never,
      items: [{ appId: 1, name, priority: 1, dateAdded: null, onSale: false, price: null } as never],
      capturedAt: new Date().toISOString(), rules: new Map(),
      preference: { mode: 'instant', timezone: null, quietStart: null, quietEnd: null, digestMinute: null }, history: [],
    }, { screen: 'detail', page: 0, query: '', eligibleOnly: false, selectedAppId: 1 }, 's').toJSON());
    expect(rendered).not.toContain('[Free gift](https://example.invalid)');
    expect(rendered).not.toContain('<@&123>');
    expect(rendered).toContain('\\\\[Free gift\\\\]\\\\(https://example.invalid\\\\)');
  });

  it('never ends a shortened name in a half escape', () => {
    const name = 'a'.repeat(99) + '*tail';
    const rendered = buildAssistantView({
      config: { discordUserId: 'u', configurationId: 'c', steamId64: '7', configVersion: 1, language: 'en', storeCountryCode: 'DE',
        enabled: true, minimumDiscountPercent: 20, createdAt: '', updatedAt: '' } as never,
      items: [], capturedAt: new Date().toISOString(), rules: new Map(),
      preference: { mode: 'instant', timezone: null, quietStart: null, quietEnd: null, digestMinute: null },
      history: [{ game_name: name, status: 'sent', reason: 'discount', created_at: new Date().toISOString() } as never],
    }, { screen: 'history', page: 0, query: '', eligibleOnly: false }, 's').toJSON();
    // The 100th character is escaped whole, so the closing ** still closes the bold.
    expect(JSON.stringify(rendered)).toContain('✅ **' + 'a'.repeat(99) + '\\\\***\\n');
  });
});

describe('manual check without a setup', () => {
  it('answers in the Discord language, not Turkish', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    await handleCheck({
      user: { id: 'owner' }, locale: 'de', deferReply: vi.fn().mockResolvedValue(undefined), editReply,
    } as never, { check: vi.fn() } as never, { get: () => ({ config: null }) } as never, { deliverPending: vi.fn() } as never);
    expect(text(editReply.mock.calls.at(-1))).toContain('Dealio ist noch nicht eingerichtet');
  });
});

describe('Settings forms', () => {
  it('report a failed default-discount save instead of failing silently', async () => {
    const dashboard = {
      status: 'ready', language: 'en',
      config: {
        discordUserId: 'owner', configurationId: 'config', configVersion: 1, steamId64: '76561198000000000',
        storeCountryCode: 'US', language: 'en', enabled: true, minimumDiscountPercent: 20, dmDeliveryBlockedAt: null,
      },
      checkState: null, notificationQueue: { pending: 0, retry: 0, sent: 0, terminalFailed: 0 },
      latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
    };
    const collector = Object.assign(new EventEmitter(), { stop(reason: string) { this.emit('end', new Map(), reason); } });
    const interaction = {
      id: 'forms', user: { id: 'owner' }, locale: 'en-US', client: { user: null },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const submission = {
      customId: '', user: { id: 'owner' },
      fields: { getTextInputValue: () => '35' },
      deferUpdate: vi.fn().mockResolvedValue(undefined), reply: vi.fn(),
    };
    const button = {
      customId: 'status-v2:forms:minimum-discount', user: { id: 'owner' },
      isButton: () => true, isStringSelectMenu: () => false,
      showModal: vi.fn(async (modal: { toJSON: () => { custom_id: string } }) => { submission.customId = modal.toJSON().custom_id; }),
      awaitModalSubmit: vi.fn(async () => submission),
    };
    const setGlobal = vi.fn().mockRejectedValue(new Error('Account changed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const task = handleStatus(interaction as never, { getDashboard: () => dashboard } as never, {} as never,
      undefined, { setGlobal } as never);
    try {
      await vi.waitFor(() => expect(collector.listenerCount('collect')).toBe(1));
      collector.emit('collect', button);
      await vi.waitFor(() => expect(interaction.followUp).toHaveBeenCalledOnce());
      expect(setGlobal).toHaveBeenCalledWith('owner', 35, 'config');
      expect(submission.deferUpdate).toHaveBeenCalledOnce();
    } finally { collector.stop('time'); await task; log.mockRestore(); }
  });
});
