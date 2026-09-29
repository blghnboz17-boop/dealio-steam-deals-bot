import { constants, createCipheriv, createDecipheriv, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

// Bound both VM memory use and seven-day artifact storage. Refuse growth rather
// than silently consuming more of the shared free allowance.
export const backupByteLimit = 16 * 1024 * 1024;
const format = 'dealio-rsa-oaep-sha256-aes-256-gcm-v1';

export function sealBackup(database: Buffer, publicKey: string): string {
  if (database.length === 0 || database.length > backupByteLimit) throw new Error('Backup size limit exceeded');
  const key = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(format));
    const data = Buffer.concat([cipher.update(database), cipher.final()]);
    const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    return JSON.stringify({ version: 1, format, key: wrapped.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
  } finally { key.fill(0); }
}

export function openBackup(envelope: string, privateKey: string): Buffer {
  if (Buffer.byteLength(envelope) > 23 * 1024 * 1024) throw new Error('Backup envelope size limit exceeded');
  const value: unknown = JSON.parse(envelope);
  if (!value || typeof value !== 'object') throw new Error('Invalid backup envelope');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.format !== format) throw new Error('Unsupported backup format');
  const decode = (name: string): Buffer => {
    const text = record[name];
    if (typeof text !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Invalid backup field');
    const decoded = Buffer.from(text, 'base64');
    if (decoded.toString('base64') !== text) throw new Error('Invalid backup encoding');
    return decoded;
  };
  const iv = decode('iv'), tag = decode('tag'), data = decode('data');
  if (iv.length !== 12 || tag.length !== 16 || data.length > backupByteLimit) throw new Error('Invalid backup dimensions');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, decode('key'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(format));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } finally { key.fill(0); }
}
