import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Events, MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotRuntime } from '../src/application/bot-runtime.js';
import { RuntimeHealth } from '../src/application/runtime-health.js';
import { CheckService } from '../src/application/check-service.js';
import { DiscountThresholdService } from '../src/application/discount-threshold-service.js';
import { NotificationService } from '../src/application/notification-service.js';
import { SetupService } from '../src/application/setup-service.js';
import { StatusService } from '../src/application/status-service.js';
import { TestNotificationService } from '../src/application/test-notification-service.js';
import { UserConfigurationService } from '../src/application/user-configuration-service.js';
import { WishlistViewService } from '../src/application/wishlist-view-service.js';

const mocks = vi.hoisted(() => ({
  registerCommands: vi.fn(async () => undefined),
  wishlistStart: vi.fn(),
  wishlistStop: vi.fn(async () => undefined),
  retryStart: vi.fn(),
  retryStop: vi.fn(async () => undefined),
  setup: vi.fn(async () => undefined),
  region: vi.fn(async () => undefined),
  status: vi.fn(async () => undefined),
  check: vi.fn(async () => undefined),
  wishlist: vi.fn(async () => undefined),
  testNotification: vi.fn(async () => undefined),
  deleteData: vi.fn(async () => undefined),
  dealio: vi.fn(async () => undefined),
  navigate: vi.fn(async () => undefined),
  autocomplete: vi.fn(async () => undefined),
  createClient: vi.fn(),
}));

vi.mock('../src/discord/register-commands.js', () => ({ registerCommands: mocks.registerCommands }));
vi.mock('../src/discord/commands/setup.js', () => ({ handleSetup: mocks.setup }));
vi.mock('../src/discord/commands/region.js', () => ({ handleRegion: mocks.region }));
vi.mock('../src/discord/commands/status.js', () => ({ handleStatus: mocks.status }));
vi.mock('../src/discord/commands/dealio.js', () => ({ handleDealio: mocks.dealio, createDealioNavigator: () => mocks.navigate }));
vi.mock('../src/discord/commands/check.js', () => ({ handleCheck: mocks.check }));
vi.mock('../src/discord/commands/wishlist.js', () => ({ handleWishlist: mocks.wishlist }));
vi.mock('../src/discord/commands/test-notification.js', () => ({
  handleTestNotification: mocks.testNotification,
}));
vi.mock('../src/discord/commands/delete-data.js', () => ({ handleDeleteData: mocks.deleteData }));
vi.mock('../src/discord/store-country-options.js', () => ({
  handleStoreCountryAutocomplete: mocks.autocomplete,
}));
vi.mock('../src/application/scheduler.js', () => ({
  WishlistScheduler: class {
    public readonly start = mocks.wishlistStart;
    public readonly stop = mocks.wishlistStop;
  },
}));
vi.mock('../src/application/notification-retry-scheduler.js', () => ({
  NotificationRetryScheduler: class {
    public readonly start = mocks.retryStart;
    public readonly stop = mocks.retryStop;
  },
}));
vi.mock('../src/discord/client.js', () => ({ createDiscordClient: mocks.createClient }));

type InteractionFake = {
  id: string;
  locale: string;
  user: { id: string };
  commandName: string;
  replied: boolean;
  deferred: boolean;
  responded: boolean;
  isAutocomplete: () => boolean;
  isChatInputCommand: () => boolean;
  isMessageComponent: () => boolean;
  respond: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
};
type Listener = (interaction?: InteractionFake) => void;

class DiscordClientFake {
  public ready = false;
  public readonly guilds = { cache: new Map<string, unknown>() };
  public readonly login = vi.fn(async (_token?: string): Promise<string> => 'test-token');
  public readonly destroy = vi.fn();
  private readonly listeners = new Map<string, Listener[]>();

  public once(event: string, listener: Listener): void {
    this.on(event, listener);
  }

  public on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  public isReady(): boolean {
    return this.ready;
  }

  public emit(event: string, interaction?: InteractionFake): void {
    if (event === Events.ClientReady) this.ready = true;
    for (const listener of this.listeners.get(event) ?? []) listener(interaction);
  }
}

const runtimes: BotRuntime[] = [];
const directories: string[] = [];
const clients: DiscordClientFake[] = [];
const environment = {
  discordToken: 'test-token',
  discordClientId: '123456789012345678',
  databasePath: '',
  pollIntervalHours: 6,
  notificationRetryIntervalSeconds: 60,
};

function interaction(overrides: Partial<InteractionFake> = {}): InteractionFake {
  return {
    id: 'interaction-id', locale: 'en-US', user: { id: 'discord-user' },
    commandName: 'setup', replied: false, deferred: false, responded: false,
    isAutocomplete: () => false, isChatInputCommand: () => true, isMessageComponent: () => false,
    respond: vi.fn(async () => undefined), reply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined), ...overrides,
  };
}

