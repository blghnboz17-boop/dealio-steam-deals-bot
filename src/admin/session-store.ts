import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createAdminToken,
  hashAdminToken,
  hashAdminTokenBytes,
  isAdminToken,
  type AdminRandomSource,
} from './admin-token.js';

const IDLE_LIFETIME_MS = 30 * 60 * 1_000;
const ABSOLUTE_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const SESSION_CAPACITY = 256;
const TOKEN_BYTES = 32;

type Session = {
  readonly username: string;
  readonly csrfHash: Buffer;
  readonly createdAt: number;
  lastSeenAt: number;
};

export type AdminSessionCredentials = {
  readonly sessionToken: string;
  readonly csrfToken: string;
};

export type AdminSessionIdentity = {
  readonly username: string;
};

export type AdminAuthenticatedView = {
  readonly username: string;
  readonly csrfToken: string;
};

export type AdminSessionStoreOptions = {
  readonly now?: () => number;
  readonly randomBytes?: AdminRandomSource;
};

export class AdminSessionCapacityError extends Error {
  public readonly name = 'AdminSessionCapacityError';
  public readonly capacity = SESSION_CAPACITY;

  public constructor() {
    super(`Admin session capacity of ${SESSION_CAPACITY} has been reached`);
  }
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly entropy: AdminRandomSource;
  private readonly csrfSecret: Buffer;

  public constructor(options: AdminSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.entropy = options.randomBytes ?? randomBytes;
    const csrfSecret = this.entropy(TOKEN_BYTES);
    if (csrfSecret.length !== TOKEN_BYTES) {
      throw new RangeError('Admin token source must return exactly 32 bytes');
    }
    this.csrfSecret = Buffer.from(csrfSecret);
  }

  public hasCapacity(): boolean {
    const now = this.now();
    let activeSessions = 0;
    for (const session of this.sessions.values()) {
      if (!this.isExpired(session, now)) activeSessions += 1;
    }
    return activeSessions < SESSION_CAPACITY;
  }

  public createSession(username: string): AdminSessionCredentials {
    this.prune();
    return this.issueSession(username, this.now());
  }

  public resolveSession(token: string): AdminSessionIdentity | null {
    this.prune();
    const session = this.getSession(token);
    if (session === null) return null;
    session.lastSeenAt = this.now();
    return { username: session.username };
  }

  public resolveAuthenticatedView(token: string): AdminAuthenticatedView | null {
    const identity = this.resolveSession(token);
    if (identity === null) return null;
    return { username: identity.username, csrfToken: this.deriveCsrfToken(token) };
  }

  public verifyCsrf(sessionToken: string, csrfToken: string): boolean {
    this.prune();
    const session = this.getSession(sessionToken);
    const candidate = hashAdminTokenBytes(csrfToken);
    const expected = session?.csrfHash ?? Buffer.alloc(candidate.length);
    const matches = timingSafeEqual(candidate, expected);
    const valid = session !== null && isAdminToken(csrfToken) && matches;
    if (valid) session.lastSeenAt = this.now();
    return valid;
  }

  public rotateSession(token: string): AdminSessionCredentials | null {
    this.prune();
    if (!isAdminToken(token)) return null;
    const key = hashAdminToken(token);
    const session = this.sessions.get(key);
    if (session === undefined) return null;
    this.sessions.delete(key);
    return this.issueSession(session.username, session.createdAt);
  }

  public revokeSession(token: string): void {
    if (isAdminToken(token)) this.sessions.delete(hashAdminToken(token));
  }

  public size(): number {
    this.prune();
    return this.sessions.size;
  }

  public hasStoredHash(hash: string): boolean {
    return this.sessions.has(hash);
  }

  public hasStoredValue(value: string): boolean {
    for (const [key, session] of this.sessions) {
      if (key === value || session.csrfHash.toString('hex') === value) return true;
    }
    return false;
  }

  private issueSession(username: string, createdAt: number): AdminSessionCredentials {
    if (this.sessions.size >= SESSION_CAPACITY) throw new AdminSessionCapacityError();
    const sessionToken = createAdminToken(this.entropy);
    const csrfToken = this.deriveCsrfToken(sessionToken);
    this.sessions.set(hashAdminToken(sessionToken), {
      username,
      csrfHash: hashAdminTokenBytes(csrfToken),
      createdAt,
      lastSeenAt: this.now(),
    });
    return { sessionToken, csrfToken };
  }

  private getSession(token: string): Session | null {
    if (!isAdminToken(token)) return null;
    return this.sessions.get(hashAdminToken(token)) ?? null;
  }

  private deriveCsrfToken(sessionToken: string): string {
    return createHmac('sha256', this.csrfSecret).update(sessionToken).digest('base64url');
  }

  private prune(): void {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (this.isExpired(session, now)) this.sessions.delete(key);
    }
  }

  private isExpired(session: Session, now: number): boolean {
    return session.lastSeenAt + IDLE_LIFETIME_MS <= now ||
      session.createdAt + ABSOLUTE_LIFETIME_MS <= now;
  }
}
