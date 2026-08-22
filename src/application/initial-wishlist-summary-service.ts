import type { StoreCountryCode } from '../domain/store-country.js';
import type { CheckService } from './check-service.js';

export interface InitialWishlistSale {
  readonly appId: number;
  readonly gameName: string;
  readonly currency: string;
  readonly normalPriceMinor: number;
  readonly finalPriceMinor: number;
  readonly discountPercent: number;
}

export interface InitialWishlistSummary {
  readonly discordUserId: string;
  readonly storeCountryCode: StoreCountryCode;
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
  | { readonly status: 'dm-failed'; readonly saleCount: number };

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
    if (result.failedItems.length > 0 || result.unknownPriceCount > 0) {
      return { status: 'steam-unavailable' };
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
        currency: price.currency,
        normalPriceMinor: price.initialMinor,
        finalPriceMinor: price.finalMinor,
        discountPercent: price.discountPercent,
      }];
    });

    try {
      await this.sender.sendInitialSummary({
        discordUserId,
        storeCountryCode: result.storeCountryCode,
        capturedAt: result.capturedAt,
        sales,
      });
      return { status: 'sent', saleCount: sales.length };
    } catch (_error: unknown) {
      return { status: 'dm-failed', saleCount: sales.length };
  }
}

}
