import type { AssistantService } from './assistant-service.js';
import type { AssistantRepository } from '../persistence/assistant-repository.js';
import {
  SteamWishlistError,
  isTransientItemError,
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
  | { readonly status: 'cooldown'; readonly language: Language; readonly retryAfterSeconds: number }
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
  private readonly loads = new Map<string, {
    context: string;
    pending?: Promise<WishlistViewResult>;
    availableAt: number;
  }>();
  private readonly refreshCooldownMs = 30_000;

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
    const config = this.configReader.findByDiscordUserId(discordUserId);
    if (!config) return { status: 'not-configured', language: fallbackLanguage };
    if (!refresh && this.assistant) {
      // These SQLite reads are synchronous: read one committed configuration and
      // its matching snapshot without waiting for unrelated network work.
      const cached = this.assistant.snapshot(config);
      if (cached) {
        return this.toViewResult(config, cached, cached.capturedAt);
      }
    }
    const context = JSON.stringify([config.configurationId, config.configVersion, config.language]);
    const existing = this.loads.get(discordUserId);
    if (existing?.pending && existing.context === context) return existing.pending;
    if (existing?.context === context && (existing.pending || existing.availableAt > this.now().getTime())) {
      return { status: 'cooldown', language: config.language,
        retryAfterSeconds: existing.pending ? 1 : Math.max(1, Math.ceil((existing.availableAt - this.now().getTime()) / 1000)) };
    }
    // Admit at most one load BEFORE the user lock, including uncached panel opens.
    const entry: {context:string; pending?:Promise<WishlistViewResult>; availableAt:number} = {context,availableAt:0};
    this.loads.set(discordUserId, entry);
    entry.pending = this.coordinator.runExclusive(discordUserId, () => {
      const current = this.configReader.findByDiscordUserId(discordUserId);
      if (!current) return {status:'not-configured' as const,language:fallbackLanguage};
      if (JSON.stringify([current.configurationId,current.configVersion,current.language]) !== context)
        return {status:'unavailable' as const,language:current.language,errorCode:'STEAM_CANCELLED' as const};
      return this.loadExclusive(discordUserId, fallbackLanguage, refresh);
    }).finally(() => {
      entry.pending = undefined;
      entry.availableAt = this.now().getTime() + this.refreshCooldownMs;
      // Bound retained state; failures receive the same cooldown as successes.
      const timer = setTimeout(() => {
        if (this.loads.get(discordUserId) === entry) this.loads.delete(discordUserId);
      }, this.refreshCooldownMs);
      timer.unref();
    });
    return entry.pending;
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
      const failed = result.errors.filter(isTransientItemError);
      if (result.items.length === 0 && failed.length > 0) {
        return {
          status: 'unavailable',
          language: config.language,
          errorCode: failed[0]?.code ?? 'STEAM_UPSTREAM_ERROR',
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
    const failed = result.errors.filter(isTransientItemError);
    if (result.items.length === 0 && failed.length > 0) {
      return { status: 'unavailable', language: config.language,
        errorCode: failed[0]?.code ?? 'STEAM_UPSTREAM_ERROR' };
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
