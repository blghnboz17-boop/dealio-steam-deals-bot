import type { AssistantService } from './assistant-service.js';
import type { AssistantRepository } from '../persistence/assistant-repository.js';
import {
  SteamWishlistError,
  type SteamWishlistErrorCode,
  type WishlistItem,
  type WishlistItemError,
} from '../domain/steam.js';
import type { Language, UserConfig } from '../domain/user-config.js';
import type { StoreCountryCode } from '../domain/store-country.js';
import type { DiscountThresholdRepository } from '../persistence/discount-threshold-repository.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';

export interface WishlistConfigReader {
  findByDiscordUserId(discordUserId: string): UserConfig | null;
}

export interface LiveWishlistReader {
  getWishlistWithErrors(
    steamId64: string,
    storeCountryCode: StoreCountryCode,
    language: Language,
  ): Promise<{
    readonly items: WishlistItem[];
    readonly errors: WishlistItemError[];
  }>;
}

export type WishlistViewResult =
  | { readonly status: 'not-configured'; readonly language: Language }
  | {
      readonly status: 'unavailable';
      readonly language: Language;
      readonly errorCode: SteamWishlistErrorCode;
    }
  | {
      readonly status: 'success';
      readonly language: Language;
      readonly items: readonly WishlistItem[];
      readonly errors: readonly WishlistItemError[];
      readonly capturedAt: string;
      readonly configVersion: number;
      readonly configurationId: string;
      readonly storeCountryCode: StoreCountryCode;
      readonly globalMinimumDiscountPercent: number;
      readonly gameMinimumDiscountOverrides: ReadonlyMap<number, number>;
    };

export class WishlistViewService {
  public constructor(
    private readonly configReader: WishlistConfigReader,
    private readonly wishlistReader: LiveWishlistReader,
    private readonly now: () => Date = () => new Date(),
    private readonly thresholdReader?: Pick<DiscountThresholdRepository, 'findGameOverrides'>,
    private readonly coordinator = new UserOperationCoordinator(),
    public readonly assistant?: AssistantRepository,
    public readonly assistantService?: AssistantService,
    private readonly refreshForUser?: (user:string)=>Promise<{items:WishlistItem[];errors:WishlistItemError[]}>,
  ) {}

  public async load(
    discordUserId: string,
    fallbackLanguage: Language,
    refresh = false,
  ): Promise<WishlistViewResult> {
    if (!refresh && this.assistant) {
      // These SQLite reads are synchronous: read one committed configuration and
      // its matching snapshot without waiting for unrelated network work.
      const config = this.configReader.findByDiscordUserId(discordUserId);
      const cached = config ? this.assistant.snapshot(config) : null;
      if (config && cached) {
        return this.toViewResult(config, cached, cached.capturedAt);
      }
    }
    return this.coordinator.runExclusive(discordUserId, () =>
      this.loadExclusive(discordUserId, fallbackLanguage, refresh),
    );
  }

  private async loadExclusive(
    discordUserId: string,
    fallbackLanguage: Language,
    refresh = false,
  ): Promise<WishlistViewResult> {
    const config = this.configReader.findByDiscordUserId(discordUserId);
    if (!config) {
      return { status: 'not-configured', language: fallbackLanguage };
    }

    try {
      const cached = refresh ? null : this.assistant?.snapshot(config);
      const result = cached ?? await (this.refreshForUser ? this.refreshForUser(discordUserId) : this.wishlistReader.getWishlistWithErrors(
        config.steamId64,
        config.storeCountryCode,
        config.language,
      ));
      if (result.items.length === 0 && result.errors.length > 0) {
        return {
          status: 'unavailable',
          language: config.language,
          errorCode: result.errors[0]?.code ?? 'STEAM_UPSTREAM_ERROR',
        };
      }
      if (!cached) this.assistant?.saveSnapshot(config, result, this.now().toISOString());
      return this.toViewResult(config, result, cached?.capturedAt ?? this.now().toISOString());
    } catch (error: unknown) {
      if (error instanceof SteamWishlistError) {
        return {
          status: 'unavailable',
          language: config.language,
          errorCode: error.code,
        };
      }

      throw error;
    }
  }

  private toViewResult(
    config: UserConfig,
    result: { readonly items: readonly WishlistItem[]; readonly errors: readonly WishlistItemError[] },
    capturedAt: string,
  ): WishlistViewResult {
    if (result.items.length === 0 && result.errors.length > 0) {
      return { status: 'unavailable', language: config.language,
        errorCode: result.errors[0]?.code ?? 'STEAM_UPSTREAM_ERROR' };
    }
    return {
      status: 'success', language: config.language,
      items: result.items, errors: result.errors, capturedAt,
      configVersion: config.configVersion, configurationId: config.configurationId,
      storeCountryCode: config.storeCountryCode,
      globalMinimumDiscountPercent: config.minimumDiscountPercent,
      gameMinimumDiscountOverrides: this.thresholdReader?.findGameOverrides(
        config, result.items.map(item => item.appId),
      ) ?? new Map(),
    };
  }
}
