import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  InvalidUserConfigurationError,
  UserConfigurationService,
} from '../../application/user-configuration-service.js';
import { SteamWishlistError } from '../../domain/steam.js';
import { messagesFor } from '../messages.js';

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure your Steam wishlist notifications')
  .addStringOption((option) =>
    option
      .setName('steamid64')
      .setDescription('Your public Steam profile SteamID64')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('language')
      .setDescription('Notification language')
      .addChoices(
        { name: 'Türkçe', value: 'tr' },
        { name: 'English', value: 'en' },
      )
      .setRequired(true),
  );

export async function handleSetup(
  interaction: ChatInputCommandInteraction,
  service: UserConfigurationService,
): Promise<void> {
  const steamId64 = interaction.options.getString('steamid64', true);
  const language = interaction.options.getString('language', true);

  try {
    const config = await service.configure(
      interaction.user.id,
      steamId64,
      language as 'tr' | 'en',
    );
    await interaction.reply({
      content: messagesFor(config.language).setupSuccess,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    if (error instanceof InvalidUserConfigurationError) {
      await interaction.reply({
        content: messagesFor('tr').invalidSetup,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (error instanceof SteamWishlistError) {
      const content = error.code === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messagesFor(language as 'tr' | 'en').wishlistInaccessible
        : messagesFor(language as 'tr' | 'en').setupValidationUnavailable;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }

    throw error;
  }
}
