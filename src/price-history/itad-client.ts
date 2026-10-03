import { safeLogger } from '../application/safe-logger.js';
import type { HistoricalLow } from '../domain/price-history.js';
import type { StoreCountryCode } from '../domain/store-country.js';

/** Optional price context for notifications; an empty result means "not shown", never an error. */
export interface HistoricalLowSource {
  historicalLows(
    appIds: readonly number[],
    country: StoreCountryCode,
  ): Promise<ReadonlyMap<number, HistoricalLow>>;
}

export type PriceHistoryFetch = (
  input: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface IsThereAnyDealClientOptions {
  readonly apiKey: string;
  readonly fetchImpl?: PriceHistoryFetch;
  readonly timeoutMs?: number;
  readonly lowCacheTtlMs?: number;
  readonly failurePauseMs?: number;
  readonly lifecycleSignal?: AbortSignal;
  readonly now?: () => number;
}

const apiBase = 'https://api.isthereanydeal.com';
const steamShopId = 61;
/** IsThereAnyDeal accepts at most 200 IDs per request body. */
const maxIdsPerRequest = 200;
const defaultTimeoutMs = 5_000;
const defaultLowCacheTtlMs = 6 * 60 * 60 * 1000;
const unknownGameCacheTtlMs = 24 * 60 * 60 * 1000;
const defaultFailurePauseMs = 5 * 60 * 1000;
const maxCacheEntries = 20_000;

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

class PriceHistoryError extends Error {
  public readonly name = 'PriceHistoryError';

  public constructor(message: string, public readonly retryAfterSeconds?: number) {
    super(message);
  }
}

/**
 * Steam's own historical low per region from the IsThereAnyDeal API. Only game IDs
 * and the Store country are sent. Failures pause lookups briefly so an unavailable
 * service cannot slow every notification.
 */
export class IsThereAnyDealClient implements HistoricalLowSource {
  private readonly apiKey: string;
  private readonly fetchImpl: PriceHistoryFetch;
  private readonly timeoutMs: number;
  private readonly lowCacheTtlMs: number;
  private readonly failurePauseMs: number;
  private readonly lifecycleSignal?: AbortSignal;
  private readonly now: () => number;
  private readonly gameIds = new Map<number, CacheEntry<string | null>>();
  private readonly lows = new Map<string, CacheEntry<HistoricalLow | null>>();
  private pausedUntil = 0;

  public constructor(options: IsThereAnyDealClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.lowCacheTtlMs = options.lowCacheTtlMs ?? defaultLowCacheTtlMs;
    this.failurePauseMs = options.failurePauseMs ?? defaultFailurePauseMs;
    this.lifecycleSignal = options.lifecycleSignal;
    this.now = options.now ?? Date.now;

    if (!this.apiKey) {
      throw new Error('IsThereAnyDeal API key must not be empty');
    }
    for (const [name, value] of [
      ['timeout', this.timeoutMs],
      ['cache lifetime', this.lowCacheTtlMs],
      ['failure pause', this.failurePauseMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`IsThereAnyDeal ${name} must be a positive safe integer`);
      }
    }
  }

  public async historicalLows(
    appIds: readonly number[],
    country: StoreCountryCode,
  ): Promise<ReadonlyMap<number, HistoricalLow>> {
    const result = new Map<number, HistoricalLow>();
    const uniqueAppIds = [...new Set(appIds)].filter((appId) => Number.isSafeInteger(appId) && appId > 0);
    const uncached: number[] = [];
    for (const appId of uniqueAppIds) {
      const cached = this.cached(this.lows, lowKey(country, appId));
      if (cached === undefined) {
        uncached.push(appId);
      } else if (cached) {
        result.set(appId, cached);
      }
    }
    if (uncached.length === 0 || this.now() < this.pausedUntil || this.lifecycleSignal?.aborted) {
      return result;
    }

    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (this.lifecycleSignal) {
      signals.push(this.lifecycleSignal);
    }
    const signal = AbortSignal.any(signals);
    try {
      const gameIds = await this.resolveGameIds(uncached, signal);
      const known = uncached.flatMap((appId) => {
        const gameId = gameIds.get(appId);
        return gameId ? [{ appId, gameId }] : [];
      });
      for (let index = 0; index < known.length; index += maxIdsPerRequest) {
        const chunk = known.slice(index, index + maxIdsPerRequest);
        const lows = parseStoreLows(await this.post(
          `/games/storelow/v2?country=${country}&shops=${steamShopId}`,
          chunk.map(({ gameId }) => gameId),
          signal,
        ));
        const expiresAt = this.now() + this.lowCacheTtlMs;
        for (const { appId, gameId } of chunk) {
          const low = lows.get(gameId) ?? null;
          this.remember(this.lows, lowKey(country, appId), low, expiresAt);
          if (low) {
            result.set(appId, low);
          }
        }
      }
    } catch (error: unknown) {
      if (this.lifecycleSignal?.aborted) {
        return result;
      }
      const retryAfterMs = error instanceof PriceHistoryError && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds * 1000
        : 0;
      this.pausedUntil = this.now() + Math.max(this.failurePauseMs, retryAfterMs);
      safeLogger.warn(`[price-history] IsThereAnyDeal unavailable; historical lows paused: ${failureCategory(error)}`);
    }
    return result;
  }

  private async resolveGameIds(
    appIds: readonly number[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<number, string>> {
    const resolved = new Map<number, string>();
    const unresolved: number[] = [];
    for (const appId of appIds) {
      const cached = this.cached(this.gameIds, appId);
      if (cached === undefined) {
        unresolved.push(appId);
      } else if (cached) {
        resolved.set(appId, cached);
      }
    }
    for (let index = 0; index < unresolved.length; index += maxIdsPerRequest) {
      const chunk = unresolved.slice(index, index + maxIdsPerRequest);
      const lookup = parseLookup(await this.post(
        `/lookup/id/shop/${steamShopId}/v1`,
        chunk.map((appId) => `app/${appId}`),
        signal,
      ));
      const now = this.now();
      for (const appId of chunk) {
        const gameId = lookup.get(`app/${appId}`) ?? null;
        // Game IDs are stable; an unknown app may be added to IsThereAnyDeal later.
        this.remember(this.gameIds, appId, gameId, gameId ? Number.POSITIVE_INFINITY : now + unknownGameCacheTtlMs);
        if (gameId) {
          resolved.set(appId, gameId);
        }
      }
    }
    return resolved;
  }

  private async post(path: string, body: readonly string[], signal: AbortSignal): Promise<unknown> {
    // The key travels in a header, so it never appears in a logged URL.
    const response = await this.fetchImpl(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'ITAD-API-Key': this.apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new PriceHistoryError(
        `HTTP ${response.status}`,
        response.status === 429 && Number.isSafeInteger(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return response.json();
  }

  private cached<K, V>(cache: Map<K, CacheEntry<V>>, key: K): V | undefined {
    const entry = cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private remember<K, V>(cache: Map<K, CacheEntry<V>>, key: K, value: V, expiresAt: number): void {
    cache.delete(key);
    if (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }
    cache.set(key, { value, expiresAt });
  }
}

function lowKey(country: StoreCountryCode, appId: number): string {
  return `${country}:${appId}`;
}

function failureCategory(error: unknown): string {
  if (error instanceof PriceHistoryError) {
    return error.message;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return error instanceof SyntaxError ? 'invalid response' : 'network error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLookup(value: unknown): ReadonlyMap<string, string> {
  if (!isRecord(value)) {
    throw new PriceHistoryError('invalid response');
  }
  const ids = new Map<string, string>();
  for (const [shopId, gameId] of Object.entries(value)) {
    if (typeof gameId === 'string' && /^[\w-]{1,64}$/.test(gameId)) {
      ids.set(shopId, gameId);
    }
  }
  return ids;
}

export function parseStoreLows(value: unknown): ReadonlyMap<string, HistoricalLow> {
  if (!Array.isArray(value)) {
    throw new PriceHistoryError('invalid response');
  }
  const lows = new Map<string, HistoricalLow>();
  for (const game of value) {
    if (!isRecord(game) || typeof game.id !== 'string' || !Array.isArray(game.lows)) {
      continue;
    }
    const steamLow = game.lows.find((low) =>
      isRecord(low) && isRecord(low.shop) && low.shop.id === steamShopId);
    const parsed = isRecord(steamLow) ? parseLow(steamLow) : null;
    if (parsed) {
      lows.set(game.id, parsed);
    }
  }
  return lows;
}

function parseLow(low: Record<string, unknown>): HistoricalLow | null {
  const price = low.price;
  if (!isRecord(price)) {
    return null;
  }
  const { amount, currency } = price;
  const recordedAt = typeof low.timestamp === 'string' ? Date.parse(low.timestamp) : Number.NaN;
  if (
    typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0
    || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)
    || typeof low.cut !== 'number' || !Number.isInteger(low.cut) || low.cut < 0 || low.cut > 100
    || !Number.isFinite(recordedAt)
  ) {
    return null;
  }
  // Dealio stores every price as hundredths of the currency, like Steam's price_overview.
  const amountMinor = Math.round(amount * 100);
  return Number.isSafeInteger(amountMinor)
    ? { currency, amountMinor, discountPercent: low.cut, recordedAt: new Date(recordedAt).toISOString() }
    : null;
}
