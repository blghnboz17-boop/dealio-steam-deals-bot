import { safeLogger } from './safe-logger.js';
import type { Client } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import type { WishlistScheduler } from './scheduler.js';
import type { ApplicationTaskTracker } from './application-task-tracker.js';
import type { ProcessLock } from './process-lock.js';
import type { RuntimeHealth } from './runtime-health.js';

interface Stoppable {
  stop(): Promise<void>;
}

export class BotRuntime {
  private readonly shutdownTimeoutMs: number;
  private readonly logger: Pick<Console, 'error'>;
  private readonly taskTracker: Pick<ApplicationTaskTracker, 'stop'>;
  private readonly processLock: Pick<ProcessLock, 'release'>;
  private readonly additionalSchedulers: readonly Stoppable[];
  private readonly cancelActiveWork: () => void;
  private readonly afterDisconnect: () => Promise<void>;
  private readonly health?: Pick<RuntimeHealth, 'markStopping' | 'markStopped' | 'markFailed'>;
  private stopPromise: Promise<void> | null = null;

  public constructor(
    private readonly scheduler: Pick<WishlistScheduler, 'stop'>,
    private readonly client: Pick<Client, 'destroy'>,
    private readonly database: Pick<DatabaseSync, 'close'>,
    options: {
      readonly shutdownTimeoutMs?: number;
      readonly logger?: Pick<Console, 'error'>;
      readonly taskTracker?: Pick<ApplicationTaskTracker, 'stop'>;
      readonly processLock?: Pick<ProcessLock, 'release'>;
      readonly additionalSchedulers?: readonly Stoppable[];
      readonly cancelActiveWork?: () => void;
      readonly afterDisconnect?: () => Promise<void>;
      readonly health?: Pick<RuntimeHealth, 'markStopping' | 'markStopped' | 'markFailed'>;
    } = {},
  ) {
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
    this.logger = options.logger ?? safeLogger;
    this.taskTracker = options.taskTracker ?? { stop: async () => undefined };
    this.processLock = options.processLock ?? { release: () => undefined };
    this.additionalSchedulers = options.additionalSchedulers ?? [];
    this.cancelActiveWork = options.cancelActiveWork ?? (() => undefined);
    this.health = options.health;
    this.afterDisconnect = options.afterDisconnect ?? (async()=>undefined);

    if (!Number.isSafeInteger(this.shutdownTimeoutMs) || this.shutdownTimeoutMs <= 0) {
      throw new Error('Shutdown timeout must be a positive safe integer');
    }
  }

  public stop(): Promise<void> {
    if (this.stopPromise === null) {
      this.stopPromise = this.stopResources();
    }

    return this.stopPromise;
  }

  private async stopResources(): Promise<void> {
    this.health?.markStopping();
    this.cancelActiveWork();
    const activeWorkStop = Promise.allSettled([
      callSafely(() => this.scheduler.stop()),
      ...this.additionalSchedulers.map((scheduler) =>
        callSafely(() => scheduler.stop()),
      ),
      callSafely(() => this.taskTracker.stop()),
    ]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const errors: unknown[] = [];

    try {
      const outcome = await Promise.race([
        activeWorkStop.then(() => 'stopped' as const),
        new Promise<'timeout'>((resolve) => {
          timeout = setTimeout(() => resolve('timeout'), this.shutdownTimeoutMs);
        }),
      ]);

      if (outcome === 'timeout') {
        try {
          this.logger.error(
            'Application shutdown timed out; waiting for active work before closing resources.',
          );
        } catch (error: unknown) {
          errors.push(error);
        }
        await activeWorkStop;
      }
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }

    }

    for (const result of await activeWorkStop) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }

    const clientResult = await Promise.allSettled([callSafely(() => this.client.destroy())]);
    if (clientResult[0]?.status === 'rejected') {
      errors.push(clientResult[0].reason);
    }

    try { await this.afterDisconnect(); } catch(error) { errors.push(error); }
    let databaseClosed = false;
    try {
      this.database.close();
      databaseClosed = true;
    } catch (error: unknown) {
      errors.push(error);
    }

    if (databaseClosed) {
      try {
        this.processLock.release();
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      this.health?.markFailed();
      throw new AggregateError(errors, 'Bot shutdown completed with errors');
    }

    this.health?.markStopped();
  }
}

function callSafely(operation: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch (error: unknown) {
    return Promise.reject(error);
  }
}
