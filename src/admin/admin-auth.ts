import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  hashOwnerPassword, validateOwnerCredentials, verifyOwnerPassword, type OwnerCredentialStore,
} from './owner-credentials.js';

export interface AdminSession {
  readonly id: string;
  readonly csrf: string;
  readonly expiresAt: number;
}

export type AdminLoginResult =
  | { readonly status: 'ok'; readonly session: AdminSession }
  | { readonly status: 'invalid' }
  | { readonly status: 'locked'; readonly retryAfterMs: number };

export type AdminLoginCodeResult =
  | { readonly status: 'ok'; readonly code: string }
  | Exclude<AdminLoginResult, { readonly status: 'ok' }>;

const sessionTtlMs = 12 * 3600_000;
const failureWindowMs = 15 * 60_000;
const maximumFailures = 10;
const maximumSessions = 20;
const loginCodeTtlMs = 60_000;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Owner sessions for the admin panel, kept in memory only; a restart signs the owner
 * out. The owner signs in with their own username and password once they set one;
 * the environment token stays valid for the tunnel script and as the way back in.
 * Repeated wrong tokens or passwords lock login.
 */
export class AdminSessions {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly tokenDigest: Buffer;
  private readonly loginCodes = new Map<string, number>();
  private failures: number[] = [];

  public constructor(
    token: string,
    private readonly now: () => number = Date.now,
    private readonly credentials: OwnerCredentialStore | null = null,
  ) {
    this.tokenDigest = digest(token);
  }

  public passwordLoginEnabled(): boolean {
    return this.credentials?.read() != null;
  }

  public ownerUsername(): string | null {
    return this.credentials?.read()?.username ?? null;
  }

  public async loginWithPassword(username: string, password: string): Promise<AdminLoginResult> {
    const locked = this.lockout(this.now());
    if (locked) return locked;
    const stored = this.credentials?.read() ?? null;
    // Without stored credentials the hash still runs, so timing does not tell either case apart.
    const passwordMatches = stored
      ? await verifyOwnerPassword(password, stored.passwordHash)
      : (await hashOwnerPassword(password), false);
    const usernameMatches = stored !== null && timingSafeEqual(digest(username), digest(stored.username));
    const now = this.now();
    if (!passwordMatches || !usernameMatches) {
      this.failures.push(now);
      return { status: 'invalid' };
    }
    this.failures = [];
    return { status: 'ok', session: this.createSession(now) };
  }

  /** Sets the owner's username and password and signs out every other session. */
  public async setOwnerCredentials(username: string, password: string, keepSessionId: string): Promise<void> {
    if (!this.credentials) throw new Error('Owner credentials are not available');
    validateOwnerCredentials(username, password);
    this.credentials.write({ username, passwordHash: await hashOwnerPassword(password) });
    this.revokeOtherSessions(keepSessionId);
  }

  public clearOwnerCredentials(keepSessionId: string): void {
    this.credentials?.write(null);
    this.revokeOtherSessions(keepSessionId);
  }

  private revokeOtherSessions(keepSessionId: string): void {
    for (const id of this.sessions.keys()) if (id !== keepSessionId) this.sessions.delete(id);
    this.loginCodes.clear();
  }

  public login(candidate: string): AdminLoginResult {
    const now = this.now();
    const check = this.checkToken(candidate, now);
    if (check) return check;
    return { status: 'ok', session: this.createSession(now) };
  }

  /**
   * A single-use code for `#login=<code>` links (scripts/admin-tunnel.ps1), so the
   * token itself never lands in a URL, browser history or a process command line.
   */
  public issueLoginCode(candidate: string): AdminLoginCodeResult {
    const now = this.now();
    const check = this.checkToken(candidate, now);
    if (check) return check;
    for (const [code, expiresAt] of this.loginCodes) if (expiresAt <= now) this.loginCodes.delete(code);
    if (this.loginCodes.size >= maximumSessions) this.loginCodes.delete(this.loginCodes.keys().next().value!);
    const code = randomBytes(32).toString('base64url');
    this.loginCodes.set(code, now + loginCodeTtlMs);
    return { status: 'ok', code };
  }

  /** Exchanges a login code once; unknown, used and expired codes are all `invalid`. */
  public redeemLoginCode(code: string): AdminLoginResult {
    const now = this.now();
    const expiresAt = this.loginCodes.get(code);
    if (expiresAt === undefined) return { status: 'invalid' };
    this.loginCodes.delete(code);
    if (expiresAt <= now) return { status: 'invalid' };
    return { status: 'ok', session: this.createSession(now) };
  }

  private lockout(now: number): { readonly status: 'locked'; readonly retryAfterMs: number } | null {
    this.failures = this.failures.filter((at) => at > now - failureWindowMs);
    return this.failures.length >= maximumFailures
      ? { status: 'locked', retryAfterMs: this.failures[0]! + failureWindowMs - now }
      : null;
  }

  private checkToken(candidate: string, now: number): Exclude<AdminLoginResult, { readonly status: 'ok' }> | null {
    const locked = this.lockout(now);
    if (locked) return locked;
    if (!timingSafeEqual(digest(candidate), this.tokenDigest)) {
      this.failures.push(now);
      return { status: 'invalid' };
    }
    this.failures = [];
    return null;
  }

  private createSession(now: number): AdminSession {
    this.prune(now);
    if (this.sessions.size >= maximumSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (oldest) this.sessions.delete(oldest.id);
    }
    const session: AdminSession = {
      id: randomBytes(32).toString('base64url'),
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: now + sessionTtlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  public get(sessionId: string | undefined): AdminSession | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  public logout(sessionId: string | undefined): void {
    if (sessionId) this.sessions.delete(sessionId);
  }

  private prune(now: number): void {
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
  }
}

export function csrfMatches(expected: string, received: string | undefined): boolean {
  return received !== undefined && timingSafeEqual(digest(expected), digest(received));
}
