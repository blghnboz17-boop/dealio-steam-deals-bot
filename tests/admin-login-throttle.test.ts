import { describe, expect, it } from 'vitest';
import { parseAdminClientIdentity } from '../src/admin/client-identity.js';
import { AdminLoginThrottle } from '../src/admin/login-throttle.js';

function client(address: string) {
  return parseAdminClientIdentity({
    peerAddress: '127.0.0.1',
    rawHeaders: ['X-Dealio-Client-IP', address],
  });
}

describe('AdminLoginThrottle', () => {
  it('blocks after five failures for one canonical user', () => {
    // Given
    const throttle = new AdminLoginThrottle({ now: () => 0, random: () => 0 });

    // When
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const attemptClient = client(`203.0.113.${attempt + 1}`);
      expect(throttle.preflight('alice', attemptClient)).toEqual({ kind: 'allowed' });
      throttle.recordFailure('alice', attemptClient);
    }

    // Then
    expect(throttle.preflight('alice', client('203.0.113.20'))).toEqual({
      kind: 'blocked',
      retryAfterSeconds: 900,
    });
    expect(throttle.preflight('bob', client('203.0.113.20'))).toEqual({ kind: 'allowed' });
  });

  it('blocks after thirty client failures and sixty global failures', () => {
    // Given
    const clientThrottle = new AdminLoginThrottle({ now: () => 0, random: () => 0 });
    const globalThrottle = new AdminLoginThrottle({ now: () => 0, random: () => 0 });

    // When
    for (let attempt = 0; attempt < 30; attempt += 1) {
      clientThrottle.recordFailure(`user-${attempt}`, client('203.0.113.1'));
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      globalThrottle.recordFailure(`user-${attempt}`, client(`198.51.100.${attempt + 1}`));
    }

    // Then
    expect(clientThrottle.preflight('new-user', client('203.0.113.1')).kind).toBe('blocked');
    expect(clientThrottle.preflight('new-user', client('203.0.113.2'))).toEqual({ kind: 'allowed' });
    expect(globalThrottle.preflight('brand-new-user', client('192.0.2.1')).kind).toBe('blocked');
  });

  it('resets expired windows and clears a successful user bucket', () => {
    // Given
    let now = 0;
    const throttle = new AdminLoginThrottle({ now: () => now, random: () => 0 });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      throttle.recordFailure('alice', client(`203.0.113.${attempt + 1}`));
    }
    throttle.recordSuccess('alice');

    // When / Then
    expect(throttle.preflight('alice', client('203.0.113.20'))).toEqual({ kind: 'allowed' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      throttle.recordFailure('alice', client(`198.51.100.${attempt + 1}`));
    }
    now = 15 * 60 * 1_000;
    expect(throttle.preflight('alice', client('203.0.113.20'))).toEqual({ kind: 'allowed' });
  });

  it('bounds attacker-controlled user and client buckets', () => {
    // Given
    const throttle = new AdminLoginThrottle({ now: () => 0, random: () => 0.5 });

    // When
    for (let index = 0; index < 300; index += 1) {
      const thirdOctet = Math.floor(index / 254);
      const fourthOctet = (index % 254) + 1;
      throttle.recordFailure(`user-${index}`, client(`10.0.${thirdOctet}.${fourthOctet}`));
    }

    // Then
    expect(throttle.trackedBuckets()).toEqual({ users: 256, clients: 256 });
  });

  it('starts the global window with the first recorded failure', () => {
    // Given
    let now = 0;
    const throttle = new AdminLoginThrottle({ now: () => now, random: () => 0 });
    now = 14 * 60 * 1_000;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      throttle.recordFailure(`user-${attempt}`, client(`198.51.100.${attempt + 1}`));
    }

    // When
    now = 15 * 60 * 1_000 + 1;

    // Then
    expect(throttle.preflight('new-user', client('192.0.2.1'))).toEqual({
      kind: 'blocked',
      retryAfterSeconds: 840,
    });
  });
});
