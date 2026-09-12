import { buildAssistantView } from '../dist/discord/assistant-view.js';
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
  const assistantData={config,items,capturedAt:date,rules:new Map([[620,{mode:'target',targetMinor:299,currency:'USD',percent:null,muted:false,revision:1}]]),
    preference:{mode:'quiet',timezone:'Europe/Istanbul',quietStart:1380,quietEnd:480,digestMinute:null},
    prices:[{final_minor:999,initial_minor:1999,observed_at:'2026-08-15T12:00:00Z'},{final_minor:199,initial_minor:1999,observed_at:date}],
    history:[{game_name:'Portal 2',app_id:620,status:'sent',reason:'target:299:USD',created_at:date,delivered_at:date,discord_message_id:'123'},
      {game_name:'Cyberpunk 2077',app_id:1091500,status:'candidate',reason:'discount',created_at:date,delivered_at:null,discord_message_id:null}]};
  const personal=screen=>[buildAssistantView(assistantData,{screen,page:0,query:'',eligibleOnly:false,selectedAppId:620},'preview').toJSON()];
  panels[language] = {
    detail:personal('detail'), history:personal('history'), rhythm:personal('rhythm'),
    home: [buildStatusV2Panel(dashboard, 'preview', { mode: 'home',featuredDeal:items[0],eligibleDealCount:2 }).toJSON()],
    wishlist: personal('wishlist'),
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
