import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEnvironment } from '../src/admin/environment.js';
import { runAdminProcess } from '../src/admin/main.js';

const STARTED_MESSAGE = 'Admin server listening on http://127.0.0.1:4317';
const FAILED_MESSAGE = 'Admin server failed to start.';

class SensitiveFailure extends Error {
  public readonly name = 'SensitiveFailure';
}

class FakeAdminListener extends EventEmitter {
  private state: 'idle' | 'starting' | 'listening' | 'closed' = 'idle';

  public constructor(private readonly events: string[]) {
    super();
  }

  public readonly listen = vi.fn((port: number, host: string): this => {
    this.state = 'starting';
    this.events.push(`listen:${host}:${port}`);
    return this;
  });

  public readonly close = vi.fn((callback?: (error?: Error) => void): this => {
    if (this.state !== 'listening') {
      queueMicrotask(() => callback?.(new Error('Server is not running')));
      return this;
    }
    this.state = 'closed';
    this.events.push('listener.close');
    queueMicrotask(() => callback?.());
    return this;
  });

  public succeedListening(): void {
    this.state = 'listening';
    this.emit('listening');
  }

  public failListening(error: Error): void {
    this.state = 'closed';
    this.emit('error', error);
  }
}

type StartupFailure = 'configuration' | 'assembly' | null;

function adminProcessHarness(startupFailure: StartupFailure = null) {
  const events: string[] = [];
  const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
  const environment: AdminEnvironment = {
    users: new Map([['operator-secret', 'scrypt$1$fixture-verifier-secret']]),
    publicOrigin: {
      origin: 'https://public-admin.example.test',
      host: 'public-admin.example.test',
    },
    host: '127.0.0.1',
    port: 4317,
    databasePath: '/private/data/admin-database.sqlite',
    healthPath: '/private/runtime/bot-health.json',
  };
  const listener = new FakeAdminListener(events);
  const botController = {
    stop: vi.fn(async () => {
      events.push('controller.stop');
    }),
  };
  const runtime = { server: listener, botController };
  const logger = { log: vi.fn(), error: vi.fn() };
  const host: {
    exitCode: string | number | null | undefined;
    on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  } = {
    exitCode: undefined,
    on: (signal, handler) => {
      handlers.set(signal, handler);
    },
  };
  const loadEnvironment = vi.fn(() => {
    if (startupFailure === 'configuration') {
      throw new SensitiveFailure('fixture verifier and origin are invalid');
    }
    return environment;
  });
  const assemble = vi.fn((_configuration: AdminEnvironment) => {
    if (startupFailure === 'assembly') {
      throw new SensitiveFailure('database /private/data/admin-database.sqlite failed');
    }
    return runtime;
  });
  const control = runAdminProcess({
    dependencies: {
      process: host,
      logger,
      loadEnvironment,
      assemble,
    },
  });

  return {
    assemble,
    botController,
    control,
    environment,
    events,
    handlers,
    host,
    listener,
    loadEnvironment,
    logger,
  };
}

async function beginListening(harness: ReturnType<typeof adminProcessHarness>): Promise<void> {
  await Promise.resolve();
  harness.listener.succeedListening();
  await harness.control.ready;
}

function signalHandler(
  harness: ReturnType<typeof adminProcessHarness>,
  signal: 'SIGINT' | 'SIGTERM',
): () => void {
  const handler = harness.handlers.get(signal);
  if (handler === undefined) {
    throw new TypeError(`${signal} handler was not registered`);
  }
  return handler;
}

describe('standalone admin process', () => {
  it('loads configuration, assembles the runtime, and listens only on configured loopback', async () => {
    const harness = adminProcessHarness();

    await beginListening(harness);

    expect(harness.loadEnvironment).toHaveBeenCalledOnce();
    expect(harness.assemble).toHaveBeenCalledWith(harness.environment);
    expect(harness.listener.listen).toHaveBeenCalledOnce();
    expect(harness.listener.listen).toHaveBeenCalledWith(4317, '127.0.0.1');
    expect([...harness.handlers.keys()]).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('logs only the fixed loopback startup message', async () => {
    const harness = adminProcessHarness();

    await beginListening(harness);

    expect(harness.logger.log).toHaveBeenCalledOnce();
    expect(harness.logger.log).toHaveBeenCalledWith(STARTED_MESSAGE);
    expect(harness.logger.error).not.toHaveBeenCalled();
    const output = JSON.stringify(harness.logger.log.mock.calls);
    expect(output).not.toContain('operator-secret');
    expect(output).not.toContain('fixture-verifier');
    expect(output).not.toContain('public-admin.example.test');
    expect(output).not.toContain('/private/');
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'uses one idempotent listener-first shutdown path for %s',
    async (signal) => {
      const harness = adminProcessHarness();
      await beginListening(harness);
      const shutdown = signalHandler(harness, signal);

      shutdown();
      shutdown();
      await Promise.all([harness.control.stop(), harness.control.stop()]);

      expect(harness.listener.close).toHaveBeenCalledOnce();
      expect(harness.botController.stop).toHaveBeenCalledOnce();
      expect(harness.events).toEqual([
        'listen:127.0.0.1:4317',
        'listener.close',
        'controller.stop',
      ]);
    },
  );

  it('defers an early signal until listening completes and then cleans active resources', async () => {
    const harness = adminProcessHarness();
    await Promise.resolve();
    const shutdown = signalHandler(harness, 'SIGTERM');

    shutdown();
    expect(harness.listener.close).not.toHaveBeenCalled();
    expect(harness.botController.stop).not.toHaveBeenCalled();
    harness.listener.succeedListening();
    await Promise.all([harness.control.ready, harness.control.stop()]);

    expect(harness.listener.close).toHaveBeenCalledOnce();
    expect(harness.botController.stop).toHaveBeenCalledOnce();
  });

  it.each(['configuration', 'assembly'] as const)(
    'handles a %s failure without disclosing its details',
    async (failure) => {
      const harness = adminProcessHarness(failure);

      await expect(harness.control.ready).rejects.toBeInstanceOf(SensitiveFailure);

      expect(harness.host.exitCode).toBe(1);
      expect(harness.logger.error).toHaveBeenCalledOnce();
      expect(harness.logger.error).toHaveBeenCalledWith(FAILED_MESSAGE);
      expect(JSON.stringify(harness.logger.error.mock.calls)).not.toContain('/private/');
      expect(harness.listener.listen).not.toHaveBeenCalled();
    },
  );

  it('handles an asynchronous listen error and stops the assembled controller safely', async () => {
    const harness = adminProcessHarness();
    await Promise.resolve();

    harness.listener.failListening(
      new SensitiveFailure('listen EADDRINUSE public-admin.example.test:4317'),
    );
    await expect(harness.control.ready).rejects.toBeInstanceOf(SensitiveFailure);

    expect(harness.host.exitCode).toBe(1);
    expect(harness.logger.error).toHaveBeenCalledOnce();
    expect(harness.logger.error).toHaveBeenCalledWith(FAILED_MESSAGE);
    expect(harness.logger.log).not.toHaveBeenCalled();
    expect(harness.botController.stop).toHaveBeenCalledOnce();
  });
});
