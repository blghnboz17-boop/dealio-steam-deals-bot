import type { AdminClientIdentity } from './client-identity.js';

const WINDOW_MS = 15 * 60 * 1_000;
const USER_LIMIT = 5;
const CLIENT_LIMIT = 30;
const GLOBAL_LIMIT = 60;
const BUCKET_CAPACITY = 256;

type Bucket = {
  count: number;
  readonly startedAt: number;
};

export type AdminLoginPreflight =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'blocked'; readonly retryAfterSeconds: number };

export type AdminLoginThrottleOptions = {
  readonly now?: () => number;
  readonly random?: () => number;
};

function increment(bucket: Bucket, limit: number): void {
  bucket.count = Math.min(bucket.count + 1, limit);
}

export class AdminLoginThrottle {
  private readonly users = new Map<string, Bucket>();
  private readonly clients = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly random: () => number;
  private global: Bucket | null = null;

  public constructor(options: AdminLoginThrottleOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  public preflight(username: string, client: AdminClientIdentity): AdminLoginPreflight {
    return this.decision(username, client.address);
  }

  public canAttempt(username: string, socketId: string): boolean {
    return this.decision(username, socketId).kind === 'allowed';
  }

  public recordFailure(username: string, client: AdminClientIdentity): void;
  public recordFailure(username: string, socketId: string): void;
  public recordFailure(username: string, client: AdminClientIdentity | string): void {
    this.prune();
    const clientAddress = typeof client === 'string' ? client : client.address;
    increment(this.bucket(this.users, username), USER_LIMIT);
    increment(this.bucket(this.clients, clientAddress), CLIENT_LIMIT);
    const global = this.global ?? { count: 0, startedAt: this.now() };
    this.global = global;
    increment(global, GLOBAL_LIMIT);
  }

  public recordSuccess(username: string): void {
    this.prune();
    this.users.delete(username);
  }

  public trackedBuckets(): { readonly users: number; readonly clients: number } {
    this.prune();
    return { users: this.users.size, clients: this.clients.size };
  }

  private decision(username: string, clientAddress: string): AdminLoginPreflight {
    this.prune();
    const now = this.now();
    const blockedUntil = [
      this.blockedUntil(this.users.get(username), USER_LIMIT),
      this.blockedUntil(this.clients.get(clientAddress), CLIENT_LIMIT),
      this.blockedUntil(this.global, GLOBAL_LIMIT),
    ].reduce((latest, expiry) => Math.max(latest, expiry), 0);
    if (blockedUntil === 0) return { kind: 'allowed' };
    return {
      kind: 'blocked',
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)),
    };
  }

  private blockedUntil(bucket: Bucket | null | undefined, limit: number): number {
    return bucket !== null && bucket !== undefined && bucket.count >= limit
      ? bucket.startedAt + WINDOW_MS
      : 0;
  }

  private bucket(buckets: Map<string, Bucket>, key: string): Bucket {
    const existing = buckets.get(key);
    if (existing !== undefined) return existing;
    if (buckets.size >= BUCKET_CAPACITY) this.evictRandom(buckets);
    const created = { count: 0, startedAt: this.now() };
    buckets.set(key, created);
    return created;
  }

  private evictRandom(buckets: Map<string, Bucket>): void {
    const random = this.random();
    if (!Number.isFinite(random) || random < 0 || random >= 1) {
      throw new RangeError('Admin throttle random source must return a value from 0 through 1');
    }
    let remaining = Math.floor(random * buckets.size);
    for (const key of buckets.keys()) {
      if (remaining === 0) {
        buckets.delete(key);
        return;
      }
      remaining -= 1;
    }
  }

  private prune(): void {
    const now = this.now();
    this.pruneBuckets(this.users, now);
    this.pruneBuckets(this.clients, now);
    if (this.global !== null && this.global.startedAt + WINDOW_MS <= now) this.global = null;
  }

  private pruneBuckets(buckets: Map<string, Bucket>, now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.startedAt + WINDOW_MS <= now) buckets.delete(key);
    }
  }
}
