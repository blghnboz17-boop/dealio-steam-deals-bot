import { it, expect } from 'vitest';
import { SteamClient } from '../src/steam/steam-client.js';
import { isRoute, jsonResponse, priceOverview, routeSteam, wishlistResponse } from './helpers/steam-fakes.js';

function fixture() {
  let now = Date.parse('2026-09-12T00:00:00Z'), fail = false;
  const fetch = routeSteam({
    wishlist: () => wishlistResponse([10]),
    prices: () => fail ? new Response('{}', { status: 503 }) : jsonResponse({ '10': priceOverview('USD', 1000, 500, 50) }),
  });
  const client = new SteamClient({ fetchImpl: fetch, now: () => now, maxRetries: 0 });
  const count = (route: 'GetItems' | 'appdetails') => fetch.mock.calls.filter(call => isRoute(call, route)).length;
  return { client, count, advance: () => { now += 300001; }, fail: () => { fail = true; }, recover: () => { fail = false; } };
}

it('coalesces simultaneous users by app/country and preserves price observation time', async () => {
  const f = fixture();
  const [one, two] = await Promise.all([f.client.getWishlist('76561198000000000', 'TR', 'en'), f.client.getWishlist('76561198000000001', 'TR', 'en')]);
  expect(f.count('appdetails')).toBe(1);
  expect(one[0].priceObservedAt).toBe(two[0].priceObservedAt);
  // Prices do not depend on text language; game names do.
  await f.client.getWishlist('76561198000000000', 'TR', 'tr');
  expect(f.count('appdetails')).toBe(1);
  expect(f.count('GetItems')).toBe(2);
  await f.client.getWishlist('76561198000000000', 'US', 'en');
  expect(f.count('appdetails')).toBe(2);
  f.advance(); const renewed = await f.client.getWishlist('76561198000000000', 'TR', 'en');
  expect(renewed[0].priceObservedAt).not.toBe(one[0].priceObservedAt);
  expect(f.count('appdetails')).toBe(3);
});

it('does not cache failures or reuse an expired price on a failed refresh', async () => {
  const f = fixture(); await f.client.getWishlist('76561198000000000', 'TR', 'en'); f.advance(); f.fail();
  const failed = await f.client.getWishlistWithErrors('76561198000000000', 'TR', 'en');
  expect(failed.items).toHaveLength(0); expect(failed.errors).toHaveLength(1);
  f.recover(); expect((await f.client.getWishlist('76561198000000000', 'TR', 'en'))).toHaveLength(1);
});

it('keeps game metadata cached for longer than prices', async () => {
  const f = fixture();
  await f.client.getWishlist('76561198000000000', 'TR', 'en');
  f.advance();
  await f.client.getWishlist('76561198000000000', 'TR', 'en');
  expect(f.count('appdetails')).toBe(2);
  expect(f.count('GetItems')).toBe(1);
});
