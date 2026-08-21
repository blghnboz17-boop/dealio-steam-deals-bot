import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { UserConfigurationService } from '../../application/user-configuration-service.js';
import { messagesFor } from '../messages.js';

export const deleteDataCommand = new SlashCommandBuilder()
  .setName('delete-data')
  .setDescription('Delete your Steam wishlist configuration and notification history')
  .addBooleanOption((option) =>
    option
      .setName('confirm')
      .setDescription('Confirm permanent deletion of your stored data')
      .setRequired(true),
  );

export async function handleDeleteData(
  interaction: ChatInputCommandInteraction,
  service: UserConfigurationService,
): Promise<void> {
  const config = service.get(interaction.user.id);
  const language = config?.language ?? 'tr';
  const confirmed = interaction.options.getBoolean('confirm', true);

  if (!confirmed) {
    await interaction.reply({
      content: messagesFor(language).deleteNotConfirmed,
      ephemeral: true,
    });
    return;
  }

  const deleted = await service.deleteData(interaction.user.id);
  await interaction.reply({
    content: deleted
      ? messagesFor(language).deleteSuccess
      : messagesFor(language).deleteNoData,
    ephemeral: true,
  });
}
