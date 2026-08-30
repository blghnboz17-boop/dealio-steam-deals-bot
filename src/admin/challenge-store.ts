import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createAdminToken,
  hashAdminToken,
  hashAdminTokenBytes,
  isAdminToken,
  type AdminRandomSource,
} from './admin-token.js';
import type { AdminClientIdentity } from './client-identity.js';

const CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const ISSUANCE_WINDOW_MS = 15 * 60 * 1_000;
const ISSUANCE_LIMIT = 60;
const OWNER_CAPACITY = 256;

type Challenge = {
  readonly tokenHash: string;
  readonly csrfHash: Buffer;
  readonly expiresAt: number;
};

type OwnerState = {
  challenge: Challenge | null;
  issuanceCount: number;
  windowStartedAt: number;
};

export type AdminChallengeCredentials = {
  readonly challengeToken: string;
  readonly csrfToken: string;
};

export type AdminChallengeIssueAvailability =
  | { readonly kind: 'available' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'capacity' };

export type AdminChallengeIssueResult =
  | { readonly kind: 'issued'; readonly challenge: AdminChallengeCredentials }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'capacity' };

export type AdminChallengeStoreOptions = {
  readonly now?: () => number;
  readonly randomBytes?: AdminRandomSource;
};

export class AdminChallengeCapacityError extends Error {
  public readonly name = 'AdminChallengeCapacityError';
  public readonly status = 503;
  public readonly capacity = OWNER_CAPACITY;

  public constructor() {
    super(`Admin challenge owner capacity of ${OWNER_CAPACITY} has been reached`);
  }
}

export class AdminChallengeRateLimitError extends Error {
  public readonly name = 'AdminChallengeRateLimitError';
  public readonly status = 429;

  public constructor(public readonly retryAfterSeconds: number) {
    super('Admin challenge issuance rate limit exceeded');
  }
}

export class InvalidAdminChallengeDecisionError extends Error {
  public readonly name = 'InvalidAdminChallengeDecisionError';

  public constructor() {
    super('Invalid admin challenge issuance decision');
  }
}

function assertNever(value: never): never {
  throw new InvalidAdminChallengeDecisionError();
}

export class AdminChallengeStore {
  private readonly owners = new Map<string, OwnerState>();
  private readonly now: () => number;
  private readonly entropy: AdminRandomSource;

  public constructor(options: AdminChallengeStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.entropy = options.randomBytes ?? randomBytes;
  }

  public preflightIssue(owner: AdminClientIdentity): AdminChallengeIssueAvailability {
    return this.issueAvailability(owner, this.now());
  }

  public issue(owner: AdminClientIdentity): AdminChallengeIssueResult {
    const now = this.now();
    const availability = this.issueAvailability(owner, now);
    switch (availability.kind) {
      case 'rate_limited':
        return availability;
      case 'capacity':
        return availability;
      case 'available':
        break;
      default:
        return assertNever(availability);
    }

    this.prune(now);
    const state = this.owners.get(owner.address) ?? {
      challenge: null,
      issuanceCount: 0,
      windowStartedAt: now,
    };
    const challengeToken = createAdminToken(this.entropy);
    const csrfToken = createAdminToken(this.entropy);
    state.challenge = {
      tokenHash: hashAdminToken(challengeToken),
      csrfHash: hashAdminTokenBytes(csrfToken),
      expiresAt: now + CHALLENGE_LIFETIME_MS,
    };
    state.issuanceCount += 1;
    this.owners.set(owner.address, state);
    return { kind: 'issued', challenge: { challengeToken, csrfToken } };
  }

  public hasAvailable(owner: AdminClientIdentity): boolean {
    const challenge = this.owners.get(owner.address)?.challenge;
    return challenge !== null && challenge !== undefined && challenge.expiresAt > this.now();
  }

  public consume(
    owner: AdminClientIdentity,
    challengeToken: string,
    csrfToken: string,
  ): boolean {
    const now = this.now();
    this.prune(now);
    const state = this.owners.get(owner.address);
    const challenge = state?.challenge ?? null;
    if (state !== undefined) state.challenge = null;

    const candidate = hashAdminTokenBytes(csrfToken);
    const expected = challenge?.csrfHash ?? Buffer.alloc(candidate.length);
    const matches = timingSafeEqual(candidate, expected);
    return challenge !== null &&
      isAdminToken(challengeToken) &&
      hashAdminToken(challengeToken) === challenge.tokenHash &&
      isAdminToken(csrfToken) &&
      matches;
  }

  public trackedOwners(): number {
    this.prune(this.now());
    return this.owners.size;
  }

  public hasStoredValue(value: string): boolean {
    for (const state of this.owners.values()) {
      const challenge = state.challenge;
      if (challenge?.tokenHash === value || challenge?.csrfHash.toString('hex') === value) return true;
    }
    return false;
  }

  private issueAvailability(
    owner: AdminClientIdentity,
    now: number,
  ): AdminChallengeIssueAvailability {
    const state = this.owners.get(owner.address);
    const ownerTracked = state !== undefined && state.windowStartedAt + ISSUANCE_WINDOW_MS > now;
    if (ownerTracked && state.issuanceCount >= ISSUANCE_LIMIT) {
      return {
        kind: 'rate_limited',
        retryAfterSeconds: Math.ceil(
          (state.windowStartedAt + ISSUANCE_WINDOW_MS - now) / 1_000,
        ),
      };
    }
    if (ownerTracked) return { kind: 'available' };

    let trackedOwners = 0;
    for (const candidate of this.owners.values()) {
      if (candidate.windowStartedAt + ISSUANCE_WINDOW_MS > now) trackedOwners += 1;
    }
    return trackedOwners >= OWNER_CAPACITY ? { kind: 'capacity' } : { kind: 'available' };
  }

  private prune(now: number): void {
    for (const [address, state] of this.owners) {
      if (state.challenge !== null && state.challenge.expiresAt <= now) state.challenge = null;
      if (state.windowStartedAt + ISSUANCE_WINDOW_MS <= now) this.owners.delete(address);
    }
  }
}
