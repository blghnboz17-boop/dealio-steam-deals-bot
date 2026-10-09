import { expect, it } from 'vitest';
import { buildHomePanel } from '../src/discord/home-view.js';
import { assertComponentsV2Limit } from '../src/discord/ui/components-v2.js';
import type { StatusDashboardResult } from '../src/application/status-service.js';

it.each(['tr', 'en'] as const)('fits the complete home panel and disables nested navigation in %s', language => {
  const result: Extract<StatusDashboardResult, {status: 'ready'}> = {
    status: 'ready', language,
    config: {
      discordUserId: '1', configurationId: 'config', steamId64: '76561198000000000',
      configVersion: 1, language, storeCountryCode: 'TR', enabled: true,
      minimumDiscountPercent: 20, dmOptInAt: '2026-09-12T00:00:00Z',
      dmDeliveryBlockedAt: '2026-09-12T00:00:00Z', dmDeliveryErrorCode: '50007',
      createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
    },
    checkState: null, notificationQueue: {pending: 3, retry: 2, sending: 1, sent: 8, terminalFailed: 1, expired: 0},
    latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 1,
  };
  const item = {
    headerImageUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg',
    appId: 570, name: 'A'.repeat(256), onSale: true,
    price: {currency: 'USD', initialMinor: 5999, finalMinor: 2999, discountPercent: 50, isFree: false},
    priority: 1, dateAdded: 1700000000, priceObservedAt: '2026-09-12T00:00:00Z',
  };
  const panel = buildHomePanel(result, 'session', {
    featuredDeal: item, trackedGameCount: 24, eligibleDealCount: 1, disabled: true, staleTargetCount: 2,
    notificationPreference: {mode: 'quiet', timezone: 'Europe/Istanbul', quietStart: 1320, quietEnd: 480, digestMinute: null},
  });
  expect(() => assertComponentsV2Limit([panel])).not.toThrow();
  const serialized = JSON.stringify(panel.toJSON());
  for (const action of ['tab-home', 'tab-games', 'tab-alerts', 'tab-settings', 'check']) {
    expect(serialized).toContain('dealio:session:' + action);
  }
  const controls: {disabled?:boolean}[] = [];
  const links: {url?:string}[] = [];
  JSON.stringify(panel.toJSON(), (_key, value) => {
    if (value && value.type === 2) (value.style === 5 ? links : controls).push(value);
    return value;
  });
  // Four tabs, the manual check and the Matching deals shortcut.
  expect(controls).toHaveLength(6);
  // A fresh Steam check is the only Home action; there is no second "refresh" button.
  expect(serialized).not.toContain('dealio:session:refresh');
  // The support link lives here, on the panel, and never in alert DMs.
  // The support server and the coffee link live on Home only.
  expect(links).toEqual([expect.objectContaining({url: 'https://dsc.gg/dealiosupport'}), expect.objectContaining({url: 'https://buymeacoffee.com/dealio'})]);
  expect(controls.every(control => control.disabled)).toBe(true);
  expect(serialized).toContain('22:00–08:00');
  expect(serialized).toContain('**6**');
  expect(serialized).not.toContain('NaN');
  expect(serialized).toContain('/steam/apps/570/header.jpg');
  expect(serialized).toContain(language === 'tr'
    ? '**2** oyunun hedef fiyatı eski para biriminde'
    : '**2** games have targets in an old currency');
});
