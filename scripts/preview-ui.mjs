// Local design review from the production component builders. All values are demo fixtures.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildStatusV2Panel } from '../dist/discord/status-view-v2.js';
import { buildWishlistV2Page } from '../dist/discord/wishlist-view.js';
import { buildSaleNotificationPanel } from '../dist/discord/notification-components-v2.js';
const date = '2026-09-12T14:00:00.000Z';
const games = [[620, 'Portal 2', 1999, 199, 90], [1091500, 'Cyberpunk 2077', 5999, 2099, 65], [1086940, 'Baldur’s Gate 3', 5999, 4499, 25]];
const items = games.map(([appId, name, initialMinor, finalMinor, discountPercent]) => ({
  appId, name, priority: null, dateAdded: null, onSale: true,
  price: { currency: 'USD', initialMinor, finalMinor, discountPercent, isFree: false },
}));
const panels = {};
for (const language of ['tr', 'en']) {
  const config = {
    discordUserId: 'preview-user', configurationId: 'preview-config', configVersion: 1,
    steamId64: '76561198000000000', language, storeCountryCode: 'TR', enabled: true, minimumDiscountPercent: 30,
    dmOptInAt: date, dmDeliveryBlockedAt: null, dmDeliveryErrorCode: null, createdAt: date, updatedAt: date,
  };
  const dashboard = {
    status: 'ready', language, config,
    checkState: {
      discordUserId: 'preview-user', lastStartedAt: date, lastCompletedAt: date,
      lastStatus: 'success', lastErrorCode: null, nextScheduledAt: '2026-09-12T14:30:00.000Z',
      lastSuccessCompletedAt: date, lastSuccessCheckedCount: 24, lastSuccessOnSaleCount: 3,
      lastSuccessFreeCount: 0, lastSuccessUnknownPriceCount: 0, lastSuccessFailedItemCount: 0,
    },
    notificationQueue: { pending: 2, retry: 0, sent: 18, terminalFailed: 0 },
    latestPriceCurrencies: ['USD'], gameDiscountOverrideCount: 2,
  };
  const snapshot = {
    items, failedItemCount: 0, capturedAt: date, storeCountryCode: 'TR',
    globalMinimumDiscountPercent: 30, gameMinimumDiscountOverrides: new Map([[620, 75]]),
  };
  const notifications = items.map((item) => ({
    discordUserId: 'preview-user', appId: item.appId, saleEpisodeId: 'preview', gameName: item.name,
    currency: 'USD', normalPriceMinor: item.price.initialMinor, finalPriceMinor: item.price.finalMinor,
    discountPercent: item.price.discountPercent, createdAt: date, storeCountryCode: 'TR',
  }));
  const wishlist = (value) => buildWishlistV2Page(value, language, 0, 'preview').components.map(c => c.toJSON());
  panels[language] = {
    home: [buildStatusV2Panel(dashboard, 'preview', { mode: 'home' }).toJSON()],
    wishlist: wishlist(snapshot),
    settings: [buildStatusV2Panel(dashboard, 'preview').toJSON()],
    notification: [buildSaleNotificationPanel(notifications, language).toJSON()],
    blocked: [buildStatusV2Panel({ ...dashboard, config: { ...config, enabled: false, dmDeliveryBlockedAt: date } }, 'preview', { mode: 'home' }).toJSON()],
    partial: [buildStatusV2Panel({ ...dashboard, checkState: { ...dashboard.checkState, lastStatus: 'unavailable', lastSuccessUnknownPriceCount: 4 } }, 'preview', { mode: 'home' }).toJSON()],
    empty: wishlist({ ...snapshot, items: [] }),
    expired: [buildStatusV2Panel(dashboard, 'preview', { mode: 'home', disabled: true }).toJSON()],
  };
}
const data = JSON.stringify(panels).replaceAll('<', '\\u003c');
const html = await readFile(new URL('./ui-preview-shell.html', import.meta.url), 'utf8');
await mkdir('.runtime', { recursive: true });
await writeFile('.runtime/ui-preview.html', html.replace('DATA_PLACEHOLDER', data));
console.log('Design preview: .runtime/ui-preview.html');
