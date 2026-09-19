import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureDiscordOperation } from '../src/discord/interaction-timing.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Discord response timing', () => {
  it('reports slow responses with elapsed time but no interaction payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await measureDiscordOperation(
      { createdTimestamp: 9_500, token: 'private-token' } as { createdTimestamp: number },
      'setup.ack', async () => { vi.setSystemTime(11_200); return 'response'; },
    );
    expect(result).toBe('response');
    expect(log).toHaveBeenCalledOnce();
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('durationMs: 1200');
    expect(output).toContain('interactionAgeMs: 1700');
    expect(output).not.toContain('private-token');
  });

  it('preserves the original failure while reporting only its numeric error code', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = Object.assign(new Error('private error with token'), { code: 10062 });
    await expect(measureDiscordOperation({}, 'setup.modal', async () => { throw error; }))
      .rejects.toBe(error);
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('10062');
    expect(output).not.toContain('private error');
  });

  it('does not flood logs for fast successful responses', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(measureDiscordOperation({}, 'dealio.render', async () => 42)).resolves.toBe(42);
    expect(log).not.toHaveBeenCalled();
  });
});
