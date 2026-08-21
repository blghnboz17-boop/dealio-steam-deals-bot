import { isLanguage, isSteamId64, type Language, type UserConfig } from '../domain/user-config.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export class InvalidUserConfigurationError extends Error {}

export interface WishlistAccessValidator {
  validateWishlistAccess(steamId64: string): Promise<void>;
}

export class UserConfigurationService {
  public constructor(
    private readonly repository: UserConfigRepository,
    private readonly wishlistAccessValidator: WishlistAccessValidator,
    private readonly coordinator = new UserOperationCoordinator(),
  ) {}

  public configure(
    discordUserId: string,
    steamId64: string,
    language: Language,
  ): Promise<UserConfig> {
    if (!isSteamId64(steamId64)) {
      throw new InvalidUserConfigurationError('SteamID64 must contain exactly 17 digits');
    }

    if (!isLanguage(language)) {
      throw new InvalidUserConfigurationError('Language must be tr or en');
    }

    return this.coordinator.runExclusive(discordUserId, async () => {
      await this.wishlistAccessValidator.validateWishlistAccess(steamId64);
      return this.repository.upsert(discordUserId, steamId64, language, new Date().toISOString());
    });
  }

  public get(discordUserId: string): UserConfig | null {
    return this.repository.findByDiscordUserId(discordUserId);
  }

  public deleteData(discordUserId: string): Promise<boolean> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.deleteByDiscordUserId(discordUserId),
    );
  }
}
