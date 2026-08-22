import type { Language, UserConfig } from '../domain/user-config.js';
import type { InitialWishlistSummaryResult } from './initial-wishlist-summary-service.js';
import { InitialWishlistSummaryService } from './initial-wishlist-summary-service.js';
import { UserConfigurationService } from './user-configuration-service.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export interface SetupResult {
  readonly config: UserConfig;
  readonly summary: InitialWishlistSummaryResult;
}

export class SetupService {
  public constructor(
    private readonly userConfigurationService: UserConfigurationService,
    private readonly initialSummaryService: InitialWishlistSummaryService,
    private readonly coordinator: UserOperationCoordinator,
  ) {}

  public configure(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput?: string,
  ): Promise<SetupResult> {
    return this.coordinator.runExclusive(discordUserId, async () => {
      const config = await this.userConfigurationService.configureWithinUserOperation(
        discordUserId,
        profileInput,
        language,
        storeCountryInput,
        { resetPricingContext: true },
      );
      const summary = await this.initialSummaryService.sendWithinUserOperation(discordUserId);
      return { config, summary };
    });
  }
}
