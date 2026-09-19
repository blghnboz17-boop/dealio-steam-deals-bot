import { measureDiscordOperation } from '../interaction-timing.js';
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
import {
  buildNoticePanel,
  dealioV2Flags,
} from '../ui/components-v2.js';

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
  await measureDiscordOperation(interaction, 'region.ack', () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const existing = service.get(interaction.user.id);
  const language = existing?.language ?? languageFromDiscordLocale(interaction.locale);
  const messages = messagesFor(language);
  if (!existing) {
    await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
      components: [buildNoticePanel(language, 'warning',
        language === 'tr' ? 'Dealio henüz kurulmamış' : 'Dealio is not configured',
        messages.notConfigured)],
      flags: dealioV2Flags,
    }));
    return;
  }

  try {
    const updated = await service.setStoreCountry(
      interaction.user.id,
      interaction.options.getString('country', true),
    );
    if (!updated) {
      await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
        flags: dealioV2Flags,
        components: [buildNoticePanel(language, 'warning',
          language === 'tr' ? 'Dealio henüz kurulmamış' : 'Dealio is not configured',
          messages.notConfigured)],
      }));
      return;
    }
    const label = storeCountryLabel(updated.storeCountryCode, updated.language);
    const unchanged = updated.configVersion === existing.configVersion;
    await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(
        updated.language,
        unchanged ? 'info' : 'success',
        unchanged
          ? (updated.language === 'tr' ? 'Bölge zaten seçili' : 'Region already selected')
          : (updated.language === 'tr' ? 'Mağaza bölgesi güncellendi' : 'Store region updated'),
        unchanged
          ? messagesFor(updated.language).regionUnchanged(label)
          : messagesFor(updated.language).regionSaved(label),
      )],
    }));
  } catch (error: unknown) {
    if (error instanceof InvalidUserConfigurationError
      && error.code === 'INVALID_STORE_COUNTRY') {
      await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
        flags: dealioV2Flags,
        components: [buildNoticePanel(language, 'warning',
          language === 'tr' ? 'Geçersiz mağaza bölgesi' : 'Invalid Store region',
          messages.invalidStoreCountry)],
      }));
      return;
    }
    throw error;
  }
}
