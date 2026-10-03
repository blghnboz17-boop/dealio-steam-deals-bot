import { steamArtworkUrl } from '../domain/steam-artwork.js';
import {
  SteamWishlistError,
  type SalePrice,
  type StoreFacts,
  type UpcomingRelease,
} from '../domain/steam.js';

interface ParsedWishlistEntry {
  readonly appId: number;
  readonly priority: number | null;
  readonly dateAdded: number | null;
}

export interface ParsedStoreItem {
  readonly headerImageUrl?: string;
  readonly storeFacts?: StoreFacts;
  readonly upcoming?: UpcomingRelease;
  readonly name: string;
  readonly isFree: boolean;
}

/** A batched appdetails price entry; `null` means Steam listed the app without a price. */
export type ParsedPriceEntry = SalePrice | null;

const steamAssetBaseUrl = 'https://shared.akamai.steamstatic.com/store_item_assets/';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(message: string): never {
  throw new SteamWishlistError('STEAM_SCHEMA_INVALID', message);
}

function integerField(
  value: unknown,
  field: string,
  options: { readonly min?: number } = {},
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (options.min !== undefined && value < options.min)
  ) {
    schemaError(`Steam field ${field} must be a safe integer`);
  }

  return value;
}

function optionalIntegerField(
  value: unknown,
  field: string,
  options: { readonly min?: number } = {},
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  return integerField(value, field, options);
}

export function parseWishlistResponse(value: unknown): ParsedWishlistEntry[] {
  if (!isObject(value) || !isObject(value.response)) {
    schemaError('Steam wishlist response must contain an object response field');
  }

  const response = value.response;
  if (response.items === undefined) {
    return [];
  }

  if (!Array.isArray(response.items)) {
    schemaError('Steam wishlist response items must be an array');
  }

  return response.items.map((item, index) => {
    if (!isObject(item)) {
      schemaError(`Steam wishlist item at index ${index} must be an object`);
    }

    return {
      appId: integerField(item.appid, `response.items[${index}].appid`, { min: 1 }),
      priority: optionalIntegerField(item.priority, `response.items[${index}].priority`, {
        min: 0,
      }),
      dateAdded: optionalIntegerField(item.date_added, `response.items[${index}].date_added`, {
        min: 0,
      }),
    };
  });
}

/**
 * Parses one IStoreBrowseService/GetItems batch. Each requested app gets either its
 * metadata or its own error, so one bad entry never hides the rest of the batch.
 */
export function parseStoreItemsResponse(
  value: unknown,
  appIds: readonly number[],
): Map<number, ParsedStoreItem | SteamWishlistError> {
  if (!isObject(value) || !isObject(value.response)) {
    schemaError('Steam GetItems response must contain an object response field');
  }

  const storeItems = value.response.store_items ?? [];
  if (!Array.isArray(storeItems)) {
    schemaError('Steam GetItems store_items must be an array');
  }

  const byAppId = new Map<number, JsonObject>();
  for (const item of storeItems) {
    if (isObject(item) && typeof item.id === 'number') {
      byAppId.set(item.id, item);
    }
  }

  return new Map(appIds.map((appId) => [appId, settle(() => parseStoreItem(byAppId.get(appId), appId))]));
}

function parseStoreItem(item: JsonObject | undefined, appId: number): ParsedStoreItem {
  if (item === undefined) {
    schemaError(`Steam GetItems response is missing app ${appId}`);
  }

  if (item.success !== 1) {
    // Steam still names a region-locked app and flags it; a delisted app is just gone.
    throw item.unvailable_for_country_restriction === true || item.unavailable_for_country_restriction === true
      ? new SteamWishlistError('STEAM_APP_REGION_UNAVAILABLE', `Steam does not sell app ${appId} in this region`)
      : new SteamWishlistError('STEAM_APP_NOT_FOUND', `Steam GetItems did not find app ${appId}`);
  }

  if (typeof item.name !== 'string' || item.name.trim() === '') {
    schemaError(`Steam GetItems name for app ${appId} must be a non-empty string`);
  }

  if (item.is_free !== undefined && typeof item.is_free !== 'boolean') {
    schemaError(`Steam GetItems is_free for app ${appId} must be a boolean`);
  }

  const headerImageUrl = storeItemArtworkUrl(item.assets, appId);
  const storeFacts = parseStoreFacts(item);
  const upcoming = parseUpcomingRelease(item.release);
  return {
    name: item.name,
    isFree: item.is_free === true,
    ...(headerImageUrl ? { headerImageUrl } : {}),
    ...(storeFacts ? { storeFacts } : {}),
    ...(upcoming ? { upcoming } : {}),
  };
}

const releasePrecisions = { date_full: 'day', date_month: 'month', date_quarter: 'quarter', date_year: 'year' } as const;

/** Steam's planned release of a not-yet-released game; undefined once it is out or when malformed. */
export function parseUpcomingRelease(release: unknown): UpcomingRelease | undefined {
  if (!isObject(release) || release.is_coming_soon !== true) return undefined;
  const precision = releasePrecisions[release.coming_soon_display as keyof typeof releasePrecisions];
  const seconds = release.steam_release_date;
  const message = typeof release.custom_release_date_message === 'string'
    ? release.custom_release_date_message.trim().slice(0, 60) : '';
  return {
    ...(precision && Number.isSafeInteger(seconds) && (seconds as number) > 0
      ? { date: new Date((seconds as number) * 1000).toISOString(), precision } : {}),
    ...(message ? { message } : {}),
  };
}

const steamDeckCategories = { 1: 'unsupported', 2: 'playable', 3: 'verified' } as const;

