import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** The owner's own sign-in for the admin panel; only a scrypt hash of the password is kept. */
export interface OwnerCredentials {
  readonly username: string;
  readonly passwordHash: string;
}

export interface OwnerCredentialStore {
  read(): OwnerCredentials | null;
  write(credentials: OwnerCredentials | null): void;
}

export class InvalidOwnerCredentialsError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidOwnerCredentialsError';
  }
}

export const ownerCredentialsSettingKey = 'admin.ownerCredentials';
const usernamePattern = /^[\p{L}\p{N}._-]{3,64}$/u;
const minimumPasswordLength = 10;
const maximumPasswordLength = 256;
const cost = { N: 16_384, r: 8, p: 1 } as const;
const keyLength = 32;
// About 16 MiB per hash at these settings; the ceiling stops a crafted hash from asking for more.
const maximumMemory = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolveKey, reject) => {
    scrypt(password.normalize('NFC'), salt, keyLength, { ...options, maxmem: maximumMemory },
      (error, key) => (error ? reject(error) : resolveKey(key)));
  });
}

export async function hashOwnerPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return `scrypt:${cost.N}:${cost.r}:${cost.p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyOwnerPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length === 0 || expected.length !== keyLength) return false;
  try {
    return timingSafeEqual(await derive(password, salt, { N, r, p }), expected);
  } catch {
    return false;
  }
}

export function validateOwnerCredentials(username: string, password: string): void {
  if (!usernamePattern.test(username)) {
    throw new InvalidOwnerCredentialsError(
      'Kullanıcı adı 3–64 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.');
  }
  if (password.length < minimumPasswordLength || password.length > maximumPasswordLength) {
    throw new InvalidOwnerCredentialsError(`Şifre en az ${minimumPasswordLength} karakter olmalı.`);
  }
}

/** Keeps the credentials in the runtime_setting table, so they survive restarts and need no .env edit. */
export function settingOwnerCredentialStore(settings: {
  setting(key: string): string | null;
  setSetting(key: string, value: string | null, at: string): void;
}): OwnerCredentialStore {
  return {
    read() {
      const value = settings.setting(ownerCredentialsSettingKey);
      if (value === null) return null;
      try {
        const parsed = JSON.parse(value) as Partial<OwnerCredentials>;
        return typeof parsed.username === 'string' && typeof parsed.passwordHash === 'string'
          ? { username: parsed.username, passwordHash: parsed.passwordHash }
          : null;
      } catch {
        return null;
      }
    },
    write(credentials) {
      settings.setSetting(ownerCredentialsSettingKey,
        credentials === null ? null : JSON.stringify(credentials), new Date().toISOString());
    },
  };
}
