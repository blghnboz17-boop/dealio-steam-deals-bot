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

export interface WishlistItem {
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
