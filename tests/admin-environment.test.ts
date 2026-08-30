import { describe, expect, it } from 'vitest';
import {
  AdminEnvironmentError,
  loadAdminEnvironment,
} from '../src/admin/environment.js';
import { createPasswordVerifier } from '../src/admin/password.js';

const verifier = createPasswordVerifier(
  'a sufficiently long password',
  () => Buffer.alloc(16, 7),
);
const requiredEnvironment = {
  ADMIN_USERS_JSON: JSON.stringify({ alice: verifier, 'ops.user': verifier }),
  ADMIN_PUBLIC_ORIGIN: 'https://admin.example.com',
};

describe('loadAdminEnvironment', () => {
  it('loads multiple users and applies standalone server defaults', () => {
    // Given
    const environment = requiredEnvironment;

    // When
    const config = loadAdminEnvironment(environment);

    // Then
    expect(config).toEqual({
      users: new Map([
        ['alice', verifier],
        ['ops.user', verifier],
      ]),
      publicOrigin: { origin: 'https://admin.example.com', host: 'admin.example.com' },
      host: '127.0.0.1',
      port: 3_001,
      databasePath: './data/wishlist.db',
      healthPath: './.runtime/bot.health.json',
    });
  });

  it('loads trimmed path and port overrides without allowing a bind-host override', () => {
    // Given
    const environment = {
      ...requiredEnvironment,
      ADMIN_PUBLIC_ORIGIN: 'https://admin.example.com:8443/',
      ADMIN_PORT: ' 8443 ',
      DATABASE_PATH: '  /srv/dealio/admin.db  ',
      ADMIN_HEALTH_PATH: '  /run/dealio/health.json  ',
      ADMIN_HOST: '0.0.0.0',
    };

    // When
    const config = loadAdminEnvironment(environment);

    // Then
    expect(config).toEqual({
      users: new Map([
        ['alice', verifier],
        ['ops.user', verifier],
      ]),
      publicOrigin: {
        origin: 'https://admin.example.com:8443',
        host: 'admin.example.com:8443',
      },
      host: '127.0.0.1',
      port: 8_443,
      databasePath: '/srv/dealio/admin.db',
      healthPath: '/run/dealio/health.json',
    });
  });

  it('uses path and port defaults for blank optional values', () => {
    // Given
    const environment = {
      ...requiredEnvironment,
      ADMIN_PORT: '   ',
      DATABASE_PATH: '   ',
      ADMIN_HEALTH_PATH: '',
    };

    // When
    const config = loadAdminEnvironment(environment);

    // Then
    expect(config).toMatchObject({
      port: 3_001,
      databasePath: './data/wishlist.db',
      healthPath: './.runtime/bot.health.json',
    });
  });

  it.each([
    undefined,
    '',
    'http://admin.example.com',
    'https://admin.example.com/dashboard',
    'https://*.example.com',
    ' https://admin.example.com ',
  ])('rejects an invalid public origin without exposing it', (publicOrigin) => {
    // Given
    const environment = { ...requiredEnvironment, ADMIN_PUBLIC_ORIGIN: publicOrigin };

    // When
    const load = (): ReturnType<typeof loadAdminEnvironment> => loadAdminEnvironment(environment);

    // Then
    expect(load).toThrow(AdminEnvironmentError);
    expect(load).toThrowError(
      'ADMIN_PUBLIC_ORIGIN must be a canonical pathless HTTPS origin',
    );
  });

  it.each(['0', '-1', '1.5', '65536', 'not-a-port'])
    ('rejects an invalid admin port without exposing it', (port) => {
      // Given
      const environment = { ...requiredEnvironment, ADMIN_PORT: port };

      // When
      const load = (): ReturnType<typeof loadAdminEnvironment> => loadAdminEnvironment(environment);

      // Then
      expect(load).toThrow(AdminEnvironmentError);
      expect(load).toThrowError('ADMIN_PORT must be an integer from 1 through 65535');
    });

  it('accepts both admin port boundaries', () => {
    // Given
    const minimum = { ...requiredEnvironment, ADMIN_PORT: '1' };
    const maximum = { ...requiredEnvironment, ADMIN_PORT: '65535' };

    // When / Then
    expect(loadAdminEnvironment(minimum).port).toBe(1);
    expect(loadAdminEnvironment(maximum).port).toBe(65_535);
  });

  it.each([
    undefined,
    '',
    'null',
    '[]',
    '{}',
    '{bad json',
    JSON.stringify({ Alice: verifier }),
    JSON.stringify({ ab: verifier }),
    JSON.stringify({ alice: 'plaintext-password' }),
  ])('rejects malformed admin credentials without exposing their contents', (configuredUsers) => {
    // Given
    const environment = configuredUsers === undefined
      ? { ADMIN_PUBLIC_ORIGIN: requiredEnvironment.ADMIN_PUBLIC_ORIGIN }
      : { ...requiredEnvironment, ADMIN_USERS_JSON: configuredUsers };

    // When
    const load = (): ReturnType<typeof loadAdminEnvironment> => loadAdminEnvironment(environment);

    // Then
    expect(load).toThrow(AdminEnvironmentError);
    expect(load).toThrowError('ADMIN_USERS_JSON must contain valid admin credentials');
  });
});
