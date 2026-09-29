import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createDatabase } from '../../src/persistence/database.js';
import { UserConfigRepository } from '../../src/persistence/user-config-repository.js';
import { CheckStateRepository } from '../../src/persistence/check-state-repository.js';
import { WishlistStateRepository } from '../../src/persistence/wishlist-state-repository.js';
import { CheckService } from '../../src/application/check-service.js';
import { NotificationService } from '../../src/application/notification-service.js';
import { UserOperationCoordinator } from '../../src/application/user-operation-coordinator.js';
import { DiscordNotificationSender } from '../../src/discord/notification-sender.js';
import { SteamClient } from '../../src/steam/steam-client.js';
import { SteamRequestLimiter } from '../../src/steam/request-limiter.js';

/** Offline transport only: there is deliberately no path to global fetch or Discord login. */
export class SteamFixture {
  public mode: 'regular' | 'sale' | 'outage' | 'unknown' | 'wishlist-outage' = 'regular';
  public active = 0;
  public peak = 0;
  public wishlistRequests = 0;
  public priceRequests = 0;
  public rateLimitsRemaining = 0;
  public constructor(public readonly games: number, private readonly sharedGames = true) {}

  public fetch = async (input: string): Promise<Response> => {
    const url = new URL(input);
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    try {
      await nextTurn();
      if (this.rateLimitsRemaining > 0) {
        this.rateLimitsRemaining--;
        return new Response('{}', { status: 429, headers: { 'retry-after': '1' } });
      }
      if (url.pathname.includes('GetWishlist')) {
        this.wishlistRequests++;
        if (this.mode === 'wishlist-outage') return new Response('{}', { status: 503 });
        const offset = this.sharedGames ? 0 : Number(BigInt(url.searchParams.get('steamid')!) - 76561198000000000n) * this.games;
        return Response.json({ response: { items: Array.from({ length: this.games }, (_, n) =>
          ({ appid: offset + n + 1, priority: 1, date_added: 0 })) } }, { headers: { 'x-eresult': '1' } });
      }
      if (!url.pathname.endsWith('/appdetails')) throw new Error('Unexpected offline route');
      this.priceRequests++;
      if (this.mode === 'outage') return new Response('{}', { status: 503 });
      const appId = Number(url.searchParams.get('appids'));
      return Response.json({ [appId]: { success: true, data: {
        steam_appid: appId, name: `Fixture Game ${appId}`, is_free: false,
        ...(this.mode === 'unknown' ? {} : { price_overview: {
          currency: 'USD', initial: 1000, final: this.mode === 'sale' ? 500 : 1000,
          discount_percent: this.mode === 'sale' ? 50 : 0,
        } }),
      } } });
    } finally { this.active--; }
  };
}

export class DiscordFixture {
  public accepted: Array<{ nonce: string; id: string; at: number }> = [];
  public attempts = 0;
  public failure: 'none' | 'before-accept' | 'lost-response' | 'blocked' = 'none';
  public constructor(private readonly now: () => number, public nonceWindowMs = 120_000) {}
  public post = async (route: string, options: { body?: unknown }): Promise<{ id: string }> => {
    await nextTurn();
    if (route === '/users/@me/channels') return { id: '123' };
    if (route !== '/channels/123/messages') throw new Error('Unexpected offline Discord route');
    this.attempts++;
    const body = options.body as { nonce?: string; enforce_nonce?: boolean };
    if (this.failure === 'blocked') throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007, status: 403 });
    if (this.failure === 'before-accept') throw new Error('Offline transport unavailable');
    const previous = this.accepted.find(message => body.enforce_nonce && body.nonce === message.nonce
      && this.now() - message.at < this.nonceWindowMs);
    if (previous) return { id: previous.id };
    const id = String(1000 + this.accepted.length);
    this.accepted.push({ nonce: body.nonce ?? '', id, at: this.now() });
    if (this.failure === 'lost-response') throw new Error('Response lost after acceptance');
    return { id };
  };
}

export function reliabilityFixture(games = 3, options: { retryDelayMs?: number; sendingTimeoutMs?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'dealio-resilience-'));
  const path = join(directory, 'test.sqlite');
  let now = Date.now();
  const steamTransport = new SteamFixture(games);
  const discordTransport = new DiscordFixture(() => now);
  const steam = new SteamClient({ fetchImpl: steamTransport.fetch, requestLimiter: new SteamRequestLimiter(3), now: () => now });
  const open = () => {
    const db = createDatabase(path);
    const users = new UserConfigRepository(db);
    const states = new WishlistStateRepository(db);
    const coordinator = new UserOperationCoordinator();
    const check = new CheckService(users, new CheckStateRepository(db), states, steam, coordinator,
      { cooldownMs: 0, now: () => new Date(now) });
    const sender = new DiscordNotificationSender({ rest: { post: discordTransport.post } } as never);
    const notifications = new NotificationService(users, states, sender, {
      coordinator, now: () => new Date(now), retryBaseDelayMs: options.retryDelayMs,
      sendingTimeoutMs: options.sendingTimeoutMs,
      revalidate: async user => (await check.checkWithinUserOperation(user, 'automatic', { bypassCooldown: true })).status === 'success',
    });
    return { db, users, states, check, notifications };
  };
  let services = open();
  return {
    path,
    get services() { return services; }, steam, steamTransport, discordTransport,
    addUser(user = 'fixture-user', index = 0) {
      return services.users.upsert(user, String(76561198000000000n + BigInt(index)), 'en', 'US', new Date(now).toISOString());
    },
    advance(ms: number) { now += ms; steam.clearPriceCache(); },
    restart() { services.db.close(); steam.clearPriceCache(); services = open(); },
    counts() {
      return services.db.prepare('SELECT status, COUNT(*) AS count FROM notification_log GROUP BY status ORDER BY status').all();
    },
    close() { services.db.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
