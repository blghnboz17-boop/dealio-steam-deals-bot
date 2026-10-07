import { describe, expect, it, vi } from 'vitest';
import { SteamIdentityError } from '../src/domain/steam-identity.js';
import {
  parseSteamProfileInput,
  SteamIdentityResolver,
} from '../src/steam/steam-identity-resolver.js';
import type { SteamFetch } from '../src/steam/steam-client.js';

const steamId64 = '76561198000000000';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchMock(): ReturnType<typeof vi.fn<SteamFetch>> {
  return vi.fn<SteamFetch>();
}

function expectIdentityCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SteamIdentityError);
  expect((error as SteamIdentityError).code).toBe(code);
}

describe('Steam profile input parsing', () => {
  it('accepts a numeric SteamID64 without a URL', () => {
    expect(parseSteamProfileInput(`  ${steamId64}  `)).toEqual({
      type: 'steam-id',
      steamId64,
    });
  });

  it.each([
    `https://steamcommunity.com/profiles/${steamId64}`,
    `http://steamcommunity.com/profiles/${steamId64}/`,
    `steamcommunity.com/profiles/${steamId64}`,
    `HTTPS://STEAMCOMMUNITY.COM/PROFILES/${steamId64}/?utm_source=test#profile`,
    // Links users copy from other pages: a sub-page, the www host, the Store wishlist.
    `https://steamcommunity.com/profiles/${steamId64}/wishlist/`,
    `https://www.steamcommunity.com/profiles/${steamId64}`,
    `www.steamcommunity.com/profiles/${steamId64}/games/?tab=all`,
    `https://store.steampowered.com/wishlist/profiles/${steamId64}/#sort=order`,
    `store.steampowered.com/wishlist/profiles/${steamId64}`,
  ])('normalizes a safe profiles URL without a network request: %s', (input) => {
    expect(parseSteamProfileInput(input)).toEqual({ type: 'steam-id', steamId64 });
  });

  it.each([
    ['https://steamcommunity.com/id/Example_Name/', 'example_name'],
    ['steamcommunity.com/id/example-name?x=1#top', 'example-name'],
    ['Bare_Vanity', 'bare_vanity'],
    ['https://steamcommunity.com/id/Example_Name/wishlist', 'example_name'],
    ['https://store.steampowered.com/wishlist/id/Example_Name/', 'example_name'],
  ])('normalizes vanity input %s', (input, vanityName) => {
    expect(parseSteamProfileInput(input)).toEqual({ type: 'vanity', vanityName });
  });

  it.each([
    '1234567890123456',
    'https://example.com/id/safe-name',
    'https://steamcommunity.com.evil.example/id/safe-name',
    'javascript:alert(1)',
    'https://user:password@steamcommunity.com/id/safe-name',
    'https://steamcommunity.com:444/id/safe-name',
    'https://steamcommunity.com/id/',
    'https://steamcommunity.com/id/foo/../evil',
    'https://steamcommunity.com/id/foo%2fbar',
    'https://steamcommunity.com/id/bad.name',
    'bad name',
    'https://steamcommunity.com/id/safe\nname',
    'a',
    // 17 digits that are not a personal account cannot own a wishlist.
    '12345678901234567',
    '76561197960265728',
    `https://steamcommunity.com/profiles/76561202255233024`,
    'https://store.steampowered.com/app/220/',
    `https://store.steampowered.com/wishlist/profiles/${steamId64}/extra`,
    `https://store.steampowered.com/profiles/${steamId64}`,
    `https://steamcommunity.com/id/foo/bad.page`,
    `https://help.steampowered.com/wishlist/profiles/${steamId64}`,
  ])('rejects unsafe or invalid input: %s', (input) => {
    expect(() => parseSteamProfileInput(input)).toThrowError(
      expect.objectContaining({ code: 'STEAM_PROFILE_INVALID' }),
    );
  });
});

