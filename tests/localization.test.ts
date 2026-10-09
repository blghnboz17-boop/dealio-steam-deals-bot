import { describe, expect, it } from 'vitest';
import type { ContainerBuilder } from 'discord.js';
import { languages, type Language, type UserConfig } from '../src/domain/user-config.js';
import type { WishlistItem } from '../src/domain/steam.js';
import type { SaleNotification } from '../src/application/notification-service.js';
import { languageFromDiscordLocale } from '../src/discord/language.js';
import { percentText } from '../src/discord/i18n.js';
import { buildAssistantView, type AssistantView, type AssistantViewData } from '../src/discord/assistant-view.js';
import { buildStatusV2Panel } from '../src/discord/status-view-v2.js';
import { buildSetupCompletePanel, buildSetupConfirmationPanel, buildSetupWelcomePanel } from '../src/discord/setup-view.js';
import { buildInitialWishlistV2Page, buildSaleNotificationPanel } from '../src/discord/notification-components-v2.js';
import { buildCountryRangePanel, buildCountrySearchPanel } from '../src/discord/ui/country-picker.js';
import { buildExpiredPanel } from '../src/discord/ui/components-v2.js';
import { priceLine } from '../src/discord/ui/design.js';
import { messagesFor } from '../src/discord/messages.js';
import { buildSupportPanel, buildTicketClosedNotice, buildTicketHeader } from '../src/discord/support/support-view.js';

const supportTicket = {
  ticketId: 7, discordUserId: 'u', guildId: 'g', channelId: 'c', topic: 'alerts', status: 'open',
  threadId: 't', openedAt: '2026-10-09T12:00:00.000Z', closedAt: null, closedBy: null,
} as const;

const json = (panel: ContainerBuilder) => JSON.stringify(panel.toJSON()).replace(/[  ]/g, ' ');

/** What a person reads: text, labels, placeholders and option descriptions, not internal IDs or URLs. */
function visibleText(serialized: string): string {
  const texts: string[] = [];
  JSON.parse(serialized, (key, value: unknown) => {
    if (typeof value === 'string' && ['content', 'label', 'placeholder', 'description'].includes(key)) {
      texts.push(value.replace(/\]\([^)]*\)/g, ']'));
    }
    return value;
  });
  return texts.join('\n');
}

