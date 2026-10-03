import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handleDealio } from '../src/discord/commands/dealio.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { handleAssistant } from '../src/discord/commands/assistant.js';
import { buildTabBar, parseTabAction, type Navigate } from '../src/discord/ui/tab-bar.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';
import type { AssistantService } from '../src/application/assistant-service.js';
import type { WishlistViewService } from '../src/application/wishlist-view-service.js';

const dashboard = {
  status: 'ready', language: 'en',
  config: {
    discordUserId: 'owner', configurationId: 'config', configVersion: 1,
    steamId64: '76561198000000000', storeCountryCode: 'US', language: 'en',
    enabled: true, minimumDiscountPercent: 20, dmDeliveryBlockedAt: null,
  },
  checkState: null, notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
  latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
};

class Collector extends EventEmitter {
  public ended = false;
  public readonly reasons: string[] = [];
  public stop(reason = 'user') { this.ended = true; this.reasons.push(reason); this.emit('end', new Map(), reason); }
}

function panel(id: string) {
  const collector = new Collector();
  const interaction = {
    id, user: { id: 'owner' }, locale: 'en-US', client: { user: null },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const click = (prefix: string, action: string, values?: string[]) => {
    const component = {
      customId: `${prefix}:${id}:${action}`, user: { id: 'owner' }, values,
      isButton: () => values === undefined, isStringSelectMenu: () => values !== undefined,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };
    collector.emit('collect', component);
    return component;
  };
  return { collector, interaction, click };
}

const json = (value: unknown) => JSON.stringify(value);

describe('tab bar', () => {
  it('shows four labelled tabs and locks only the active root screen', () => {
    const root = buildTabBar('dealio', 's', 'tr', { active: 'home' }).toJSON();
    expect(root.components.map((button) => 'label' in button && button.label)).toEqual(['Ana sayfa', 'İstek listem', 'Bildirimler', 'Ayarlar']);
    expect(root.components.map((button) => button.disabled)).toEqual([true, false, false, false]);
    const below = buildTabBar('assistant', 's', 'en', { active: 'games', activeIsRoot: false }).toJSON();
    expect(below.components.every((button) => !button.disabled)).toBe(true);
    expect(json(below)).toContain('assistant:s:tab-games');
  });

  it('parses only known tabs', () => {
    expect(parseTabAction('tab-alerts')).toBe('alerts');
    expect(parseTabAction('tab-unknown')).toBeNull();
    expect(parseTabAction('wishlist')).toBeNull();
  });
});

describe('in-place navigation', () => {
  it('hands the home message to another tab without opening a message or locking it', async () => {
    const f = panel('home-session');
    const navigate = vi.fn<Navigate>(async () => undefined);
    const task = handleDealio(f.interaction as unknown as ChatInputCommandInteraction, {
      statusService: { getDashboard: vi.fn().mockReturnValue(dashboard) },
      wishlistViewService: {},
    } as never, { navigate });
    await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
    const renders = f.interaction.editReply.mock.calls.length;

    const component = f.click('dealio', 'tab-games');
    await task;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('games', component));
    expect(component.deferUpdate).toHaveBeenCalledOnce();
    expect(f.collector.reasons).toEqual(['handoff']);
    // The old session must not draw its disabled panel over the new screen.
    expect(f.interaction.editReply).toHaveBeenCalledTimes(renders);
  });

  it('opens Home in place from the check button target', async () => {
    const f = panel('home-check');
    const navigate = vi.fn<Navigate>(async () => undefined);
    const task = handleDealio(f.interaction as unknown as ChatInputCommandInteraction, {
      statusService: { getDashboard: vi.fn().mockReturnValue(dashboard) },
      wishlistViewService: {},
    } as never, { navigate });
    await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
    const component = f.click('dealio', 'check');
    await task;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('check', component));
  });

  it('edits the clicked message instead of replying when opened in place', async () => {
    const f = panel('settings-in-place');
    const navigate = vi.fn<Navigate>(async () => undefined);
    const task = handleStatus(f.interaction as unknown as ChatInputCommandInteraction,
      { getDashboard: vi.fn().mockReturnValue(dashboard) } as never, {} as never,
      undefined, undefined, undefined, { inPlace: true, navigate });
    await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
    expect(json(f.interaction.editReply.mock.calls[0])).toContain('status-v2:settings-in-place:tab-home');

    const component = f.click('status-v2', 'tab-home');
    await task;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('home', component));
    expect(f.interaction.editReply).toHaveBeenCalledOnce();
  });

  it('switches between Games and Alerts inside one session and leaves for Settings', async () => {
    const f = panel('assistant-tabs');
    const db = createDatabase(':memory:');
    try {
      const users = new UserConfigRepository(db);
      users.upsert('owner', '76561198000000000', 'en', 'US', new Date().toISOString());
      const service = { config: () => users.findByDiscordUserId('owner'), repository: new AssistantRepository(db) } as unknown as AssistantService;
      const load = vi.fn().mockResolvedValue({ status: 'success', capturedAt: new Date().toISOString(),
        items: [{ appId: 1, name: 'Game 1', priority: 1, dateAdded: null, onSale: false, price: null }] });
      const navigate = vi.fn<Navigate>(async () => undefined);
      const task = handleAssistant(f.interaction as unknown as ChatInputCommandInteraction, service,
        { load } as unknown as WishlistViewService, undefined, 'wishlist', { navigate });
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));

      f.click('assistant', 'tab-alerts');
      await vi.waitFor(() => expect(json(f.interaction.editReply.mock.calls.at(-1))).toContain('Alert history'));
      f.click('assistant', 'game', ['1']);
      await vi.waitFor(() => expect(json(f.interaction.editReply.mock.calls.at(-1))).toContain('Back to list'));
      // Below the list, the Games tab stays clickable to return.
      const buttons: { custom_id?: string; disabled?: boolean }[] = [];
      JSON.stringify(f.interaction.editReply.mock.calls.at(-1), (_key, value: { type?: number }) => {
        if (value?.type === 2) buttons.push(value as never);
        return value;
      });
      expect(buttons.find((button) => button.custom_id === 'assistant:assistant-tabs:tab-games')?.disabled).not.toBe(true);
      expect(navigate).not.toHaveBeenCalled();

      const renders = f.interaction.editReply.mock.calls.length;
      const component = f.click('assistant', 'tab-settings');
      await task;
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('settings', component));
      expect(f.interaction.editReply).toHaveBeenCalledTimes(renders);
    } finally {
      db.close();
    }
  });
});
