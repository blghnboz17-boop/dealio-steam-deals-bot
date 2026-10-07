import { SteamIdentityError, type SteamProfileSummary } from '../domain/steam-identity.js';
import { isSteamId64 } from '../domain/user-config.js';
import {
  globalSteamRequestLimiter,
  type SteamRequestLimiter,
} from './request-limiter.js';
import type { SteamFetch } from './steam-client.js';

const resolveVanityEndpoint =
  'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/';
const playerSummariesEndpoint =
  'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/';
const defaultTimeoutMs = 10_000;
const vanityPattern = /^[a-z0-9_-]{2,32}$/i;

export type ParsedSteamProfile =
  | { readonly type: 'steam-id'; readonly steamId64: string }
  | { readonly type: 'vanity'; readonly vanityName: string };

export interface SteamIdentityResolverOptions {
  readonly apiKey?: string;
  readonly fetchImpl?: SteamFetch;
  readonly timeoutMs?: number;
  readonly requestLimiter?: Pick<SteamRequestLimiter, 'run'>;
  readonly lifecycleSignal?: AbortSignal;
}

function defaultFetch(input: string, init?: { readonly signal?: AbortSignal }): Promise<Response> {
  return globalThis.fetch(input, init);
}

/** The SteamID64 range of individual (personal) accounts; other values cannot own a wishlist. */
const firstIndividualSteamId = 76561197960265729n;
const lastIndividualSteamId = 76561202255233023n;

function isIndividualSteamId64(value: string): boolean {
  if (!isSteamId64(value)) {
    return false;
  }
  const id = BigInt(value);
  return id >= firstIndividualSteamId && id <= lastIndividualSteamId;
}

/** Profile pages and the Store wishlist page, which users often paste instead of their profile. */
const communityProfilePath = /^\/(profiles|id)\/([^/]+)(?:\/[\w-]+)*\/?$/iu;
const profilePaths: ReadonlyMap<string, RegExp> = new Map([
  ['steamcommunity.com', communityProfilePath],
  ['www.steamcommunity.com', communityProfilePath],
  ['store.steampowered.com', /^\/wishlist\/(profiles|id)\/([^/]+)\/?$/iu],
]);

