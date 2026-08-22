import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  InvalidUserConfigurationError,
  UserConfigurationService,
} from '../../application/user-configuration-service.js';
import { storeCountryLabel } from '../../domain/store-country.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';

export const regionCommand = new SlashCommandBuilder()
  .setName('region')
  .setDescription('Change the country configured for your Steam Store account')
  .setDescriptionLocalizations({
    tr: 'Steam mağaza hesabında ayarlı ülkeyi değiştir',
  })
  .addStringOption((option) => option
    .setName('country')
    .setDescription('Steam Store country; this is not inferred from your Discord location')
    .setDescriptionLocalizations({
      tr: 'Steam mağaza ülkesi; Discord konumundan tahmin edilmez',
    })
    .setAutocomplete(true)
    .setRequired(true));

export async function handleRegion(
  interaction: ChatInputCommandInteraction,
  service: UserConfigurationService,
): Promise<void> {
  const existing = service.get(interaction.user.id);
  const language = existing?.language ?? languageFromDiscordLocale(interaction.locale);
  const messages = messagesFor(language);
  if (!existing) {
    await interaction.reply({ content: messages.notConfigured, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const updated = await service.setStoreCountry(
      interaction.user.id,
      interaction.options.getString('country', true),
    );
    if (!updated) {
      await interaction.editReply({ content: messages.notConfigured });
      return;
    }
    const label = storeCountryLabel(updated.storeCountryCode, updated.language);
    await interaction.editReply({
      content: updated.configVersion === existing.configVersion
        ? messagesFor(updated.language).regionUnchanged(label)
        : messagesFor(updated.language).regionSaved(label),
    });
  } catch (error: unknown) {
    if (error instanceof InvalidUserConfigurationError
      && error.code === 'INVALID_STORE_COUNTRY') {
      await interaction.editReply({ content: messages.invalidStoreCountry });
      return;
    }
    throw error;
  }
}
