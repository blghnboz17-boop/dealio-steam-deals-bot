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
import { buildNoticePanel, dealioV2Flags } from '../ui/components-v2.js';
import { uiCopy } from '../ui/copy.js';

export const testNotificationCommand = new SlashCommandBuilder()
  .setName('test-notification')
  .setDescription('Send yourself an example sale notification by DM')
  .setDescriptionLocalizations({
    tr: 'Kendine DM ile örnek bir indirim bildirimi gönder',
  });

export async function handleTestNotification(
  interaction: ChatInputCommandInteraction,
  userConfigurationService: UserConfigurationService,
  testNotificationService: TestNotificationService,
): Promise<void> {
  const config = userConfigurationService.get(interaction.user.id);
  const language = config?.language ?? languageFromDiscordLocale(interaction.locale);
  const messages = messagesFor(language);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
      console.error('Discord test notification delivery failed', error);
      kind = 'danger';
      title = uiCopy(language).testFailedTitle;
      description = messages.testNotificationFailed;
    }
  }

  await interaction.editReply({
    flags: dealioV2Flags,
    components: [buildNoticePanel(language, kind, title, description)],
  });
}
