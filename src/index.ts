import 'dotenv/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Events } from 'discord.js';
import { BotRuntime } from './application/bot-runtime.js';
import { ApplicationTaskTracker } from './application/application-task-tracker.js';
import { CheckService } from './application/check-service.js';
import { NotificationService } from './application/notification-service.js';
import { NotificationRetryScheduler } from './application/notification-retry-scheduler.js';
import { WishlistScheduler } from './application/scheduler.js';
import { StatusService } from './application/status-service.js';
import { UserConfigurationService } from './application/user-configuration-service.js';
import { UserOperationCoordinator } from './application/user-operation-coordinator.js';
import { ProcessLock } from './application/process-lock.js';
import { RuntimeHealth } from './application/runtime-health.js';
import { loadEnvironment, type EnvironmentConfig } from './config/environment.js';
import {
  createDatabase,
  DatabaseInitializationError,
} from './persistence/database.js';
import { CheckStateRepository } from './persistence/check-state-repository.js';
import { UserConfigRepository } from './persistence/user-config-repository.js';
import { WishlistStateRepository } from './persistence/wishlist-state-repository.js';
import { SteamClient } from './steam/steam-client.js';
import { createDiscordClient } from './discord/client.js';
import { handleCheck } from './discord/commands/check.js';
import { handleSetup } from './discord/commands/setup.js';
import { handleStatus } from './discord/commands/status.js';
import { handleDeleteData } from './discord/commands/delete-data.js';
import { DiscordNotificationSender } from './discord/notification-sender.js';
import { registerCommands } from './discord/register-commands.js';

interface StartBotOptions {
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
    const taskTracker = new ApplicationTaskTracker();
    const userOperationCoordinator = new UserOperationCoordinator();
    const applicationAbortController = new AbortController();
    const steamClient = new SteamClient({
      lifecycleSignal: applicationAbortController.signal,
    });
    const userConfigurationService = new UserConfigurationService(
      userConfigRepository,
      steamClient,
      userOperationCoordinator,
    );
    const statusService = new StatusService(userConfigRepository, checkStateRepository);
    const checkService = new CheckService(
      userConfigRepository,
      checkStateRepository,
      wishlistStateRepository,
      steamClient,
      userOperationCoordinator,
    );
    const client = createDiscordClient();
    health?.setDiscordReadyProbe(() => client.isReady());
    const notificationService = new NotificationService(
      userConfigRepository,
      wishlistStateRepository,
      new DiscordNotificationSender(client, {
        lifecycleSignal: applicationAbortController.signal,
      }),
      {
        coordinator: userOperationCoordinator,
        lifecycleSignal: applicationAbortController.signal,
      },
    );
    const scheduler = new WishlistScheduler({
      intervalHours: environment.pollIntervalHours,
      userConfigRepository,
      checkService,
      notificationService,
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

    client.once(Events.ClientReady, () => {
      console.log(`${new Date().toISOString()} Discord client is ready; schedulers started.`);
      scheduler.start();
      notificationRetryScheduler.start();
      health?.markReady();
    });
    client.on(Events.ShardReady, () => health?.refreshDiscordReady());
    client.on(Events.ShardDisconnect, () => health?.refreshDiscordReady());
    client.on(Events.Invalidated, () => health?.refreshDiscordReady());

    client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      taskTracker.run(async () => {
        try {
          await handleInteraction(
            interaction,
            userConfigurationService,
            statusService,
            checkService,
            notificationService,
          );
        } catch (error: unknown) {
          console.error('Discord interaction failed', error);

          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.editReply({ content: 'The command could not be completed.' });
            } else {
              await interaction.reply({
                content: 'The command could not be completed.',
                ephemeral: true,
              });
            }
          } catch (replyError: unknown) {
            console.error('Discord interaction error reply failed', replyError);
          }
        }
      });
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

async function handleInteraction(
  interaction: Parameters<typeof handleSetup>[0],
  userConfigurationService: UserConfigurationService,
  statusService: StatusService,
  checkService: CheckService,
  notificationService: NotificationService,
): Promise<void> {
  switch (interaction.commandName) {
    case 'setup':
      await handleSetup(interaction, userConfigurationService);
      return;
    case 'status':
      await handleStatus(interaction, statusService);
      return;
    case 'check':
      await handleCheck(interaction, checkService, statusService, notificationService);
      return;
    case 'delete-data':
      await handleDeleteData(interaction, userConfigurationService);
      return;
    default:
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMainModule) {
  let runtime: BotRuntime | null = null;
  let shutdownRequested = false;
  const startupAbortController = new AbortController();
  const runtimeDirectory = resolve('.runtime');
  const shutdownRequestPath = resolve(runtimeDirectory, 'shutdown.request');
  const nodePidPath = resolve(runtimeDirectory, 'bot.node.pid');
  const healthPath = resolve(runtimeDirectory, 'bot.health.json');
  mkdirSync(runtimeDirectory, { recursive: true });
  const shutdownRequestTimer = setInterval(() => {
    try {
      if (!existsSync(shutdownRequestPath)) {
        return;
      }

      const requestedProcess = readFileSync(shutdownRequestPath, 'utf8').trim();
      if (requestedProcess !== 'all' && requestedProcess !== String(process.pid)) {
        return;
      }

      rmSync(shutdownRequestPath, { force: true });
      requestShutdown('control request');
    } catch (error: unknown) {
      console.error(
        `${new Date().toISOString()} Could not process cooperative shutdown request`,
        error,
      );
    }
  }, 500);
  shutdownRequestTimer.unref();

  const requestShutdown = (signal: string): void => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    clearInterval(shutdownRequestTimer);
    console.log(`${new Date().toISOString()} Received ${signal}; shutting down.`);
    startupAbortController.abort();
    if (runtime) {
      void runtime.stop()
        .catch((error: unknown) => {
          console.error(`${new Date().toISOString()} Bot shutdown failed`, error);
        })
        .finally(removeNodePid);
    }
  };

  const removeNodePid = (): void => {
    try {
      if (readFileSync(nodePidPath, 'utf8').trim() === String(process.pid)) {
        rmSync(nodePidPath, { force: true });
      }
    } catch (_error: unknown) {
      // The PID file may already have been removed by an operator.
    }
  };

  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  Promise.resolve()
    .then(() => startBot(loadEnvironment(), {
      signal: startupAbortController.signal,
      nodePidPath,
      healthPath,
    }))
    .then(async (startedRuntime) => {
      runtime = startedRuntime;
      if (shutdownRequested) {
        await runtime.stop();
        removeNodePid();
      }
    })
    .catch((error: unknown) => {
      clearInterval(shutdownRequestTimer);
      if (!shutdownRequested) {
        console.error(`${new Date().toISOString()} Bot failed to start`, error);
        process.exitCode = 1;
      }
      removeNodePid();
    });
}
