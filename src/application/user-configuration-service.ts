import { isLanguage, isSteamId64, type Language, type UserConfig } from '../domain/user-config.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export class InvalidUserConfigurationError extends Error {}

export interface WishlistAccessValidator {
  validateWishlistAccess(steamId64: string): Promise<void>;
}

export interface SteamIdentityReader {
  resolve(profileInput: string): Promise<string>;
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
  ): Promise<UserConfig> {
    if (!isLanguage(language)) {
      throw new InvalidUserConfigurationError('Language must be tr or en');
    }

    return this.coordinator.runExclusive(discordUserId, async () => {
      const steamId64 = await this.identityResolver.resolve(profileInput);
      if (!isSteamId64(steamId64)) {
        throw new InvalidUserConfigurationError('Resolved SteamID64 is invalid');
      }
      await this.wishlistAccessValidator.validateWishlistAccess(steamId64);
      return this.repository.upsert(discordUserId, steamId64, language, this.now().toISOString());
    });
  }

  public get(discordUserId: string): UserConfig | null {
    return this.repository.findByDiscordUserId(discordUserId);
  }

  public setEnabled(discordUserId: string, enabled: boolean): Promise<UserConfig | null> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.setEnabled(discordUserId, enabled, this.now().toISOString()),
    );
  }

  public deleteData(discordUserId: string): Promise<boolean> {
    return this.coordinator.runExclusive(discordUserId, () =>
      this.repository.deleteByDiscordUserId(discordUserId),
    );
  }
}
