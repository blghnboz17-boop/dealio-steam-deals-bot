import type { InitialWishlistSale } from '../application/initial-wishlist-summary-service.js';

export interface InitialSummaryPresentationOptions {
  readonly bannerUrl?: string;
  readonly avatarUrl?: string;
  readonly pollIntervalHours?: number;
}

export function parseInitialSummaryPageAction(
  customId: string,
): { readonly sessionId: string; readonly action: 'previous' | 'next' } | null {
  const match = /^dealio-summary:([A-Za-z0-9_-]+):(previous|next)$/.exec(customId);
  return match?.[1] && (match[2] === 'previous' || match[2] === 'next')
    ? { sessionId: match[1], action: match[2] }
    : null;
}

export function sortInitialWishlistSales(
  sales: readonly InitialWishlistSale[],
): InitialWishlistSale[] {
  return [...sales].sort((left, right) =>
    right.discountPercent - left.discountPercent || left.appId - right.appId
  );
}
