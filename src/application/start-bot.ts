import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { loadEnvironment, type EnvironmentConfig } from '../config/environment.js';
import { registerBotEvents } from '../discord/bot-events.js';
import { createDiscordClient } from '../discord/client.js';
import { DiscordNotificationSender } from '../discord/notification-sender.js';
import { registerCommands } from '../discord/register-commands.js';
import { CheckStateRepository } from '../persistence/check-state-repository.js';
import { DiscountThresholdRepository } from '../persistence/discount-threshold-repository.js';
import {
  createDatabase,
  DatabaseInitializationError,
} from '../persistence/database.js';
import { PollScheduleRepository } from '../persistence/poll-schedule-repository.js';
import { StatusDashboardRepository } from '../persistence/status-dashboard-repository.js';
import { UserConfigRepository } from '../persistence/user-config-repository.js';
import { WishlistStateRepository } from '../persistence/wishlist-state-repository.js';
import { SteamClient } from '../steam/steam-client.js';
import { SteamIdentityResolver } from '../steam/steam-identity-resolver.js';
import { ApplicationTaskTracker } from './application-task-tracker.js';
import { BotRuntime } from './bot-runtime.js';
import { CheckService } from './check-service.js';
import { DiscountThresholdService } from './discount-threshold-service.js';
import { InitialWishlistSummaryService } from './initial-wishlist-summary-service.js';
import { NotificationRetryScheduler } from './notification-retry-scheduler.js';
import { NotificationService } from './notification-service.js';
import { ProcessLock } from './process-lock.js';
import { RuntimeHealth } from './runtime-health.js';
import { WishlistScheduler } from './scheduler.js';
import { SetupService } from './setup-service.js';
import { StatusService } from './status-service.js';
import { TestNotificationService } from './test-notification-service.js';
import { UserConfigurationService } from './user-configuration-service.js';
import { UserOperationCoordinator } from './user-operation-coordinator.js';
import { WishlistViewService } from './wishlist-view-service.js';

export interface StartBotOptions {
  readonly signal?: AbortSignal;
  readonly nodePidPath?: string;
  readonly healthPath?: string;
  readonly health?: RuntimeHealth;
}

