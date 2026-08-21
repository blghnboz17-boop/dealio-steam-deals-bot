import type { UserConfig } from '../domain/user-config.js';
import type { UserConfigRepository } from '../persistence/user-config-repository.js';
import type { NotificationDeliveryResult } from './notification-service.js';

export interface NotificationRetryClock {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface NotificationRetryLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface NotificationRetrySchedulerOptions {
  readonly intervalSeconds: number;
  readonly userConfigRepository: Pick<UserConfigRepository, 'findEnabled'>;
  readonly notificationService: {
    deliverPending(discordUserId: string): Promise<NotificationDeliveryResult>;
  };
  readonly maxUserConcurrency?: number;
  readonly clock?: NotificationRetryClock;
  readonly logger?: NotificationRetryLogger;
}

export interface NotificationRetryRunSummary {
  readonly userCount: number;
  readonly completedCount: number;
  readonly candidateCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly errorCount: number;
}

const systemClock: NotificationRetryClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

const consoleLogger: NotificationRetryLogger = {
  info: (message) => console.log(`${new Date().toISOString()} [notification-retry] ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} [notification-retry] ${message}`),
};

const emptySummary: NotificationRetryRunSummary = {
  userCount: 0,
  completedCount: 0,
  candidateCount: 0,
  sentCount: 0,
  failedCount: 0,
  errorCount: 0,
};

export class NotificationRetryScheduler {
  private readonly intervalMs: number;
  private readonly clock: NotificationRetryClock;
  private readonly logger: NotificationRetryLogger;
  private readonly maxUserConcurrency: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopping = false;
  private activeRun: Promise<NotificationRetryRunSummary> | null = null;
  private stopPromise: Promise<void> | null = null;

  public constructor(private readonly options: NotificationRetrySchedulerOptions) {
    if (
      !Number.isSafeInteger(options.intervalSeconds) ||
      options.intervalSeconds < 1 ||
      options.intervalSeconds > 3_600
    ) {
      throw new Error('Notification retry interval must be between 1 and 3600 seconds');
    }

    this.intervalMs = options.intervalSeconds * 1_000;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? consoleLogger;
    this.maxUserConcurrency = options.maxUserConcurrency ?? 3;

    if (!Number.isSafeInteger(this.maxUserConcurrency) || this.maxUserConcurrency <= 0) {
      throw new Error('Notification retry concurrency must be a positive safe integer');
    }
  }

  public get intervalMilliseconds(): number {
    return this.intervalMs;
  }

  public start(): void {
    if (this.started || this.stopping) {
      return;
    }

    this.started = true;
    this.timer = this.clock.setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.logger.info(`Started with interval ${this.options.intervalSeconds} seconds.`);
    void this.runOnce();
  }

  public stop(): Promise<void> {
    if (this.stopPromise !== null) {
      return this.stopPromise;
    }

    this.stopping = true;
    if (this.timer !== null) {
      this.clock.clearInterval(this.timer);
      this.timer = null;
    }

    this.started = false;
    const activeRun = this.activeRun;
    this.stopPromise = activeRun
      ? activeRun.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    return this.stopPromise;
  }

  public runOnce(): Promise<NotificationRetryRunSummary> {
    if (this.stopping || this.activeRun !== null) {
      return Promise.resolve(emptySummary);
    }

    const run = Promise.resolve().then(() => this.executeRun());
    this.activeRun = run;
    const clearActiveRun = (): void => {
      if (this.activeRun === run) {
        this.activeRun = null;
      }
    };
    void run.then(clearActiveRun, clearActiveRun);
    return run;
  }

  private async executeRun(): Promise<NotificationRetryRunSummary> {
    let users: UserConfig[];
    try {
      users = this.options.userConfigRepository.findEnabled();
    } catch (_error: unknown) {
      this.logger.error('Could not load enabled users.');
      return { ...emptySummary, errorCount: 1 };
    }

    let completedCount = 0;
    let candidateCount = 0;
    let sentCount = 0;
    let failedCount = 0;
    let errorCount = 0;
    let nextUserIndex = 0;

    const processNextUser = async (): Promise<void> => {
      while (nextUserIndex < users.length) {
        const user = users[nextUserIndex];
        nextUserIndex += 1;

        try {
          const delivery = await this.options.notificationService.deliverPending(
            user.discordUserId,
          );
          candidateCount += delivery.candidateCount;
          sentCount += delivery.sentCount;
          failedCount += delivery.failedCount;
        } catch (_error: unknown) {
          errorCount += 1;
        } finally {
          completedCount += 1;
        }
      }
    };

    const workerCount = Math.min(users.length, this.maxUserConcurrency);
    await Promise.all(Array.from({ length: workerCount }, () => processNextUser()));
    if (candidateCount > 0 || failedCount > 0 || errorCount > 0) {
      this.logger.info(
        `Run completed: users=${users.length} candidates=${candidateCount} sent=${sentCount} failed=${failedCount} errors=${errorCount}.`,
      );
    }

    return {
      userCount: users.length,
      completedCount,
      candidateCount,
      sentCount,
      failedCount,
      errorCount,
    };
  }
}
