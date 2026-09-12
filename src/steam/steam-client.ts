import {
  SteamWishlistError,
  type SteamWishlistResult,
  type WishlistItem,
} from '../domain/steam.js';
import type { Language } from '../domain/user-config.js';
import {
  parseStoreCountryCode,
  type StoreCountryCode,
} from '../domain/store-country.js';
import {
  parseAppDetailsResponse,
  parseWishlistResponse,
} from './wishlist-parser.js';
import {
  globalSteamRequestLimiter,
  type SteamRequestLimiter,
} from './request-limiter.js';

export type SteamFetch = (
  input: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<Response>;

export interface SteamClientOptions {
  readonly fetchImpl?: SteamFetch;
  readonly timeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly requestLimiter?: Pick<SteamRequestLimiter, 'run' | 'deferFor'>;
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly lifecycleSignal?: AbortSignal;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

const wishlistEndpoint = 'https://api.steampowered.com/IWishlistService/GetWishlist/v1/';
const appDetailsEndpoint = 'https://store.steampowered.com/api/appdetails';
const defaultTimeoutMs = 10_000;
const defaultMaxConcurrency = 3;
const defaultMaxRetries = 2;
const defaultRetryBaseDelayMs = 1_000;
const defaultMaxRetryDelayMs = 60_000;

function defaultFetch(input: string, init?: { readonly signal?: AbortSignal }): Promise<Response> {
  return globalThis.fetch(input, init);
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (
    Number.isSafeInteger(seconds) &&
    seconds >= 0 &&
    Number.isSafeInteger(seconds * 1000)
  ) {
    return seconds;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

function errorForStatus(response: Response): SteamWishlistError {
  const retryAfterSeconds = response.status === 429 ? parseRetryAfter(response) : undefined;

  if (response.status === 400) {
    return new SteamWishlistError('STEAM_INVALID_REQUEST', 'Steam rejected the request', 400);
  }

  if (response.status === 404) {
    return new SteamWishlistError('STEAM_NOT_FOUND', 'Steam endpoint or resource was not found', 404);
  }

  if (response.status === 429) {
    return new SteamWishlistError(
      'STEAM_RATE_LIMITED',
      'Steam rate limited the request',
      429,
      retryAfterSeconds,
    );
  }

  return new SteamWishlistError(
    'STEAM_UPSTREAM_ERROR',
    `Steam returned HTTP ${response.status}`,
    response.status,
  );
}

async function runWithConcurrency<T>(
  values: readonly T[],
  maxConcurrency: number,
  worker: (value: T) => Promise<WishlistItem | null>,
): Promise<Array<WishlistItem | null>> {
  const results: Array<WishlistItem | null> = new Array(values.length).fill(null);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= values.length) {
        return;
      }

      results[index] = await worker(values[index]);
    }
  }

  const workerCount = Math.min(values.length, maxConcurrency);
  await Promise.all(Array.from({ length: workerCount }, () => consume()));

  return results;
}

export class SteamClient {
  private readonly cache = new Map<string, {value: ReturnType<typeof parseAppDetailsResponse>; observedAt: string; expiresAt:number}>();
  private readonly inflight = new Map<string, Promise<{value: ReturnType<typeof parseAppDetailsResponse>; observedAt:string}>>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: SteamFetch;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly requestLimiter: Pick<SteamRequestLimiter, 'run' | 'deferFor'>;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly lifecycleSignal?: AbortSignal;

  public constructor(options: SteamClientOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.maxConcurrency = options.maxConcurrency ?? defaultMaxConcurrency;
    this.requestLimiter = options.requestLimiter ?? globalSteamRequestLimiter;
    this.maxRetries = options.maxRetries ?? defaultMaxRetries;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? defaultRetryBaseDelayMs;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? defaultMaxRetryDelayMs;
    this.lifecycleSignal = options.lifecycleSignal;

    if (!Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 0) throw new Error('Steam cache TTL must be a non-negative integer');
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Steam timeout must be a positive safe integer');
    }

    if (!Number.isSafeInteger(this.maxConcurrency) || this.maxConcurrency <= 0) {
      throw new Error('Steam max concurrency must be a positive safe integer');
    }

    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new Error('Steam max retries must be a non-negative safe integer');
    }

    for (const [name, value] of [
      ['retry base delay', this.retryBaseDelayMs],
      ['maximum retry delay', this.maxRetryDelayMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Steam ${name} must be a positive safe integer`);
      }
    }
  }

  public async getWishlist(
    steamId64: string,
    storeCountryCode: StoreCountryCode,
    language: Language,
  ): Promise<WishlistItem[]> {
    const result = await this.getWishlistWithErrors(steamId64, storeCountryCode, language);
    if (result.items.length === 0 && result.errors.length > 0) {
      throw new SteamWishlistError(
        result.errors[0]?.code ?? 'STEAM_UPSTREAM_ERROR',
        'Steam app details were unavailable for the entire wishlist',
      );
    }
    return result.items;
  }

  public async validateWishlistAccess(steamId64: string): Promise<void> {
    await this.getWishlistEntries(steamId64);
  }

  public async getWishlistWithErrors(
    steamId64: string,
    storeCountryInput: StoreCountryCode,
    language: Language,
  ): Promise<SteamWishlistResult> {
    const storeCountryCode = parseStoreCountryCode(storeCountryInput);
    if (!storeCountryCode || (language !== 'tr' && language !== 'en')) {
      throw new SteamWishlistError(
        'STEAM_INVALID_REQUEST',
        'Steam store country or response language is invalid',
      );
    }
    const wishlistEntries = await this.getWishlistEntries(steamId64);
    const errors: SteamWishlistResult['errors'] = [];

    const results = await runWithConcurrency(
      wishlistEntries,
      this.maxConcurrency,
      async (entry): Promise<WishlistItem | null> => {
        try {
          const appDetailsUrl = new URL(appDetailsEndpoint);
          appDetailsUrl.searchParams.set('appids', String(entry.appId));
          appDetailsUrl.searchParams.set('cc', storeCountryCode);
          appDetailsUrl.searchParams.set('l', language === 'tr' ? 'turkish' : 'english');

          const cached = await this.appDetails(appDetailsUrl.toString(), entry.appId);
          const appDetails = cached.value;

          return {
            appId: entry.appId,
            priceObservedAt: cached.observedAt,
            name: appDetails.name,
            priority: entry.priority,
            dateAdded: entry.dateAdded,
            price: appDetails.price,
            onSale:
              appDetails.price === null
                ? null
                : !appDetails.price.isFree && appDetails.price.discountPercent > 0,
          };
        } catch (error: unknown) {
          if (error instanceof SteamWishlistError) {
            if (error.code === 'STEAM_CANCELLED') {
              throw error;
            }
            errors.push({ appId: entry.appId, code: error.code });
            return null;
          }

          throw error;
        }
      },
    );

    return {
      items: results.filter((item): item is WishlistItem => item !== null),
      errors,
    };
  }


  public clearPriceCache(): void { this.cache.clear(); }

  private async appDetails(key: string, appId: number): Promise<{value: ReturnType<typeof parseAppDetailsResponse>; observedAt:string}> {
    if (this.lifecycleSignal?.aborted) throw cancelledError();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached;
    const running = this.inflight.get(key);
    if (running) return running;
    const request = (async () => {
      const value = parseAppDetailsResponse(await this.requestJson(key), appId);
      const observedAt = new Date(this.now()).toISOString();
      // Unpriced/unavailable products are not reusable successful prices.
      if (value.price !== null && value.price.currency !== null) {
        if (this.cache.size >= 10000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, {value,observedAt,expiresAt:this.now()+this.cacheTtlMs});
      }
      return {value,observedAt};
    })();
    this.inflight.set(key,request);
    try { return await request; } finally { this.inflight.delete(key); }
  }

  private async getWishlistEntries(
    steamId64: string,
  ): Promise<ReturnType<typeof parseWishlistResponse>> {
    if (!/^\d{17}$/.test(steamId64)) {
      throw new SteamWishlistError(
        'STEAM_INVALID_REQUEST',
        'SteamID64 must contain exactly 17 digits',
      );
    }

    const encodedSteamId = encodeURIComponent(steamId64);
    const wishlistPayload = await this.requestJson(
      `${wishlistEndpoint}?steamid=${encodedSteamId}`,
      true,
    );

    return parseWishlistResponse(wishlistPayload);
  }

  private async requestJson(url: string, requireWishlistAccess = false): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.lifecycleSignal?.aborted) {
        throw cancelledError();
      }

      try {
        return await this.requestLimiter.run(async () => {
          try {
            return await this.requestJsonAttempt(
              url,
              requireWishlistAccess,
              this.lifecycleSignal,
            );
          } catch (error: unknown) {
            if (error instanceof SteamWishlistError && error.code === 'STEAM_RATE_LIMITED') {
              const retryDelayMs = error.retryAfterSeconds === undefined
                ? Math.min(this.retryBaseDelayMs * (2 ** attempt), this.maxRetryDelayMs)
                : Math.min(error.retryAfterSeconds * 1000, this.maxRetryDelayMs);
              this.requestLimiter.deferFor(retryDelayMs, this.lifecycleSignal);
            }

            throw error;
          }
        }, this.lifecycleSignal);
      } catch (error: unknown) {
        if (this.lifecycleSignal?.aborted) {
          throw cancelledError();
        }

        if (
          !(error instanceof SteamWishlistError) ||
          error.code !== 'STEAM_RATE_LIMITED' ||
          attempt >= this.maxRetries
        ) {
          throw error;
        }

      }
    }
  }

  private async requestJsonAttempt(
    url: string,
    requireWishlistAccess: boolean,
    lifecycleSignal?: AbortSignal,
  ): Promise<unknown> {
    if (lifecycleSignal?.aborted) {
      throw cancelledError();
    }

    const controller = new AbortController();
    let rejectCancellation: ((error: SteamWishlistError) => void) | undefined;
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (): void => {
      controller.abort();
      rejectCancellation?.(cancelledError());
    };
    lifecycleSignal?.addEventListener('abort', cancel, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new SteamWishlistError('STEAM_TIMEOUT', 'Steam request timed out'));
      }, this.timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        this.fetchImpl(url, { signal: controller.signal }),
        timeoutPromise,
        cancellationPromise,
      ]);
    } catch (error: unknown) {
      lifecycleSignal?.removeEventListener('abort', cancel);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

      if (error instanceof SteamWishlistError) {
        throw error;
      }

      if (lifecycleSignal?.aborted) {
        throw cancelledError();
      }

      if (controller.signal.aborted) {
        throw new SteamWishlistError('STEAM_TIMEOUT', 'Steam request timed out');
      }

      throw new SteamWishlistError(
        'STEAM_NETWORK_ERROR',
        `Steam request failed: ${error instanceof Error ? error.message : 'unknown network error'}`,
      );
    }

    try {
      if (!response.ok) {
        throw errorForStatus(response);
      }

      if (requireWishlistAccess) {
        const result = response.headers.get('x-eresult')?.trim();
        if (result === '15') {
          throw new SteamWishlistError(
            'STEAM_WISHLIST_INACCESSIBLE',
            'Steam wishlist is private, unavailable, or the SteamID64 does not exist',
            response.status,
          );
        }

        if (result !== '1') {
          throw new SteamWishlistError(
            'STEAM_INVALID_RESPONSE',
            'Steam wishlist response did not include a successful X-EResult',
            response.status,
          );
        }
      }

      return await Promise.race([response.json(), timeoutPromise, cancellationPromise]) as unknown;
    } catch (error: unknown) {
      if (error instanceof SteamWishlistError) {
        throw error;
      }

      if (lifecycleSignal?.aborted) {
        throw cancelledError();
      }

      if (controller.signal.aborted) {
        throw new SteamWishlistError('STEAM_TIMEOUT', 'Steam response timed out');
      }

      throw new SteamWishlistError(
        'STEAM_INVALID_RESPONSE',
        `Steam returned invalid JSON: ${error instanceof Error ? error.message : 'unknown response error'}`,
      );
    } finally {
      lifecycleSignal?.removeEventListener('abort', cancel);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

function cancelledError(): SteamWishlistError {
  return new SteamWishlistError('STEAM_CANCELLED', 'Steam request cancelled');
}
