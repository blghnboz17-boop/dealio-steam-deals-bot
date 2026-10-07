import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
 * Owner sessions for the admin panel: one shared secret from the environment, kept
 * in memory only. A restart signs the owner out. Repeated wrong tokens lock login.
 */
export class AdminSessions {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly tokenDigest: Buffer;
  private readonly loginCodes = new Map<string, number>();
  private failures: number[] = [];

  public constructor(
    token: string,
    private readonly now: () => number = Date.now,
  ) {
    this.tokenDigest = digest(token);
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

  private checkToken(candidate: string, now: number): Exclude<AdminLoginResult, { readonly status: 'ok' }> | null {
    this.failures = this.failures.filter((at) => at > now - failureWindowMs);
    if (this.failures.length >= maximumFailures) {
      return { status: 'locked', retryAfterMs: this.failures[0]! + failureWindowMs - now };
    }
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
