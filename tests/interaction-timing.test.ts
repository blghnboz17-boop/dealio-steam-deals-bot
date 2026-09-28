import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureDiscordOperation } from '../src/discord/interaction-timing.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Discord response timing', () => {
  it('records a fast acknowledgement without logging interaction data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await measureDiscordOperation(
      { createdTimestamp: 9_700, token: 'private-token' } as { createdTimestamp: number },
      'setup.ack', async () => 'ok',
    );
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain('[discord-metric]');
    expect(JSON.stringify(log.mock.calls)).toContain('\\\"interactionAgeMs\\\":300');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['setup.ack', 'status.button-ack', 'wishlist.modal', 'status.modal-submit-ack'] as const)(
    'reports a fast but late %s acknowledgement', async (operation) => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);
      const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await measureDiscordOperation({ createdTimestamp: 7_500 }, operation, async () => 'ok');
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).toContain('startAgeMs: 2500');
    },
  );

  it.each(['setup.render', 'assistant.load'] as const)(
    'does not report a fast %s just because the panel is old', async (operation) => {
      vi.useFakeTimers();
      vi.setSystemTime(600_000);
      const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await measureDiscordOperation({ createdTimestamp: 0 }, operation, async () => 'ok');
      expect(log).not.toHaveBeenCalled();
    },
  );

  it('reports an acknowledgement crossing the age threshold during a fast request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await measureDiscordOperation({ createdTimestamp: 8_100 }, 'setup.ack', async () => {
      vi.setSystemTime(10_200);
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain('interactionAgeMs: 2100');
  });

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
