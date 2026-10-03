import type { StoreFacts } from '../domain/steam.js';
import type { StoreCountryCode } from '../domain/store-country.js';
import type { Language } from '../domain/user-config.js';
import type { CheckService } from './check-service.js';
import { isDiscordDmBlocked } from './notification-service.js';

export interface InitialWishlistSale {
  readonly headerImageUrl?: string;
  readonly storeFacts?: StoreFacts;
  readonly appId: number;
  readonly gameName: string;
  readonly currency: string;
  readonly normalPriceMinor: number;
  readonly finalPriceMinor: number;
  readonly discountPercent: number;
}

export interface InitialWishlistSummary {
  readonly discordUserId: string;
  readonly steamId64: string;
  readonly language: Language;
  readonly storeCountryCode: StoreCountryCode;
  readonly totalGameCount: number;
  readonly failedItemCount: number;
  readonly minimumDiscountPercent: number;
  readonly capturedAt: string;
  readonly sales: readonly InitialWishlistSale[];
}

export interface InitialWishlistSummarySender {
  sendInitialSummary(summary: InitialWishlistSummary): Promise<void>;
}

export type InitialWishlistSummaryResult =
  | { readonly status: 'sent'; readonly saleCount: number }
  | { readonly status: 'steam-unavailable' }
  | { readonly status: 'persistence-error' }
  | { readonly status: 'dm-transient-failed'; readonly saleCount: number }
  | { readonly status: 'dm-blocked'; readonly saleCount: number };

export class InitialWishlistSummaryService {
  public constructor(
    private readonly checkService: CheckService,
    private readonly sender: InitialWishlistSummarySender,
  ) {}

  public async send(discordUserId: string): Promise<InitialWishlistSummaryResult> {
    return this.sendFromCheck(discordUserId, this.checkService.check(
      discordUserId,
      'manual',
      { baseline: true, bypassCooldown: true },
    ));
  }

  public async sendWithinUserOperation(
    discordUserId: string,
  ): Promise<InitialWishlistSummaryResult> {
    return this.sendFromCheck(discordUserId, this.checkService.checkWithinUserOperation(
      discordUserId,
      'manual',
      { baseline: true, bypassCooldown: true },
    ));
  }

  private async sendFromCheck(
    discordUserId: string,
    check: ReturnType<CheckService['check']>,
  ): Promise<InitialWishlistSummaryResult> {
    const result = await check;
    if (result.status === 'unavailable') {
      return { status: 'steam-unavailable' };
    }
    if (result.status !== 'success') {
      return { status: 'persistence-error' };
    }
    const sales = result.wishlistItems.flatMap((item): InitialWishlistSale[] => {
      const price = item.price;
      if (
        item.onSale !== true
        || price === null
        || price.currency === null
        || price.isFree
        || price.discountPercent <= 0
        || price.finalMinor >= price.initialMinor
      ) {
        return [];
      }
      return [{
        appId: item.appId,
        gameName: item.name,
        ...(item.headerImageUrl ? { headerImageUrl: item.headerImageUrl } : {}),
        ...(item.storeFacts ? { storeFacts: item.storeFacts } : {}),
        currency: price.currency,
        normalPriceMinor: price.initialMinor,
        finalPriceMinor: price.finalMinor,
        discountPercent: price.discountPercent,
      }];
    });

    try {
      await this.sender.sendInitialSummary({
        discordUserId,
        steamId64: result.steamId64,
        language: result.language,
        storeCountryCode: result.storeCountryCode,
        totalGameCount: result.wishlistItems.length + result.failedItems.length,
        failedItemCount: result.failedItems.length + result.unknownPriceCount,
        minimumDiscountPercent: result.minimumDiscountPercent,
        capturedAt: result.capturedAt,
        sales,
      });
      return { status: 'sent', saleCount: sales.length };
    } catch (error: unknown) {
      return {
        status: isDiscordDmBlocked(error) ? 'dm-blocked' : 'dm-transient-failed',
        saleCount: sales.length,
      };
    }
}

}
