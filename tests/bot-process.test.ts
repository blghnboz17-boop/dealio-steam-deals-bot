import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runBotProcess } from '../src/application/bot-process.js';

function processHarness(startFailure = false, deferStart = false) {
  const runtimeDirectory = resolve('process-test-runtime');
  const shutdownRequestPath = resolve(runtimeDirectory, 'shutdown.request');
  const nodePidPath = resolve(runtimeDirectory, 'bot.node.pid');
  const healthPath = resolve(runtimeDirectory, 'bot.health.json');
  const files = new Map<string, string>();
  const events: string[] = [];
  const handlers = new Map<string, () => void>();
  const timer = { clear: vi.fn(), unref: vi.fn() };
  let poll = (): void => undefined;
  const mkdir = vi.fn();
  const setPolling = vi.fn((callback: () => void, _delayMs: number) => {
    poll = callback;
    return timer;
  });
  const runtime = { stop: vi.fn(async () => { events.push('stop'); }) };
  const environment = {
    discordToken: 'test-token',
    discordClientId: '123456789012345678',
    databasePath: ':memory:',
    pollIntervalHours: 6,
    notificationRetryIntervalSeconds: 60,
  };
  let startupSignal: AbortSignal | undefined;
  let resolveStart = (): void => undefined;
  const pendingStart = new Promise<typeof runtime>((resolve) => {
    resolveStart = () => resolve(runtime);
  });
  const start = vi.fn(async (_environment: typeof environment, options: { readonly signal?: AbortSignal }) => {
    startupSignal = options.signal;
    if (startFailure) throw new Error('startup failed');
    if (deferStart) return pendingStart;
    return runtime;
  });
  const host: {
    pid: number;
    exitCode: string | number | null | undefined;
    on: (signal: string, listener: () => void) => void;
  } = {
    pid: 42,
    exitCode: undefined,
    on: (signal, listener) => { handlers.set(signal, listener); },
  };
  const control = runBotProcess({
    runtimeDirectory,
    dependencies: {
      process: host,
      fileSystem: {
        existsSync: (path) => files.has(path),
        mkdirSync: mkdir,
        readFileSync: (path) => {
          const value = files.get(path);
          if (value === undefined) throw new Error('missing file');
          return value;
        },
        rmSync: (path) => { events.push(`remove:${path}`); files.delete(path); },
      },
      clock: {
        setInterval: setPolling,
      },
      logger: { log: vi.fn(), error: vi.fn() },
      now: () => new Date('2026-08-25T00:00:00.000Z'),
      loadEnvironment: vi.fn().mockReturnValue(environment),
      startBot: start,
    },
  });
  return {
    control, events, files, handlers, healthPath, host, mkdir, nodePidPath,
    poll: () => poll(), resolveStart, runtime, setPolling, shutdownRequestPath, start,
    startupSignal: () => startupSignal, timer,
  };
}

describe('process lifecycle', () => {
  it('creates runtime controls with an unrefed 500ms poll and both shutdown signals', async () => {
    const harness = processHarness();

    await harness.control.completion;

    expect(harness.timer.unref).toHaveBeenCalledOnce();
    expect(harness.setPolling).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(harness.mkdir).toHaveBeenCalledWith(resolve('process-test-runtime'), { recursive: true });
    expect([...harness.handlers.keys()]).toEqual(['SIGINT', 'SIGTERM']);
    expect(harness.start).toHaveBeenCalledWith(
      expect.objectContaining({ discordToken: 'test-token' }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        nodePidPath: harness.nodePidPath,
        healthPath: harness.healthPath,
      }),
    );
  });

  it('retains a shutdown request addressed to another process', async () => {
    const harness = processHarness();
    await harness.control.completion;
    harness.files.set(harness.shutdownRequestPath, '99');

    harness.poll();

    expect(harness.files.has(harness.shutdownRequestPath)).toBe(true);
    expect(harness.runtime.stop).not.toHaveBeenCalled();
  });

  it.each(['all', '42'])('removes a %s shutdown request before stopping the runtime', async (request) => {
    const harness = processHarness();
    await harness.control.completion;
    harness.files.set(harness.shutdownRequestPath, request);

    harness.poll();
    await vi.waitFor(() => expect(harness.runtime.stop).toHaveBeenCalledOnce());

    expect(harness.events).toEqual([`remove:${harness.shutdownRequestPath}`, 'stop']);
    expect(harness.startupSignal()?.aborted).toBe(true);
  });

  it('handles duplicate shutdown signals idempotently', async () => {
    const harness = processHarness();
    await harness.control.completion;
    const shutdown = harness.handlers.get('SIGINT');
    if (shutdown === undefined) throw new Error('SIGINT handler was not registered');

    shutdown();
    shutdown();
    await vi.waitFor(() => expect(harness.runtime.stop).toHaveBeenCalledOnce());

    expect(harness.runtime.stop).toHaveBeenCalledOnce();
  });

  it('stops a runtime that resolves after shutdown and removes its owned PID file', async () => {
    const harness = processHarness(false, true);
    harness.files.set(harness.nodePidPath, '42');
    await Promise.resolve();
    const shutdown = harness.handlers.get('SIGTERM');
    if (shutdown === undefined) throw new Error('SIGTERM handler was not registered');

    shutdown();
    expect(harness.runtime.stop).not.toHaveBeenCalled();
    harness.resolveStart();
    await harness.control.completion;

    expect(harness.runtime.stop).toHaveBeenCalledOnce();
    expect(harness.files.has(harness.nodePidPath)).toBe(false);
  });

  it.each([
    ['42', false],
    ['7', true],
  ])('removes the PID file only when owned (content=%s)', async (pidFile, retained) => {
    const harness = processHarness();
    await harness.control.completion;
    harness.files.set(harness.nodePidPath, pidFile);
    const shutdown = harness.handlers.get('SIGTERM');
    if (shutdown === undefined) throw new Error('SIGTERM handler was not registered');

    shutdown();
    await vi.waitFor(() => expect(harness.files.has(harness.nodePidPath)).toBe(retained));
  });

  it.each([
    ['ordinary startup failure', false, 1],
    ['requested startup cancellation', true, undefined],
  ])('sets exit code only for %s', async (_case, requested, expectedExitCode) => {
    const harness = processHarness(true);
    if (requested) {
      const shutdown = harness.handlers.get('SIGTERM');
      if (shutdown === undefined) throw new Error('SIGTERM handler was not registered');
      shutdown();
    }

    await harness.control.completion;

    expect(harness.host.exitCode).toBe(expectedExitCode);
  });
});
