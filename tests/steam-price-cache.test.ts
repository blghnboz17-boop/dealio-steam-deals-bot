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

it('never serves a price cached before Steam\'s daily price change after it', async () => {
  let now = Date.parse('2026-10-07T16:58:00Z');
  let discount = 0;
  const fetch = routeSteam({
    wishlist: () => wishlistResponse([10]),
    prices: () => jsonResponse({ '10': priceOverview('USD', 1000, 1000 - discount * 10, discount) }),
  });
  const client = new SteamClient({ fetchImpl: fetch, now: () => now, maxRetries: 0 });
  const prices = () => fetch.mock.calls.filter(call => isRoute(call, 'appdetails')).length;

  expect((await client.getWishlist('76561198000000000', 'TR', 'en'))[0].onSale).toBe(false);
  now = Date.parse('2026-10-07T16:59:30Z');
  await client.getWishlist('76561198000000000', 'TR', 'en');
  expect(prices()).toBe(1);

  // 10:00 Pacific: the sale starts well inside the five-minute TTL of the cached price.
  discount = 50;
  now = Date.parse('2026-10-07T17:00:30Z');
  const afterChange = await client.getWishlist('76561198000000000', 'TR', 'en');
  expect(prices()).toBe(2);
  expect(afterChange[0]).toMatchObject({ onSale: true, price: { discountPercent: 50 } });
});
