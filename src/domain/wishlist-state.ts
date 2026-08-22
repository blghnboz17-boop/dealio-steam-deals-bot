import type { WishlistItem } from './steam.js';
import type { Language } from './user-config.js';
import type { StoreCountryCode } from './store-country.js';

export type WishlistObservationStatus = 'known' | 'unknown' | 'error' | 'missing';

export interface WishlistItemState {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly storeCountryCode: StoreCountryCode;
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
  readonly observationStatus: WishlistObservationStatus;
}

export interface NotificationCandidate {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly configVersion: number;
  readonly storeCountryCode: StoreCountryCode;
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

export interface NotificationBatch<T> {
  readonly notifications: readonly [T, ...T[]];
}

export interface DurableNotificationBatch extends NotificationBatch<NotificationCandidate> {
  readonly batchId: string;
  readonly language: Language;
  readonly attemptCount: number;
}

export interface WishlistObservation {
  readonly item: WishlistItem;
  readonly saleKey: string | null;
  readonly observedAt: string;
}
