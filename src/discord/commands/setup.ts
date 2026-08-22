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
import { SteamIdentityError } from '../../domain/steam-identity.js';
import { messagesFor } from '../messages.js';

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure your Steam wishlist notifications')
  .addStringOption((option) =>
    option
      .setName('steam-profile')
      .setDescription('Steam profile ID, link, or vanity name')
      .setDescriptionLocalizations({
        tr: 'Steam profil ID, bağlantı veya vanity adı',
      })
      .setMaxLength(200)
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
  const profileInput = interaction.options.getString('steam-profile')
    ?? interaction.options.getString('steamid64', true);
  const language = interaction.options.getString('language', true);
  const responseLanguage = language === 'en' ? 'en' : 'tr';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const config = await service.configure(
      interaction.user.id,
      profileInput,
      language as 'tr' | 'en',
    );
    await interaction.editReply({
      content: messagesFor(config.language).setupSuccess,
    });
  } catch (error) {
    if (error instanceof InvalidUserConfigurationError) {
      await interaction.editReply({
        content: messagesFor(responseLanguage).invalidSetup,
      });
      return;
    }

    if (error instanceof SteamIdentityError) {
      const messages = messagesFor(responseLanguage);
      const content = error.code === 'STEAM_PROFILE_INVALID'
        ? messages.invalidSteamProfile
        : error.code === 'STEAM_VANITY_NOT_FOUND'
          ? messages.vanityProfileNotFound
          : error.code === 'STEAM_WEB_API_KEY_MISSING'
            ? messages.steamWebApiKeyMissing
            : messages.vanityResolutionUnavailable;
      await interaction.editReply({ content });
      return;
    }

    if (error instanceof SteamWishlistError) {
      const content = error.code === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messagesFor(responseLanguage).wishlistInaccessible
        : messagesFor(responseLanguage).setupValidationUnavailable;
      await interaction.editReply({ content });
      return;
    }

    throw error;
  }
}
