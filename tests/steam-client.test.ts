import { describe, expect, it, vi } from 'vitest';
import {
  SteamClient,
  type SteamFetch,
} from '../src/steam/steam-client.js';
import { SteamWishlistError } from '../src/domain/steam.js';
import { SteamRequestLimiter } from '../src/steam/request-limiter.js';
import {
  isRoute,
  jsonResponse,
  priceOverview,
  routeSteam,
  storeItem,
  storeItemsResponse,
  unpriced,
  wishlistResponse,
} from './helpers/steam-fakes.js';

function createFetchMock(): ReturnType<typeof vi.fn<SteamFetch>> {
  return vi.fn<SteamFetch>();
}

function expectSteamError(error: unknown, code: string): SteamWishlistError {
  expect(error).toBeInstanceOf(SteamWishlistError);
  expect((error as SteamWishlistError).code).toBe(code);
  return error as SteamWishlistError;
}

describe('SteamClient', () => {
  it('uses the selected store country and text language while trusting Steam currency', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10]),
      prices: () => jsonResponse({ '10': priceOverview('USD', 2_000, 1_000, 50) }),
    });

    const result = await new SteamClient({ fetchImpl: fetchMock })
      .getWishlist('76561198000000000', 'US', 'en');
    const appDetailsUrl = new URL(String(fetchMock.mock.calls.find(call => isRoute(call, 'appdetails'))?.[0]));
    const itemsUrl = new URL(String(fetchMock.mock.calls.find(call => isRoute(call, 'GetItems'))?.[0]));

    expect(appDetailsUrl.searchParams.get('cc')).toBe('US');
    expect(appDetailsUrl.searchParams.get('filters')).toBe('price_overview');
    expect(JSON.parse(itemsUrl.searchParams.get('input_json')!).context)
      .toEqual({ language: 'english', country_code: 'US', steam_realm: 1 });
    expect(result[0]?.price?.currency).toBe('USD');
  });

  it('rejects an unsupported store country before making a request', async () => {
    const fetchMock = createFetchMock();
    await expect(new SteamClient({ fetchImpl: fetchMock }).getWishlist(
      '76561198000000000',
      'XX' as never,
      'en',
    )).rejects.toMatchObject({ code: 'STEAM_INVALID_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads wishlist items and normalizes batched prices', async () => {
    const fetchMock = routeSteam({
      wishlist: () => jsonResponse({
        response: {
          items: [
            { appid: 10, priority: 2, date_added: 1_700_000_000 },
            { appid: 20, priority: 1, date_added: 1_700_000_001 },
          ],
        },
      }),
      items: () => storeItemsResponse([
        storeItem(20, { name: 'İkinci Oyun' }),
        storeItem(10, { name: 'Birinci Oyun', is_free: false }),
      ]),
      prices: () => jsonResponse({
        '10': priceOverview('TRY', 1_000, 500, 50),
        '20': priceOverview('EUR', 999, 999, 0),
      }),
    });

    const client = new SteamClient({ fetchImpl: fetchMock });
    const items = await client.getWishlist('76561198000000000', 'TR', 'tr');

    expect(items.every(item => !Number.isNaN(Date.parse(item.priceObservedAt!)))).toBe(true);
    expect(items.map(({priceObservedAt, ...item}) => item)).toEqual([
      {
        appId: 10,
        name: 'Birinci Oyun',
        priority: 2,
        dateAdded: 1_700_000_000,
        price: {
          currency: 'TRY',
          initialMinor: 1_000,
          finalMinor: 500,
          discountPercent: 50,
          isFree: false,
        },
        onSale: true,
      },
      {
        appId: 20,
        name: 'İkinci Oyun',
        priority: 1,
        dateAdded: 1_700_000_001,
        price: {
          currency: 'EUR',
          initialMinor: 999,
          finalMinor: 999,
          discountPercent: 0,
          isFree: false,
        },
        onSale: false,
      },
    ]);

    const wishlistUrl = String(fetchMock.mock.calls[0][0]);
    expect(wishlistUrl).toBe(
      'https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=76561198000000000',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const appDetailsUrl = new URL(String(fetchMock.mock.calls.find(call => isRoute(call, 'appdetails'))![0]));
    expect(appDetailsUrl.origin + appDetailsUrl.pathname).toBe(
      'https://store.steampowered.com/api/appdetails',
    );
    expect(appDetailsUrl.searchParams.get('appids')).toBe('10,20');
    expect(appDetailsUrl.searchParams.get('cc')).toBe('TR');
    const itemsUrl = new URL(String(fetchMock.mock.calls.find(call => isRoute(call, 'GetItems'))![0]));
    expect(JSON.parse(itemsUrl.searchParams.get('input_json')!)).toMatchObject({
      ids: [{ appid: 10 }, { appid: 20 }],
      context: { language: 'turkish', country_code: 'TR' },
    });
  });

  it('splits large wishlists into 100-app batches for both Steam endpoints', async () => {
    const appIds = Array.from({ length: 250 }, (_, index) => index + 1);
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse(appIds),
      prices: (ids) => jsonResponse(Object.fromEntries(ids.map(id => [id, priceOverview('USD', 1_000, 500, 50)]))),
    });

    const result = await new SteamClient({ fetchImpl: fetchMock })
      .getWishlistWithErrors('76561198000000000', 'US', 'en');

    expect(result.items).toHaveLength(250);
    expect(result.errors).toEqual([]);
    const priceBatches = fetchMock.mock.calls.filter(call => isRoute(call, 'appdetails'))
      .map(call => new URL(String(call[0])).searchParams.get('appids')!.split(',').length);
    const itemBatches = fetchMock.mock.calls.filter(call => isRoute(call, 'GetItems'))
      .map(call => JSON.parse(new URL(String(call[0])).searchParams.get('input_json')!).ids.length);
    expect(priceBatches.sort()).toEqual([100, 100, 50].sort());
    expect(itemBatches.sort()).toEqual([100, 100, 50].sort());
  });

  it('shares in-flight batches between overlapping wishlists', async () => {
    const fetchMock = routeSteam({
      wishlist: (url) => wishlistResponse(url.searchParams.get('steamid')!.endsWith('0') ? [1, 2] : [2, 3]),
      prices: (ids) => jsonResponse(Object.fromEntries(ids.map(id => [id, priceOverview('USD', 1_000, 500, 50)]))),
    });
    const client = new SteamClient({ fetchImpl: fetchMock });

    await Promise.all([
      client.getWishlist('76561198000000000', 'US', 'en'),
      client.getWishlist('76561198000000001', 'US', 'en'),
    ]);

    const requested = fetchMock.mock.calls.filter(call => isRoute(call, 'appdetails'))
      .flatMap(call => new URL(String(call[0])).searchParams.get('appids')!.split(',').map(Number));
    expect(requested.sort()).toEqual([1, 2, 3]);
  });

  it('isolates a failed batch to its own games', async () => {
    const appIds = Array.from({ length: 150 }, (_, index) => index + 1);
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse(appIds),
      prices: (ids) => ids.includes(1)
        ? new Response('', { status: 503 })
        : jsonResponse(Object.fromEntries(ids.map(id => [id, priceOverview('USD', 1_000, 1_000, 0)]))),
    });

    const result = await new SteamClient({ fetchImpl: fetchMock })
      .getWishlistWithErrors('76561198000000000', 'US', 'en');

    expect(result.items).toHaveLength(50);
    expect(result.errors).toHaveLength(100);
    expect(new Set(result.errors.map(error => error.code))).toEqual(new Set(['STEAM_UPSTREAM_ERROR']));
  });

  it('prefers a listed price over a free flag', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10]),
      items: () => storeItemsResponse([storeItem(10, { is_free: true })]),
      prices: () => jsonResponse({ '10': priceOverview('USD', 1_000, 500, 50) }),
    });

    await expect(new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'US', 'en'))
      .resolves.toMatchObject([{ onSale: true, price: { isFree: false, finalMinor: 500 } }]);
  });

  it('reports games missing from Steam metadata or price batches as item errors', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10, 20, 30, 40]),
      items: () => storeItemsResponse([
        storeItem(10),
        storeItem(20, { success: 15, name: '' }),
        storeItem(40),
      ]),
      prices: () => jsonResponse({ '10': { success: false }, '20': unpriced, '30': unpriced }),
    });

    await expect(new SteamClient({ fetchImpl: fetchMock })
      .getWishlistWithErrors('76561198000000000', 'US', 'en'))
      .resolves.toEqual({
        items: [],
        errors: [
          { appId: 10, code: 'STEAM_APP_NOT_FOUND' },
          { appId: 20, code: 'STEAM_APP_NOT_FOUND' },
          { appId: 30, code: 'STEAM_SCHEMA_INVALID' },
          { appId: 40, code: 'STEAM_SCHEMA_INVALID' },
        ],
      });
  });

  it('returns an empty wishlist for an empty response object', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: {} }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a private or inaccessible wishlist without treating it as empty', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: {} }, 200, '15'),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({
      code: 'STEAM_WISHLIST_INACCESSIBLE',
      status: 200,
    });
  });

  it('fails closed when Steam omits the wishlist access result', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      new Response(JSON.stringify({ response: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({ code: 'STEAM_INVALID_RESPONSE' });
  });

  it('validates wishlist access without loading app details', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: { items: [{ appid: 10 }] } }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).validateWishlistAccess('76561198000000000'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('continues processing when one game is unavailable in a batch', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10, 20]),
      items: () => storeItemsResponse([storeItem(10), storeItem(20, { name: 'Başarılı Oyun' })]),
      prices: () => jsonResponse({ '10': { success: false }, '20': priceOverview('TRY', 1_000, 500, 50) }),
    });

    await expect(
      new SteamClient({ fetchImpl: fetchMock, maxConcurrency: 1 }).getWishlistWithErrors(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).resolves.toMatchObject({
      items: [{ appId: 20, name: 'Başarılı Oyun' }],
      errors: [{ appId: 10, code: 'STEAM_APP_NOT_FOUND' }],
    });
  });

  it('marks missing price_overview as unknown instead of not on sale', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([30]),
      items: () => storeItemsResponse([storeItem(30, { name: 'Fiyatı Olmayan Oyun' })]),
      prices: () => jsonResponse({ '30': unpriced }),
    });

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).resolves.toMatchObject([
      { appId: 30, price: null, onSale: null },
    ]);
  });

  it('represents free games as known non-sale prices', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([40]),
      items: () => storeItemsResponse([storeItem(40, { name: 'Ücretsiz Oyun', is_free: true })]),
      prices: () => jsonResponse({ '40': unpriced }),
    });

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).resolves.toMatchObject([
      {
        appId: 40,
        price: {
          currency: null,
          initialMinor: 0,
          finalMinor: 0,
          discountPercent: 0,
          isFree: true,
        },
        onSale: false,
      },
    ]);
  });

  it('maps HTTP 429 and preserves Retry-After', async () => {
    const limiter = new SteamRequestLimiter(1, vi.fn().mockResolvedValue(undefined));
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      new Response('', {
        status: 429,
        headers: { 'retry-after': '12' },
      }),
    );

    try {
      await new SteamClient({ fetchImpl: fetchMock, maxRetries: 0, requestLimiter: limiter }).getWishlist(
        '76561198000000000',
        'TR',
        'tr',
      );
      expect.fail('Expected a SteamWishlistError');
    } catch (error: unknown) {
      expectSteamError(error, 'STEAM_RATE_LIMITED');
      expect((error as SteamWishlistError).status).toBe(429);
      expect((error as SteamWishlistError).retryAfterSeconds).toBe(12);
    }
  });

  it('caps Retry-After before retrying a rate-limited request', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const limiter = new SteamRequestLimiter(1, sleep);
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response('', {
        status: 429,
        headers: { 'retry-after': '300' },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: {} }));

    await expect(
      new SteamClient({ fetchImpl: fetchMock, maxRetries: 1, requestLimiter: limiter }).getWishlist(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(60_000, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('pauses queued global requests while Retry-After is active', async () => {
    let releaseBackoff: (() => void) | undefined;
    const sleep = vi.fn(
      () => new Promise<void>((resolve) => {
        releaseBackoff = resolve;
      }),
    );
    const limiter = new SteamRequestLimiter(1, sleep);
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(new Response('', {
        status: 429,
        headers: { 'retry-after': '10' },
      }))
      .mockImplementation(() => Promise.resolve(jsonResponse({ response: {} })));
    const first = new SteamClient({ fetchImpl: fetchMock, maxRetries: 1, requestLimiter: limiter })
      .getWishlist('76561198000000000', 'TR', 'tr');
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(10_000, undefined));
    const second = new SteamClient({ fetchImpl: fetchMock, requestLimiter: limiter })
      .getWishlist('76561198000000001', 'TR', 'tr');
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseBackoff?.();
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('observes a Retry-After pause installed while a request awaits an older pause', async () => {
    const releases: Array<() => void> = [];
    const sleep = vi.fn(
      () => new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
    );
    const limiter = new SteamRequestLimiter(1, sleep);
    const operation = vi.fn().mockResolvedValue(undefined);

    limiter.deferFor(1_000);
    const running = limiter.run(operation);
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    limiter.deferFor(2_000);
    releases[0]?.();
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(operation).not.toHaveBeenCalled();
    releases[1]?.();
    await running;
    expect(operation).toHaveBeenCalledOnce();
  });

  it('shares a global request concurrency limiter across clients', async () => {
    const limiter = new SteamRequestLimiter(1);
    const releases: Array<() => void> = [];
    let activeCount = 0;
    let maximumActiveCount = 0;
    const fetchMock = createFetchMock().mockImplementation(
      () => new Promise<Response>((resolve) => {
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        releases.push(() => {
          activeCount -= 1;
          resolve(jsonResponse({ response: {} }));
        });
      }),
    );
    const first = new SteamClient({ fetchImpl: fetchMock, requestLimiter: limiter })
      .getWishlist('76561198000000000', 'TR', 'tr');
    const second = new SteamClient({ fetchImpl: fetchMock, requestLimiter: limiter })
      .getWishlist('76561198000000001', 'TR', 'tr');
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.();

    await Promise.all([first, second]);
    expect(maximumActiveCount).toBe(1);
  });

  it('maps HTTP 5xx to an upstream error', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      new Response('', { status: 503 }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({
      code: 'STEAM_UPSTREAM_ERROR',
      status: 503,
    });
  });

  it('maps a network failure', async () => {
    const fetchMock = createFetchMock().mockRejectedValueOnce(new Error('offline'));

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({ code: 'STEAM_NETWORK_ERROR' });
  });

  it('does not downgrade an internal appdetails worker failure to a network error', async () => {
    let requestCount = 0;
    const requestLimiter = {
      run: async <T>(operation: () => Promise<T>): Promise<T> => {
        requestCount += 1;
        if (requestCount === 2) {
          throw new Error('limiter defect');
        }
        return operation();
      },
      deferFor: vi.fn(),
    };
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: { items: [{ appid: 10 }] } }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock, requestLimiter }).getWishlistWithErrors(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).rejects.toThrow('limiter defect');
  });

  it('maps an aborted request to a timeout error', async () => {
    const fetchMock = createFetchMock().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock, timeoutMs: 5 }).getWishlist(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).rejects.toMatchObject({ code: 'STEAM_TIMEOUT' });
  });

  it('enforces the timeout if a fetch implementation ignores abort', async () => {
    const fetchMock = createFetchMock().mockImplementation(
      () => new Promise<Response>(() => undefined),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock, timeoutMs: 5 }).getWishlist(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).rejects.toMatchObject({ code: 'STEAM_TIMEOUT' });
  });

  it('cancels active Steam work during application shutdown', async () => {
    const lifecycle = new AbortController();
    const fetchMock = createFetchMock().mockImplementation(
      () => new Promise<Response>(() => undefined),
    );
    const request = new SteamClient({
      fetchImpl: fetchMock,
      lifecycleSignal: lifecycle.signal,
    }).getWishlist('76561198000000000', 'TR', 'tr');
    const rejection = expect(request).rejects.toMatchObject({ code: 'STEAM_CANCELLED' });
    lifecycle.abort();

    await rejection;
  });

  it('rejects a partially loaded wishlist when app-detail work is cancelled', async () => {
    const lifecycle = new AbortController();
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10, 20]),
      prices: () => new Promise<Response>(() => undefined),
    });
    const request = new SteamClient({
      fetchImpl: fetchMock,
      maxConcurrency: 1,
      lifecycleSignal: lifecycle.signal,
    }).getWishlistWithErrors('76561198000000000', 'TR', 'tr');
    const rejection = expect(request).rejects.toMatchObject({ code: 'STEAM_CANCELLED' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    lifecycle.abort();

    await rejection;
  });

  it('removes cancelled limiter waiters without losing capacity', async () => {
    const limiter = new SteamRequestLimiter(1);
    let releaseFirst: (() => void) | undefined;
    const first = limiter.run(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    const lifecycle = new AbortController();
    const secondOperation = vi.fn().mockResolvedValue(undefined);
    const second = limiter.run(secondOperation, lifecycle.signal);
    const rejection = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    lifecycle.abort();
    await rejection;
    releaseFirst?.();
    await first;

    const thirdOperation = vi.fn().mockResolvedValue(undefined);
    await limiter.run(thirdOperation);
    expect(secondOperation).not.toHaveBeenCalled();
    expect(thirdOperation).toHaveBeenCalledOnce();
  });

  it('rejects HTML or malformed JSON responses', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      new Response('<html>Steam</html>', {
        status: 200,
        headers: { 'x-eresult': '1' },
      }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({ code: 'STEAM_INVALID_RESPONSE' });
  });

  it('rejects unexpected wishlist schemas', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: { items: [{ appid: 'not-a-number' }] } }),
    );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).rejects.toMatchObject({ code: 'STEAM_SCHEMA_INVALID' });
  });

  it('marks a complete metadata schema outage unavailable', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([50]),
      items: () => storeItemsResponse([{ id: 50, success: 1 }]),
    });

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlistWithErrors(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).resolves.toEqual({
      items: [],
      errors: [{ appId: 50, code: 'STEAM_SCHEMA_INVALID' }],
    });
  });

  it('rejects malformed currency metadata before it reaches notification formatting', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([50]),
      prices: () => jsonResponse({ '50': priceOverview('not-a-currency', 1_000, 500, 50) }),
    });

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlistWithErrors(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).resolves.toEqual({
      items: [],
      errors: [{ appId: 50, code: 'STEAM_SCHEMA_INVALID' }],
    });
  });

  it('cancels immediately while a response body ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const lifecycle = new AbortController();
      const response = jsonResponse({ response: {} });
      const readBody = vi.spyOn(response, 'json').mockReturnValue(new Promise(() => undefined));
      let outcome: unknown;
      const request = new SteamClient({
        fetchImpl: createFetchMock().mockResolvedValue(response),
        lifecycleSignal: lifecycle.signal,
        timeoutMs: 500,
      }).getWishlist('76561198000000000', 'TR', 'tr')
        .catch((error: unknown) => { outcome = error; });
      await vi.advanceTimersByTimeAsync(0);
      expect(readBody).toHaveBeenCalledOnce();
      lifecycle.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toMatchObject({ code: 'STEAM_CANCELLED' });
      await request;
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it.each([
    { initial: 1000, final: 1200, discount_percent: 50 },
    { initial: 1000, final: 1000, discount_percent: 50 },
    { initial: 1000, final: 500, discount_percent: 0 },
    { initial: 1000, final: 500, discount_percent: 100 },
  ])('rejects contradictory price metadata: %j', async (price) => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10]),
      prices: () => jsonResponse({ '10': priceOverview('USD', price.initial, price.final, price.discount_percent) }),
    });
    await expect(new SteamClient({ fetchImpl: fetchMock })
      .getWishlistWithErrors('76561198000000000', 'US', 'en'))
      .resolves.toEqual({ items: [], errors: [{ appId: 10, code: 'STEAM_SCHEMA_INVALID' }] });
  });

  it('keeps a real 100 percent discount distinct from permanently free games', async () => {
    const fetchMock = routeSteam({
      wishlist: () => wishlistResponse([10]),
      items: () => storeItemsResponse([storeItem(10, { name: 'Giveaway', is_free: false })]),
      prices: () => jsonResponse({ '10': priceOverview('USD', 1000, 0, 100) }),
    });
    await expect(new SteamClient({ fetchImpl: fetchMock })
      .getWishlist('76561198000000000', 'US', 'en'))
      .resolves.toMatchObject([{ onSale: true, price: { isFree: false, finalMinor: 0 } }]);
  });

  it('URL encodes the SteamID64 before requesting the wishlist', async () => {
    const fetchMock = createFetchMock().mockResolvedValueOnce(
      jsonResponse({ response: {} }),
    );

    await new SteamClient({ fetchImpl: fetchMock }).getWishlist(
      '76561198000000000',
      'TR',
      'tr',
    );

    expect(fetchMock.mock.calls[0][0]).toContain('steamid=76561198000000000');
  });
});
