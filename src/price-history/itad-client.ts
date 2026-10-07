import { safeLogger } from '../application/safe-logger.js';
import type { GameHistory, HistoricalLow, PriceChange } from '../domain/price-history.js';
import type { StoreCountryCode } from '../domain/store-country.js';

export interface PricedApp {
  readonly appId: number;
  /** Steam's current currency for the app in this Store region. */
  readonly currency: string;
}

/** Optional price context for notifications; an empty result means "not shown", never an error. */
export interface HistoricalLowSource {
  historicalLows(
    apps: readonly PricedApp[],
    country: StoreCountryCode,
  ): Promise<ReadonlyMap<number, HistoricalLow>>;
}

/** Optional price history for a game's detail panel; null means "not shown". */
export interface GameHistorySource {
  gameHistory(app: PricedApp, country: StoreCountryCode): Promise<GameHistory | null>;
}

export type PriceHistoryFetch = (
  input: string,
  init: {
    readonly method: 'GET' | 'POST';
    readonly headers: Record<string, string>;
    readonly body?: string;
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
/** Full Steam history, so a region's whole current-currency period is covered. */
const historyStart = '2000-01-01T00:00:00Z';
const recentChangeCount = 5;
/** History requests in flight at once for one lookup. */
const historyConcurrency = 4;
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
export class IsThereAnyDealClient implements HistoricalLowSource, GameHistorySource {
  private readonly apiKey: string;
  private readonly fetchImpl: PriceHistoryFetch;
  private readonly timeoutMs: number;
  private readonly lowCacheTtlMs: number;
  private readonly failurePauseMs: number;
  private readonly lifecycleSignal?: AbortSignal;
  private readonly now: () => number;
  private readonly gameIds = new Map<number, CacheEntry<string | null>>();
  private readonly lows = new Map<string, CacheEntry<HistoricalLow | null>>();
  private readonly histories = new Map<string, CacheEntry<GameHistory | null>>();
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
    apps: readonly PricedApp[],
    country: StoreCountryCode,
  ): Promise<ReadonlyMap<number, HistoricalLow>> {
    const result = new Map<number, HistoricalLow>();
    const currencies = new Map<number, string>();
    for (const { appId, currency } of apps) {
      if (Number.isSafeInteger(appId) && appId > 0 && /^[A-Z]{3}$/.test(currency)) {
        currencies.set(appId, currency);
      }
    }
    const uncached: number[] = [];
    for (const [appId, currency] of currencies) {
      const cached = this.cached(this.lows, lowKey(country, appId, currency));
      if (cached === undefined) {
        uncached.push(appId);
      } else if (cached) {
        result.set(appId, cached);
      }
    }
    if (uncached.length === 0) {
      return result;
    }
    await this.guarded(async (signal) => {
      const gameIds = await this.resolveGameIds(uncached, signal);
      const known = uncached.flatMap((appId) => {
        const gameId = gameIds.get(appId);
        return gameId ? [{ appId, gameId }] : [];
      });
      for (let index = 0; index < known.length; index += maxIdsPerRequest) {
        const chunk = known.slice(index, index + maxIdsPerRequest);
        const lows = parseStoreLows(await this.request(
          `/games/storelow/v2?country=${country}&shops=${steamShopId}`,
          signal,
          chunk.map(({ gameId }) => gameId),
        ));
        const chunkLows = new Map<number, HistoricalLow | null>();
        // In a region that changed currency (Turkey) nearly every game needs its own
        // history; one at a time, a few alerts would outlast the timeout and get none.
        await forEachLimited(chunk, historyConcurrency, async ({ appId, gameId }) => {
          const currency = currencies.get(appId)!;
          const storeLow = lows.get(gameId);
          // A region that changed currency keeps its old-currency low; use the
          // current currency's own period instead of comparing across currencies.
          // A free giveaway is not a sale either, so its 0 low falls back to the paid history.
          const low = !storeLow || (storeLow.currency === currency && storeLow.amountMinor > 0)
            ? storeLow ?? null
            : (this.cached(this.histories, lowKey(country, appId, currency))
              ?? await this.fetchHistory(gameId, { appId, currency }, country, signal)).low;
          this.remember(this.lows, lowKey(country, appId, currency), low, this.now() + this.lowCacheTtlMs);
          chunkLows.set(appId, low);
        });
        for (const { appId } of chunk) {
          const low = chunkLows.get(appId);
          if (low) {
            result.set(appId, low);
          }
        }
      }
    });
    return result;
  }

  /** One game's Steam price history in its current currency; null when unknown or unavailable. */
  public async gameHistory(app: PricedApp, country: StoreCountryCode): Promise<GameHistory | null> {
    if (!Number.isSafeInteger(app.appId) || app.appId <= 0 || !/^[A-Z]{3}$/.test(app.currency)) {
      return null;
    }
    const cached = this.cached(this.histories, lowKey(country, app.appId, app.currency));
    if (cached !== undefined) {
      return cached;
    }
    const history = await this.guarded(async (signal) => {
      const gameId = (await this.resolveGameIds([app.appId], signal)).get(app.appId);
      if (!gameId) {
        this.remember(this.histories, lowKey(country, app.appId, app.currency), null, this.now() + this.lowCacheTtlMs);
        return null;
      }
      return this.fetchHistory(gameId, app, country, signal);
    });
    return history ?? null;
  }

  private async fetchHistory(
    gameId: string,
    app: PricedApp,
    country: StoreCountryCode,
    signal: AbortSignal,
  ): Promise<GameHistory> {
    const history = parseCurrentCurrencyHistory(await this.request(
      `/games/history/v2?id=${encodeURIComponent(gameId)}&country=${country}&shops=${steamShopId}&since=${historyStart}`,
      signal,
    ), app.currency);
    this.remember(this.histories, lowKey(country, app.appId, app.currency), history, this.now() + this.lowCacheTtlMs);
    return history;
  }

  /**
   * Runs one bounded lookup. Any failure pauses further lookups and yields
   * undefined, so callers simply show no price history.
   */
  private async guarded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    if (this.now() < this.pausedUntil || this.lifecycleSignal?.aborted) {
      return undefined;
    }
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (this.lifecycleSignal) {
      signals.push(this.lifecycleSignal);
    }
    try {
      return await operation(AbortSignal.any(signals));
    } catch (error: unknown) {
      if (this.lifecycleSignal?.aborted) {
        return undefined;
      }
      const retryAfterMs = error instanceof PriceHistoryError && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds * 1000
        : 0;
      this.pausedUntil = this.now() + Math.max(this.failurePauseMs, retryAfterMs);
      safeLogger.warn(`[price-history] IsThereAnyDeal unavailable; historical lows paused: ${failureCategory(error)}`);
      return undefined;
    }
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
      const lookup = parseLookup(await this.request(
        `/lookup/id/shop/${steamShopId}/v1`,
        signal,
        chunk.map((appId) => `app/${appId}`),
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

  private async request(path: string, signal: AbortSignal, body?: readonly string[]): Promise<unknown> {
    // The key travels in a header, so it never appears in a logged URL.
    const response = await this.fetchImpl(`${apiBase}${path}`, body ? {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'ITAD-API-Key': this.apiKey },
      body: JSON.stringify(body),
      signal,
    } : {
      method: 'GET',
      headers: { 'ITAD-API-Key': this.apiKey },
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

/** Runs `worker` over `values`, at most `limit` at a time; the first failure stops new work. */
async function forEachLimited<T>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const consume = async (): Promise<void> => {
    while (!failed && next < values.length) {
      const value = values[next]!;
      next += 1;
      try {
        await worker(value);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, consume));
}

function lowKey(country: StoreCountryCode, appId: number, currency: string): string {
  return `${country}:${appId}:${currency}`;
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

/**
 * Steam's price changes in the latest unbroken run of `currency` (history is
 * newest first). Free giveaways are not sales and are ignored. The low carries
 * `since` only when an older currency ended the run, so it is never "all-time".
 */
export function parseCurrentCurrencyHistory(value: unknown, currency: string): GameHistory {
  if (!Array.isArray(value)) {
    throw new PriceHistoryError('invalid response');
  }
  const changes: PriceChange[] = [];
  let currencyChanged = false;
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.shop) || entry.shop.id !== steamShopId || !isRecord(entry.deal)) {
      continue;
    }
    const parsed = parseLow({ ...entry.deal, timestamp: entry.timestamp });
    if (!parsed) {
      continue;
    }
    if (parsed.currency !== currency) {
      currencyChanged = true;
      break;
    }
    if (parsed.amountMinor > 0) {
      changes.push(parsed);
    }
  }
  let lowest: PriceChange | null = null;
  for (const change of changes) {
    if (!lowest || change.amountMinor < lowest.amountMinor) {
      lowest = change;
    }
  }
  const since = currencyChanged ? changes.at(-1)?.recordedAt : undefined;
  return {
    low: lowest ? { ...lowest, ...(since ? { since } : {}) } : null,
    recent: changes.slice(0, recentChangeCount),
  };
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
