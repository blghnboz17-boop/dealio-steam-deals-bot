import { steamArtworkUrl } from '../domain/steam-artwork.js';
import {
  SteamWishlistError,
  type SalePrice,
} from '../domain/steam.js';

interface ParsedWishlistEntry {
  readonly appId: number;
  readonly priority: number | null;
  readonly dateAdded: number | null;
}

interface ParsedAppDetails {
  readonly headerImageUrl?: string;
  readonly name: string;
  readonly price: SalePrice | null;
}

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

export function parseAppDetailsResponse(value: unknown, appId: number): ParsedAppDetails {
  if (!isObject(value)) {
    schemaError('Steam appdetails response must be an object');
  }

  const appDetails = value[String(appId)];
  if (!isObject(appDetails) || typeof appDetails.success !== 'boolean') {
    schemaError(`Steam appdetails response is missing app ${appId}`);
  }

  if (!appDetails.success) {
    throw new SteamWishlistError(
      'STEAM_APP_NOT_FOUND',
      `Steam appdetails did not find app ${appId}`,
    );
  }

  if (!isObject(appDetails.data)) {
    schemaError(`Steam appdetails data for app ${appId} must be an object`);
  }

  const data = appDetails.data;
  if (integerField(data.steam_appid, 'data.steam_appid', { min: 1 }) !== appId) {
    schemaError(`Steam appdetails app ID does not match requested app ${appId}`);
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    schemaError(`Steam appdetails name for app ${appId} must be a non-empty string`);
  }

  if (data.is_free !== undefined && typeof data.is_free !== 'boolean') {
    schemaError(`Steam appdetails is_free for app ${appId} must be a boolean`);
  }

  const headerImageUrl = steamArtworkUrl(data.header_image, appId);
  const artwork = headerImageUrl ? { headerImageUrl } : {};

  if (data.is_free === true) {
    return {
      name: data.name, ...artwork,
      price: {
        currency: null,
        initialMinor: 0,
        finalMinor: 0,
        discountPercent: 0,
        isFree: true,
      },
    };
  }

  if (data.price_overview === undefined || data.price_overview === null) {
    return { name: data.name, ...artwork, price: null };
  }

  if (!isObject(data.price_overview)) {
    schemaError(`Steam price_overview for app ${appId} must be an object`);
  }

  const priceOverview = data.price_overview;
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
    name: data.name, ...artwork,
    price: {
      currency: priceOverview.currency.toUpperCase(),
      initialMinor,
      finalMinor,
      discountPercent,
      isFree: false,
    },
  };
}
