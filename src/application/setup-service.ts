import type { Language, UserConfig } from '../domain/user-config.js';
import type { InitialWishlistSummaryResult } from './initial-wishlist-summary-service.js';
import { InitialWishlistSummaryService } from './initial-wishlist-summary-service.js';
import {
  UserConfigurationService,
  type PreparedUserConfiguration,
} from './user-configuration-service.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export interface SetupResult {
  readonly config: UserConfig;
  readonly summary: InitialWishlistSummaryResult;
}

export class SetupAlreadyCompletedError extends Error {
  public readonly name = 'SetupAlreadyCompletedError';

  public constructor() {
    super('Dealio setup has already been completed for this Discord user');
  }
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
      this.assertNotConfigured(discordUserId);
      const config = await this.userConfigurationService.configureWithinUserOperation(
        discordUserId,
        profileInput,
        language,
        storeCountryInput,
        { resetPricingContext: true },
      );
      const summary = await this.initialSummaryService.sendWithinUserOperation(discordUserId);
      if (summary.status === 'dm-blocked') {
        const blocked = this.userConfigurationService.markDmDeliveryBlocked(discordUserId);
        return { config: blocked ?? config, summary };
      }
      return { config, summary };
    });
  }

  public prepare(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput: string,
  ): Promise<PreparedUserConfiguration> {
    this.assertNotConfigured(discordUserId);
    return this.userConfigurationService.prepare(
      discordUserId,
      profileInput,
      language,
      storeCountryInput,
    );
  }

  public confirm(prepared: PreparedUserConfiguration): Promise<SetupResult> {
    return this.coordinator.runExclusive(prepared.discordUserId, async () => {
      this.assertNotConfigured(prepared.discordUserId);
      const config = this.userConfigurationService.configurePreparedWithinUserOperation(
        prepared,
        { resetPricingContext: true },
      );
      const summary = await this.initialSummaryService.sendWithinUserOperation(
        prepared.discordUserId,
      );
      if (summary.status === 'dm-blocked') {
        const blocked = this.userConfigurationService.markDmDeliveryBlocked(
          prepared.discordUserId,
        );
        return { config: blocked ?? config, summary };
      }
      return { config, summary };
    });
  }

  public hasExistingConfiguration(discordUserId: string): boolean {
    return this.userConfigurationService.get(discordUserId) !== null;
  }

  private assertNotConfigured(discordUserId: string): void {
    if (this.hasExistingConfiguration(discordUserId)) {
      throw new SetupAlreadyCompletedError();
    }
  }
}
