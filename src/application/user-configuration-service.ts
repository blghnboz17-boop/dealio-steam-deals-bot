import { isLanguage, isSteamId64, type Language, type UserConfig } from '../domain/user-config.js';
import {
  parseStoreCountryCode,
} from '../domain/store-country.js';
import { SteamWishlistError } from '../domain/steam.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export class InvalidUserConfigurationError extends Error {
  public constructor(
    message: string,
    public readonly code: 'INVALID_CONFIGURATION' | 'INVALID_STORE_COUNTRY' = 'INVALID_CONFIGURATION',
  ) {
    super(message);
  }
}

export interface WishlistAccessValidator {
  validateWishlistAccess(steamId64: string): Promise<void>;
}

export interface SteamIdentityReader {
  resolve(profileInput: string): Promise<string>;
}

export interface ConfigureUserOptions {
  readonly resetPricingContext?: boolean;
}

export class UserConfigurationService {
  public constructor(
    private readonly repository: UserConfigRepository,
    private readonly identityResolver: SteamIdentityReader,
    private readonly wishlistAccessValidator: WishlistAccessValidator,
    private readonly coordinator = new UserOperationCoordinator(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  public configure(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput?: string,
    options: ConfigureUserOptions = {},
  ): Promise<UserConfig> {
    if (!isLanguage(language)) {
      throw new InvalidUserConfigurationError('Language must be tr or en');
    }
    if (storeCountryInput !== undefined && !parseStoreCountryCode(storeCountryInput)) {
      throw new InvalidUserConfigurationError(
        'Store country must be a supported country code',
        'INVALID_STORE_COUNTRY',
      );
    }
    return this.coordinator.runExclusive(discordUserId, () =>
      this.configureWithinUserOperation(
        discordUserId,
        profileInput,
        language,
        storeCountryInput,
        options,
      ),
    );
  }

  public configureWithinUserOperation(
    discordUserId: string,
    profileInput: string,
    language: Language,
    storeCountryInput?: string,
    options: ConfigureUserOptions = {},
  ): Promise<UserConfig> {
    if (!isLanguage(language)) {
      throw new InvalidUserConfigurationError('Language must be tr or en');
    }
    const requestedStoreCountry = storeCountryInput === undefined
      ? undefined
      : parseStoreCountryCode(storeCountryInput);
    if (storeCountryInput !== undefined && !requestedStoreCountry) {
      throw new InvalidUserConfigurationError(
        'Store country must be a supported country code',
        'INVALID_STORE_COUNTRY',
      );
    }

    return (async () => {
      const existingStoreCountry = this.repository
        .findByDiscordUserId(discordUserId)?.storeCountryCode;
      const storeCountryCode = requestedStoreCountry ?? existingStoreCountry;
      if (!storeCountryCode) {
        throw new InvalidUserConfigurationError(
          'Store country is required for a new configuration',
          'INVALID_STORE_COUNTRY',
        );
      }
      const steamId64 = await this.identityResolver.resolve(profileInput);
      if (!isSteamId64(steamId64)) {
        throw new InvalidUserConfigurationError('Resolved SteamID64 is invalid');
      }
      try {
        await this.wishlistAccessValidator.validateWishlistAccess(steamId64);
      } catch (error: unknown) {
        if (
          !(error instanceof SteamWishlistError)
          || error.code === 'STEAM_WISHLIST_INACCESSIBLE'
          || error.code === 'STEAM_INVALID_REQUEST'
          || error.code === 'STEAM_CANCELLED'
        ) {
          throw error;
        }
      }
      return this.repository.upsert(
        discordUserId,
        steamId64,
        language,
        storeCountryCode,
        this.now().toISOString(),
        { forcePricingReset: options.resetPricingContext },
      );
    })();
  }

  public get(discordUserId: string): UserConfig | null {
    return this.repository.findByDiscordUserId(discordUserId);
  }

  public setEnabled(discordUserId: string, enabled: boolean): Promise<UserConfig | null> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.setEnabled(discordUserId, enabled, this.now().toISOString()),
    );
  }

  public setStoreCountry(
    discordUserId: string,
    storeCountryInput: string,
  ): Promise<UserConfig | null> {
    const storeCountryCode = parseStoreCountryCode(storeCountryInput);
    if (!storeCountryCode) {
      throw new InvalidUserConfigurationError(
        'Store country must be a supported country code',
        'INVALID_STORE_COUNTRY',
      );
    }

    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.setStoreCountryCode(
        discordUserId,
        storeCountryCode,
        this.now().toISOString(),
      ),
    );
  }

  public deleteData(discordUserId: string): Promise<boolean> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.deleteByDiscordUserId(discordUserId),
    );
  }
}