describe('SteamIdentityResolver', () => {
  it('resolves numeric and profiles inputs without fetch or API key', async () => {
    const fetchImpl = fetchMock();
    const limiter = { run: vi.fn() };
    const resolver = new SteamIdentityResolver({ fetchImpl, requestLimiter: limiter });

    await expect(resolver.resolve(steamId64)).resolves.toBe(steamId64);
    await expect(resolver.resolve(
      `https://steamcommunity.com/profiles/${steamId64}`,
    )).resolves.toBe(steamId64);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(limiter.run).not.toHaveBeenCalled();
  });

  it('uses only the official HTTPS endpoint and validates a successful response', async () => {
    const fetchImpl = fetchMock().mockResolvedValue(jsonResponse({
      response: { success: 1, steamid: steamId64 },
    }));
    const limiter = {
      run: vi.fn(async (operation: () => Promise<Response | string>) => operation()),
    };
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl,
      requestLimiter: limiter,
    });

    await expect(resolver.resolve('Example_Name')).resolves.toBe(steamId64);
    const requestUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/',
    );
    expect(requestUrl.searchParams.get('key')).toBe('secret-api-key');
    expect(requestUrl.searchParams.get('vanityurl')).toBe('example_name');
    expect(limiter.run).toHaveBeenCalledOnce();
  });

  it.each([
    { response: { success: 42 } },
    { response: { success: false } },
  ])('returns a typed not-found error for an unresolved vanity', async (payload) => {
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl: fetchMock().mockResolvedValue(jsonResponse(payload)),
    });
    await resolver.resolve('missing-name').catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_VANITY_NOT_FOUND');
    });
  });

  it.each([
    {},
    { response: null },
    { response: { success: 1 } },
    { response: { success: 1, steamid: '123' } },
    { response: { success: '1', steamid: steamId64 } },
  ])('fails closed for malformed API responses', async (payload) => {
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl: fetchMock().mockResolvedValue(jsonResponse(payload)),
    });
    await resolver.resolve('valid-name').catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_VANITY_UNAVAILABLE');
    });
  });

  it('requires the optional API key only when vanity resolution is requested', async () => {
    const resolver = new SteamIdentityResolver();
    await resolver.resolve('valid-name').catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_WEB_API_KEY_MISSING');
    });
    await expect(resolver.resolve(steamId64)).resolves.toBe(steamId64);
  });

  it('maps network, HTTP, and timeout failures to a safe unavailable error', async () => {
    const failures: SteamFetch[] = [
      fetchMock().mockRejectedValue(new Error('network secret')),
      fetchMock().mockResolvedValue(new Response('', { status: 503 })),
      fetchMock().mockReturnValue(new Promise(() => undefined)),
    ];
    for (const fetchImpl of failures) {
      const resolver = new SteamIdentityResolver({
        apiKey: 'secret-api-key',
        fetchImpl,
        timeoutMs: 5,
      });
      await resolver.resolve('valid-name').catch((error: unknown) => {
        expectIdentityCode(error, 'STEAM_VANITY_UNAVAILABLE');
        expect(String((error as Error).message)).not.toContain('secret-api-key');
        expect(String((error as Error).message)).not.toContain('network secret');
        expect(String((error as Error).message)).not.toContain('ResolveVanityURL');
      });
    }
  });

  it('cancels promptly through the shared lifecycle signal', async () => {
    const lifecycle = new AbortController();
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl: fetchMock().mockReturnValue(new Promise(() => undefined)),
      lifecycleSignal: lifecycle.signal,
    });
    const resolving = resolver.resolve('valid-name');
    lifecycle.abort();
    await resolving.catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_IDENTITY_CANCELLED');
    });
  });

  it('does not start fetch when cancellation happens at the limiter handoff', async () => {
    const lifecycle = new AbortController();
    const fetchImpl = fetchMock();
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl,
      lifecycleSignal: lifecycle.signal,
      requestLimiter: {
        run: vi.fn(async (operation: () => Promise<string>) => {
          lifecycle.abort();
          return operation();
        }),
      },
    });

    await resolver.resolve('valid-name').catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_IDENTITY_CANCELLED');
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('releases the connection of an error response it does not read', async () => {
    const failed = new Response('busy', { status: 503 });
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl: fetchMock().mockResolvedValue(failed),
    });

    await resolver.resolve('valid-name').catch((error: unknown) => {
      expectIdentityCode(error, 'STEAM_VANITY_UNAVAILABLE');
    });
    expect(failed.bodyUsed).toBe(true);
  });

  it('does not log API keys, vanity input, or request URLs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const resolver = new SteamIdentityResolver({
      apiKey: 'secret-api-key',
      fetchImpl: fetchMock().mockRejectedValue(new Error('request failed')),
    });
    try {
      await expect(resolver.resolve('private-vanity')).rejects.toBeInstanceOf(SteamIdentityError);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('Steam profile summary', () => {
  const player = (overrides: Record<string, unknown> = {}) => jsonResponse({ response: { players: [{
    steamid: steamId64, personaname: '  Gabe\u0007N  ', avatarfull: 'https://avatars.steamstatic.com/abc_full.jpg', ...overrides,
  }] } });

  it('reads the persona name and avatar with the Web API key', async () => {
    const fetchImpl = fetchMock().mockResolvedValue(player());
    const resolver = new SteamIdentityResolver({ apiKey: 'key', fetchImpl });
    await expect(resolver.summary(steamId64)).resolves.toEqual({
      personaName: 'Gabe N', avatarUrl: 'https://avatars.steamstatic.com/abc_full.jpg',
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('GetPlayerSummaries');
  });

  it('drops an avatar outside Steam’s image hosts but keeps the name', async () => {
    const resolver = new SteamIdentityResolver({ apiKey: 'key', fetchImpl: fetchMock().mockResolvedValue(player({ avatarfull: 'https://evil.example/a.jpg' })) });
    await expect(resolver.summary(steamId64)).resolves.toEqual({ personaName: 'Gabe N' });
  });

  it.each([
    ['no API key', undefined, () => player()],
    ['a Steam error', 'key', () => jsonResponse({}, 500)],
    ['another account', 'key', () => player({ steamid: '76561198000000001' })],
    ['an empty name', 'key', () => player({ personaname: '   ' })],
  ] as const)('returns null for %s, never an error', async (_case, apiKey, response) => {
    const resolver = new SteamIdentityResolver({ ...(apiKey ? { apiKey } : {}), fetchImpl: fetchMock().mockImplementation(async () => response()) });
    await expect(resolver.summary(steamId64)).resolves.toBeNull();
  });

  it('gives up within the timeout', async () => {
    const resolver = new SteamIdentityResolver({ apiKey: 'key', timeoutMs: 10, fetchImpl: fetchMock().mockReturnValue(new Promise(() => undefined)) });
    await expect(resolver.summary(steamId64)).resolves.toBeNull();
  });
});
