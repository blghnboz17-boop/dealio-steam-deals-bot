import { describe, expect, it } from 'vitest';
import {
  AdminClientIdentityError,
  parseAdminClientIdentity,
} from '../src/admin/client-identity.js';

describe('parseAdminClientIdentity', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'accepts one client IP header from loopback peer %s',
    (peerAddress) => {
      // Given / When
      const identity = parseAdminClientIdentity({
        peerAddress,
        rawHeaders: ['Host', 'admin.example.test', 'X-Dealio-Client-IP', '203.0.113.7'],
      });

      // Then
      expect(identity.address).toBe('203.0.113.7');
    },
  );

  it('canonicalizes a bare IPv6 client address', () => {
    // Given / When
    const identity = parseAdminClientIdentity({
      peerAddress: '::1',
      rawHeaders: ['x-dealio-client-ip', '2001:0DB8:0:0:0:0:0:1'],
    });

    // Then
    expect(identity.address).toBe('2001:db8::1');
  });

  it.each([
    { peerAddress: '192.0.2.4', rawHeaders: ['X-Dealio-Client-IP', '203.0.113.7'] },
    { peerAddress: '127.0.0.1', rawHeaders: [] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', '203.0.113.7', 'x-dealio-client-ip', '203.0.113.8'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', ' 203.0.113.7'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', '203.0.113.7, 198.51.100.2'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', '203.0.113.7:443'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', '[2001:db8::1]'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', 'fe80::1%eth0'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', 'client.example.test'] },
    { peerAddress: '127.0.0.1', rawHeaders: ['X-Dealio-Client-IP', 'a'.repeat(65)] },
  ])('rejects an untrusted peer or malformed identity boundary', (input) => {
    // Given / When
    const parse = (): ReturnType<typeof parseAdminClientIdentity> =>
      parseAdminClientIdentity(input);

    // Then
    expect(parse).toThrow(AdminClientIdentityError);
  });

  it('ignores all unrelated forwarding headers', () => {
    // Given / When
    const parse = (): ReturnType<typeof parseAdminClientIdentity> => parseAdminClientIdentity({
      peerAddress: '127.0.0.1',
      rawHeaders: [
        'X-Forwarded-For', '203.0.113.7',
        'Forwarded', 'for=203.0.113.7',
        'X-Real-IP', '203.0.113.7',
      ],
    });

    // Then
    expect(parse).toThrow(AdminClientIdentityError);
  });
});
