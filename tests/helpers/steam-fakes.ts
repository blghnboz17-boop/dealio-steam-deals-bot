import { vi } from 'vitest';
import type { SteamFetch } from '../../src/steam/steam-client.js';

export function jsonResponse(value: unknown, status = 200, result = '1'): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'x-eresult': result },
  });
}

export function wishlistResponse(appIds: readonly number[]): Response {
  return jsonResponse({ response: { items: appIds.map((appid) => ({ appid })) } });
}

/** A GetItems store item; pass `undefined` fields to omit them. */
export function storeItem(appId: number, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: appId, appid: appId, success: 1, visible: true, name: `Game ${appId}`, ...fields };
}

export function priceOverview(
  currency: string,
  initial: number,
  final: number,
  discountPercent: number,
): Record<string, unknown> {
  return { success: true, data: { price_overview: { currency, initial, final, discount_percent: discountPercent } } };
}

export const unpriced = { success: true, data: [] } as const;

type Route = (appIds: number[], url: URL) => Response | Promise<Response>;

export interface SteamRoutes {
  readonly wishlist?: (url: URL) => Response | Promise<Response>;
  /** Defaults to a named, visible store item for every requested app. */
  readonly items?: Route;
  /** Defaults to an unpriced entry for every requested app. */
  readonly prices?: Route;
}

/** Routes fake Steam traffic by URL, so tests do not depend on request ordering. */
export function routeSteam(routes: SteamRoutes) {
  return vi.fn<SteamFetch>(async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('GetWishlist')) {
      if (!routes.wishlist) throw new Error('Unexpected wishlist request');
      return routes.wishlist(url);
    }
    if (url.pathname.includes('GetItems')) {
      const ids = (JSON.parse(url.searchParams.get('input_json')!) as { ids: Array<{ appid: number }> })
        .ids.map(({ appid }) => appid);
      return routes.items
        ? routes.items(ids, url)
        : jsonResponse({ response: { store_items: ids.map((appId) => storeItem(appId)) } });
    }
    if (url.pathname.endsWith('/appdetails')) {
      const ids = url.searchParams.get('appids')!.split(',').map(Number);
      return routes.prices
        ? routes.prices(ids, url)
        : jsonResponse(Object.fromEntries(ids.map((appId) => [appId, unpriced])));
    }
    throw new Error(`Unexpected Steam route ${url.pathname}`);
  });
}

export function storeItemsResponse(items: ReadonlyArray<Record<string, unknown>>): Response {
  return jsonResponse({ response: { store_items: items } });
}

export function isRoute(call: readonly unknown[], route: 'GetItems' | 'appdetails' | 'GetWishlist'): boolean {
  return String(call[0]).includes(route);
}