async function launch(): Promise<{ readonly client: DiscordClientFake; readonly healthPath: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'bot-wiring-'));
  directories.push(directory);
  const healthPath = join(directory, 'health.json');
  const runtime = await startBot(
    { ...environment, databasePath: join(directory, 'wishlist.db') },
    { healthPath },
  );
  runtimes.push(runtime);
  const client = clients.at(-1);
  if (client === undefined) throw new Error('Discord client fake was not created');
  return { client, healthPath };
}

function health(healthPath: string): {
  readonly phase: string;
  readonly discordReady: boolean;
  readonly guildCount: number | null;
} {
  return JSON.parse(readFileSync(healthPath, 'utf8'));
}

const { startBot } = await import('../src/index.js');

function restoreClientFactory(): void {
  mocks.createClient.mockImplementation(() => {
    const client = new DiscordClientFake();
    clients.push(client);
    return client;
  });
}

restoreClientFactory();

afterEach(async () => {
  await Promise.allSettled(runtimes.map((runtime) => runtime.stop()));
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  runtimes.length = 0;
  directories.length = 0;
  clients.length = 0;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  restoreClientFactory();
});

describe('bot wiring', () => {
  it('registers commands before logging in', async () => {
    let finishRegistration = (): void => undefined;
    mocks.registerCommands.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishRegistration = resolve;
    }));
    const directory = mkdtempSync(join(tmpdir(), 'bot-wiring-order-'));
    directories.push(directory);

    const startup = startBot({ ...environment, databasePath: join(directory, 'wishlist.db') });
    await vi.waitFor(() => expect(mocks.registerCommands).toHaveBeenCalledOnce());
    const client = clients.at(-1);
    expect(client?.login).not.toHaveBeenCalled();
    finishRegistration();
    const runtime = await startup;
    runtimes.push(runtime);

    expect(mocks.registerCommands.mock.invocationCallOrder[0])
      .toBeLessThan(client?.login.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it('rejects promptly after cleanup when aborted during unresolved Discord login', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bot-wiring-login-abort-'));
    directories.push(directory);
    let rejectLogin = (_error: Error): void => undefined;
    const pendingLogin = new Promise<string>((_resolve, reject) => {
      rejectLogin = reject;
    });
    const client = new DiscordClientFake();
    client.login.mockImplementationOnce(() => pendingLogin);
    clients.push(client);
    mocks.createClient.mockReturnValueOnce(client);
    const abortController = new AbortController();
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const startup = startBot(
      { ...environment, databasePath: join(directory, 'wishlist.db') },
      { signal: abortController.signal },
    );
    const startupOutcome = startup.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    try {
      await vi.waitFor(() => expect(client.login).toHaveBeenCalledOnce());
      abortController.abort();

      expect(await Promise.race([
        startupOutcome,
        new Promise<'pending'>((resolve) => setImmediate(() => resolve('pending'))),
      ])).toBe('rejected');
      expect(client.destroy).toHaveBeenCalledOnce();

      rejectLogin(new Error('late login failure'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledReasons).toEqual([]);
    } finally {
      rejectLogin(new Error('test cleanup'));
      await startupOutcome;
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('starts both schedulers and marks health ready only on ClientReady', async () => {
    const { client, healthPath } = await launch();
    client.guilds.cache.set('guild-one', {});
    client.guilds.cache.set('guild-two', {});
    expect(mocks.wishlistStart).not.toHaveBeenCalled();
    expect(mocks.retryStart).not.toHaveBeenCalled();
    expect(health(healthPath).phase).toBe('starting');

    client.emit(Events.ClientReady);

    expect(mocks.wishlistStart).toHaveBeenCalledOnce();
    expect(mocks.retryStart).toHaveBeenCalledOnce();
    expect(health(healthPath)).toMatchObject({
      phase: 'ready',
      discordReady: true,
      guildCount: 2,
    });
  });

  it('refreshes health for every shard readiness event', async () => {
    const refresh = vi.spyOn(RuntimeHealth.prototype, 'refreshDiscordReady');
    const { client, healthPath } = await launch();
    client.emit(Events.ClientReady);

    for (const event of [Events.ShardReady, Events.ShardDisconnect, Events.Invalidated]) {
      client.ready = event === Events.ShardReady;
      client.emit(event);
    }

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(health(healthPath).discordReady).toBe(false);
  });

  const commandCases = [
    ['setup', mocks.setup, [expect.any(SetupService), expect.any(AbortSignal), {
      bannerUrl: undefined,
      pollIntervalHours: 6,
    }]],
    ['region', mocks.region, [expect.any(UserConfigurationService)]],
    ['status', mocks.status, [expect.any(StatusService), expect.any(UserConfigurationService), expect.any(AbortSignal), expect.any(DiscountThresholdService), expect.any(TestNotificationService), { navigate: mocks.navigate }]],
    ['check', mocks.check, [expect.any(CheckService), expect.any(StatusService), expect.any(NotificationService), { navigate: mocks.navigate, lifecycleSignal: expect.any(AbortSignal) }]],
    ['wishlist', mocks.wishlist, [expect.any(WishlistViewService), expect.any(AbortSignal), expect.any(DiscountThresholdService), { navigate: mocks.navigate }]],
    ['test-notification', mocks.testNotification, [expect.any(UserConfigurationService), expect.any(TestNotificationService)]],
    ['delete-data', mocks.deleteData, [expect.any(UserConfigurationService), expect.any(SetupService), expect.any(AbortSignal), {
      bannerUrl: undefined,
      pollIntervalHours: 6,
    }]],
  ] satisfies readonly (readonly [string, ReturnType<typeof vi.fn>, readonly unknown[]])[];

  it.each(commandCases)('routes /%s with its required dependencies', async (name, handler, dependencies) => {
    const { client } = await launch();
    const input = interaction({ commandName: name });

    client.emit(Events.InteractionCreate, input);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

    expect(handler).toHaveBeenCalledWith(input, ...dependencies);
  });

  it('routes /dealio with the shared UI services', async () => {
    const { client } = await launch();
    const input = interaction({ commandName: 'dealio' });
    client.emit(Events.InteractionCreate, input);
    await vi.waitFor(() => expect(mocks.dealio).toHaveBeenCalledOnce());
    expect(mocks.dealio).toHaveBeenCalledWith(input, expect.objectContaining({
      setupService: expect.any(SetupService),
      statusService: expect.any(StatusService),
      wishlistViewService: expect.any(WishlistViewService),
      lifecycleSignal: expect.any(AbortSignal),
    }), { navigate: mocks.navigate });
  });

  it('replies ephemerally to an unknown chat command', async () => {
    const { client } = await launch();
    const input = interaction({ commandName: 'unknown' });

    client.emit(Events.InteractionCreate, input);
    await vi.waitFor(() => expect(input.reply).toHaveBeenCalledOnce());

    expect(input.reply).toHaveBeenCalledWith(expect.objectContaining({
      components: expect.any(Array),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    }));
  });

  it('ignores interactions that are neither autocomplete nor chat commands', async () => {
    const { client } = await launch();
    const input = interaction({ isChatInputCommand: () => false });

    client.emit(Events.InteractionCreate, input);
    await Promise.resolve();

    expect(input.reply).not.toHaveBeenCalled();
    for (const handler of commandCases.map((entry) => entry[1])) expect(handler).not.toHaveBeenCalled();
  });

  it.each([false, true])('responds with no autocomplete choices after failure only when responded=%s', async (responded) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.autocomplete.mockRejectedValueOnce(new Error('autocomplete failed'));
    const { client } = await launch();
    const input = interaction({ responded, isAutocomplete: () => true, isChatInputCommand: () => false });

    client.emit(Events.InteractionCreate, input);
    await vi.waitFor(() => expect(mocks.autocomplete).toHaveBeenCalledOnce());
    await Promise.resolve();

    if (responded) expect(input.respond).not.toHaveBeenCalled();
    else expect(input.respond).toHaveBeenCalledWith([]);
  });

  it.each([
    ['deferred', { deferred: true }, 'editReply'],
    ['replied', { replied: true }, 'editReply'],
    ['unacknowledged', {}, 'reply'],
  ] satisfies readonly (readonly [string, Partial<InteractionFake>, 'editReply' | 'reply'])[])(
    'uses %s command error response path', async (_state, state, responseMethod) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.setup.mockRejectedValueOnce(new Error('command failed'));
      const { client } = await launch();
      const input = interaction(state);

      client.emit(Events.InteractionCreate, input);
      await vi.waitFor(() => expect(input[responseMethod]).toHaveBeenCalledOnce());

      expect(input[responseMethod]).toHaveBeenCalledWith(expect.objectContaining({
        components: expect.any(Array),
        ...(responseMethod === 'reply'
          ? { flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 }
          : { flags: MessageFlags.IsComponentsV2 }),
      }));
    },
  );

  it('contains a failure while sending the command error response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.setup.mockRejectedValueOnce(new Error('command failed'));
    const { client } = await launch();
    const input = interaction({ reply: vi.fn().mockRejectedValue(new Error('reply failed')) });

    client.emit(Events.InteractionCreate, input);
    await vi.waitFor(() => expect(input.reply).toHaveBeenCalledOnce());

    await expect(Promise.all(runtimes.map((runtime) => runtime.stop()))).resolves.toBeDefined();
  });
});
