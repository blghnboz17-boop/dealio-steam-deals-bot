import type { Language, UserConfig } from '../domain/user-config.js';
import type { InitialWishlistSummaryResult } from './initial-wishlist-summary-service.js';
import { InitialWishlistSummaryService } from './initial-wishlist-summary-service.js';
import {
  InvalidUserConfigurationError,
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

/** New sign-ups are closed: the beta already has as many users as it can carry. */
export class SetupCapacityReachedError extends Error {
  public readonly name = 'SetupCapacityReachedError';

  public constructor() {
    super('Dealio is not accepting new users right now');
  }
}

export interface SetupServiceOptions {
  /** Most users Dealio accepts; existing users are never affected. Unlimited when omitted. */
  readonly maxUsers?: number;
}

export interface AccountChangeResult {
  readonly config: UserConfig;
  /** Whether the new wishlist was read right away; otherwise the next scheduled check reads it. */
  readonly wishlistLoaded: boolean;
}

export class SetupService {
  private readonly maxUsers?: number;

  public constructor(
    private readonly userConfigurationService: UserConfigurationService,
    private readonly initialSummaryService: InitialWishlistSummaryService,
    private readonly coordinator: UserOperationCoordinator,
    options: SetupServiceOptions = {},
  ) {
    this.maxUsers = options.maxUsers;
  }

  public configure(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput?: string,
  ): Promise<SetupResult> {
    return this.coordinator.runExclusive(discordUserId, async () => {
      this.assertNotConfigured(discordUserId);
      this.assertCapacity();
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

  public async prepare(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput: string,
  ): Promise<PreparedUserConfiguration> {
    this.assertNotConfigured(discordUserId);
    this.assertCapacity();
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
      this.assertCapacity();
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

  /** Reads a replacement Steam account for a configured user; nothing is saved yet. */
  public prepareAccountChange(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput: string,
  ): Promise<PreparedUserConfiguration> {
    if (!this.hasExistingConfiguration(discordUserId)) {
      return Promise.reject(new InvalidUserConfigurationError('Dealio is not set up for this user'));
    }
    return this.userConfigurationService.prepare(discordUserId, profileInput, language, storeCountryInput);
  }

  /**
   * Switches a configured user to another Steam account. The old account's rules and
   * queued alerts are retired; the new wishlist starts from a baseline, so games that
   * are already discounted do not trigger alerts.
   */
  public changeAccount(prepared: PreparedUserConfiguration): Promise<AccountChangeResult> {
    return this.coordinator.runExclusive(prepared.discordUserId, async () => {
      if (!this.hasExistingConfiguration(prepared.discordUserId)) {
        throw new InvalidUserConfigurationError('Dealio is not set up for this user');
      }
      const config = this.userConfigurationService.configurePreparedWithinUserOperation(prepared);
      const baseline = await this.initialSummaryService.baselineWithinUserOperation(prepared.discordUserId);
      return { config: this.userConfigurationService.get(prepared.discordUserId) ?? config, wishlistLoaded: baseline };
    });
  }

  public hasExistingConfiguration(discordUserId: string): boolean {
    return this.userConfigurationService.get(discordUserId) !== null;
  }

  /** False while the user limit is reached, so setup can say so before asking anything. */
  public acceptsNewUsers(): boolean {
    return this.maxUsers === undefined || this.userConfigurationService.countUsers() < this.maxUsers;
  }

  private assertCapacity(): void {
    if (!this.acceptsNewUsers()) {
      throw new SetupCapacityReachedError();
    }
  }

  private assertNotConfigured(discordUserId: string): void {
    if (this.hasExistingConfiguration(discordUserId)) {
      throw new SetupAlreadyCompletedError();
    }
  }
}
