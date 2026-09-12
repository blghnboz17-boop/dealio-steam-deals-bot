import { describe, expect, it, vi } from 'vitest';
import {
  SteamClient,
  type SteamFetch,
} from '../src/steam/steam-client.js';
import { SteamWishlistError } from '../src/domain/steam.js';
import { SteamRequestLimiter } from '../src/steam/request-limiter.js';

function jsonResponse(value: unknown, status = 200, result = '1'): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-eresult': result },
  });
}

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
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 10 }] } }))
      .mockResolvedValueOnce(jsonResponse({
        '10': {
          success: true,
          data: {
            steam_appid: 10,
            name: 'Regional Game',
            is_free: false,
            price_overview: {
              currency: 'USD',
              initial: 2_000,
              final: 1_000,
              discount_percent: 50,
            },
          },
        },
      }));

    const result = await new SteamClient({ fetchImpl: fetchMock })
      .getWishlist('76561198000000000', 'US', 'en');
    const appDetailsUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));

    expect(appDetailsUrl.searchParams.get('cc')).toBe('US');
    expect(appDetailsUrl.searchParams.get('l')).toBe('english');
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

  it('loads wishlist items and normalizes appdetails prices', async () => {
    const fetchMock = createFetchMock();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          response: {
            items: [
              { appid: 10, priority: 2, date_added: 1_700_000_000 },
              { appid: 20, priority: 1, date_added: 1_700_000_001 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          '10': {
            success: true,
            data: {
              steam_appid: 10,
              name: 'Birinci Oyun',
              is_free: false,
              price_overview: {
                currency: 'TRY',
                initial: 1_000,
                final: 500,
                discount_percent: 50,
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          '20': {
            success: true,
            data: {
              steam_appid: 20,
              name: 'İkinci Oyun',
              is_free: false,
              price_overview: {
                currency: 'EUR',
                initial: 999,
                final: 999,
                discount_percent: 0,
              },
            },
          },
        }),
      );

    const client = new SteamClient({ fetchImpl: fetchMock });
    const items = await client.getWishlist('76561198000000000', 'TR', 'tr');

    expect(items).toEqual([
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

    const appDetailsUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(appDetailsUrl.origin + appDetailsUrl.pathname).toBe(
      'https://store.steampowered.com/api/appdetails',
    );
    expect(appDetailsUrl.searchParams.get('appids')).toBe('10');
    expect(appDetailsUrl.searchParams.get('cc')).toBe('TR');
    expect(appDetailsUrl.searchParams.get('l')).toBe('turkish');
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

  it('continues processing when one appdetails request fails', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          response: { items: [{ appid: 10 }, { appid: 20 }] },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({
          '20': {
            success: true,
            data: {
              steam_appid: 20,
              name: 'Başarılı Oyun',
              is_free: false,
              price_overview: {
                currency: 'TRY',
                initial: 1_000,
                final: 500,
                discount_percent: 50,
              },
            },
          },
        }),
      );

    await expect(
      new SteamClient({ fetchImpl: fetchMock, maxConcurrency: 1 }).getWishlistWithErrors(
        '76561198000000000',
        'TR',
        'tr',
      ),
    ).resolves.toMatchObject({
      items: [{ appId: 20, name: 'Başarılı Oyun' }],
      errors: [{ appId: 10, code: 'STEAM_UPSTREAM_ERROR' }],
    });
  });

  it('marks missing price_overview as unknown instead of not on sale', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 30 }] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          '30': {
            success: true,
            data: {
              steam_appid: 30,
              name: 'Fiyatı Olmayan Oyun',
              is_free: false,
            },
          },
        }),
      );

    await expect(
      new SteamClient({ fetchImpl: fetchMock }).getWishlist('76561198000000000', 'TR', 'tr'),
    ).resolves.toMatchObject([
      { appId: 30, price: null, onSale: null },
    ]);
  });

  it('represents free games as known non-sale prices', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 40 }] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          '40': {
            success: true,
            data: { steam_appid: 40, name: 'Ücretsiz Oyun', is_free: true },
          },
        }),
      );

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
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({
        response: { items: [{ appid: 10 }, { appid: 20 }] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        '10': {
          success: true,
          data: {
            steam_appid: 10,
            name: 'Completed Game',
            is_free: false,
            price_overview: {
              currency: 'TRY',
              initial: 1_000,
              final: 500,
              discount_percent: 50,
            },
          },
        },
      }))
      .mockImplementationOnce(() => new Promise<Response>(() => undefined));
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

  it('marks a complete appdetails schema outage unavailable', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 50 }] } }))
      .mockResolvedValueOnce(jsonResponse({ '50': { success: true, data: {} } }));

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
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 50 }] } }))
      .mockResolvedValueOnce(jsonResponse({
        '50': {
          success: true,
          data: {
            steam_appid: 50,
            name: 'Invalid Currency Game',
            price_overview: {
              currency: 'not-a-currency',
              initial: 1_000,
              final: 500,
              discount_percent: 50,
            },
          },
        },
      }));

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
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 10 }] } }))
      .mockResolvedValueOnce(jsonResponse({
        '10': { success: true, data: {
          steam_appid: 10, name: 'Inconsistent game', is_free: false,
          price_overview: { currency: 'USD', ...price },
        } },
      }));
    await expect(new SteamClient({ fetchImpl: fetchMock })
      .getWishlistWithErrors('76561198000000000', 'US', 'en'))
      .resolves.toEqual({ items: [], errors: [{ appId: 10, code: 'STEAM_SCHEMA_INVALID' }] });
  });

  it('keeps a real 100 percent discount distinct from permanently free games', async () => {
    const fetchMock = createFetchMock()
      .mockResolvedValueOnce(jsonResponse({ response: { items: [{ appid: 10 }] } }))
      .mockResolvedValueOnce(jsonResponse({
        '10': { success: true, data: {
          steam_appid: 10, name: 'Giveaway', is_free: false,
          price_overview: { currency: 'USD', initial: 1000, final: 0, discount_percent: 100 },
        } },
      }));
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
