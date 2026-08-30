import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SECURITY_HEADERS } from '../src/admin/security.js';
import { adminStyles } from '../src/admin/ui/styles.js';
import {
  AdminServerHarness,
  FORM_TYPE,
  TEST_PASSWORD,
  USERNAME,
  cookie,
  csrf,
  failureAlert,
} from './admin-server-harness.js';

describe('admin authentication HTTP contract', () => {
  let harness: AdminServerHarness;

  beforeEach(async () => {
    harness = new AdminServerHarness();
    await harness.start();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it('serves public login and CSS with the complete strict security policy', async () => {
    // Given / When
    const login = await harness.send('/admin/login');
    const styles = await harness.send('/admin/styles.css');

    // Then
    expect(login.status).toBe(200);
    expect(login.headers['content-type']).toMatch(/^text\/html/);
    expect(login.body).toContain('<form method="post" action="/admin/login"');
    expect(styles.status).toBe(200);
    expect(styles.headers['content-type']).toMatch(/^text\/css/);
    expect(styles.body).toBe(adminStyles);
    for (const [name, value] of Object.entries(ADMIN_SECURITY_HEADERS)) {
      expect(login.headers[name.toLowerCase()]).toBe(value);
      expect(styles.headers[name.toLowerCase()]).toBe(value);
    }
    expect(login.headers['strict-transport-security']).toBeUndefined();
  });

  it('issues independent login challenge and redirects an anonymous dashboard', async () => {
    // Given / When
    const login = await harness.send('/admin/login');
    const challengeCookie = cookie(login, '__Host-dealio_login');
    const csrfToken = csrf(login);
    const dashboard = await harness.send('/admin');

    // Then
    expect(challengeCookie.split('=')[1]).not.toBe(csrfToken);
    expect(login.headers['set-cookie']?.join(';')).toContain(
      'Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict',
    );
    expect(login.headers['set-cookie']?.join(';')).not.toContain('__Host-dealio_admin=');
    expect(dashboard.status).toBe(303);
    expect(dashboard.headers.location).toBe('/admin/login');
  });

  it.each([
    ['missing', { includeDefaultClientIp: false }],
    ['duplicate', { rawHeaders: ['X-Dealio-Client-IP', '198.51.100.7'] }],
    ['malformed', {
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', 'not-an-ip'],
    }],
  ] as const)('rejects %s trusted client identity without issuing a challenge', async (_case, options) => {
    // Given
    const issue = vi.spyOn(harness.challenges, 'issue');

    // When
    const response = await harness.send('/admin/login', options);

    // Then
    expect(response.status).toBe(400);
    expect(response.body).toBe('Geçersiz istek.');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(issue).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { includeDefaultClientIp: false }],
    ['duplicate', { rawHeaders: ['X-Dealio-Client-IP', '198.51.100.7'] }],
    ['malformed', {
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', 'not-an-ip'],
    }],
  ] as const)('rejects %s POST identity before malformed body processing', async (_case, identity) => {
    // Given
    const issue = vi.spyOn(harness.challenges, 'issue');
    const consume = vi.spyOn(harness.challenges, 'consume');

    // When
    const response = await harness.send('/admin/login', {
      method: 'POST',
      ...identity,
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    // Then
    expect(response.status).toBe(400);
    expect(response.body).toBe('Geçersiz istek.');
    expect(issue).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(harness.verifyPassword).not.toHaveBeenCalled();
    expect(harness.audit).toEqual([]);
  });

  it('does not trust standard forwarding headers or socket identity as a fallback', async () => {
    // Given / When
    const response = await harness.send('/admin/login', {
      includeDefaultClientIp: false,
      headers: {
        Forwarded: 'for=192.0.2.10',
        'X-Forwarded-For': '192.0.2.10',
        'X-Real-IP': '192.0.2.10',
      },
    });

    // Then
    expect(response.status).toBe(400);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns one generic failed login and rotates the consumed challenge', async () => {
    // Given
    const original = await harness.challenge();
    const unknown = await harness.challenge({
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', '192.0.2.11'],
    });
    const rawPassword = `${TEST_PASSWORD}-wrong`;

    // When
    const response = await harness.send('/admin/login', {
      method: 'POST',
      headers: { Cookie: original.cookie, 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({ username: USERNAME, password: rawPassword, csrfToken: original.csrf }).toString(),
    });
    const unknownResponse = await harness.send('/admin/login', {
      method: 'POST',
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', '192.0.2.11'],
      headers: { Cookie: unknown.cookie, 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({ username: 'absent-operator', password: rawPassword, csrfToken: unknown.csrf }).toString(),
    });

    // Then
    expect([response.status, unknownResponse.status]).toEqual([401, 401]);
    expect(cookie(response, '__Host-dealio_login')).not.toBe(original.cookie);
    expect(csrf(response)).not.toBe(original.csrf);
    expect(failureAlert(response)).toBe(failureAlert(unknownResponse));
    expect(response.body).not.toContain(rawPassword);
    expect(harness.audit.map((record) => record.event)).toEqual([
      'admin.login.failed', 'admin.login.failed',
    ]);
  });

  it('creates a secure session and renders an authenticated dashboard', async () => {
    // Given / When
    const sessionCookie = await harness.authenticate();
    const dashboard = await harness.send('/admin', { headers: { Cookie: sessionCookie } });

    // Then
    expect(sessionCookie).toMatch(/^__Host-dealio_admin=[A-Za-z0-9_-]{43}$/);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toContain(USERNAME);
    expect(dashboard.body).toContain('action="/admin/logout"');
    expect(dashboard.body).not.toMatch(
      new RegExp(`${TEST_PASSWORD}|__Host-dealio_admin|stderr|stack|[A-Z]:\\\\`),
    );
    expect(harness.audit).toEqual([{
      event: 'admin.login.succeeded',
      timestamp: '2026-08-29T12:00:00.000Z',
      username: USERNAME,
    }]);
  });

  it('maps typed challenge rate limit and capacity without side effects', async () => {
    // Given
    for (let issuance = 0; issuance < 60; issuance += 1) {
      harness.challenges.issue(harness.client('198.51.100.10'));
    }
    for (let owner = 0; owner < 255; owner += 1) {
      harness.challenges.issue(harness.client(`10.0.${Math.floor(owner / 254)}.${(owner % 254) + 1}`));
    }

    // When
    const limited = await harness.send('/admin/login', {
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', '198.51.100.10'],
    });
    const capacity = await harness.send('/admin/login', {
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', '203.0.113.200'],
    });
    const postCapacity = await harness.send('/admin/login', {
      method: 'POST',
      includeDefaultClientIp: false,
      rawHeaders: ['X-Dealio-Client-IP', '203.0.113.200'],
      headers: { Cookie: '__Host-dealio_login=missing', 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({
        username: USERNAME, password: TEST_PASSWORD, csrfToken: 'missing',
      }).toString(),
    });

    // Then
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('900');
    expect(limited.headers['set-cookie']).toBeUndefined();
    expect(capacity.status).toBe(503);
    expect(capacity.headers['set-cookie']).toBeUndefined();
    expect(postCapacity.status).toBe(503);
    expect(postCapacity.headers['set-cookie']).toBeUndefined();
    expect(harness.audit).toEqual([]);
  });

  it('returns 503 for a full session store before consuming the login challenge', async () => {
    // Given
    const login = await harness.challenge();
    const retainedSession = harness.sessions.createSession('operator-0');
    for (let index = 1; index < 256; index += 1) {
      harness.sessions.createSession(`operator-${index}`);
    }
    const sessionCapacity = vi.spyOn(harness.sessions, 'hasCapacity');
    const createSession = vi.spyOn(harness.sessions, 'createSession');
    const challengePreflight = vi.spyOn(harness.challenges, 'preflightIssue');
    const consumption = vi.spyOn(harness.challenges, 'consume');
    const failure = vi.spyOn(harness.throttle, 'recordFailure');
    const success = vi.spyOn(harness.throttle, 'recordSuccess');

    // When
    const loginRequest = {
      method: 'POST',
      headers: { Cookie: login.cookie, 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({ username: USERNAME, password: TEST_PASSWORD, csrfToken: login.csrf }).toString(),
    };
    const response = await harness.send('/admin/login', loginRequest);

    // Then
    expect(response.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessionCapacity).toHaveBeenCalledOnce();
    expect(createSession).not.toHaveBeenCalled();
    expect(challengePreflight).not.toHaveBeenCalled();
    expect(consumption).not.toHaveBeenCalled();
    expect(harness.verifyPassword).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(harness.sessions.size()).toBe(256);
    expect(harness.audit).toEqual([]);

    harness.sessions.revokeSession(retainedSession.sessionToken);
    const retry = await harness.send('/admin/login', loginRequest);
    expect(retry.status).toBe(303);
    expect(cookie(retry, '__Host-dealio_admin')).toMatch(/^__Host-dealio_admin=[A-Za-z0-9_-]{43}$/);
    expect(consumption).toHaveBeenCalledOnce();
    expect(harness.verifyPassword).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledOnce();
    expect(harness.audit).toEqual([{ event: 'admin.login.succeeded', timestamp: '2026-08-29T12:00:00.000Z', username: USERNAME }]);
  });

  it('keeps a rate-limited POST side-effect-free', async () => {
    // Given
    const login = await harness.challenge();
    for (let failure = 1; failure <= 5; failure += 1) {
      harness.throttle.recordFailure(USERNAME, harness.client(`198.51.100.${failure}`));
    }
    const consume = vi.spyOn(harness.challenges, 'consume');

    // When
    const response = await harness.send('/admin/login', {
      method: 'POST',
      headers: { Cookie: login.cookie, 'Content-Type': FORM_TYPE },
      body: new URLSearchParams({
        username: USERNAME, password: TEST_PASSWORD, csrfToken: login.csrf,
      }).toString(),
    });

    // Then
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('900');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(consume).not.toHaveBeenCalled();
    expect(harness.audit).toEqual([]);
  });

  it('rejects wrong authority and maps routes, methods, and form failures', async () => {
    // Given
    const login = await harness.challenge();
    const base = { Cookie: login.cookie, 'Content-Type': FORM_TYPE };

    // When
    const responses = await Promise.all([
      harness.send('/admin/login', { headers: { Host: 'attacker.example' } }),
      harness.send('/admin/login', { method: 'POST', headers: { ...base, Origin: 'https://attacker.example' }, body: 'x=1' }),
      harness.send('/missing'),
      harness.send('/admin/login', { method: 'PUT' }),
      harness.send('/admin/login', { method: 'POST', headers: base, body: 'username=%ZZ&password=x&csrfToken=y' }),
      harness.send('/admin/login', { method: 'POST', headers: { ...base, 'Content-Type': 'application/json' }, body: '{}' }),
      harness.send('/admin/login', { method: 'POST', headers: base, body: `username=${'a'.repeat(8 * 1024)}&password=x&csrfToken=y` }),
    ]);

    // Then
    expect(responses.map((response) => response.status)).toEqual([400, 400, 404, 405, 400, 415, 413]);
    expect(responses[3]?.headers.allow).toBe('GET, POST');
  });
});
