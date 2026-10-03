import { describe, expect, it, vi } from 'vitest';
import { historicalLowStanding, type HistoricalLow } from '../src/domain/price-history.js';
import {
  IsThereAnyDealClient,
  type HistoricalLowSource,
  type PriceHistoryFetch,
} from '../src/price-history/itad-client.js';
import { NotificationService, type SaleNotification } from '../src/application/notification-service.js';
import { buildSaleNotificationPanel } from '../src/discord/notification-components-v2.js';
import { componentsV2TextLength, countComponentsV2 } from '../src/discord/ui/components-v2.js';
import type { WishlistItem } from '../src/domain/steam.js';
import type { NotificationCandidate } from '../src/domain/wishlist-state.js';
import { createDatabase } from '../src/persistence/database.js';
import { UserConfigRepository } from '../src/persistence/user-config-repository.js';
import { WishlistStateRepository } from '../src/persistence/wishlist-state-repository.js';

const low: HistoricalLow = {
  currency: 'USD',
  amountMinor: 659,
  discountPercent: 70,
  recordedAt: '2022-12-20T23:29:04.000Z',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function steamLow(id: string, amount: number, currency = 'USD', shopId = 61) {
  return {
    id,
    lows: [{
      shop: { id: shopId, name: shopId === 61 ? 'Steam' : 'Other' },
      price: { amount, amountInt: Math.round(amount * 100), currency },
      regular: { amount: 21.99, amountInt: 2199, currency },
      cut: 70,
      timestamp: '2022-12-21T00:29:04+01:00',
    }],
  };
}

function fixture(storeLows: (ids: string[]) => unknown = (ids) => ids.map((id) => steamLow(id, 6.59))) {
  let now = Date.parse('2026-10-03T12:00:00Z');
  let failure: Response | null = null;
  const fetchImpl = vi.fn<PriceHistoryFetch>(async (input, init) => {
    if (failure) return failure.clone();
    const body = JSON.parse(init.body) as string[];
    if (input.includes('/lookup/id/shop/61/v1')) {
      return jsonResponse(Object.fromEntries(body.map((key) => [key, key === 'app/404' ? null : `game-${key.slice(4)}`])));
    }
    return jsonResponse(storeLows(body));
  });
  const client = new IsThereAnyDealClient({ apiKey: 'secret-key', fetchImpl, now: () => now, failurePauseMs: 60_000 });
  return {
    client,
    fetchImpl,
    advance: (ms: number) => { now += ms; },
    fail: (response: Response | null) => { failure = response; },
  };
}

describe('historical low standing', () => {
  it('compares only the same currency', () => {
    expect(historicalLowStanding(600, 'USD', low)).toBe('new-low');
    expect(historicalLowStanding(659, 'USD', low)).toBe('matches-low');
    expect(historicalLowStanding(999, 'USD', low)).toBe('above-low');
    expect(historicalLowStanding(600, 'TRY', low)).toBeNull();
  });
});

describe('IsThereAnyDeal client', () => {
  it('returns Steam lows for the Store country and keeps the key out of the URL', async () => {
    const f = fixture();
    const lows = await f.client.historicalLows([220, 220, 404], 'TR');

    expect([...lows]).toEqual([[220, low]]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    const [lookupUrl, lookupInit] = f.fetchImpl.mock.calls[0]!;
    const [lowsUrl, lowsInit] = f.fetchImpl.mock.calls[1]!;
    expect(lookupUrl).toBe('https://api.isthereanydeal.com/lookup/id/shop/61/v1');
    expect(JSON.parse(lookupInit.body)).toEqual(['app/220', 'app/404']);
    expect(lowsUrl).toBe('https://api.isthereanydeal.com/games/storelow/v2?country=TR&shops=61');
    expect(JSON.parse(lowsInit.body)).toEqual(['game-220']);
    expect(lowsInit.headers['ITAD-API-Key']).toBe('secret-key');
    expect(f.fetchImpl.mock.calls.flat().map(String).join(' ')).not.toMatch(/key=/);
  });

  it('caches game IDs and lows, per country', async () => {
    const f = fixture();
    await f.client.historicalLows([220, 404], 'TR');
    await f.client.historicalLows([220, 404], 'TR');
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);

    await f.client.historicalLows([220], 'US');
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    expect(f.fetchImpl.mock.calls[2]![0]).toContain('country=US');

    f.advance(6 * 60 * 60 * 1000 + 1);
    await f.client.historicalLows([220], 'TR');
    expect(f.fetchImpl).toHaveBeenCalledTimes(4);
    expect(f.fetchImpl.mock.calls[3]![0]).toContain('/games/storelow/v2');
  });

  it('splits requests at the 200-ID API limit', async () => {
    const f = fixture();
    const appIds = Array.from({ length: 250 }, (_, index) => index + 1);
    const lows = await f.client.historicalLows(appIds, 'TR');

    expect(lows.size).toBe(250);
    expect(f.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).length)).toEqual([200, 50, 200, 50]);
  });

  it('ignores other shops and malformed lows', async () => {
    const f = fixture((ids) => [
      steamLow(ids[0]!, 6.59, 'USD', 16),
      { ...steamLow(ids[1]!, 6.59), lows: [{ ...steamLow(ids[1]!, 6.59).lows[0], cut: 150 }] },
      steamLow(ids[2]!, 4.99, 'usd'),
      steamLow(ids[3]!, 4.99, 'EUR'),
      'not a game',
    ]);
    const lows = await f.client.historicalLows([1, 2, 3, 4], 'TR');

    expect([...lows]).toEqual([[4, { ...low, currency: 'EUR', amountMinor: 499 }]]);
  });

  it('returns nothing and pauses lookups while the service fails', async () => {
    const f = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      f.fail(jsonResponse({ reason_phrase: 'Server error' }, 500));
      await expect(f.client.historicalLows([220], 'TR')).resolves.toEqual(new Map());
      expect(String(warn.mock.calls[0]?.[0])).toContain('HTTP 500');
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('secret-key');

      f.fail(null);
      await f.client.historicalLows([220], 'TR');
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);

      f.advance(60_001);
      await expect(f.client.historicalLows([220], 'TR')).resolves.toEqual(new Map([[220, low]]));
    } finally {
      warn.mockRestore();
    }
  });

  it('honors a longer Retry-After when rate limited', async () => {
    const f = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      f.fail(jsonResponse({}, 429, { 'retry-after': '120' }));
      await f.client.historicalLows([220], 'TR');
      f.fail(null);
      f.advance(90_000);
      await f.client.historicalLows([220], 'TR');
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
      f.advance(30_001);
      await expect(f.client.historicalLows([220], 'TR')).resolves.toHaveProperty('size', 1);
    } finally {
      warn.mockRestore();
    }
  });

  it('gives up at the timeout instead of delaying a notification', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn<PriceHistoryFetch>((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    try {
      const client = new IsThereAnyDealClient({ apiKey: 'secret-key', fetchImpl, timeoutMs: 20 });
      await expect(client.historicalLows([220], 'TR')).resolves.toEqual(new Map());
      expect(String(warn.mock.calls[0]?.[0])).toContain('timeout');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects an empty API key', () => {
    expect(() => new IsThereAnyDealClient({ apiKey: '  ' })).toThrow('must not be empty');
  });
});