function config(language: Language): UserConfig {
  return {
    discordUserId: 'u', configurationId: 'c', steamId64: '76561198000000000', configVersion: 1, language,
    storeCountryCode: 'DE', enabled: true, minimumDiscountPercent: 20, dmOptInAt: '2026-10-01T00:00:00.000Z',
    dmDeliveryBlockedAt: null, dmDeliveryErrorCode: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

const item: WishlistItem = {
  appId: 620, name: 'Portal 2', priority: 1, dateAdded: null, onSale: true,
  price: { currency: 'EUR', initialMinor: 999, finalMinor: 199, discountPercent: 80, isFree: false },
  storeFacts: { reviewLabel: 'Overwhelmingly Positive', reviewPercent: 98, steamDeck: 'verified', platforms: { windows: true, mac: true, linux: true } },
};

function sale(index: number): SaleNotification {
  return {
    discordUserId: 'u', appId: index + 1, saleEpisodeId: `e${index}`, storeCountryCode: 'DE',
    gameName: `Portal ${index + 1} `.repeat(12).trim(), currency: 'EUR', normalPriceMinor: 999, finalPriceMinor: 199,
    discountPercent: 80, createdAt: '2026-10-03T12:00:00.000Z', reason: index % 2 ? 'target:200:EUR' : 'discount',
    historicalLow: { currency: 'EUR', amountMinor: 150, discountPercent: 85, recordedAt: '2025-06-01T00:00:00.000Z' },
    storeFacts: item.storeFacts,
  };
}

/** Every screen a user can reach, in one language. */
function everyScreen(language: Language): string[] {
  const ready = {
    status: 'ready', language, config: config(language), checkState: null,
    notificationQueue: { pending: 1, retry: 0, sending: 0, sent: 3, terminalFailed: 0, expired: 0 },
    latestPriceCurrencies: ['EUR'], gameDiscountOverrideCount: 1,
  } as const;
  const data: AssistantViewData = {
    config: config(language), items: [item], capturedAt: '2026-10-03T12:00:00.000Z', rules: new Map(),
    preference: { mode: 'quiet', timezone: 'Europe/Berlin', quietStart: 1380, quietEnd: 480, digestMinute: null },
    history: [{ app_id: 620, game_name: 'Portal 2', status: 'sent', reason: 'discount', created_at: '2026-10-03T12:00:00.000Z', delivered_at: null, discord_message_id: null }],
    priceHistory: { status: 'ready', history: { low: { currency: 'EUR', amountMinor: 150, discountPercent: 85, recordedAt: '2025-06-01T00:00:00.000Z' }, recent: [] } },
  };
  const view = (screen: AssistantView['screen']): AssistantView => ({ screen, page: 0, query: '', eligibleOnly: false, selectedAppId: 620 });
  const prepared = { discordUserId: 'u', steamId64: '76561198000000000', language, storeCountryCode: 'DE' } as never;
  return [
    buildStatusV2Panel(ready, 's', { mode: 'home', heroGame: item, tabs: true }),
    buildStatusV2Panel(ready, 's', { tabs: true }),
    ...(['wishlist', 'detail', 'history', 'rhythm'] as const).map((screen) => buildAssistantView(data, view(screen), 's')),
    buildSaleNotificationPanel(Array.from({ length: 10 }, (_, index) => sale(index)), language),
    buildSaleNotificationPanel([sale(0)], language, { test: true, testSource: 'example' }),
    ...buildInitialWishlistV2Page({
      discordUserId: 'u', steamId64: '76561198000000000', language, storeCountryCode: 'DE', totalGameCount: 3,
      failedItemCount: 1, upcomingCount: 1, minimumDiscountPercent: 20, capturedAt: '2026-10-03T12:00:00.000Z',
      sales: [{ appId: 620, gameName: 'Portal 2', currency: 'EUR', normalPriceMinor: 999, finalPriceMinor: 199, discountPercent: 80 }],
    }, {}, 's', 0).components,
    buildSetupWelcomePanel(language, 's', {}, true),
    buildSetupConfirmationPanel(prepared, 's'),
    buildSetupCompletePanel(prepared, 'sent', {}, 's'),
    buildCountryRangePanel(language, 's', { selected: 'DE' }),
    buildCountrySearchPanel(language, 's', 'zzzz'),
    buildExpiredPanel(language),
    buildSupportPanel(language, { faqChannelId: 'c' }),
    buildTicketHeader(supportTicket, 'Hades', language),
    buildTicketClosedNotice(supportTicket, 'u', language),
  ].map(json);
}

describe('localization', () => {
  it('speaks the Discord client’s language when Dealio knows it', () => {
    expect(['tr', 'de', 'fr', 'en-US', 'en-GB', 'es-ES', 'pt-BR'].map(languageFromDiscordLocale))
      .toEqual(['tr', 'de', 'fr', 'en', 'en', 'en', 'en']);
  });

  it('writes percentages and prices the way each language does', () => {
    expect(languages.map((language) => percentText(30, language).replace(/[  ]/g, ' ')))
      .toEqual(['%30', '30%', '30 %', '30 %']);
    const price = { finalMinor: 399, initialMinor: 1999, discountPercent: 80, currency: 'EUR' };
    expect(priceLine(price, 'de').replace(/[  ]/g, ' ')).toBe('**3,99 €**  ~~19,99 €~~  🟢 `−80 %`');
    expect(priceLine(price, 'fr').replace(/[  ]/g, ' ')).toBe('**3,99 €**  ~~19,99 €~~  🟢 `−80 %`');
  });

  it.each(languages)('renders every screen in %s within Discord’s limits', (language) => {
    expect(() => everyScreen(language)).not.toThrow();
  });

  it.each(['de', 'fr'] as const)('keeps %s screens free of Turkish and English UI text', (language) => {
    const text = everyScreen(language).map(visibleText).join('\n')
      // Content that is not UI copy: Steam's review label, language names in the picker, Steam's brand.
      .replace(/Overwhelmingly Positive|Türkçe|English/g, '');
    expect(text).not.toMatch(/[ğşıİ]/);
    expect(text).not.toMatch(/\b(the|your|you|games|wishlist|sale|alerts|check|settings|price)\b/i);
  });

  it('calls the wishlist by Steam’s own name in each language', () => {
    expect(everyScreen('tr')[2]).toContain('İSTEK LİSTEM');
    expect(everyScreen('de')[2]).toContain('WUNSCHLISTE');
    expect(everyScreen('fr')[2]).toContain('MA LISTE');
    expect(everyScreen('tr').map(visibleText).join()).not.toMatch(/[Ww]ishlist/);
  });

  it('lets setup switch to any of the four languages on the welcome screen only', () => {
    const prepared = { discordUserId: 'u', steamId64: '76561198000000000', language: 'fr', storeCountryCode: 'FR' } as never;
    expect(JSON.stringify(buildSetupConfirmationPanel(prepared, 's').toJSON())).not.toContain('setup:s:language');
    const panel = buildSetupWelcomePanel('fr', 's').toJSON();
    const select = panel.components.flatMap((component) => component.type === 1 ? component.components : [])
      .find((component) => 'custom_id' in component && component.custom_id === 'setup:s:language');
    expect(select).toMatchObject({
      type: 3,
      options: [
        { label: 'Türkçe', value: 'tr', default: false },
        { label: 'English', value: 'en', default: false },
        { label: 'Deutsch', value: 'de', default: false },
        { label: 'Français', value: 'fr', default: true },
      ],
    });
  });

  it('keeps every catalog complete, with the same placeholders in each language', () => {
    const keys = (language: Language) => Object.keys(messagesFor(language)).sort();
    for (const language of languages) expect(keys(language)).toEqual(keys('en'));
    for (const language of languages) {
      expect(messagesFor(language).cooldown(42)).toContain('42');
      expect(messagesFor(language).checkCompleted({ checked: 7, found: 2, sent: 2, deliveryFailed: 1, unconfirmed: 3 }))
        .toMatch(/7[^]*2[^]*1[^]*3/);
    }
  });
});

describe('owner-requested Turkish wording', () => {
  it('keeps the long alerts title on one line with a smaller heading, and other titles large', () => {
    const [home, , , , , rhythm] = everyScreen('tr');
    expect(rhythm).toContain('### Sen bildirimlere değil, bildirimler sana uysun');
    expect(rhythm).toContain('Şu an: **🌙 Rahatsız etme saatleri');
    expect(rhythm).toContain('"label":"Anında"');
    expect(home).toContain('\\n# Senin istek listen, senin kuralların!');
    expect(everyScreen('tr')[1]).toContain('"label":"İndirim yüzdesini belirle"');
  });
});