export function parseSteamProfileInput(input: string): ParsedSteamProfile {
  const value = input.trim();
  if (isIndividualSteamId64(value)) {
    return { type: 'steam-id', steamId64: value };
  }
  if (/^\d+$/.test(value)) {
    throw invalidProfileError();
  }
  if (/[\u0000-\u0020\u007f]/u.test(value)) {
    throw invalidProfileError();
  }
  if (vanityPattern.test(value)) {
    return { type: 'vanity', vanityName: value.toLowerCase() };
  }

  const hasSupportedPrefix = /^https?:\/\//i.test(value)
    || /^(?:www\.)?steamcommunity\.com\//i.test(value)
    || /^store\.steampowered\.com\//i.test(value);
  if (!hasSupportedPrefix || value.includes('\\')) {
    throw invalidProfileError();
  }
  const pathOnly = value.split(/[?#]/u, 1)[0] ?? value;
  if (pathOnly.includes('%') || /\/(?:\.{1,2})(?:\/|$)/u.test(pathOnly)) {
    throw invalidProfileError();
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch (_error: unknown) {
    throw invalidProfileError();
  }
  const profilePath = profilePaths.get(url.hostname);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || !profilePath
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
  ) {
    throw invalidProfileError();
  }

  const match = profilePath.exec(url.pathname);
  if (!match) {
    throw invalidProfileError();
  }
  const kind = match[1]?.toLowerCase();
  const identity = match[2] ?? '';
  if (kind === 'profiles') {
    if (!isIndividualSteamId64(identity)) {
      throw invalidProfileError();
    }
    return { type: 'steam-id', steamId64: identity };
  }
  if (!vanityPattern.test(identity)) {
    throw invalidProfileError();
  }
  return { type: 'vanity', vanityName: identity.toLowerCase() };
}

export class SteamIdentityResolver {
  private readonly apiKey?: string;
  private readonly fetchImpl: SteamFetch;
  private readonly timeoutMs: number;
  private readonly requestLimiter: Pick<SteamRequestLimiter, 'run'>;
  private readonly lifecycleSignal?: AbortSignal;

  public constructor(options: SteamIdentityResolverOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.requestLimiter = options.requestLimiter ?? globalSteamRequestLimiter;
    this.lifecycleSignal = options.lifecycleSignal;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Steam identity timeout must be a positive safe integer');
    }
  }

  public async resolve(profileInput: string): Promise<string> {
    const parsed = parseSteamProfileInput(profileInput);
    if (parsed.type === 'steam-id') {
      return parsed.steamId64;
    }
    if (!this.apiKey) {
      throw new SteamIdentityError(
        'STEAM_WEB_API_KEY_MISSING',
        'Steam Web API key is required to resolve a vanity profile',
      );
    }
    if (this.lifecycleSignal?.aborted) {
      throw cancelledIdentityError();
    }

    try {
      return await this.requestLimiter.run(
        () => this.resolveVanity(parsed.vanityName),
        this.lifecycleSignal,
      );
    } catch (error: unknown) {
      if (error instanceof SteamIdentityError) {
        throw error;
      }
      if (this.lifecycleSignal?.aborted) {
        throw cancelledIdentityError();
      }
      throw unavailableIdentityError();
    }
  }

  /**
   * The public persona name and avatar, shown so a user can recognize their own
   * profile before confirming. Presentation only: any failure returns null and
   * never blocks setup.
   */
  public async summary(steamId64: string): Promise<SteamProfileSummary | null> {
    if (!this.apiKey || !isSteamId64(steamId64) || this.lifecycleSignal?.aborted) {
      return null;
    }
    const url = new URL(playerSummariesEndpoint);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('steamids', steamId64);
    try {
      const payload = await this.requestLimiter.run(() => this.fetchJson(url), this.lifecycleSignal);
      return parsePlayerSummary(payload, steamId64);
    } catch (_error: unknown) {
      return null;
    }
  }

  private async resolveVanity(vanityName: string): Promise<string> {
    const url = new URL(resolveVanityEndpoint);
    url.searchParams.set('key', this.apiKey!);
    url.searchParams.set('vanityurl', vanityName);
    return parseVanityResponse(await this.fetchJson(url));
  }

  /** One Steam Web API read with a timeout, cancelled with the bot's lifecycle. */
  private async fetchJson(url: URL): Promise<unknown> {
    if (this.lifecycleSignal?.aborted) {
      throw cancelledIdentityError();
    }

    const controller = new AbortController();
    let rejectCancellation: ((error: SteamIdentityError) => void) | undefined;
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    let cancelled = false;
    const cancel = (): void => {
      cancelled = true;
      controller.abort();
      rejectCancellation?.(cancelledIdentityError());
    };
    this.lifecycleSignal?.addEventListener('abort', cancel, { once: true });
    if (this.lifecycleSignal?.aborted && !cancelled) {
      cancel();
    }
    if (cancelled) {
      this.lifecycleSignal?.removeEventListener('abort', cancel);
      return cancellationPromise;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(unavailableIdentityError());
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.fetchImpl(url.toString(), { signal: controller.signal }),
        timeoutPromise,
        cancellationPromise,
      ]);
      if (!response.ok) {
        throw unavailableIdentityError();
      }
      return await Promise.race([
        response.json(),
        timeoutPromise,
        cancellationPromise,
      ]) as unknown;
    } catch (error: unknown) {
      if (error instanceof SteamIdentityError) {
        throw error;
      }
      if (this.lifecycleSignal?.aborted) {
        throw cancelledIdentityError();
      }
      throw unavailableIdentityError();
    } finally {
      this.lifecycleSignal?.removeEventListener('abort', cancel);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

function parseVanityResponse(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw unavailableIdentityError();
  }
  const response = (payload as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    throw unavailableIdentityError();
  }
  const success = (response as { success?: unknown }).success;
  if (success === 0 || success === 42 || success === false) {
    throw new SteamIdentityError('STEAM_VANITY_NOT_FOUND', 'Steam vanity profile was not found');
  }
  if (success !== 1) {
    throw unavailableIdentityError();
  }
  const steamId64 = (response as { steamid?: unknown }).steamid;
  if (typeof steamId64 !== 'string' || !isSteamId64(steamId64)) {
    throw unavailableIdentityError();
  }
  return steamId64;
}

const avatarHosts = /(^|\.)(steamstatic\.com|akamaihd\.net)$/;

function parsePlayerSummary(payload: unknown, steamId64: string): SteamProfileSummary | null {
  const players = (payload as { response?: { players?: unknown } } | null)?.response?.players;
  const player = Array.isArray(players) ? players[0] as Record<string, unknown> | undefined : undefined;
  if (!player || player.steamid !== steamId64) {
    return null;
  }
  const personaName = typeof player.personaname === 'string'
    ? player.personaname.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 64)
    : '';
  if (!personaName) {
    return null;
  }
  return { personaName, ...(steamAvatarUrl(player.avatarfull) ? { avatarUrl: steamAvatarUrl(player.avatarfull) } : {}) };
}

/** Only an https avatar on Steam's own image hosts is shown. */
function steamAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && avatarHosts.test(url.hostname) ? url.toString() : undefined;
  } catch (_error: unknown) {
    return undefined;
  }
}

function invalidProfileError(): SteamIdentityError {
  return new SteamIdentityError('STEAM_PROFILE_INVALID', 'Invalid Steam profile input');
}

function unavailableIdentityError(): SteamIdentityError {
  return new SteamIdentityError(
    'STEAM_VANITY_UNAVAILABLE',
    'Steam vanity resolution is unavailable',
  );
}

function cancelledIdentityError(): SteamIdentityError {
  return new SteamIdentityError('STEAM_IDENTITY_CANCELLED', 'Steam identity resolution cancelled');
}