describe('sale alert price history', () => {
  const sale: SaleNotification = {
    discordUserId: 'discord-user',
    appId: 220,
    saleEpisodeId: 'episode',
    storeCountryCode: 'TR',
    gameName: 'Half-Life 2',
    currency: 'USD',
    normalPriceMinor: 999,
    finalPriceMinor: 199,
    discountPercent: 80,
    createdAt: '2026-10-03T12:00:00.000Z',
  };
  const text = (notifications: SaleNotification[], language: 'tr' | 'en') =>
    // Intl separates the currency code with a no-break space.
    JSON.stringify(buildSaleNotificationPanel(notifications, language).toJSON()).replace(/ /g, ' ');

  it.each([
    ['tr', 150, 'Tarihî en düşük: **USD 1,50** (%70 · Aralık 2022)'],
    ['en', 150, 'All-time low: **USD 1.50** (70% off · December 2022)'],
    ['tr', 199, 'Tarihî en düşük fiyata eşit'],
    ['en', 199, 'Matches the all-time low'],
    ['tr', 250, 'Tüm zamanların en düşük fiyatı!'],
    ['en', 250, 'Lowest price ever!'],
  ] as const)('shows the %s low for a recorded %i', (language, amountMinor, expected) => {
    const rendered = text([{ ...sale, historicalLow: { ...low, amountMinor } }], language);
    expect(rendered).toContain(expected);
    expect(rendered).toContain('[IsThereAnyDeal](https://isthereanydeal.com/)');
  });

  it('omits price history without data or in another currency', () => {
    for (const notification of [sale, { ...sale, historicalLow: { ...low, currency: 'TRY' } }]) {
      const rendered = text([notification], 'en');
      expect(rendered).not.toContain('All-time low');
      expect(rendered).not.toContain('IsThereAnyDeal');
    }
  });

  it('keeps ten long alerts with history inside Discord limits', () => {
    const panel = buildSaleNotificationPanel(Array.from({ length: 10 }, (_, index) => ({
      ...sale,
      appId: 2147483647 - index,
      gameName: 'A'.repeat(256),
      normalPriceMinor: 99999999,
      finalPriceMinor: 49999999,
      historicalLow: { ...low, amountMinor: 12345678 },
    })), 'tr');
    expect(componentsV2TextLength([panel])).toBeLessThanOrEqual(4000);
    expect(countComponentsV2([panel])).toBeLessThanOrEqual(40);
    expect(JSON.stringify(panel.toJSON())).toContain('Tarihî en düşük');
  });
});