/**
 * Reviews, platforms, Steam Deck support and the discount end from a GetItems
 * entry. This is optional context: malformed or missing parts are left out and
 * never fail the item.
 */
export function parseStoreFacts(item: JsonObject): StoreFacts | undefined {
  const facts: { -readonly [K in keyof StoreFacts]: StoreFacts[K] } = {};
  const reviews = isObject(item.reviews) && isObject(item.reviews.summary_filtered)
    ? item.reviews.summary_filtered : undefined;
  if (reviews && Number.isSafeInteger(reviews.review_count) && (reviews.review_count as number) > 0) {
    facts.reviewCount = reviews.review_count as number;
    if (Number.isSafeInteger(reviews.percent_positive)
      && (reviews.percent_positive as number) >= 0 && (reviews.percent_positive as number) <= 100) {
      facts.reviewPercent = reviews.percent_positive as number;
    }
    if (typeof reviews.review_score_label === 'string' && reviews.review_score_label.trim() !== '') {
      facts.reviewLabel = reviews.review_score_label.trim().slice(0, 60);
    }
  }
  const platforms = isObject(item.platforms) ? item.platforms : undefined;
  if (platforms) {
    const supported = {
      windows: platforms.windows === true,
      mac: platforms.mac === true,
      linux: platforms.steamos_linux === true,
    };
    if (supported.windows || supported.mac || supported.linux) facts.platforms = supported;
    const deck = steamDeckCategories[platforms.steam_deck_compat_category as keyof typeof steamDeckCategories];
    if (deck) facts.steamDeck = deck;
  }
  const discounts = isObject(item.best_purchase_option) && Array.isArray(item.best_purchase_option.active_discounts)
    ? item.best_purchase_option.active_discounts : [];
  const ends = discounts
    .map((discount) => (isObject(discount) ? discount.discount_end_date : undefined))
    .filter((end): end is number => Number.isSafeInteger(end) && (end as number) > 0);
  if (ends.length > 0) facts.saleEndsAt = new Date(Math.min(...ends) * 1000).toISOString();
  return Object.keys(facts).length > 0 ? facts : undefined;
}

function storeItemArtworkUrl(assets: unknown, appId: number): string | undefined {
  if (
    !isObject(assets)
    || typeof assets.asset_url_format !== 'string'
    || typeof assets.header !== 'string'
  ) {
    return undefined;
  }

  const path = assets.asset_url_format.replace('${FILENAME}', assets.header);
  return steamArtworkUrl(`${steamAssetBaseUrl}${path}`, appId);
}

/**
 * Parses one batched `appdetails?filters=price_overview` response. Steam returns an
 * empty `data` array for apps without a price (unreleased, free, or not for sale).
 */
export function parsePriceOverviewResponse(
  value: unknown,
  appIds: readonly number[],
): Map<number, ParsedPriceEntry | SteamWishlistError> {
  if (!isObject(value)) {
    schemaError('Steam appdetails response must be an object');
  }

  return new Map(appIds.map((appId) => [appId, settle(() => parsePriceEntry(value[String(appId)], appId))]));
}

function parsePriceEntry(entry: unknown, appId: number): ParsedPriceEntry {
  if (!isObject(entry) || typeof entry.success !== 'boolean') {
    schemaError(`Steam appdetails response is missing app ${appId}`);
  }

  if (!entry.success) {
    throw new SteamWishlistError(
      'STEAM_APP_NOT_FOUND',
      `Steam appdetails did not find app ${appId}`,
    );
  }

  if (Array.isArray(entry.data)) {
    return null;
  }

  if (!isObject(entry.data)) {
    schemaError(`Steam appdetails data for app ${appId} must be an object`);
  }

  const priceOverview = entry.data.price_overview;
  if (priceOverview === undefined || priceOverview === null) {
    return null;
  }

  if (!isObject(priceOverview)) {
    schemaError(`Steam price_overview for app ${appId} must be an object`);
  }

  return parsePriceOverview(priceOverview, appId);
}

function settle<T>(parse: () => T): T | SteamWishlistError {
  try {
    return parse();
  } catch (error: unknown) {
    if (error instanceof SteamWishlistError) {
      return error;
    }
    throw error;
  }
}

function parsePriceOverview(priceOverview: JsonObject, appId: number): SalePrice {
  if (
    typeof priceOverview.currency !== 'string' ||
    !/^[a-z]{3}$/i.test(priceOverview.currency)
  ) {
    schemaError(`Steam price_overview currency for app ${appId} must be a three-letter code`);
  }

  const initialMinor = integerField(priceOverview.initial, 'price_overview.initial', { min: 0 });
  const finalMinor = integerField(priceOverview.final, 'price_overview.final', { min: 0 });
  const discountPercent = integerField(
    priceOverview.discount_percent,
    'price_overview.discount_percent',
    { min: 0 },
  );

  if (discountPercent > 100) {
    schemaError(`Steam discount percent for app ${appId} must be between 0 and 100`);
  }

  // Preserve the last confirmed observation when upstream pricing contradicts itself.
  // Do not require exact percentage arithmetic: Steam can round regional prices.
  if (
    finalMinor > initialMinor
    || (discountPercent > 0 && finalMinor >= initialMinor)
    || (discountPercent === 0 && finalMinor !== initialMinor)
    || (discountPercent === 100 && finalMinor !== 0)
  ) {
    schemaError(`Steam price_overview for app ${appId} contains contradictory sale values`);
  }

  return {
    currency: priceOverview.currency.toUpperCase(),
    initialMinor,
    finalMinor,
    discountPercent,
    isFree: false,
  };
}
