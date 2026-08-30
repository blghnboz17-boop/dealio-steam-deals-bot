import { describe, expect, it, vi } from 'vitest';
import { client, credentials, fixture } from './admin-login-service-fixture.js';

describe('AdminLoginService authentication', () => {
  it('returns one replacement and username when no challenge is available', () => {
    // Given
    const setup = fixture();
    const owner = client();
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const failure = vi.spyOn(setup.throttle, 'recordFailure');

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: 'missing',
      csrfToken: 'missing',
    });

    // Then
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new TypeError('Expected failed result');
    expect(result.username).toBe('alice');
    expect(result.challenge.challengeToken).toHaveLength(43);
    expect(consumption).not.toHaveBeenCalled();
    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledOnce();
    expect(setup.challengeEntropy).toHaveBeenCalledTimes(2);
  });

  it('consumes then verifies before returning one failure replacement', () => {
    // Given
    const setup = fixture();
    const owner = client();
    const challenge = credentials(setup.service.issueChallenge(owner));
    const issuancePreflight = vi.spyOn(setup.challenges, 'preflightIssue');
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const issuance = vi.spyOn(setup.challenges, 'issue');

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'wrong password',
      challengeToken: challenge.challengeToken,
      csrfToken: challenge.csrfToken,
    });

    // Then
    expect(result.kind).toBe('failed');
    expect(consumption).toHaveBeenCalledOnce();
    expect(setup.verifyPassword).toHaveBeenCalledOnce();
    expect(issuance).toHaveBeenCalledOnce();
    expect(issuancePreflight.mock.invocationCallOrder[0]).toBeLessThan(
      consumption.mock.invocationCallOrder[0] ?? 0,
    );
    expect(consumption.mock.invocationCallOrder[0]).toBeLessThan(
      setup.verifyPassword.mock.invocationCallOrder[0] ?? 0,
    );
    expect(setup.verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(
      issuance.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not verify a password after invalid owner challenge consumption', () => {
    // Given
    const setup = fixture();
    const owner = client();
    credentials(setup.service.issueChallenge(owner));

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: 'invalid',
      csrfToken: 'invalid',
    });

    // Then
    expect(result.kind).toBe('failed');
    expect(setup.verifyPassword).not.toHaveBeenCalled();
  });

  it('keeps unknown-user failure generic while returning the attempted username', () => {
    // Given
    const setup = fixture();
    const owner = client();
    const challenge = credentials(setup.service.issueChallenge(owner));

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'unknown',
      password: 'correct password',
      challengeToken: challenge.challengeToken,
      csrfToken: challenge.csrfToken,
    });

    // Then
    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') throw new TypeError('Expected failed result');
    expect(result.username).toBe('unknown');
    expect(setup.verifyPassword).toHaveBeenCalledWith('unknown', 'correct password');
  });

  it('creates a strict session and returns username for caller-owned auditing', () => {
    // Given
    const setup = fixture();
    const owner = client();
    for (let failure = 0; failure < 4; failure += 1) {
      setup.throttle.recordFailure('alice', client(`198.51.100.${failure + 1}`));
    }
    const challenge = credentials(setup.service.issueChallenge(owner));

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: challenge.challengeToken,
      csrfToken: challenge.csrfToken,
    });

    // Then
    expect(result.kind).toBe('authenticated');
    if (result.kind !== 'authenticated') throw new TypeError('Expected authenticated result');
    expect(result.username).toBe('alice');
    expect(setup.sessions.resolveSession(result.session.sessionToken)).toEqual({ username: 'alice' });
    expect(setup.sessions.verifyCsrf(result.session.sessionToken, result.session.csrfToken)).toBe(true);
    expect(setup.throttle.preflight('alice', client('192.0.2.1'))).toEqual({ kind: 'allowed' });
  });
});
