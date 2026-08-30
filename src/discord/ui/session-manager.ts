interface UiSession {
  readonly ownerUserId: string;
  readonly expiresAt: number;
}

export type UiSessionResolution = 'active-owner' | 'active-other-user' | 'expired';

class DealioUiSessionManager {
  private readonly sessions = new Map<string, UiSession>();

  public open(
    sessionId: string,
    ownerUserId: string,
    prefixes: readonly string[],
    lifetimeMs: number,
  ): () => void {
    this.prune();
    const expiresAt = Date.now() + lifetimeMs;
    const keys = prefixes.map((prefix) => this.key(prefix, sessionId));
    for (const key of keys) {
      this.sessions.set(key, { ownerUserId, expiresAt });
    }
    return () => {
      for (const key of keys) {
        this.sessions.delete(key);
      }
    };
  }

  public resolve(customId: string, userId: string): UiSessionResolution {
    this.prune();
    const firstSeparator = customId.indexOf(':');
    const secondSeparator = customId.indexOf(':', firstSeparator + 1);
    if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) {
      return 'expired';
    }
    const session = this.sessions.get(customId.slice(0, secondSeparator));
    if (!session) {
      return 'expired';
    }
    return session.ownerUserId === userId ? 'active-owner' : 'active-other-user';
  }

  private key(prefix: string, sessionId: string): string {
    return `${prefix}:${sessionId}`;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }
  }
}

export const dealioUiSessions = new DealioUiSessionManager();
