import { describe, expect, it, vi } from 'vitest';
import { client, credentials, fixture } from './admin-login-service-fixture.js';

describe('AdminLoginService preflight', () => {
  it('exposes typed challenge issuance for the login page', () => {
    // Given
    const setup = fixture();
    const owner = client();

    // When
    const result = setup.service.issueChallenge(owner);

    // Then
    expect(result.kind).toBe('issued');
    expect(credentials(result).challengeToken).toHaveLength(43);
  });

  it('returns login rate limit before challenge access, entropy, verification, or mutation', () => {
    // Given
    const setup = fixture();
    const owner = client();
    const challenge = credentials(setup.service.issueChallenge(owner));
    for (let failure = 0; failure < 5; failure += 1) {
      setup.throttle.recordFailure('alice', client(`198.51.100.${failure + 1}`));
    }
    setup.challengeEntropy.mockClear();
    const issuancePreflight = vi.spyOn(setup.challenges, 'preflightIssue');
    const availability = vi.spyOn(setup.challenges, 'hasAvailable');
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const issuance = vi.spyOn(setup.challenges, 'issue');
    const failure = vi.spyOn(setup.throttle, 'recordFailure');
    const success = vi.spyOn(setup.throttle, 'recordSuccess');
    const session = vi.spyOn(setup.sessions, 'createSession');

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: challenge.challengeToken,
      csrfToken: challenge.csrfToken,
    });

    // Then
    expect(result).toEqual({ kind: 'rate_limited', username: 'alice', retryAfterSeconds: 900 });
    expect(issuancePreflight).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
    expect(consumption).not.toHaveBeenCalled();
    expect(issuance).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(setup.challengeEntropy).not.toHaveBeenCalled();
    expect(setup.challenges.consume(owner, challenge.challengeToken, challenge.csrfToken)).toBe(true);
  });

  it('returns replacement rate limit before consuming or verifying', () => {
    // Given
    const setup = fixture();
    const owner = client();
    let latest = credentials(setup.service.issueChallenge(owner));
    for (let issuance = 1; issuance < 60; issuance += 1) {
      latest = credentials(setup.service.issueChallenge(owner));
    }
    setup.challengeEntropy.mockClear();
    expect(setup.service.issueChallenge(owner)).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 900,
    });
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const issuance = vi.spyOn(setup.challenges, 'issue');
    const failure = vi.spyOn(setup.throttle, 'recordFailure');

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: latest.challengeToken,
      csrfToken: latest.csrfToken,
    });

    // Then
    expect(result).toEqual({ kind: 'rate_limited', username: 'alice', retryAfterSeconds: 900 });
    expect(consumption).not.toHaveBeenCalled();
    expect(issuance).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(setup.challengeEntropy).not.toHaveBeenCalled();
    expect(setup.challenges.consume(owner, latest.challengeToken, latest.csrfToken)).toBe(true);
  });

  it('returns replacement capacity before challenge access, entropy, verification, or mutation', () => {
    // Given
    const setup = fixture();
    for (let index = 0; index < 256; index += 1) {
      const thirdOctet = Math.floor(index / 254);
      const fourthOctet = (index % 254) + 1;
      credentials(setup.service.issueChallenge(client(`10.0.${thirdOctet}.${fourthOctet}`)));
    }
    setup.challengeEntropy.mockClear();
    const owner = client('10.1.0.1');
    expect(setup.service.issueChallenge(owner)).toEqual({ kind: 'capacity' });
    const availability = vi.spyOn(setup.challenges, 'hasAvailable');
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const issuance = vi.spyOn(setup.challenges, 'issue');
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
    expect(result).toEqual({ kind: 'capacity', username: 'alice' });
    expect(availability).not.toHaveBeenCalled();
    expect(consumption).not.toHaveBeenCalled();
    expect(issuance).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(setup.challengeEntropy).not.toHaveBeenCalled();
    expect(setup.challenges.trackedOwners()).toBe(256);
  });

  it('returns session capacity after throttle preflight without downstream side effects', () => {
    // Given
    const setup = fixture();
    const owner = client('198.51.100.72');
    const challenge = credentials(setup.service.issueChallenge(owner));
    for (let index = 0; index < 256; index += 1) {
      setup.sessions.createSession(`operator-${index}`);
    }
    const throttlePreflight = vi.spyOn(setup.throttle, 'preflight');
    const sessionCapacity = vi.spyOn(setup.sessions, 'hasCapacity');
    const createSession = vi.spyOn(setup.sessions, 'createSession');
    const challengePreflight = vi.spyOn(setup.challenges, 'preflightIssue');
    const availability = vi.spyOn(setup.challenges, 'hasAvailable');
    const consumption = vi.spyOn(setup.challenges, 'consume');
    const failure = vi.spyOn(setup.throttle, 'recordFailure');
    const success = vi.spyOn(setup.throttle, 'recordSuccess');

    // When
    const result = setup.service.attempt({
      client: owner,
      username: 'alice',
      password: 'correct password',
      challengeToken: challenge.challengeToken,
      csrfToken: challenge.csrfToken,
    });

    // Then
    expect(result).toEqual({ kind: 'capacity', username: 'alice' });
    expect(throttlePreflight).toHaveBeenCalledOnce();
    expect(sessionCapacity).toHaveBeenCalledOnce();
    expect(throttlePreflight.mock.invocationCallOrder[0]).toBeLessThan(
      sessionCapacity.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(challengePreflight).not.toHaveBeenCalled();
    expect(availability).not.toHaveBeenCalled();
    expect(consumption).not.toHaveBeenCalled();
    expect(setup.verifyPassword).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(setup.sessions.size()).toBe(256);
    expect(setup.challenges.consume(owner, challenge.challengeToken, challenge.csrfToken)).toBe(true);
  });
});