export async function startBot(
  environment: EnvironmentConfig = loadEnvironment(),
  options: StartBotOptions = {},
): Promise<BotRuntime> {
  if (options.signal?.aborted) {
    throw new Error('Bot startup was cancelled');
  }

  const processLock = ProcessLock.acquire(environment.databasePath);
  let health: RuntimeHealth | undefined;
  try {
    health = options.health ?? (options.healthPath ? new RuntimeHealth(options.healthPath) : undefined);
  } catch (error: unknown) {
    processLock.release();
    throw error;
  }
  let database;
  try {
    database = createDatabase(environment.databasePath);
  } catch (error: unknown) {
    if (!(error instanceof DatabaseInitializationError) || error.databaseClosed) {
      processLock.release();
    }
    health?.markFailed();
    throw error;
  }

  let runtime: BotRuntime | null = null;
  let handleStartupAbort: (() => void) | null = null;
  try {
    const userConfigRepository = new UserConfigRepository(database);
    const checkStateRepository = new CheckStateRepository(database);
    const wishlistStateRepository = new WishlistStateRepository(database);
    const pollScheduleRepository = new PollScheduleRepository(database);
    const statusDashboardRepository = new StatusDashboardRepository(database);
    const discountThresholdRepository = new DiscountThresholdRepository(database);
    const taskTracker = new ApplicationTaskTracker();
    const userOperationCoordinator = new UserOperationCoordinator();
    const applicationAbortController = new AbortController();
    const steamClient = new SteamClient({
      lifecycleSignal: applicationAbortController.signal,
    });
    const steamIdentityResolver = new SteamIdentityResolver({
      apiKey: environment.steamWebApiKey,
      lifecycleSignal: applicationAbortController.signal,
    });
    const userConfigurationService = new UserConfigurationService(
      userConfigRepository,
      steamIdentityResolver,
      steamClient,
      userOperationCoordinator,
    );
    const statusService = new StatusService(
      userConfigRepository,
      checkStateRepository,
      statusDashboardRepository,
      discountThresholdRepository,
    );
    const checkService = new CheckService(
      userConfigRepository,
      checkStateRepository,
      wishlistStateRepository,
      steamClient,
      userOperationCoordinator,
    );
    const discountThresholdService = new DiscountThresholdService(
      userConfigRepository,
      discountThresholdRepository,
      userOperationCoordinator,
    );
    const client = createDiscordClient();
    health?.setDiscordReadyProbe(() => client.isReady());
    health?.setDiscordGuildCountProbe(() => client.guilds.cache.size);
    const notificationSender = new DiscordNotificationSender(client, {
      lifecycleSignal: applicationAbortController.signal,
      bannerUrl: environment.dealioBannerUrl,
      pollIntervalHours: environment.pollIntervalHours,
    });
    const initialWishlistSummaryService = new InitialWishlistSummaryService(
      checkService,
      notificationSender,
    );
    const setupService = new SetupService(
      userConfigurationService,
      initialWishlistSummaryService,
      userOperationCoordinator,
    );
    const notificationService = new NotificationService(
      userConfigRepository,
      wishlistStateRepository,
      notificationSender,
      {
        coordinator: userOperationCoordinator,
        lifecycleSignal: applicationAbortController.signal,
      },
    );
    const testNotificationService = new TestNotificationService(notificationSender);
    const wishlistViewService = new WishlistViewService(
      userConfigRepository,
      steamClient,
      undefined,
      discountThresholdRepository,
      userOperationCoordinator,
    );
    const scheduler = new WishlistScheduler({
      intervalHours: environment.pollIntervalHours,
      userConfigRepository,
      checkService,
      notificationService,
      scheduleRepository: pollScheduleRepository,
    });
    const notificationRetryScheduler = new NotificationRetryScheduler({
      intervalSeconds: environment.notificationRetryIntervalSeconds,
      userConfigRepository,
      notificationService,
    });
    runtime = new BotRuntime(scheduler, client, database, {
      taskTracker,
      processLock,
      additionalSchedulers: [notificationRetryScheduler],
      cancelActiveWork: () => applicationAbortController.abort(),
      health,
    });
    const startedRuntime = runtime;
    if (options.nodePidPath) {
      writeFileSync(options.nodePidPath, String(process.pid), 'utf8');
    }
    handleStartupAbort = () => {
      void startedRuntime.stop().catch((error: unknown) => {
        console.error('Bot shutdown during startup failed', error);
      });
    };
    options.signal?.addEventListener('abort', handleStartupAbort, { once: true });

    registerBotEvents({
      client,
      scheduler,
      notificationRetryScheduler,
      taskTracker,
      services: {
        userConfigurationService,
        setupService,
        statusService,
        checkService,
        notificationService,
        testNotificationService,
        wishlistViewService,
        discountThresholdService,
        setupPresentation: {
          bannerUrl: environment.dealioBannerUrl,
          pollIntervalHours: environment.pollIntervalHours,
        },
      },
      lifecycleSignal: applicationAbortController.signal,
      health,
    });

    await registerCommands(environment, options.signal);
    if (options.signal?.aborted) {
      throw new Error('Bot startup was cancelled');
    }
    await client.login(environment.discordToken);
    if (options.signal?.aborted) {
      throw new Error('Bot startup was cancelled');
    }
    return startedRuntime;
  } catch (error: unknown) {
    if (handleStartupAbort) {
      options.signal?.removeEventListener('abort', handleStartupAbort);
    }
    if (runtime) {
      await runtime.stop();
    } else {
      database.close();
      try {
        processLock.release();
      } catch (releaseError: unknown) {
        console.error('Could not release process lock after startup failure', releaseError);
      }
    }
    if (options.signal?.aborted) {
      health?.markStopped();
    } else {
      health?.markFailed();
    }
    throw error;
  }
}
