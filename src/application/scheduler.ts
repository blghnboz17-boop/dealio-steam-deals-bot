import type { CheckResult } from './check-service.js';
import type { UserConfig } from '../domain/user-config.js';
import type { UserConfigRepository } from '../persistence/user-config-repository.js';
import { maxPollIntervalHours, minPollIntervalHours } from '../config/environment.js';

export interface SchedulerCheckService {
  check(discordUserId: string): Promise<CheckResult>;
}

export interface SchedulerNotificationService {
  deliverPending(discordUserId: string): Promise<{
    readonly candidateCount: number;
    readonly sentCount: number;
    readonly failedCount: number;
  }>;
}

export interface SchedulerClock {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface SchedulerLogger {
  info(message: string): void;
  error(message: string): void;
}

const systemClock: SchedulerClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

const consoleLogger: SchedulerLogger = {
  info: (message) => console.log(`${new Date().toISOString()} [scheduler] ${message}`),
  error: (message) => console.error(`${new Date().toISOString()} [scheduler] ${message}`),
};

export interface SchedulerOptions {
  readonly intervalHours: number;
  readonly userConfigRepository: Pick<UserConfigRepository, 'findEnabled'>;
  readonly checkService: SchedulerCheckService;
  readonly notificationService: SchedulerNotificationService;
  readonly clock?: SchedulerClock;
  readonly logger?: SchedulerLogger;
  readonly maxUserConcurrency?: number;
}

export interface SchedulerRunSummary {
  readonly userCount: number;
  readonly completedCount: number;
  readonly errorCount: number;
}

export class WishlistScheduler {
  private readonly intervalMs: number;
  private readonly clock: SchedulerClock;
  private readonly logger: SchedulerLogger;
  private readonly maxUserConcurrency: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopping = false;
  private activeRun: Promise<SchedulerRunSummary> | null = null;
  private stopPromise: Promise<void> | null = null;

  public constructor(private readonly options: SchedulerOptions) {
    if (
      !Number.isFinite(options.intervalHours) ||
      options.intervalHours < minPollIntervalHours ||
      options.intervalHours > maxPollIntervalHours
    ) {
      throw new Error(
        `Scheduler interval must be between ${minPollIntervalHours} and ${maxPollIntervalHours} hours`,
      );
    }

    this.intervalMs = options.intervalHours * 60 * 60 * 1000;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? consoleLogger;
    this.maxUserConcurrency = options.maxUserConcurrency ?? 3;

    if (!Number.isSafeInteger(this.maxUserConcurrency) || this.maxUserConcurrency <= 0) {
      throw new Error('Scheduler user concurrency must be a positive safe integer');
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
    this.logger.info(`Started with interval ${this.options.intervalHours} hours.`);
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

  public runOnce(): Promise<SchedulerRunSummary> {
    if (this.stopping || this.activeRun !== null) {
      return Promise.resolve({ userCount: 0, completedCount: 0, errorCount: 0 });
    }

    const run = this.executeRun();
    this.activeRun = run;
    const clearActiveRun = (): void => {
      if (this.activeRun === run) {
        this.activeRun = null;
      }
    };
    void run.then(clearActiveRun, clearActiveRun);

    return run;
  }

  private async executeRun(): Promise<SchedulerRunSummary> {
    let users: UserConfig[];
    try {
      users = this.options.userConfigRepository.findEnabled();
    } catch (_error: unknown) {
      this.logger.error('Could not load enabled users.');
      return { userCount: 0, completedCount: 0, errorCount: 1 };
    }

    this.logger.info(`Run started for ${users.length} enabled user(s).`);
    let completedCount = 0;
    let errorCount = 0;

    let nextUserIndex = 0;
    const processNextUser = async (): Promise<void> => {
      while (nextUserIndex < users.length) {
        const index = nextUserIndex;
        nextUserIndex += 1;
        const user = users[index];
        this.logger.info(`Check started (${index + 1}/${users.length}).`);

        try {
          const result = await this.options.checkService.check(user.discordUserId);
          if (result.status === 'success') {
            const delivery = await this.options.notificationService.deliverPending(
              user.discordUserId,
            );
            this.logger.info(
              `Check completed (${index + 1}/${users.length}): status=success checked=${result.checkedCount} candidates=${delivery.candidateCount} dmSent=${delivery.sentCount} dmFailed=${delivery.failedCount}.`,
            );
          } else if (result.status === 'unavailable') {
            errorCount += 1;
            this.logger.error(
              `Check completed (${index + 1}/${users.length}): status=unavailable code=${result.errorCode}.`,
            );
          } else if (result.status === 'failed') {
            errorCount += 1;
            this.logger.error(
              `Check completed (${index + 1}/${users.length}): status=failed code=${result.errorCode}.`,
            );
          } else {
            this.logger.info(
              `Check completed (${index + 1}/${users.length}): status=${result.status}.`,
            );
          }

          completedCount += 1;
        } catch (_error: unknown) {
          errorCount += 1;
          completedCount += 1;
          this.logger.error(
            `Check completed (${index + 1}/${users.length}): status=error.`,
          );
        }
      }
    };
    const workerCount = Math.min(users.length, this.maxUserConcurrency);
    await Promise.all(
      Array.from({ length: workerCount }, () => processNextUser()),
    );

    this.logger.info(
      `Run completed: users=${users.length} completed=${completedCount} errors=${errorCount}.`,
    );
    return { userCount: users.length, completedCount, errorCount };
  }
}
