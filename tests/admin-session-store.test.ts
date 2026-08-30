import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminSessionCapacityError,
  AdminSessionStore,
} from '../src/admin/session-store.js';

function deterministicRandom(): (size: number) => Buffer {
  let value = 0;
  return (size) => {
    value += 1;
    return createHash('sha256').update(String(value)).digest().subarray(0, size);
  };
}

describe('AdminSessionStore', () => {
  it('stores token hashes and verifies CSRF values with the owning session', () => {
    // Given
    const store = new AdminSessionStore({ now: () => 5_000, randomBytes: deterministicRandom() });

    // When
    const credentials = store.createSession('alice');

    // Then
    expect(credentials.sessionToken).not.toBe(credentials.csrfToken);
    expect(store.resolveSession(credentials.sessionToken)).toEqual({ username: 'alice' });
    expect(store.verifyCsrf(credentials.sessionToken, credentials.csrfToken)).toBe(true);
    expect(store.verifyCsrf(credentials.sessionToken, `${credentials.csrfToken}x`)).toBe(false);
    expect(store.hasStoredHash(createHash('sha256').update(credentials.sessionToken).digest('hex'))).toBe(true);
    expect(store.hasStoredValue(credentials.sessionToken)).toBe(false);
    expect(store.hasStoredValue(credentials.csrfToken)).toBe(false);
  });

  it('resolves an authenticated view with a valid CSRF token after a redirect', () => {
    // Given
    const store = new AdminSessionStore({ now: () => 5_000, randomBytes: deterministicRandom() });
    const credentials = store.createSession('alice');

    // When
    const view = store.resolveAuthenticatedView(credentials.sessionToken);

    // Then
    expect(view).toEqual({ username: 'alice', csrfToken: credentials.csrfToken });
    expect(Buffer.from(view?.csrfToken ?? '', 'base64url')).toHaveLength(32);
    expect(view && store.verifyCsrf(credentials.sessionToken, view.csrfToken)).toBe(true);
    expect(store.verifyCsrf(credentials.sessionToken, credentials.sessionToken)).toBe(false);
    expect(store.hasStoredValue(credentials.sessionToken)).toBe(false);
    expect(store.hasStoredValue(credentials.csrfToken)).toBe(false);
  });

  it('rotates both tokens and invalidates the previous session', () => {
    // Given
    const store = new AdminSessionStore({ now: () => 9_000, randomBytes: deterministicRandom() });
    const original = store.createSession('alice');

    // When
    const rotated = store.rotateSession(original.sessionToken);

    // Then
    expect(rotated).not.toBeNull();
    expect(store.resolveSession(original.sessionToken)).toBeNull();
    expect(rotated && store.resolveSession(rotated.sessionToken)).toEqual({ username: 'alice' });
    expect(rotated && store.verifyCsrf(rotated.sessionToken, original.csrfToken)).toBe(false);
    expect(rotated?.csrfToken).not.toBe(original.csrfToken);
    const rotatedView = rotated === null ? null : store.resolveAuthenticatedView(rotated.sessionToken);
    expect(rotatedView?.csrfToken).toBe(rotated?.csrfToken);
  });

  it('enforces idle and absolute session expiry', () => {
    // Given
    let now = 0;
    const store = new AdminSessionStore({ now: () => now, randomBytes: deterministicRandom() });
    const idle = store.createSession('idle-user');

    // When / Then
    now = 30 * 60 * 1_000;
    expect(store.resolveSession(idle.sessionToken)).toBeNull();

    now = 0;
    const absolute = store.createSession('absolute-user');
    for (now = 29 * 60 * 1_000; now < 8 * 60 * 60 * 1_000; now += 29 * 60 * 1_000) {
      expect(store.resolveSession(absolute.sessionToken)).toEqual({ username: 'absolute-user' });
    }
    now = 8 * 60 * 60 * 1_000;
    expect(store.resolveSession(absolute.sessionToken)).toBeNull();
  });

  it('does not extend idle expiry for an invalid CSRF value', () => {
    // Given
    let now = 0;
    const store = new AdminSessionStore({ now: () => now, randomBytes: deterministicRandom() });
    const session = store.createSession('alice');

    // When
    now = 29 * 60 * 1_000;
    expect(store.verifyCsrf(session.sessionToken, 'invalid')).toBe(false);
    now = 31 * 60 * 1_000;

    // Then
    expect(store.resolveSession(session.sessionToken)).toBeNull();
  });

  it('rejects a new session without evicting when 256 active sessions exist', () => {
    // Given
    const store = new AdminSessionStore({ now: () => 0, randomBytes: deterministicRandom() });
    const oldestSession = store.createSession('oldest');

    // When
    for (let index = 0; index < 255; index += 1) {
      store.createSession(`user-${index}`);
    }

    // Then
    expect(() => store.createSession('overflow')).toThrow(AdminSessionCapacityError);
    expect(store.resolveSession(oldestSession.sessionToken)).toEqual({ username: 'oldest' });
    expect(store.size()).toBe(256);
  });

  it('preflights full capacity without mutating sessions or consuming entropy', () => {
    // Given
    const randomBytes = vi.fn(deterministicRandom());
    const store = new AdminSessionStore({ now: () => 0, randomBytes });
    for (let index = 0; index < 256; index += 1) {
      store.createSession(`user-${index}`);
    }
    randomBytes.mockClear();

    // When
    const hasCapacity = store.hasCapacity();

    // Then
    expect(hasCapacity).toBe(false);
    expect(store.size()).toBe(256);
    expect(randomBytes).not.toHaveBeenCalled();
  });

  it('prunes expired sessions before applying the session capacity limit', () => {
    // Given
    let now = 0;
    const store = new AdminSessionStore({ now: () => now, randomBytes: deterministicRandom() });
    for (let index = 0; index < 256; index += 1) {
      store.createSession(`user-${index}`);
    }

    // When
    now = 30 * 60 * 1_000;
    const replacement = store.createSession('replacement');

    // Then
    expect(store.resolveSession(replacement.sessionToken)).toEqual({ username: 'replacement' });
    expect(store.size()).toBe(1);
  });
});
