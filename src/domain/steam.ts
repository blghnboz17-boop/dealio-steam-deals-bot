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
