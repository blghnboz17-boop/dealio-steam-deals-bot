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

  let content: string;
  try {
    await testNotificationService.send(
      interaction.user.id,
      language,
      config?.storeCountryCode ?? 'TR',
    );
    content = messages.testNotificationSent;
  } catch (error: unknown) {
    if (error instanceof TestNotificationCooldownError) {
      content = messages.testNotificationCooldown(error.retryAfterSeconds);
    } else {
      console.error('Discord test notification delivery failed', error);
      content = messages.testNotificationFailed;
    }
  }

  await interaction.editReply({ content });
}
