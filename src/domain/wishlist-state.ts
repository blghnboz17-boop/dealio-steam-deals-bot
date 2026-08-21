import type { WishlistItem } from './steam.js';

export interface WishlistItemState {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly appId: number;
  readonly onSale: boolean;
  readonly saleEpisodeId: string | null;
  readonly saleStartedAt: string | null;
  readonly saleKey: string | null;
  readonly currency: string | null;
  readonly normalPriceMinor: number | null;
  readonly finalPriceMinor: number | null;
  readonly discountPercent: number | null;
  readonly lastSeenAt: string;
}

export interface NotificationCandidate {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly appId: number;
  readonly gameName: string;
  readonly saleEpisodeId: string;
  readonly saleKey: string;
  readonly currency: string;
  readonly normalPriceMinor: number;
  readonly finalPriceMinor: number;
  readonly discountPercent: number;
  readonly attemptCount: number;
  readonly createdAt: string;
}

export interface WishlistObservation {
  readonly item: WishlistItem;
  readonly saleKey: string | null;
  readonly observedAt: string;
}
