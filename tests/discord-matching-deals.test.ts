import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantService } from '../src/application/assistant-service.js';
import type { StatusDashboardResult } from '../src/application/status-service.js';
import type { WishlistViewService } from '../src/application/wishlist-view-service.js';
import { createDealioNavigator, handleDealio } from '../src/discord/commands/dealio.js';
import { buildHomePanel } from '../src/discord/home-view.js';
import type { Navigate } from '../src/discord/ui/tab-bar.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';

type Ready = Extract<StatusDashboardResult, { status: 'ready' }>;
interface Button { custom_id?: string; label?: string; style?: number; disabled?: boolean }

function ready(language: 'tr' | 'en'): Ready {
  return {
    status: 'ready', language,
    config: {
      discordUserId: 'owner', configurationId: 'config', steamId64: '76561198000000000',
      configVersion: 1, language, storeCountryCode: 'US', enabled: true,
      minimumDiscountPercent: 20, dmOptInAt: '2026-09-12T00:00:00Z', dmDeliveryBlockedAt: null,
      createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
    },
    checkState: null, notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
    latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
  } as Ready;
}

function buttons(value: unknown): Button[] {
  const found: Button[] = [];
  JSON.stringify(value, (_key, entry: { type?: number }) => {
    if (entry?.type === 2) found.push(entry as Button);
    return entry;
  });
  return found;
}

const dealsButton = (value: unknown) => buttons(value).find((button) => button.custom_id === 'dealio:session:deals');

describe('the Matching deals shortcut on Home', () => {
  it('shows how many deals match the rule and opens them', () => {
    const english = dealsButton(buildHomePanel(ready('en'), 'session', { eligibleDealCount: 3, trackedGameCount: 10 }).toJSON());
    expect(english).toMatchObject({ label: 'Matching deals (3)', style: 1 });
    expect(english?.disabled).not.toBe(true);
    const turkish = dealsButton(buildHomePanel(ready('tr'), 'session', { eligibleDealCount: 3, trackedGameCount: 10 }).toJSON());
    expect(turkish?.label).toBe('Kuralıma uyanlar (3)');
  });

  it('says so, without a dead end, when nothing matches right now', () => {
    const button = dealsButton(buildHomePanel(ready('en'), 'session', { eligibleDealCount: 0, trackedGameCount: 10 }).toJSON());
    expect(button).toMatchObject({ label: 'No matching deals right now', disabled: true });
  });

  it('is absent before the first check has saved a wishlist', () => {
    expect(dealsButton(buildHomePanel(ready('en'), 'session', {}).toJSON())).toBeUndefined();
  });
});

class Collector extends EventEmitter {
  public ended = false;
  public stop(reason = 'user') { this.ended = true; this.emit('end', new Map(), reason); }
}

function panel(id: string) {
  const collector = new Collector();
  const interaction = {
    id, user: { id: 'owner' }, locale: 'en-US', client: { user: null },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  return { collector, interaction };
}

describe('opening the matching deals', () => {
  it('hands the Home message to the deals target', async () => {
    const f = panel('home-deals');
    const navigate = vi.fn<Navigate>(async () => undefined);
    const task = handleDealio(f.interaction as unknown as ChatInputCommandInteraction, {
      statusService: { getDashboard: vi.fn().mockReturnValue(ready('en')) },
      wishlistViewService: {},
    } as never, { navigate });
    await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
    const component = {
      customId: 'dealio:home-deals:deals', user: { id: 'owner' },
      isButton: () => true, isStringSelectMenu: () => false,
      deferUpdate: vi.fn().mockResolvedValue(undefined),
    };
    f.collector.emit('collect', component);
    await task;
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('deals', component));
  });

  it('opens the Wishlist with only the matching deals, deepest discount first', async () => {
    const f = panel('deals-list');
    const db = createDatabase(':memory:');
    try {
      const users = new UserConfigRepository(db);
      users.upsert('owner', '76561198000000000', 'en', 'US', new Date().toISOString());
      db.prepare('UPDATE user_config SET minimum_discount_percent = 20').run();
      const service = { config: () => users.findByDiscordUserId('owner'), repository: new AssistantRepository(db) } as unknown as AssistantService;
      const price = (discountPercent: number) => ({
        currency: 'USD', initialMinor: 2000, finalMinor: 2000 * (100 - discountPercent) / 100, discountPercent, isFree: false,
      });
      const load = vi.fn().mockResolvedValue({ status: 'success', capturedAt: new Date().toISOString(), items: [
        { appId: 1, name: 'Full Price Game', priority: 1, dateAdded: null, onSale: false, price: price(0) },
        { appId: 2, name: 'Small Discount Game', priority: 2, dateAdded: null, onSale: true, price: price(10) },
        { appId: 3, name: 'Good Deal Game', priority: 3, dateAdded: null, onSale: true, price: price(40) },
        { appId: 4, name: 'Best Deal Game', priority: 4, dateAdded: null, onSale: true, price: price(75) },
      ] });
      const navigate = createDealioNavigator({
        wishlistViewService: { assistantService: service, load } as unknown as WishlistViewService,
      } as never);
      const task = navigate('deals', f.interaction as never);
      await vi.waitFor(() => expect(f.interaction.editReply).toHaveBeenCalled());

      const first = JSON.stringify(f.interaction.editReply.mock.calls[0]);
      expect(first).toContain('Best Deal Game');
      expect(first).toContain('Good Deal Game');
      expect(first).not.toContain('Small Discount Game');
      expect(first).not.toContain('Full Price Game');
      expect(first.indexOf('Best Deal Game')).toBeLessThan(first.indexOf('Good Deal Game'));
      // The filter is on, so its button offers the way back to every game.
      expect(buttons(f.interaction.editReply.mock.calls[0])
        .find((button) => button.custom_id === 'assistant:deals-list:filter')?.label).toBe('All games');
      f.collector.stop();
      await task;
    } finally {
      db.close();
    }
  });
});
