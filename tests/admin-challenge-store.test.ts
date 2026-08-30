import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminChallengeStore,
  type AdminChallengeCredentials,
  type AdminChallengeIssueResult,
} from '../src/admin/challenge-store.js';
import { parseAdminClientIdentity } from '../src/admin/client-identity.js';

function deterministicRandom(): (size: number) => Buffer {
  let value = 0;
  return (size) => createHash('sha256').update(String(value += 1)).digest().subarray(0, size);
}

function client(address: string) {
  return parseAdminClientIdentity({
    peerAddress: '127.0.0.1',
    rawHeaders: ['X-Dealio-Client-IP', address],
  });
}

function credentials(result: AdminChallengeIssueResult): AdminChallengeCredentials {
  switch (result.kind) {
    case 'issued':
      return result.challenge;
    case 'rate_limited':
    case 'capacity':
      throw new TypeError(`Expected issued challenge, received ${result.kind}`);
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new TypeError('Unexpected challenge result');
}

describe('AdminChallengeStore', () => {
  it('isolates one rotating challenge per canonical client and consumes only its owner', () => {
    // Given
    const store = new AdminChallengeStore({ now: () => 0, randomBytes: deterministicRandom() });
    const firstClient = client('203.0.113.1');
    const secondClient = client('203.0.113.2');
    const original = credentials(store.issue(firstClient));

    // When
    const crossClient = store.consume(secondClient, original.challengeToken, original.csrfToken);
    const ownClient = store.consume(firstClient, original.challengeToken, original.csrfToken);
    const other = credentials(store.issue(secondClient));

    // Then
    expect(crossClient).toBe(false);
    expect(ownClient).toBe(true);
    expect(store.consume(secondClient, other.challengeToken, other.csrfToken)).toBe(true);
  });

  it('rotates an existing owner challenge and consumes it after any presented attempt', () => {
    // Given
    const store = new AdminChallengeStore({ now: () => 0, randomBytes: deterministicRandom() });
    const owner = client('203.0.113.1');
    const original = credentials(store.issue(owner));
    const replacement = credentials(store.issue(owner));

    // When
    const originalAccepted = store.consume(owner, original.challengeToken, original.csrfToken);
    const mismatchAccepted = store.consume(owner, replacement.challengeToken, 'invalid');
    const retryAccepted = store.consume(owner, replacement.challengeToken, replacement.csrfToken);

    // Then
    expect({ originalAccepted, mismatchAccepted, retryAccepted }).toEqual({
      originalAccepted: false,
      mismatchAccepted: false,
      retryAccepted: false,
    });
  });

  it('expires challenges after ten minutes without availability mutation', () => {
    // Given
    let now = 0;
    const store = new AdminChallengeStore({ now: () => now, randomBytes: deterministicRandom() });
    const owner = client('203.0.113.1');
    const challenge = credentials(store.issue(owner));

    // When
    now = 10 * 60 * 1_000;

    // Then
    expect(store.hasAvailable(owner)).toBe(false);
    expect(store.consume(owner, challenge.challengeToken, challenge.csrfToken)).toBe(false);
  });

  it('preflights issuance without entropy or owner mutation', () => {
    // Given
    const entropy = vi.fn(deterministicRandom());
    const store = new AdminChallengeStore({ now: () => 0, randomBytes: entropy });
    const owner = client('203.0.113.1');

    // When
    const result = store.preflightIssue(owner);

    // Then
    expect(result).toEqual({ kind: 'available' });
    expect(entropy).not.toHaveBeenCalled();
    expect(store.trackedOwners()).toBe(0);
  });

  it('allows the sixtieth issuance and returns typed Retry-After on the sixty-first', () => {
    // Given
    let now = 0;
    const entropy = vi.fn(deterministicRandom());
    const store = new AdminChallengeStore({ now: () => now, randomBytes: entropy });
    const owner = client('203.0.113.1');
    let latest = credentials(store.issue(owner));
    for (let issuance = 1; issuance < 60; issuance += 1) {
      latest = credentials(store.issue(owner));
    }
    entropy.mockClear();

    // When
    const preflight = store.preflightIssue(owner);
    const result = store.issue(owner);

    // Then
    expect(preflight).toEqual({ kind: 'rate_limited', retryAfterSeconds: 900 });
    expect(result).toEqual({ kind: 'rate_limited', retryAfterSeconds: 900 });
    expect(entropy).not.toHaveBeenCalled();
    expect(store.consume(owner, latest.challengeToken, latest.csrfToken)).toBe(true);
    now = 15 * 60 * 1_000;
    expect(credentials(store.issue(owner)).challengeToken).toHaveLength(43);
  });

  it('rejects a new owner at 256 without eviction but lets an existing owner rotate', () => {
    // Given
    const entropy = vi.fn(deterministicRandom());
    const store = new AdminChallengeStore({ now: () => 0, randomBytes: entropy });
    const oldestOwner = client('10.0.0.1');
    const oldest = credentials(store.issue(oldestOwner));
    for (let index = 2; index <= 256; index += 1) {
      const thirdOctet = Math.floor((index - 1) / 254);
      const fourthOctet = ((index - 1) % 254) + 1;
      credentials(store.issue(client(`10.0.${thirdOctet}.${fourthOctet}`)));
    }
    entropy.mockClear();

    // When
    const rejectedOwner = client('10.1.0.1');
    const preflight = store.preflightIssue(rejectedOwner);
    const rejected = store.issue(rejectedOwner);

    // Then
    expect(preflight).toEqual({ kind: 'capacity' });
    expect(rejected).toEqual({ kind: 'capacity' });
    expect(entropy).not.toHaveBeenCalled();
    expect(store.trackedOwners()).toBe(256);
    const rotated = credentials(store.issue(oldestOwner));
    expect(rotated.challengeToken).not.toBe(oldest.challengeToken);
    expect(store.trackedOwners()).toBe(256);
  });
});
