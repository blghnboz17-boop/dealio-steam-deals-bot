import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import {
  AdminChallengeStore,
  type AdminChallengeCredentials,
  type AdminChallengeIssueResult,
} from '../src/admin/challenge-store.js';
import { parseAdminClientIdentity } from '../src/admin/client-identity.js';
import { AdminLoginService } from '../src/admin/login-service.js';
import { AdminLoginThrottle } from '../src/admin/login-throttle.js';
import { AdminSessionStore } from '../src/admin/session-store.js';

function deterministicRandom(): (size: number) => Buffer {
  let value = 0;
  return (size) => createHash('sha256').update(String(value += 1)).digest().subarray(0, size);
}

export function client(address = '203.0.113.7') {
  return parseAdminClientIdentity({
    peerAddress: '127.0.0.1',
    rawHeaders: ['X-Dealio-Client-IP', address],
  });
}

export function credentials(result: AdminChallengeIssueResult): AdminChallengeCredentials {
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

export function fixture() {
  const challengeEntropy = vi.fn(deterministicRandom());
  const challenges = new AdminChallengeStore({ now: () => 0, randomBytes: challengeEntropy });
  const sessions = new AdminSessionStore({ now: () => 0, randomBytes: deterministicRandom() });
  const throttle = new AdminLoginThrottle({ now: () => 0, random: () => 0 });
  const verifyPassword = vi.fn((username: string, password: string) =>
    username === 'alice' && password === 'correct password');
  const service = new AdminLoginService({ challenges, sessions, throttle, verifyPassword });
  return { challengeEntropy, challenges, sessions, throttle, verifyPassword, service };
}
