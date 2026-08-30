import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const algorithm = 'scrypt';
const version = '1';
const cost = 16_384;
const blockSize = 8;
const parallelization = 1;
const saltBytes = 16;
const digestBytes = 32;
const maxMemoryBytes = 64 * 1024 * 1024;
const verifierPattern = /^scrypt\$1\$16384\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;
const dummySalt = Buffer.alloc(saltBytes);
const dummyDigest = Buffer.alloc(digestBytes);

type EntropySource = (size: number) => Buffer;

type ParsedVerifier = {
  readonly salt: Buffer;
  readonly digest: Buffer;
};

export class AdminPasswordError extends Error {
  public readonly name = 'AdminPasswordError';
}

function parseVerifier(value: string): ParsedVerifier | null {
  const match = verifierPattern.exec(value);
  if (!match) {
    return null;
  }
  const saltText = match[1];
  const digestText = match[2];
  if (saltText === undefined || digestText === undefined) {
    return null;
  }
  const salt = Buffer.from(saltText, 'base64url');
  const digest = Buffer.from(digestText, 'base64url');
  if (
    salt.length !== saltBytes ||
    digest.length !== digestBytes ||
    salt.toString('base64url') !== saltText ||
    digest.toString('base64url') !== digestText
  ) {
    return null;
  }
  return { salt, digest };
}

function validatePasswordLength(password: string): void {
  const byteLength = Buffer.byteLength(password, 'utf8');
  if (byteLength < 14 || byteLength > 256) {
    throw new AdminPasswordError('Password must be between 14 and 256 UTF-8 bytes');
  }
}

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, digestBytes, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: maxMemoryBytes,
  });
}

export function isPasswordVerifier(value: string): boolean {
  return parseVerifier(value) !== null;
}

export function createPasswordVerifier(
  password: string,
  entropy: EntropySource = randomBytes,
): string {
  validatePasswordLength(password);
  const salt = entropy(saltBytes);
  if (salt.length !== saltBytes) {
    throw new AdminPasswordError('Password salt source must return exactly 16 bytes');
  }
  const digest = derive(password, salt);
  return [
    algorithm,
    version,
    String(cost),
    String(blockSize),
    String(parallelization),
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

export function verifyAdminPassword(
  username: string,
  password: string,
  users: ReadonlyMap<string, string>,
): boolean {
  const configured = users.get(username);
  const parsed = configured === undefined ? null : parseVerifier(configured);
  const expected = parsed?.digest ?? dummyDigest;
  const salt = parsed?.salt ?? dummySalt;
  const validLength = Buffer.byteLength(password, 'utf8') >= 14 &&
    Buffer.byteLength(password, 'utf8') <= 256;
  const actual = derive(validLength ? password : '', salt);
  const matches = timingSafeEqual(actual, expected);
  return configured !== undefined && parsed !== null && validLength && matches;
}
