import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runPasswordCli } from '../src/admin/password-cli.js';
import {
  createPasswordVerifier,
  isPasswordVerifier,
  verifyAdminPassword,
} from '../src/admin/password.js';

class FakeTerminal extends PassThrough {
  readonly isTTY = true;
  readonly rawModes: boolean[] = [];

  setRawMode(enabled: boolean): this {
    this.rawModes.push(enabled);
    return this;
  }
}

describe('admin password verification', () => {
  it('finishes password generation when Enter is pressed in an interactive terminal', async () => {
    // Given
    const input = new FakeTerminal();
    const output = new PassThrough();
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => outputChunks.push(chunk));

    // When
    const resultPromise = runPasswordCli(input, output);
    input.write('correct horse battery staple\rignored-after-enter\r');
    const result = await resultPromise;

    // Then
    const tokens = Buffer.concat(outputChunks).toString('utf8').split(/\s+/);
    expect(result).toBe(0);
    expect(tokens.some(isPasswordVerifier)).toBe(true);
    expect(input.rawModes).toEqual([true, false]);
  });

  it('creates the fixed scrypt verifier and verifies the password', () => {
    // Given
    const password = 'correct horse battery staple';

    // When
    const encoded = createPasswordVerifier(password, () => Buffer.alloc(16, 3));

    // Then
    expect(encoded).toMatch(/^scrypt\$1\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(verifyAdminPassword('alice', password, new Map([['alice', encoded]]))).toBe(true);
    expect(verifyAdminPassword('alice', `${password}!`, new Map([['alice', encoded]]))).toBe(false);
  });

  it.each([
    'too short',
    `valid characters ${'x'.repeat(242)}`,
    `unicode ${'😀'.repeat(63)}`,
  ])('rejects passwords outside the 14-256 UTF-8 byte boundary', (password) => {
    // Given
    const entropy = (): Buffer => Buffer.alloc(16);

    // When
    const encode = (): string => createPasswordVerifier(password, entropy);

    // Then
    expect(encode).toThrow(/14 and 256 UTF-8 bytes/);
  });

  it('accepts both password byte boundaries', () => {
    // Given
    const minimum = 'x'.repeat(14);
    const maximum = 'y'.repeat(256);

    // When
    const minimumVerifier = createPasswordVerifier(minimum, () => Buffer.alloc(16, 1));
    const maximumVerifier = createPasswordVerifier(maximum, () => Buffer.alloc(16, 2));

    // Then
    expect(isPasswordVerifier(minimumVerifier)).toBe(true);
    expect(isPasswordVerifier(maximumVerifier)).toBe(true);
  });

  it('rejects malformed and non-canonical verifier encodings', () => {
    // Given
    const malformed = [
      'scrypt$2$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'scrypt$1$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'scrypt$1$16384$8$1$AAAAAAAAAAAAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ];

    // When
    const results = malformed.map(isPasswordVerifier);

    // Then
    expect(results).toEqual([false, false, false]);
  });

  it('does not authenticate an unknown user', () => {
    // Given
    const encoded = createPasswordVerifier('known user password', () => Buffer.alloc(16, 9));

    // When
    const authenticated = verifyAdminPassword(
      'unknown',
      'known user password',
      new Map([['known', encoded]]),
    );

    // Then
    expect(authenticated).toBe(false);
  });
});
