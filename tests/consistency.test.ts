import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { countryDisplay, discountTier, hotPrefix, priceLine } from '../src/discord/ui/design.js';
import {
  buildCountryRangePanel,
  buildCountrySearchPanel,
  parseCountryPickerAction,
} from '../src/discord/ui/country-picker.js';
import { buildSetupCompletePanel } from '../src/discord/setup-view.js';
import { handleStatus } from '../src/discord/commands/status.js';
import { handleDealio } from '../src/discord/commands/dealio.js';
import { buildExpiredPanel } from '../src/discord/ui/components-v2.js';

const json = (value: { toJSON: () => unknown }) => JSON.stringify(value.toJSON()).replace(/ /g, ' ');

describe('price presentation', () => {
  it('uses the currency symbol and a colour that shows how big the discount is', () => {
    expect(priceLine({ finalMinor: 399, initialMinor: 1999, discountPercent: 80, currency: 'USD' }, 'tr'))
      .toBe('**$3,99**  ~~$19,99~~  🟢 `−%80`');
    expect(priceLine({ finalMinor: 2999, initialMinor: 5999, discountPercent: 50, currency: 'EUR' }, 'en'))
      .toBe('**€29.99**  ~~€59.99~~  🟡 `−50%`');
    expect(priceLine({ finalMinor: 999, initialMinor: 999, discountPercent: 0, currency: 'TRY' }, 'tr')).toBe('**₺9,99**');
    expect([discountTier(90), discountTier(60), discountTier(59), discountTier(30), discountTier(29)])
      .toEqual(['🟢', '🟢', '🟡', '🟡', '🟠']);
    expect([hotPrefix(60), hotPrefix(59), hotPrefix(null)]).toEqual(['🔥 ', '', '']);
  });

  it('shows a country the same way everywhere', () => {
    expect(countryDisplay('TR', 'tr')).toBe('🇹🇷 Türkiye');
    expect(countryDisplay('DE', 'en')).toBe('🇩🇪 Germany');
  });
});

describe('one region picker', () => {
  it('offers popular countries with flags, the full A–Z list, search and cancel together', () => {
    const panel = json(buildCountryRangePanel('tr', 's', { selected: 'DE' }));
    expect(panel).toContain('"custom_id":"country:s:select"');
    expect(panel).toContain('"custom_id":"country:s:range"');
    expect(panel).toContain('"custom_id":"country:s:search"');
    expect(panel).toContain('"custom_id":"country:s:cancel"');
    expect(panel).toContain('"name":"🇹🇷"');
    expect(panel).toMatch(/"label":"Almanya \(DE\)","value":"DE"[^}]*"default":true/);
    expect(parseCountryPickerAction('country:s:search', 's')).toBe('search');
    expect(parseCountryPickerAction('country:other:search', 's')).toBeNull();
  });

  it('finds countries by name or code and explains an empty search', () => {
    expect(json(buildCountrySearchPanel('tr', 's', 'alm'))).toContain('"value":"DE"');
    expect(json(buildCountrySearchPanel('en', 's', 'BR'))).toContain('"value":"BR"');
    expect(json(buildCountrySearchPanel('tr', 's', 'zzzz'))).toContain('Bu adla bir ülke bulunamadı');
  });
});

describe('setup completion', () => {
  const prepared = { discordUserId: 'u', steamId64: '76561198000000000', language: 'tr', storeCountryCode: 'TR' } as never;

  it('ends with a way into the Dealio panel while the session lasts', () => {
    expect(json(buildSetupCompletePanel(prepared, 'sent', {}, 'session'))).toContain('"custom_id":"setup:session:open"');
    expect(json(buildSetupCompletePanel(prepared, 'sent'))).not.toContain(':open');
    expect(json(buildSetupCompletePanel(prepared, 'sent'))).toContain('🇹🇷 Türkiye');
  });
});

describe('settings region flow', () => {
  const dashboard = {
    status: 'ready', language: 'tr',
    config: {
      discordUserId: 'owner', configurationId: 'config', configVersion: 1, steamId64: '76561198000000000',
      storeCountryCode: 'TR', language: 'tr', enabled: true, minimumDiscountPercent: 20, dmDeliveryBlockedAt: null,
    },
    checkState: null, notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
    latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 0,
  };

  it('opens the shared picker, searches, and cancels back to Settings', async () => {
    const collector = Object.assign(new EventEmitter(), { stop(reason = 'user') { this.emit('end', new Map(), reason); } });
    const interaction = {
      id: 'region-flow', user: { id: 'owner' }, locale: 'tr', client: { user: null },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const click = (customId: string, extra: object = {}) => {
      const component = { customId, user: { id: 'owner' }, isButton: () => true, isStringSelectMenu: () => false,
        deferUpdate: vi.fn().mockResolvedValue(undefined), ...extra };
      collector.emit('collect', component);
      return component;
    };
    const last = () => JSON.stringify(interaction.editReply.mock.calls.at(-1));
    const task = handleStatus(interaction as unknown as ChatInputCommandInteraction,
      { getDashboard: vi.fn().mockReturnValue(dashboard) } as never, {} as never);
    try {
      await vi.waitFor(() => expect(collector.listenerCount('collect')).toBe(1));
      click('status-v2:region-flow:region');
      await vi.waitFor(() => expect(last()).toContain('country:region-flow:search'));

      let modalId = '';
      click('country:region-flow:search', {
        showModal: vi.fn(async (modal: { toJSON: () => { custom_id: string } }) => { modalId = modal.toJSON().custom_id; }),
        awaitModalSubmit: vi.fn(async () => ({
          customId: modalId, user: { id: 'owner' }, deferUpdate: vi.fn().mockResolvedValue(undefined),
          fields: { getTextInputValue: () => 'alman' },
        })),
      });
      await vi.waitFor(() => expect(last()).toContain('Arama: **alman**'));
      expect(last()).toContain('"value":"DE"');

      click('country:region-flow:cancel');
      await vi.waitFor(() => expect(last()).toContain('Hesabın ve tercihlerin'));
    } finally {
      collector.stop();
      await task;
    }
  });
});

describe('first contact', () => {
  it('greets a newcomer on /dealio with the setup welcome itself, in one message', async () => {
    const collector = Object.assign(new EventEmitter(), { stop(reason = 'user') { this.emit('end', new Map(), reason); } });
    const interaction = {
      id: 'newcomer', user: { id: 'new-user' }, locale: 'tr', client: { user: null },
      options: { getString: () => null },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    const task = handleDealio(interaction as unknown as ChatInputCommandInteraction, {
      statusService: { getDashboard: vi.fn().mockReturnValue({ status: 'not-configured', language: 'tr' }) },
      setupService: { hasExistingConfiguration: () => false },
    } as never);
    try {
      await vi.waitFor(() => expect(collector.listenerCount('collect')).toBe(1));
      expect(interaction.deferReply).toHaveBeenCalledOnce();
      const shown = JSON.stringify(interaction.editReply.mock.calls.at(-1));
      expect(shown).toContain("Dealio'ya hoş geldin");
      expect(shown).toContain('setup:newcomer:start');
    } finally {
      collector.stop();
      await task;
    }
  });

  it('offers the panel from expired panels, which keeps working after restarts', () => {
    const shown = json(buildExpiredPanel('tr'));
    expect(shown).toContain('"custom_id":"dealio-open:home"');
    expect(shown).toContain('Dealio paneli');
  });
});
