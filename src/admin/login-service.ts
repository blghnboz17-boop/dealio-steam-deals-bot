import type {
  AdminChallengeCredentials,
  AdminChallengeIssueResult,
  AdminChallengeStore,
} from './challenge-store.js';
import type { AdminClientIdentity } from './client-identity.js';
import type { AdminLoginThrottle } from './login-throttle.js';
import type { AdminSessionCredentials, AdminSessionStore } from './session-store.js';

export type AdminLoginAttempt = {
  readonly client: AdminClientIdentity;
  readonly username: string;
  readonly password: string;
  readonly challengeToken: string;
  readonly csrfToken: string;
};

export type AdminLoginResult =
  | {
    readonly kind: 'rate_limited';
    readonly username: string;
    readonly retryAfterSeconds: number;
  }
  | { readonly kind: 'capacity'; readonly username: string }
  | {
    readonly kind: 'failed';
    readonly username: string;
    readonly challenge: AdminChallengeCredentials;
  }
  | {
    readonly kind: 'authenticated';
    readonly username: string;
    readonly session: AdminSessionCredentials;
  };

export type AdminLoginServiceDependencies = {
  readonly challenges: AdminChallengeStore;
  readonly sessions: AdminSessionStore;
  readonly throttle: AdminLoginThrottle;
  readonly verifyPassword: (username: string, password: string) => boolean;
};

export class InvalidAdminLoginDecisionError extends Error {
  public readonly name = 'InvalidAdminLoginDecisionError';

  public constructor() {
    super('Invalid admin login decision');
  }
}

function assertNever(value: never): never {
  throw new InvalidAdminLoginDecisionError();
}

export class AdminLoginService {
  public constructor(private readonly dependencies: AdminLoginServiceDependencies) {}

  public issueChallenge(client: AdminClientIdentity): AdminChallengeIssueResult {
    return this.dependencies.challenges.issue(client);
  }

  public attempt(attempt: AdminLoginAttempt): AdminLoginResult {
    const preflight = this.dependencies.throttle.preflight(attempt.username, attempt.client);
    switch (preflight.kind) {
      case 'blocked':
        return {
          kind: 'rate_limited',
          username: attempt.username,
          retryAfterSeconds: preflight.retryAfterSeconds,
        };
      case 'allowed':
        return this.attemptAllowed(attempt);
      default:
        return assertNever(preflight);
    }
  }

  private attemptAllowed(attempt: AdminLoginAttempt): AdminLoginResult {
    if (!this.dependencies.sessions.hasCapacity()) {
      return { kind: 'capacity', username: attempt.username };
    }

    const replacementAvailability = this.dependencies.challenges.preflightIssue(attempt.client);
    switch (replacementAvailability.kind) {
      case 'rate_limited':
        return {
          kind: 'rate_limited',
          username: attempt.username,
          retryAfterSeconds: replacementAvailability.retryAfterSeconds,
        };
      case 'capacity':
        return { kind: 'capacity', username: attempt.username };
      case 'available':
        break;
      default:
        return assertNever(replacementAvailability);
    }

    if (!this.dependencies.challenges.hasAvailable(attempt.client)) {
      return this.failure(attempt);
    }
    const challengeValid = this.dependencies.challenges.consume(
      attempt.client,
      attempt.challengeToken,
      attempt.csrfToken,
    );
    if (!challengeValid) return this.failure(attempt);
    if (!this.dependencies.verifyPassword(attempt.username, attempt.password)) {
      return this.failure(attempt);
    }

    const session = this.dependencies.sessions.createSession(attempt.username);
    this.dependencies.throttle.recordSuccess(attempt.username);
    return { kind: 'authenticated', username: attempt.username, session };
  }

  private failure(attempt: AdminLoginAttempt): AdminLoginResult {
    const replacement = this.dependencies.challenges.issue(attempt.client);
    switch (replacement.kind) {
      case 'rate_limited':
        return {
          kind: 'rate_limited',
          username: attempt.username,
          retryAfterSeconds: replacement.retryAfterSeconds,
        };
      case 'capacity':
        return { kind: 'capacity', username: attempt.username };
      case 'issued':
        this.dependencies.throttle.recordFailure(attempt.username, attempt.client);
        return {
          kind: 'failed',
          username: attempt.username,
          challenge: replacement.challenge,
        };
      default:
        return assertNever(replacement);
    }
  }
}
