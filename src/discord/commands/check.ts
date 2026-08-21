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
  const delivery = result.status === 'success'
    ? await notificationService.deliverPending(interaction.user.id)
    : { sentCount: 0, failedCount: 0, candidateCount: 0 };

  const content = result.status === 'already-running'
    ? messagesFor(language).alreadyRunning
    : result.status === 'cooldown'
      ? messagesFor(language).cooldown(result.retryAfterSeconds)
    : result.status === 'not-configured'
      ? messagesFor(language).notConfigured
    : result.status === 'unavailable'
      ? result.errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messagesFor(language).wishlistInaccessible
        : messagesFor(language).unavailable
      : result.status === 'failed'
        ? messagesFor(language).failed
      : messagesFor(language).checkCompleted(
            result.checkedCount,
            delivery.candidateCount,
            result.failedItems.length,
            result.unknownPriceCount,
            delivery.sentCount,
            delivery.failedCount,
          );

  await interaction.editReply({ content });
}
