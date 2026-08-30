import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AdminRandomSource = (size: number) => Buffer;

export function createAdminToken(entropy: AdminRandomSource = randomBytes): string {
  const bytes = entropy(TOKEN_BYTES);
  if (bytes.length !== TOKEN_BYTES) {
    throw new RangeError('Admin token source must return exactly 32 bytes');
  }
  return bytes.toString('base64url');
}

export function hashAdminToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashAdminTokenBytes(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function isAdminToken(token: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  const decoded = Buffer.from(token, 'base64url');
  return decoded.length === TOKEN_BYTES && decoded.toString('base64url') === token;
}
