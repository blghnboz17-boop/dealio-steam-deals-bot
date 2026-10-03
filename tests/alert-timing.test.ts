import { EventEmitter } from 'node:events';
import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { defaultTimezone, timezoneChoices, timezoneLabel } from '../src/domain/timezone.js';
import { buildAssistantView } from '../src/discord/assistant-view.js';
import { handleAssistant } from '../src/discord/commands/assistant.js';
import { AssistantService } from '../src/application/assistant-service.js';
import { UserOperationCoordinator } from '../src/application/user-operation-coordinator.js';
import type { NotificationPreference } from '../src/domain/notification-preference.js';
import type { StoreCountryCode } from '../src/domain/store-country.js';
import type { WishlistViewService } from '../src/application/wishlist-view-service.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { AssistantRepository } from '../src/persistence/assistant-repository.js';

const instant: NotificationPreference = { mode: 'instant', timezone: null, quietStart: null, quietEnd: null, digestMinute: null };
const text = (value: unknown) => JSON.stringify(value).replace(/ /g, ' ');

describe('time zones', () => {
  it('chooses a single-zone Store country and asks in multi-zone ones', () => {
    expect(defaultTimezone('TR')).toBe('Europe/Istanbul');
    expect(defaultTimezone('DE')).toBe('Europe/Berlin');
    expect(defaultTimezone('US')).toBeNull();
    expect(defaultTimezone('RU')).toBeNull();
  });

  it('offers the current zone and the country first, at most 25, without duplicates', () => {
    const us = timezoneChoices('US', 'Asia/Tokyo');
    expect(us.slice(0, 3)).toEqual(['Asia/Tokyo', 'America/New_York', 'America/Chicago']);
    expect(new Set(us).size).toBe(us.length);
    expect(us.length).toBeLessThanOrEqual(25);
    expect(timezoneChoices('TR')[0]).toBe('Europe/Istanbul');
    expect(timezoneChoices('AQ').length).toBeGreaterThan(10);
    for (const country of ['US', 'CA', 'AU', 'BR', 'MX', 'RU', 'ID', 'KZ', 'TR'] as const) {
      for (const zone of timezoneChoices(country)) {
        expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow();
      }
    }
  });

  it('labels a zone with its city and today’s UTC offset', () => {
    expect(timezoneLabel('Europe/Istanbul')).toBe('Istanbul (UTC+3)');
    expect(timezoneLabel('Europe/London', new Date('2026-01-15T12:00:00Z'))).toBe('London (UTC+0)');
    expect(timezoneLabel('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe('New York (UTC−4)');
    expect(timezoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires (UTC−3)');
  });
});

function render(country: StoreCountryCode, preference: NotificationPreference, language: 'tr' | 'en' = 'tr') {
  return text(buildAssistantView({
    config: { discordUserId: 'u', configurationId: 'c', steamId64: '7', configVersion: 1, language, storeCountryCode: country,
      enabled: true, minimumDiscountPercent: 20, createdAt: '', updatedAt: '' } as never,
    items: [], capturedAt: new Date().toISOString(), rules: new Map(), preference, history: [],
  }, { screen: 'rhythm', page: 0, query: '', eligibleOnly: false }, 's').toJSON());
}

describe('alerts screen', () => {
  it('explains each choice and uses the Store region’s time zone', () => {
    const rendered = render('TR', instant);
    expect(rendered).toContain('Şu an: **⚡ Hemen**');
    expect(rendered).toContain('Saat dilimi: Istanbul (UTC+3)');
    expect(rendered).toContain('Bu saatlerde bildirim gelmez; saat bitince bekleyenler gelir.');
    expect(rendered).toContain('Gece 23:00–08:00');
    expect(rendered).toContain('"value":"Europe/Istanbul","default":true');
    expect(rendered).not.toMatch(/IANA|Sessiz saat/);
  });

  it('asks a multi-zone country to choose and keeps hand-written minutes', () => {
    expect(render('US', instant, 'en')).toContain('Time zone: not set, choose below');
    const quiet = render('TR', { mode: 'quiet', timezone: 'Europe/Istanbul', quietStart: 1410, quietEnd: 450, digestMinute: null });
    expect(quiet).toContain('🌙 Rahatsız etme · 23:30–07:30');
  });
});

function fixture(country: StoreCountryCode) {
  const db = createDatabase(':memory:');
  const users = new UserConfigRepository(db);
  users.upsert('owner', '76561198000000000', 'tr', country, new Date().toISOString());
  const repository = new AssistantRepository(db);
  const service = new AssistantService(repository, users, new UserOperationCoordinator());
  const collector = Object.assign(new EventEmitter(), { ended: false, stop() { this.ended = true; this.emit('end'); } });
  const interaction = {
    id: 'timing', user: { id: 'owner' }, locale: 'tr',
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ createMessageComponentCollector: () => collector }),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
  const component = (action: string, extra: object = {}) => ({
    customId: `assistant:timing:${action}`, user: { id: 'owner' }, isStringSelectMenu: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined), ...extra,
  });
  const click = (action: string, extra: object = {}) => {
    const value = component(action, extra);
    collector.emit('collect', value);
    return value;
  };
  const start = () => handleAssistant(interaction as unknown as ChatInputCommandInteraction, service,
    {} as WishlistViewService, undefined, 'rhythm');
  const last = () => text(interaction.editReply.mock.calls.at(-1));
  return { db, repository, collector, interaction, click, start, last };
}

describe('alert timing actions', () => {
  it('saves the one-click night preset in the Store region’s zone', async () => {
    const f = fixture('TR'); const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.click('quiet-night');
      await vi.waitFor(() => expect(f.last()).toContain('Bildirim zamanın kaydedildi.'));
      expect(f.repository.preference('owner')).toMatchObject({ mode: 'quiet', timezone: 'Europe/Istanbul', quietStart: 1380, quietEnd: 480 });
      f.click('instant');
      await vi.waitFor(() => expect(f.repository.preference('owner').mode).toBe('instant'));
      // Switching back to instant keeps the zone and the earlier hours.
      expect(f.repository.preference('owner')).toMatchObject({ timezone: 'Europe/Istanbul', quietStart: 1380 });
    } finally { f.collector.stop(); await task; f.db.close(); }
  });

  it('asks for a time zone first in a multi-zone country, then saves the choice', async () => {
    const f = fixture('US'); const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      f.click('digest-evening');
      await vi.waitFor(() => expect(f.last()).toContain('Önce aşağıdan saat dilimini seç.'));
      expect(f.repository.preference('owner').mode).toBe('instant');
      f.click('timezone', { isStringSelectMenu: () => true, values: ['America/Chicago'] });
      await vi.waitFor(() => expect(f.repository.preference('owner').timezone).toBe('America/Chicago'));
      f.click('digest-evening');
      await vi.waitFor(() => expect(f.repository.preference('owner')).toMatchObject({ mode: 'digest', digestMinute: 1140 }));
    } finally { f.collector.stop(); await task; f.db.close(); }
  });

  it('saves custom hours chosen from lists', async () => {
    const f = fixture('TR'); const task = f.start();
    try {
      await vi.waitFor(() => expect(f.collector.listenerCount('collect')).toBe(1));
      let modalId = '';
      const submit = {
        user: { id: 'owner' }, deferUpdate: vi.fn().mockResolvedValue(undefined),
        fields: { getStringSelectValues: (id: string) => [id === 'start' ? '1320' : '420'] },
      };
      const opened = f.click('quiet', {
        showModal: vi.fn(async (modal: { toJSON: () => { custom_id: string; components: unknown[] } }) => {
          const json = modal.toJSON(); modalId = json.custom_id;
          expect(text(json)).toContain('"label":"23:00","value":"1380","default":true');
        }),
        awaitModalSubmit: vi.fn(async () => ({ ...submit, customId: modalId })),
      });
      await vi.waitFor(() => expect(f.repository.preference('owner')).toMatchObject({ mode: 'quiet', quietStart: 1320, quietEnd: 420 }));
      expect(opened.deferUpdate).not.toHaveBeenCalled();
    } finally { f.collector.stop(); await task; f.db.close(); }
  });
});
