import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { WishlistItem } from '../src/domain/steam.js';
import { buildAssistantView, filteredAssistantItems, type AssistantViewData } from '../src/discord/assistant-view.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { buildStatusV2Panel } from '../src/discord/status-view-v2.js';
import type { GameRule } from '../src/persistence/assistant-repository.js';

const game = (appId: number, discountPercent: number | null): WishlistItem => ({
  appId, name: `Game ${appId}`, priority: appId, dateAdded: null,
  onSale: discountPercent === null ? null : discountPercent > 0,
  price: discountPercent === null ? null : {
    currency: 'USD', initialMinor: 1000, finalMinor: 1000 - discountPercent * 10, discountPercent, isFree: false,
  },
});
const config = {
  discordUserId: 'u', configurationId: 'c', steamId64: '76561198000000000', configVersion: 1, language: 'tr',
  storeCountryCode: 'US', enabled: true, minimumDiscountPercent: 30, createdAt: '', updatedAt: '',
} as never;
const viewData = (items: WishlistItem[], rules = new Map<number, GameRule>(), extra: Partial<AssistantViewData> = {}): AssistantViewData => ({
  config, items, capturedAt: '2026-10-06T00:00:00.000Z', rules, history: [],
  preference: { mode: 'instant', timezone: 'Europe/Istanbul', quietStart: null, quietEnd: null, digestMinute: null },
  ...extra,
});
const buttons = (panel: { toJSON: () => unknown }) => {
  const found: Array<{ custom_id?: string; style: number; label?: string }> = [];
  JSON.stringify(panel.toJSON(), (_key, value) => {
    if (value && value.type === 2) found.push(value);
    return value;
  });
  return found;
};

describe('wishlist order', () => {
  it('lists matching deals first, then other discounts, each deepest first, then the rest in Steam order', () => {
    const items = [game(1, null), game(2, 20), game(3, 40), game(4, 0), game(5, 70), game(6, 10)];
    const order = filteredAssistantItems(viewData(items), { screen: 'wishlist', page: 0, query: '', eligibleOnly: false })
      .map((item) => item.appId);
    expect(order).toEqual([5, 3, 2, 6, 1, 4]);
    const list = JSON.stringify(buildAssistantView(viewData(items),
      { screen: 'wishlist', page: 0, query: '', eligibleOnly: false }, 's').toJSON());
    expect(list).toContain('Önce kuralına uyanlar, sonra en büyük indirimler');
    expect(list).toContain('oyun kuralına uyuyor');
    expect(list).not.toContain('fırsat kuralına uyuyor');
  });
});

describe('game detail rule buttons', () => {
  const detail = (rules: Map<number, GameRule>) => buttons(buildAssistantView(viewData([game(5, 70)], rules),
    { screen: 'detail', page: 0, query: '', eligibleOnly: false, selectedAppId: 5 }, 's'));
  const style = (found: ReturnType<typeof detail>, action: string) => found.find((button) => button.custom_id === `assistant:s:${action}`)?.style;

  it('highlights the rule in force and only that one', () => {
    const inherit = detail(new Map());
    expect([style(inherit, 'inherit'), style(inherit, 'percent'), style(inherit, 'target')]).toEqual([1, 2, 2]);
    const target = detail(new Map([[5, { mode: 'target', percent: null, targetMinor: 400, currency: 'USD', muted: false, revision: 1 }]]));
    expect([style(target, 'inherit'), style(target, 'percent'), style(target, 'target')]).toEqual([2, 2, 1]);
    const percent = detail(new Map([[5, { mode: 'percent', percent: 50, targetMinor: null, currency: null, muted: false, revision: 1 }]]));
    expect([style(percent, 'inherit'), style(percent, 'percent'), style(percent, 'target')]).toEqual([2, 1, 2]);
  });
});

describe('alert timing screen', () => {
  it('states the check interval the bot really uses', () => {
    const shown = (hours?: number) => JSON.stringify(buildAssistantView(viewData([game(5, 70)], new Map(),
      hours === undefined ? {} : { pollIntervalHours: hours }), { screen: 'rhythm', page: 0, query: '', eligibleOnly: false }, 's').toJSON());
    expect(shown(2)).toContain('2 saatte bir');
    expect(shown()).toContain('30 dakikada bir');
  });
});

describe('settings', () => {
  const dashboard = {
    status: 'ready', language: 'tr',
    config: {
      discordUserId: 'owner', configurationId: 'config', configVersion: 1, steamId64: '76561198000000000',
      storeCountryCode: 'TR', language: 'tr', enabled: true, minimumDiscountPercent: 20, dmDeliveryBlockedAt: null,
    },
    checkState: null, notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
    latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
  };

  it('names pausing as tracking, the same word the status line uses', () => {
    const on = JSON.stringify(buildStatusV2Panel(dashboard as never, 's').toJSON());
    expect(on).toContain('Takibi durdur');
    expect(on).toContain('Takip açık');
    const paused = JSON.stringify(buildStatusV2Panel({ ...dashboard, config: { ...dashboard.config, enabled: false } } as never, 's').toJSON());
    expect(paused).toContain('Takibi sürdür');
    expect(paused).not.toContain('Bildirimleri aç');
  });

  it('opens the /delete-data confirmation from a Settings button', async () => {
    const collector = Object.assign(new EventEmitter(), { stop(reason = 'user') { this.emit('end', new Map(), reason); } });
    const deleteCollector = Object.assign(new EventEmitter(), { stop(reason = 'user') { this.emit('end', new Map(), reason); } });
    const interaction = {
      id: 'settings', user: { id: 'owner' }, locale: 'tr', client: { user: null },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const component = {
      id: 'delete-click', customId: 'status-v2:settings:delete', user: { id: 'owner' }, locale: 'tr',
      isButton: () => true, isStringSelectMenu: () => false,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => deleteCollector }),
    };
    const task = handleStatus(interaction as unknown as ChatInputCommandInteraction,
      { getDashboard: vi.fn().mockReturnValue(dashboard) } as never,
      { get: vi.fn().mockReturnValue(dashboard.config) } as never);
    try {
      await vi.waitFor(() => expect(collector.listenerCount('collect')).toBe(1));
      expect(JSON.stringify(interaction.editReply.mock.calls.at(-1))).toContain('status-v2:settings:delete');
      collector.emit('collect', component);
      await vi.waitFor(() => expect(component.editReply).toHaveBeenCalled());
      // Its own private message, with the same deliberate confirmation as /delete-data.
      expect(component.deferReply).toHaveBeenCalledWith(expect.objectContaining({ flags: expect.any(Number) }));
      expect(JSON.stringify(component.editReply.mock.calls[0])).toContain('delete-v2:delete-click:confirm');
    } finally {
      deleteCollector.stop('time');
      collector.stop();
      await task;
    }
  });
});
