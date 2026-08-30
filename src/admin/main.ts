import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminAuditLogger } from './audit-logger.js';
import { BotController } from './bot-controller.js';
import { AdminChallengeStore } from './challenge-store.js';
import { AdminDashboardService } from './dashboard-service.js';
import { loadAdminEnvironment, type AdminEnvironment } from './environment.js';
import { AdminHealthReader } from './health-reader.js';
import { AdminLoginService } from './login-service.js';
import { AdminLoginThrottle } from './login-throttle.js';
import { verifyAdminPassword } from './password.js';
import { createAdminServer } from './server.js';
import { AdminSessionStore } from './session-store.js';
import { AdminTelemetryRepository } from './telemetry-repository.js';
import { renderDashboardView } from './ui/dashboard-view.js';
import { renderLoginView } from './ui/login-view.js';
import { adminStyles } from './ui/styles.js';

const START_FAILURE_MESSAGE = 'Admin server failed to start.';
const STOP_FAILURE_MESSAGE = 'Admin server failed to stop.';
const LIFECYCLE_AUDIT_FAILURE_MESSAGE = 'Admin lifecycle audit record failed.';
const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;

export interface AdminProcessServer {
  once(event: 'listening', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  listen(port: number, host: string): this;
  close(callback: (error?: Error) => void): this;
}

export interface AdminProcessRuntime {
  readonly server: AdminProcessServer;
  readonly botController: { stop(): Promise<void> };
}

export interface AdminProcessHost {
  exitCode: string | number | null | undefined;
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
}

export interface AdminProcessDependencies {
  readonly process: AdminProcessHost;
  readonly logger: Pick<Console, 'log' | 'error'>;
  readonly loadEnvironment: () => AdminEnvironment;
  readonly assemble: (configuration: AdminEnvironment) => AdminProcessRuntime;
}

export interface RunAdminProcessOptions {
  readonly dependencies?: AdminProcessDependencies;
}

export interface AdminProcessControl {
  readonly ready: Promise<void>;
  stop(): Promise<void>;
}

export function assembleAdminRuntime(
  configuration: AdminEnvironment,
  logger: Pick<Console, 'log' | 'error'> = console,
): AdminProcessRuntime {
  const healthReader = new AdminHealthReader(configuration.healthPath);
  const telemetryRepository = new AdminTelemetryRepository(configuration.databasePath);
  const dashboardService = new AdminDashboardService(healthReader, telemetryRepository);
  const sessionStore = new AdminSessionStore();
  const challengeStore = new AdminChallengeStore();
  const loginThrottle = new AdminLoginThrottle();
  const loginService = new AdminLoginService({
    challenges: challengeStore,
    sessions: sessionStore,
    throttle: loginThrottle,
    verifyPassword: (username, password) => verifyAdminPassword(
      username,
      password,
      configuration.users,
    ),
  });
  const botController = new BotController();
  const auditLogger = new AdminAuditLogger((record) => {
    logger.log(JSON.stringify(record));
  });
  const server = createAdminServer({
    publicOrigin: configuration.publicOrigin,
    loginService,
    sessionStore,
    dashboardService,
    botController,
    auditLogger,
    renderers: {
      login: renderLoginView,
      dashboard: renderDashboardView,
      styles: adminStyles,
    },
    now: () => new Date(),
    reportLifecycleAuditFailure: () => {
      logger.error(LIFECYCLE_AUDIT_FAILURE_MESSAGE);
    },
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  return { server, botController };
}

const systemProcess: AdminProcessHost = {
  get exitCode() {
    return process.exitCode;
  },
  set exitCode(value) {
    process.exitCode = value;
  },
  on: (signal, listener) => {
    process.on(signal, listener);
  },
};

const defaultDependencies: AdminProcessDependencies = {
  process: systemProcess,
  logger: console,
  loadEnvironment: loadAdminEnvironment,
  assemble: (configuration) => assembleAdminRuntime(configuration),
};

export function runAdminProcess(
  options: RunAdminProcessOptions = {},
): AdminProcessControl {
  const dependencies = options.dependencies ?? defaultDependencies;
  let runtime: AdminProcessRuntime | null = null;
  let listening = false;
  let startupSettled = false;
  let startupFailureLogged = false;
  let stopFailureLogged = false;
  let controllerStop: Promise<void> | null = null;
  let shutdown: Promise<void> | null = null;
  let resolveReady = (): void => undefined;
  let rejectReady = (_error: unknown): void => undefined;
  let resolveStartup = (): void => undefined;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const startup = new Promise<void>((resolvePromise) => {
    resolveStartup = resolvePromise;
  });

  const stopController = (): Promise<void> => {
    const activeRuntime = runtime;
    if (activeRuntime === null) {
      return Promise.resolve();
    }
    controllerStop ??= Promise.resolve().then(() => activeRuntime.botController.stop());
    return controllerStop;
  };

  const reportStopFailure = (): void => {
    dependencies.process.exitCode = 1;
    if (!startupFailureLogged && !stopFailureLogged) {
      stopFailureLogged = true;
      dependencies.logger.error(STOP_FAILURE_MESSAGE);
    }
  };

  const failStartup = async (error: unknown): Promise<void> => {
    if (startupSettled) {
      return;
    }
    startupSettled = true;
    startupFailureLogged = true;
    dependencies.process.exitCode = 1;
    dependencies.logger.error(START_FAILURE_MESSAGE);
    await stopController().catch(reportStopFailure);
    rejectReady(error);
    resolveStartup();
  };

  const stop = (): Promise<void> => {
    shutdown ??= startup
      .then(async () => {
        if (runtime === null) {
          return;
        }
        const activeRuntime = runtime;
        let failed = false;
        if (listening) {
          listening = false;
          await new Promise<void>((resolvePromise, rejectPromise) => {
            activeRuntime.server.close((error) => {
              if (error !== undefined) {
                rejectPromise(error);
                return;
              }
              resolvePromise();
            });
          }).catch(() => {
            failed = true;
          });
        }
        await stopController().catch(() => {
          failed = true;
        });
        if (failed) {
          reportStopFailure();
        }
      })
      .catch(reportStopFailure);
    return shutdown;
  };

  dependencies.process.on('SIGINT', () => {
    void stop();
  });
  dependencies.process.on('SIGTERM', () => {
    void stop();
  });

  void Promise.resolve()
    .then(() => {
      const configuration = dependencies.loadEnvironment();
      runtime = dependencies.assemble(configuration);
      runtime.server.once('error', (error) => {
        void failStartup(error);
      });
      runtime.server.once('listening', () => {
        if (startupSettled) {
          return;
        }
        startupSettled = true;
        listening = true;
        dependencies.logger.log(
          `Admin server listening on http://${configuration.host}:${configuration.port}`,
        );
        resolveReady();
        resolveStartup();
      });
      runtime.server.listen(configuration.port, configuration.host);
    })
    .catch((error: unknown) => failStartup(error));

  return { ready, stop };
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMainModule) {
  void import('dotenv/config')
    .then(() => {
      const control = runAdminProcess();
      void control.ready.catch(() => undefined);
    })
    .catch(() => {
      process.exitCode = 1;
      console.error(START_FAILURE_MESSAGE);
    });
}
