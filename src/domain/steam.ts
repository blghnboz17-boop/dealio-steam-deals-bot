export type SteamWishlistErrorCode =
  | 'STEAM_INVALID_REQUEST'
  | 'STEAM_NOT_FOUND'
  | 'STEAM_RATE_LIMITED'
  | 'STEAM_UPSTREAM_ERROR'
  | 'STEAM_TIMEOUT'
  | 'STEAM_NETWORK_ERROR'
  | 'STEAM_INVALID_RESPONSE'
  | 'STEAM_SCHEMA_INVALID'
  | 'STEAM_APP_NOT_FOUND'
  | 'STEAM_APP_REGION_UNAVAILABLE'
  | 'STEAM_WISHLIST_INACCESSIBLE'
  | 'STEAM_CANCELLED';

export class SteamWishlistError extends Error {
  public readonly name = 'SteamWishlistError';

  public constructor(
    public readonly code: SteamWishlistErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface SalePrice {
  readonly currency: string | null;
  readonly initialMinor: number;
  readonly finalMinor: number;
  readonly discountPercent: number;
  readonly isFree: boolean;
}

/**
 * Item errors that describe the app itself, not a failed request: the app is not
 * sold in the user's Store region, or Steam no longer lists it. They are shown as
 * facts, never as an incomplete check.
 */
export const permanentItemErrorCodes: ReadonlySet<SteamWishlistErrorCode> = new Set([
  'STEAM_APP_NOT_FOUND', 'STEAM_APP_REGION_UNAVAILABLE',
]);

export function isTransientItemError(error: { readonly code: SteamWishlistErrorCode }): boolean {
  return !permanentItemErrorCodes.has(error.code);
}

/** An unreleased game: Steam sells it only after release, so it has no price yet. */
export interface UpcomingRelease {
  /** Steam's planned release date (ISO), read with `precision`. */
  readonly date?: string;
  readonly precision?: 'day' | 'month' | 'quarter' | 'year';
  /** Steam's localized text when there is no date, such as "To be announced". */
  readonly message?: string;
}

export type SteamDeckCompatibility = 'verified' | 'playable' | 'unsupported';

/**
 * Store context Steam returns with an app's metadata, shown next to prices.
 * Every field is optional: a missing field is simply not shown.
 */
export interface StoreFacts {
  /** Steam's localized review summary, such as "Very Positive". */
  readonly reviewLabel?: string;
  readonly reviewPercent?: number;
  readonly reviewCount?: number;
  readonly platforms?: { readonly windows: boolean; readonly mac: boolean; readonly linux: boolean };
  readonly steamDeck?: SteamDeckCompatibility;
  /** When the current Store-region discount ends (ISO time), if Steam states it. */
  readonly saleEndsAt?: string;
}

export interface WishlistItem {
  readonly headerImageUrl?: string;
  readonly storeFacts?: StoreFacts;
  /** Present only while the game is not released yet. */
  readonly upcoming?: UpcomingRelease;
  readonly priceObservedAt?: string;
  readonly appId: number;
  readonly name: string;
  readonly priority: number | null;
  readonly dateAdded: number | null;
  readonly price: SalePrice | null;
  readonly onSale: boolean | null;
}

export interface WishlistItemError {
  readonly appId: number;
  readonly code: SteamWishlistErrorCode;
}

export interface SteamWishlistResult {
  readonly items: WishlistItem[];
  readonly errors: WishlistItemError[];
}
