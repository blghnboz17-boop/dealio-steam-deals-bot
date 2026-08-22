import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { CheckService } from '../../application/check-service.js';
import { NotificationService } from '../../application/notification-service.js';
import { StatusService } from '../../application/status-service.js';
import { messagesFor } from '../messages.js';

export const checkCommand = new SlashCommandBuilder()
  .setName('check')
  .setDescription('Check your Steam wishlist for sales');

export async function handleCheck(
  interaction: ChatInputCommandInteraction,
  checkService: CheckService,
  statusService: StatusService,
  notificationService: NotificationService,
): Promise<void> {
  const config = statusService.get(interaction.user.id).config;
  const language = config?.language ?? 'tr';

  if (!config) {
    await interaction.reply({
      content: messagesFor(language).notConfigured,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await checkService.check(interaction.user.id);
  const currentConfig = result.status === 'success'
    ? statusService.get(interaction.user.id).config
    : config;
  const currentLanguage = currentConfig?.language ?? language;
  const notificationsEnabled = currentConfig?.enabled === true;
  const delivery = result.status === 'success' && notificationsEnabled
    ? await notificationService.deliverPending(interaction.user.id)
    : { sentCount: 0, failedCount: 0, candidateCount: 0 };

  const content = result.status === 'already-running'
    ? messagesFor(currentLanguage).alreadyRunning
    : result.status === 'cooldown'
      ? messagesFor(currentLanguage).cooldown(result.retryAfterSeconds)
    : result.status === 'not-configured'
      ? messagesFor(currentLanguage).notConfigured
    : result.status === 'unavailable'
      ? result.errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messagesFor(currentLanguage).wishlistInaccessible
        : messagesFor(currentLanguage).unavailable
       : result.status === 'disabled'
         ? messagesFor(currentLanguage).statusDisabled
       : result.status === 'failed'
        ? messagesFor(currentLanguage).failed
       : !notificationsEnabled
         ? messagesFor(currentLanguage).checkCompletedNotificationsDisabled(
             result.checkedCount,
             result.notificationCandidates.length,
             result.failedItems.length,
             result.unknownPriceCount,
           )
       : messagesFor(currentLanguage).checkCompleted(
            result.checkedCount,
            delivery.candidateCount,
            result.failedItems.length,
            result.unknownPriceCount,
            delivery.sentCount,
            delivery.failedCount,
          );

  await interaction.editReply({ content });
}
