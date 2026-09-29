import { expect, it, vi } from 'vitest';
import { parseAppDetailsResponse } from '../src/steam/wishlist-parser.js';
import { SteamClient } from '../src/steam/steam-client.js';
import { buildWishlistV2Page } from '../src/discord/wishlist-view.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import { buildAssistantView } from '../src/discord/assistant-view.js';
import { buildHomePanel } from '../src/discord/home-view.js';

const appId = 3751950;
const artwork = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/9b046115b1663a4be2b252712328e4f6c162da68/header.jpg?t=1787915122`;
const response = (extra: object = {}) => ({ [appId]: { success: true, data: {
  steam_appid: appId, name: 'Black Flag', header_image: artwork, ...extra,
} } });

it.each(['tr', 'en'] as const)('renders actual artwork for unpriced games in every assistant screen (%s)', language => {
  const db = createDatabase(':memory:');
  try {
    const config = new UserConfigRepository(db).upsert('u', '76561198000000000', language, 'TR', '2026-09-30T00:00:00Z');
    const item = { appId, name: 'Black Flag', headerImageUrl: artwork, price: null, onSale: null, priority: null, dateAdded: null };
    const data = { config, items: [item], capturedAt: '2026-09-30T00:00:00Z', rules: new Map(),
      preference: new WishlistStateRepository(db).assistant.preference('u'), history: [], prices: [] };
    for (const screen of ['wishlist', 'detail'] as const) {
      const panel = buildAssistantView(data, { screen, page: 0, query: '', eligibleOnly: false, selectedAppId: appId }, 'session');
      const json = JSON.stringify(panel.toJSON());
      expect(json).toContain(artwork);
      expect(json).toContain(language === 'tr' ? 'Fiyat doğrulanamadı' : 'Price unavailable');
    }
    const home = buildHomePanel({ status: 'ready', language, config, checkState: null,
      notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
      latestPriceCurrencies: [], gameDiscountOverrideCount: 0 }, 'session', { heroGame: item });
    expect(JSON.stringify(home.toJSON())).toContain(artwork);
  } finally { db.close(); }
});

it.each([{}, { is_free: true }, { price_overview: {
  currency: 'USD', initial: 4799, final: 4319, discount_percent: 10,
} }])('keeps Steam artwork independently of price availability: %j', extra => {
  expect(parseAppDetailsResponse(response(extra), appId)).toMatchObject({ headerImageUrl: artwork });
});

it('carries unpriced artwork through Steam loading, persisted snapshots and the wishlist', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ response: { items: [{ appid: appId }] } }), { headers: { 'X-EResult': '1' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify(response())));
  const result = await new SteamClient({ fetchImpl }).getWishlistWithErrors('76561198000000000', 'TR', 'en');
  expect(result.items[0]).toMatchObject({ price: null, onSale: null, headerImageUrl: artwork });
  const db = createDatabase(':memory:');
  try {
    const config = new UserConfigRepository(db).upsert('u', '76561198000000000', 'en', 'TR', '2026-09-30T00:00:00Z');
    new WishlistStateRepository(db).assistant.saveSnapshot(config, result, '2026-09-30T00:00:00Z');
    const snapshot = new WishlistStateRepository(db).assistant.snapshot(config)!;
    const panel = buildWishlistV2Page({ ...snapshot, failedItemCount: 0 }, 'en', 0, 'session');
    const json = JSON.stringify(panel.components.map(c => c.toJSON()));
    expect(json).toContain(artwork);
    expect(json).toContain('Price unavailable');
    expect(json).not.toContain('−100');
  } finally { db.close(); }
});

it('renders old snapshots without inventing a broken image URL', () => {
  const panel = buildWishlistV2Page({ items: [{ appId, name: 'Unpriced game', price: null,
    onSale: null, priority: null, dateAdded: null }], failedItemCount: 0,
    capturedAt: '2026-09-30T00:00:00Z' }, 'en', 0, 'session');
  const json = JSON.stringify(panel.components.map(c => c.toJSON()));
  expect(json).not.toContain('steamstatic.com');
  expect(json).toContain(`https://store.steampowered.com/app/${appId}/`);
});

it.each(['https://evil.example/header.jpg', 'https://shared.akamai.steamstatic.com.evil.example/header.jpg',
  'http://shared.akamai.steamstatic.com/steam/apps/3751950/header.jpg',
  'https://shared.akamai.steamstatic.com/steam/apps/10/header.jpg', 'not-a-url'])
('ignores invalid artwork without rejecting valid game metadata: %s', header_image => {
  const parsed = parseAppDetailsResponse(response({ header_image }), appId);
  expect(parsed).toMatchObject({ name: 'Black Flag', price: null });
  expect(parsed).not.toHaveProperty('headerImageUrl');
});
