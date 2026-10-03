import { measureDiscordOperation } from '../interaction-timing.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import {
  TestNotificationCooldownError,
  TestNotificationService,
} from '../../application/test-notification-service.js';
import { UserConfigurationService } from '../../application/user-configuration-service.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import { buildNoticePanel, dealioV2Flags, openPanelNoticeButton } from '../ui/components-v2.js';
import { uiCopy } from '../ui/copy.js';

export const testNotificationCommand = new SlashCommandBuilder()
  .setName('test-notification')
  .setDescription('Send yourself an example sale notification by DM')
  .setDescriptionLocalizations({
    tr: 'Kendine örnek bir indirim bildirimi DM olarak gönder',
    de: 'Dir selbst eine Beispiel-Angebotsbenachrichtigung per DM schicken',
    fr: 'T’envoyer en MP un exemple d’alerte promo',
  });

export async function handleTestNotification(
  interaction: ChatInputCommandInteraction,
  userConfigurationService: UserConfigurationService,
  testNotificationService: TestNotificationService,
): Promise<void> {
  await measureDiscordOperation(interaction, 'test-notification.ack', () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const config = userConfigurationService.get(interaction.user.id);
  const language = config?.language ?? languageFromDiscordLocale(interaction.locale);
  const messages = messagesFor(language);

  let kind: 'success' | 'warning' | 'danger' = 'success';
  let title: string = uiCopy(language).testSentTitle;
  let description: string = uiCopy(language).testSentDescription;
  try {
    await testNotificationService.send(
      interaction.user.id,
      language,
      config?.storeCountryCode ?? 'TR',
    );
  } catch (error: unknown) {
    if (error instanceof TestNotificationCooldownError) {
      kind = 'warning';
      title = uiCopy(language).testCooldownTitle;
      description = messages.testNotificationCooldown(error.retryAfterSeconds);
    } else {
      safeLogger.error('Discord test notification delivery failed', error);
      kind = 'danger';
      title = uiCopy(language).testFailedTitle;
      description = messages.testNotificationFailed;
    }
  }

  await measureDiscordOperation(interaction, 'test-notification.render', () => interaction.editReply({
    flags: dealioV2Flags,
    components: [buildNoticePanel(language, kind, title, description,
      { button: openPanelNoticeButton(language, !config) })],
  }));
}
