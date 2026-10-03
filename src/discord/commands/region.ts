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
import { countryDisplay } from '../ui/design.js';
import { localizer } from '../i18n.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import {
  buildNoticePanel,
  dealioV2Flags,
  openPanelNoticeButton,
} from '../ui/components-v2.js';

export const regionCommand = new SlashCommandBuilder()
  .setName('region')
  .setDescription('Change the country configured for your Steam Store account')
  .setDescriptionLocalizations({
    tr: 'Steam hesabındaki mağaza ülkesini değiştir',
    de: 'Das Shop-Land deines Steam-Kontos ändern',
    fr: 'Changer le pays de boutique de ton compte Steam',
  })
  .addStringOption((option) => option
    .setName('country')
    .setDescription('Steam Store country; this is not inferred from your Discord location')
    .setDescriptionLocalizations({
      tr: 'Steam mağazanın ülkesi; Discord konumuna bakılmaz',
      de: 'Land deines Steam-Shops; dein Discord-Standort spielt keine Rolle',
      fr: 'Pays de ta boutique Steam ; ta position Discord n’est pas utilisée',
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
  const t = localizer(language);
  if (!existing) {
    await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
      components: [buildNoticePanel(language, 'warning',
        t({ tr: 'Dealio henüz kurulmadı', en: 'Dealio isn’t set up yet', de: 'Dealio ist noch nicht eingerichtet', fr: 'Dealio n’est pas encore configuré' }),
        messages.notConfigured, { button: openPanelNoticeButton(language, true) })],
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
          t({ tr: 'Dealio henüz kurulmadı', en: 'Dealio isn’t set up yet', de: 'Dealio ist noch nicht eingerichtet', fr: 'Dealio n’est pas encore configuré' }),
          messages.notConfigured, { button: openPanelNoticeButton(language, true) })],
      }));
      return;
    }
    const label = countryDisplay(updated.storeCountryCode, updated.language);
    const unchanged = updated.configVersion === existing.configVersion;
    await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(
        updated.language,
        unchanged ? 'info' : 'success',
        localizer(updated.language)(unchanged
          ? { tr: 'Bölgen zaten bu', en: 'That’s already your region', de: 'Das ist schon deine Region', fr: 'C’est déjà ta région' }
          : { tr: 'Mağaza bölgeni güncelledim', en: 'Store region updated', de: 'Shop-Region aktualisiert', fr: 'Région mise à jour' }),
        unchanged
          ? messagesFor(updated.language).regionUnchanged(label)
          : messagesFor(updated.language).regionSaved(label),
        { button: openPanelNoticeButton(updated.language) },
      )],
    }));
  } catch (error: unknown) {
    if (error instanceof InvalidUserConfigurationError
      && error.code === 'INVALID_STORE_COUNTRY') {
      await measureDiscordOperation(interaction, 'region.render', () => interaction.editReply({
        flags: dealioV2Flags,
        components: [buildNoticePanel(language, 'warning',
          t({ tr: 'Bu ülkeyi tanımadım', en: 'I don’t recognize that country', de: 'Dieses Land kenne ich nicht', fr: 'Je ne reconnais pas ce pays' }),
          messages.invalidStoreCountry)],
      }));
      return;
    }
    throw error;
  }
}
