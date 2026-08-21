import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { EnvironmentConfig } from '../config/environment.js';
import { checkCommand } from './commands/check.js';
import { setupCommand } from './commands/setup.js';
import { statusCommand } from './commands/status.js';
import { deleteDataCommand } from './commands/delete-data.js';

export const commands = [setupCommand, statusCommand, checkCommand, deleteDataCommand];

export async function registerCommands(environment: EnvironmentConfig): Promise<void> {
  const body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = commands.map((command) =>
    command.toJSON(),
  );
  const rest = new REST({ version: '10' }).setToken(environment.discordToken);

  await rest.put(
    Routes.applicationGuildCommands(environment.discordClientId, environment.discordGuildId),
    { body },
  );
}
