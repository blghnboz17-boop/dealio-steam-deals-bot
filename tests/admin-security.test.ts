import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_COOKIE_NAMES,
  ADMIN_SECURITY_HEADERS,
  FormBodyError,
  RequestValidationError,
  parseAdminCookie,
  parsePublicOrigin,
  parseUrlEncodedBody,
  serializeAdminCookie,
  validateRequestAuthority,
} from '../src/admin/security.js';
import {
  AdminAuditLogger,
  type AdminAuditRecord,
} from '../src/admin/audit-logger.js';

async function* bodyChunks(...chunks: readonly string[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) yield Buffer.from(chunk);
}

describe('admin HTTP security', () => {
  it('publishes strict headers while preserving the Origin on same-origin form posts', () => {
    // Given / When
    const headers = new Headers(ADMIN_SECURITY_HEADERS);

    // Then
    expect(Object.fromEntries(headers)).toEqual({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    });
    expect(headers.has('strict-transport-security')).toBe(false);
  });

  it.each([
    undefined,
    '',
    'http://admin.example.com',
    'https://admin.example.com/control',
    'https://user:password@admin.example.com',
    'https://admin.example.com?token=secret',
    'https://admin.example.com#fragment',
  ])('rejects a missing or non-pathless HTTPS public origin: %s', (configuredOrigin) => {
    // Given / When
    const parse = (): ReturnType<typeof parsePublicOrigin> => parsePublicOrigin(configuredOrigin);

    // Then
    expect(parse).toThrow(RequestValidationError);
  });

  it('requires exact Host and exact POST Origin while ignoring forwarded headers', () => {
    // Given
    const publicOrigin = parsePublicOrigin('https://admin.example.com:8443');
    const valid = new Headers({
      host: 'admin.example.com:8443',
      origin: 'https://admin.example.com:8443',
      'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'http',
    });

    // When / Then
    expect(() => validateRequestAuthority(valid, publicOrigin, 'POST')).not.toThrow();
    expect(() => validateRequestAuthority(new Headers({
      host: 'attacker.example',
      origin: 'https://admin.example.com:8443',
      'x-forwarded-host': 'admin.example.com:8443',
    }), publicOrigin, 'POST')).toThrow(RequestValidationError);
    expect(() => validateRequestAuthority(new Headers({
      host: 'admin.example.com:8443',
      origin: 'https://attacker.example',
    }), publicOrigin, 'POST')).toThrow(RequestValidationError);
    expect(() => validateRequestAuthority(new Headers({
      host: 'admin.example.com:8443',
    }), publicOrigin, 'GET')).not.toThrow();
  });

  it.each(ADMIN_COOKIE_NAMES)('serializes and parses only secure %s cookies', (name) => {
    // Given
    const value = 'opaque value;with=delimiters';

    // When
    const serialized = serializeAdminCookie({ name, value, maxAgeSeconds: 900 });
    const parsed = parseAdminCookie(`other=ignored; ${serialized.split(';')[0]}`, name);

    // Then
    expect(serialized).toBe(`${name}=opaque%20value%3Bwith%3Ddelimiters; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Strict`);
    expect(serialized).not.toMatch(/Domain=/i);
    expect(parsed).toBe(value);
  });

  it('rejects ambiguous or malformed target cookies', () => {
    // Given / When / Then
    expect(parseAdminCookie('__Host-dealio_login=one; __Host-dealio_login=two', '__Host-dealio_login')).toBeNull();
    expect(parseAdminCookie('__Host-dealio_login=%E0%A4%A', '__Host-dealio_login')).toBeNull();
    expect(parseAdminCookie('unrelated=value', '__Host-dealio_login')).toBeNull();
  });

  it('parses an exact set of unique URL-encoded fields across chunks', async () => {
    // Given
    const body = bodyChunks('username=alice&pass', 'word=correct%20horse');

    // When
    const fields = await parseUrlEncodedBody({
      contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
      body,
      expectedFields: ['username', 'password'],
    });

    // Then
    expect(Object.fromEntries(fields)).toEqual({ username: 'alice', password: 'correct horse' });
  });

  it.each([
    ['username=alice&username=bob&password=x', 'duplicate'],
    ['username=alice&password=x&extra=y', 'unexpected'],
    ['username=alice', 'missing'],
    ['username=%ZZ&password=x', 'malformed'],
  ])('returns 400 for %s form data', async (encoded) => {
    // Given / When
    const parsing = parseUrlEncodedBody({
      contentType: 'application/x-www-form-urlencoded',
      body: bodyChunks(encoded),
      expectedFields: ['username', 'password'],
    });

    // Then
    await expect(parsing).rejects.toMatchObject({ status: 400 });
  });

  it('returns 415 for a non-form media type without consuming the body', async () => {
    // Given
    const iterate = vi.fn(() => bodyChunks('username=alice'));

    // When
    const parsing = parseUrlEncodedBody({
      contentType: 'application/json',
      body: { [Symbol.asyncIterator]: iterate },
      expectedFields: ['username'],
    });

    // Then
    await expect(parsing).rejects.toMatchObject({ status: 415 });
    expect(iterate).not.toHaveBeenCalled();
  });

  it('returns 413 as soon as the form body exceeds 8 KiB', async () => {
    // Given / When
    const parsing = parseUrlEncodedBody({
      contentType: 'application/x-www-form-urlencoded',
      body: bodyChunks(`field=${'a'.repeat(8 * 1024)}`),
      expectedFields: ['field'],
    });

    // Then
    await expect(parsing).rejects.toBeInstanceOf(FormBodyError);
    await expect(parsing).rejects.toMatchObject({ status: 413 });
  });
});

describe('AdminAuditLogger', () => {
  it('emits allowlisted login fields and drops arbitrary request data', () => {
    // Given
    const records: AdminAuditRecord[] = [];
    const logger = new AdminAuditLogger((record) => records.push(record));
    const event = {
      event: 'admin.login.succeeded' as const,
      timestamp: '2026-08-29T12:00:00.000Z',
      username: 'alice',
      token: 'secret-token',
      body: 'password=secret',
      path: 'C:\\private',
      error: new Error('credential failure'),
    };

    // When
    logger.record(event);

    // Then
    expect(records).toEqual([{
      event: 'admin.login.succeeded',
      timestamp: '2026-08-29T12:00:00.000Z',
      username: 'alice',
    }]);
  });

  it('emits only fixed bot action, outcome, and duration fields', () => {
    // Given
    const records: AdminAuditRecord[] = [];
    const logger = new AdminAuditLogger((record) => records.push(record));
    const event = {
      event: 'admin.bot.action' as const,
      timestamp: '2026-08-29T12:00:00.000Z',
      username: 'ops.user',
      action: 'restart' as const,
      outcome: 'timed_out' as const,
      durationMs: 130_000,
      childOutput: 'sensitive output',
      credentials: { password: 'secret' },
    };

    // When
    logger.record(event);

    // Then
    expect(records).toEqual([{
      event: 'admin.bot.action',
      timestamp: '2026-08-29T12:00:00.000Z',
      username: 'ops.user',
      action: 'restart',
      outcome: 'timed_out',
      durationMs: 130_000,
    }]);
  });
});
