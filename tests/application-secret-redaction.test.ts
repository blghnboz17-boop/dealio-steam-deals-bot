import { afterEach, describe, expect, it, vi } from 'vitest';
import { redactSecrets } from '../src/application/safe-logger.js';

afterEach(() => vi.unstubAllEnvs());

describe('redactSecrets with configured secrets', () => {
  it('removes a raw token value that has no recognisable prefix', () => {
    vi.stubEnv('DISCORD_TOKEN', 'MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef.ghijklmnopqrstuvwxyz');
    vi.stubEnv('ITAD_API_KEY', '0123456789abcdef0123456789abcdef');

    const text = redactSecrets(new Error(
      'failed with MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef.ghijklmnopqrstuvwxyz and 0123456789abcdef0123456789abcdef'));

    expect(text).not.toContain('MTIzNDU2Nzg5MDEyMzQ1Njc4');
    expect(text).not.toContain('0123456789abcdef0123456789abcdef');
    expect(text).toContain('[REDACTED]');
  });

  it('leaves text alone when a configured value is too short to be a real secret', () => {
    vi.stubEnv('DEALIO_ADMIN_TOKEN', 'the');

    expect(redactSecrets('the price changed')).toBe('the price changed');
  });
});
