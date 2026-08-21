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
import { WishlistScheduler } from './application/scheduler.js';
import { StatusService } from './application/status-service.js';
import { UserConfigurationService } from './application/user-configuration-service.js';
import { UserOperationCoordinator } from './application/user-operation-coordinator.js';
import { ProcessLock } from './application/process-lock.js';
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

export async function startBot(
  environment: EnvironmentConfig = loadEnvironment(),
  options: { readonly signal?: AbortSignal; readonly nodePidPath?: string } = {},
): Promise<BotRuntime> {
  if (options.signal?.aborted) {
    throw new Error('Bot startup was cancelled');
  }

  const processLock = ProcessLock.acquire(environment.databasePath);
  let database;
  try {
    database = createDatabase(environment.databasePath);
  } catch (error: unknown) {
    if (!(error instanceof DatabaseInitializationError) || error.databaseClosed) {
      processLock.release();
    }
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
    const steamClient = new SteamClient();
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
    const notificationService = new NotificationService(
      userConfigRepository,
      wishlistStateRepository,
      new DiscordNotificationSender(client),
      { coordinator: userOperationCoordinator },
    );
    const scheduler = new WishlistScheduler({
      intervalHours: environment.pollIntervalHours,
      userConfigRepository,
      checkService,
      notificationService,
    });
    runtime = new BotRuntime(scheduler, client, database, {
      taskTracker,
      processLock,
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

    client.once(Events.ClientReady, (readyClient) => {
      console.log(`Discord bot is ready as ${readyClient.user.tag}`);
      scheduler.start();
    });

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

    await registerCommands(environment);
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
      console.error('Could not process cooperative shutdown request', error);
    }
  }, 500);
  shutdownRequestTimer.unref();

  const requestShutdown = (signal: string): void => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    clearInterval(shutdownRequestTimer);
    console.log(`Received ${signal}; shutting down.`);
    startupAbortController.abort();
    if (runtime) {
      void runtime.stop()
        .catch((error: unknown) => {
          console.error('Bot shutdown failed', error);
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

  startBot(loadEnvironment(), {
    signal: startupAbortController.signal,
    nodePidPath,
  })
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
        console.error('Bot failed to start', error);
        process.exitCode = 1;
      }
      removeNodePid();
    });
}