describe('notification delivery with price history', () => {
  function setup(priceHistory: HistoricalLowSource) {
    const database = createDatabase(':memory:');
    const users = new UserConfigRepository(database);
    const states = new WishlistStateRepository(database);
    const config = users.upsert('discord-user', '76561198000000000', 'en', 'TR', '2026-10-03T00:00:00.000Z');
    const item: WishlistItem = {
      appId: 220, name: 'Half-Life 2', priority: null, dateAdded: null, onSale: false,
      price: { currency: 'USD', initialMinor: 999, finalMinor: 999, discountPercent: 0, isFree: false },
    };
    states.recordObservation(config, { item, saleKey: null, observedAt: '2026-10-03T00:01:00.000Z' });
    states.recordObservation(config, {
      item: { ...item, onSale: true, price: { ...item.price, finalMinor: 199, discountPercent: 80 } },
      saleKey: 'USD:999:199:80',
      observedAt: '2026-10-03T00:02:00.000Z',
    });
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = { plan: vi.fn((items: readonly NotificationCandidate[]) => [{ notifications: items }]), send };
    const service = new NotificationService(users, states, sender as never, { priceHistory });
    return { database, send, service };
  }

  it('adds the low for the Store country without changing the durable batch', async () => {
    const historicalLows = vi.fn(async () => new Map([[220, low]]));
    const f = setup({ historicalLows });
    try {
      await expect(f.service.deliverPending('discord-user')).resolves.toMatchObject({ sentCount: 1 });
      expect(historicalLows).toHaveBeenCalledWith([220], 'TR');
      expect(f.send.mock.calls[0]![0].notifications[0]).toMatchObject({ appId: 220, historicalLow: low });
      const stored = f.database.prepare('SELECT COUNT(*) AS n FROM notification_log WHERE status = ?').get('sent') as { n: number };
      expect(stored.n).toBe(1);
    } finally { f.database.close(); }
  });

  it('still delivers the sale when price history throws', async () => {
    const f = setup({ historicalLows: vi.fn(async () => { throw new Error('unavailable'); }) });
    try {
      await expect(f.service.deliverPending('discord-user')).resolves.toMatchObject({ sentCount: 1, failedCount: 0 });
      expect(f.send.mock.calls[0]![0].notifications[0]).not.toHaveProperty('historicalLow');
    } finally { f.database.close(); }
  });
});
