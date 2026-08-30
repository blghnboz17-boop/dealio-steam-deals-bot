import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { EnvironmentConfig } from '../config/environment.js';
import { checkCommand } from './commands/check.js';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';
import { deleteDataCommand } from './commands/delete-data.js';
import { testNotificationCommand } from './commands/test-notification.js';
import { wishlistCommand } from './commands/wishlist.js';
import { regionCommand } from './commands/region.js';
import { dealioCommand } from './commands/dealio.js';

export const commands = [
  dealioCommand,
  setupCommand,
  regionCommand,
  statusCommand,
  checkCommand,
  wishlistCommand,
  testNotificationCommand,
  deleteDataCommand,
];

type CommandRegistrationRest = Pick<REST, 'get' | 'put'>;
type CommandCleanupRest = Pick<REST, 'put'>;
type RegistrationLogger = (message: string) => void;

function commandBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands.map((command) => command.toJSON());
}

function responseCommandNames(response: unknown, operation: 'PUT' | 'GET'): string[] {
  if (!Array.isArray(response)) {
    throw new Error(`Discord global command ${operation} returned an invalid response`);
  }

  return response.map((command) => {
    if (
      typeof command !== 'object'
      || command === null
      || !('name' in command)
      || typeof command.name !== 'string'
    ) {
      throw new Error(`Discord global command ${operation} returned an invalid command`);
    }
    return command.name;
  });
}

export async function registerGlobalCommands(
  rest: CommandRegistrationRest,
  discordClientId: string,
  signal?: AbortSignal,
  log: RegistrationLogger = console.log,
): Promise<readonly string[]> {
  const route = Routes.applicationCommands(discordClientId);
  const body = commandBody();
  const expectedNames = body.map((command) => command.name);
  log(`Registering global commands: ${expectedNames.join(', ')}`);

  const putResponse = await rest.put(
    route,
    { body, signal },
  );
  const putNames = responseCommandNames(putResponse, 'PUT');
  log(`Registered global commands: ${putNames.join(', ')}`);

  const getResponse = await rest.get(route, { signal });
  const verifiedNames = responseCommandNames(getResponse, 'GET');
  log(`Verified global commands: ${verifiedNames.join(', ')}`);

  const missingNames = expectedNames.filter((name) => !verifiedNames.includes(name));
  if (missingNames.length > 0) {
    throw new Error(
      `Discord global command verification failed; missing commands: ${missingNames.join(', ')}`,
    );
  }

  return verifiedNames;
}

export async function cleanupLegacyGuildCommands(
  rest: CommandCleanupRest,
  discordClientId: string,
  discordGuildId: string,
  signal?: AbortSignal,
): Promise<void> {
  await rest.put(
    Routes.applicationGuildCommands(discordClientId, discordGuildId),
    { body: [], signal },
  );
}

export async function registerCommands(
  environment: EnvironmentConfig,
  signal?: AbortSignal,
  registrationRest?: CommandRegistrationRest,
  log: RegistrationLogger = console.log,
): Promise<void> {
  const rest = registrationRest ?? new REST({
    version: '10',
    timeout: 10_000,
    retries: 0,
    rejectOnRateLimit: () => true,
  }).setToken(environment.discordToken);

  await registerGlobalCommands(rest, environment.discordClientId, signal, log);

  if (environment.discordGuildId) {
    await cleanupLegacyGuildCommands(
      rest,
      environment.discordClientId,
      environment.discordGuildId,
      signal,
    );
  }
}
