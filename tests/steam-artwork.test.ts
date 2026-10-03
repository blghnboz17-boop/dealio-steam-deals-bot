import { expect, it } from 'vitest';
import { parseStoreItemsResponse } from '../src/steam/wishlist-parser.js';
import { routeSteam, storeItem, storeItemsResponse, wishlistResponse } from './helpers/steam-fakes.js';
import { SteamClient } from '../src/steam/steam-client.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';
import { buildAssistantView } from '../src/discord/assistant-view.js';
import { buildHomePanel } from '../src/discord/home-view.js';

const appId = 3751950;
const artwork = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/9b046115b1663a4be2b252712328e4f6c162da68/header.jpg?t=1787915122`;
const assets = {
  asset_url_format: `steam/apps/${appId}/\${FILENAME}?t=1787915122`,
  header: '9b046115b1663a4be2b252712328e4f6c162da68/header.jpg',
};
const item = (extra: object = {}) => storeItem(appId, { name: 'Black Flag', assets, ...extra });
function wishlistPanel(items: unknown[]) {
  const db = createDatabase(':memory:');
  try {
    const config = new UserConfigRepository(db).upsert('u', '76561198000000000', 'en', 'TR', '2026-09-30T00:00:00Z');
    return buildAssistantView({ config, items: items as never, capturedAt: '2026-09-30T00:00:00Z', rules: new Map(),
      preference: new WishlistStateRepository(db).assistant.preference('u'), history: [] },
    { screen: 'wishlist', page: 0, query: '', eligibleOnly: false }, 'session');
  } finally { db.close(); }
}
const parse = (extra: object = {}) =>
  parseStoreItemsResponse({ response: { store_items: [item(extra)] } }, [appId]).get(appId);

it.each(['tr', 'en'] as const)('renders actual artwork for unpriced games in every assistant screen (%s)', language => {
  const db = createDatabase(':memory:');
  try {
    const config = new UserConfigRepository(db).upsert('u', '76561198000000000', language, 'TR', '2026-09-30T00:00:00Z');
    const item = { appId, name: 'Black Flag', headerImageUrl: artwork, price: null, onSale: null, priority: null, dateAdded: null };
    const data = { config, items: [item], capturedAt: '2026-09-30T00:00:00Z', rules: new Map(),
      preference: new WishlistStateRepository(db).assistant.preference('u'), history: [] };
    for (const screen of ['wishlist', 'detail'] as const) {
      const panel = buildAssistantView(data, { screen, page: 0, query: '', eligibleOnly: false, selectedAppId: appId }, 'session');
      const json = JSON.stringify(panel.toJSON());
      expect(json).toContain(artwork);
      expect(json).toContain(language === 'tr' ? 'Fiyatını şu an alamadım' : 'Couldn’t get the price right now');
    }
    const home = buildHomePanel({ status: 'ready', language, config, checkState: null,
      notificationQueue: { pending: 0, retry: 0, sending: 0, sent: 0, terminalFailed: 0, expired: 0 },
      latestPriceCurrencies: [], gameDiscountOverrideCount: 0 }, 'session', { heroGame: item });
    expect(JSON.stringify(home.toJSON())).toContain(artwork);
  } finally { db.close(); }
});

it.each([{}, { is_free: true }, { is_free: false }])('builds Steam artwork from GetItems assets independently of price: %j', extra => {
  expect(parse(extra)).toMatchObject({ headerImageUrl: artwork });
});

it('carries unpriced artwork through Steam loading, persisted snapshots and the wishlist', async () => {
  const fetchImpl = routeSteam({ wishlist: () => wishlistResponse([appId]), items: () => storeItemsResponse([item()]) });
  const result = await new SteamClient({ fetchImpl }).getWishlistWithErrors('76561198000000000', 'TR', 'en');
  expect(result.items[0]).toMatchObject({ price: null, onSale: null, headerImageUrl: artwork });
  const db = createDatabase(':memory:');
  try {
    const config = new UserConfigRepository(db).upsert('u', '76561198000000000', 'en', 'TR', '2026-09-30T00:00:00Z');
    new WishlistStateRepository(db).assistant.saveSnapshot(config, result, '2026-09-30T00:00:00Z');
    const snapshot = new WishlistStateRepository(db).assistant.snapshot(config)!;
    const json = JSON.stringify(wishlistPanel([...snapshot.items]).toJSON());
    expect(json).toContain(artwork);
    expect(json).toContain('Couldn’t get the price right now');
    expect(json).not.toContain('−100');
  } finally { db.close(); }
});

it('renders old snapshots without inventing a broken image URL', () => {
  const json = JSON.stringify(wishlistPanel([{ appId, name: 'Unpriced game', price: null,
    onSale: null, priority: null, dateAdded: null }]).toJSON());
  expect(json).not.toContain('steamstatic.com');
  expect(json).toContain(`https://store.steampowered.com/app/${appId}/`);
});

it.each([
  { asset_url_format: 'steam/apps/10/${FILENAME}', header: 'header.jpg' },
  { asset_url_format: `steam/apps/${appId}/\${FILENAME}`, header: 'header.exe' },
  { asset_url_format: `../../evil/${appId}/\${FILENAME}`, header: 'header.jpg' },
  { asset_url_format: `steam/apps/${appId}/\${FILENAME}` },
  'not-an-object',
])('ignores invalid artwork without rejecting valid game metadata: %j', invalid => {
  const parsed = parse({ assets: invalid });
  expect(parsed).toMatchObject({ name: 'Black Flag', isFree: false });
  expect(parsed).not.toHaveProperty('headerImageUrl');
});
