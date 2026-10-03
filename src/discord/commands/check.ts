import { measureDiscordOperation } from '../interaction-timing.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { CheckService } from '../../application/check-service.js';
import type { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { NotificationService } from '../../application/notification-service.js';
import type { StatusService } from '../../application/status-service.js';
import type { TestNotificationService } from '../../application/test-notification-service.js';
import type { UserConfigurationService } from '../../application/user-configuration-service.js';
import type { WishlistViewService } from '../../application/wishlist-view-service.js';
import { buildCheckPanel, type CheckResultPresentation } from '../check-view-v2.js';
import { messagesFor } from '../messages.js';
import { dealioUiSessionTimeoutMs, dealioV2Flags } from '../ui/components-v2.js';
import { uiCopy } from '../ui/copy.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { handleStatus } from './status.js';
import { handleWishlist } from './wishlist.js';

export const checkCommand = new SlashCommandBuilder()
  .setName('check')
  .setDescription('Check your Steam wishlist for sales')
  .setDescriptionLocalizations({ tr: 'Steam wishlistini şimdi indirimler için kontrol et' });

export interface CheckNavigationServices {
  readonly wishlistViewService: WishlistViewService;
  readonly userConfigurationService: UserConfigurationService;
  readonly discountThresholdService?: DiscountThresholdService;
  readonly testNotificationService?: TestNotificationService;
  readonly lifecycleSignal?: AbortSignal;
}

export async function handleCheck(
  interaction: ChatInputCommandInteraction,
  checkService: CheckService,
  statusService: StatusService,
  notificationService: NotificationService,
  navigation?: CheckNavigationServices,
): Promise<void> {
  await measureDiscordOperation(interaction, 'check.ack', () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const config = statusService.get(interaction.user.id).config;
  const language = config?.language ?? 'tr';
  const messages = messagesFor(language);
  if (!config) {
    await measureDiscordOperation(interaction, 'check.render', () => interaction.editReply({
      flags: dealioV2Flags,
      components: [buildCheckPanel(language, {
        kind: 'warning',
        title: language === 'tr' ? 'Dealio henüz kurulmamış' : 'Dealio is not configured',
        description: messages.notConfigured,
      })],
    }));
    return;
  }

  const text = uiCopy(language);
  await measureDiscordOperation(interaction, 'check.render', () => interaction.editReply({
    flags: dealioV2Flags,
    components: [buildCheckPanel(language, {
      kind: 'info',
      title: text.checkingTitle,
      description: text.checkingDescription,
    })],
  }));
  const result = await checkService.check(interaction.user.id);
  const currentConfig = result.status === 'success'
    ? statusService.get(interaction.user.id).config
    : config;
  const currentLanguage = currentConfig?.language ?? language;
  const currentMessages = messagesFor(currentLanguage);
  const notificationsEnabled = currentConfig?.enabled === true;
  const delivery = result.status === 'success' && notificationsEnabled
    ? await notificationService.deliverPending(interaction.user.id)
    : { sentCount: 0, failedCount: 0, candidateCount: 0 };
  const presentation = checkPresentation(
    result,
    currentLanguage,
    notificationsEnabled,
    delivery,
  );
  const finalPanel = buildCheckPanel(
    currentLanguage,
    presentation,
    navigation ? interaction.id : undefined,
  );
  const message = await measureDiscordOperation(interaction, 'check.render', () => interaction.editReply({ components: [finalPanel] }));
  if (!navigation) {
    return;
  }
  const collector = message.createMessageComponentCollector({
    time: dealioUiSessionTimeoutMs,
    filter: (component) => component.user.id === interaction.user.id
      && component.customId.startsWith(`check-v2:${interaction.id}:`),
  });
  const closeUiSession = dealioUiSessions.open(
    interaction.id,
    interaction.user.id,
    ['check-v2'],
    dealioUiSessionTimeoutMs,
  );
  collector.on('collect', (component) => {
    const action = component.customId.slice(`check-v2:${interaction.id}:`.length);
    if (action === 'wishlist') {
      void handleWishlist(
        component as unknown as ChatInputCommandInteraction,
        navigation.wishlistViewService,
        navigation.lifecycleSignal,
        navigation.discountThresholdService,
      ).catch((error: unknown) => safeLogger.error('Dealio check wishlist navigation failed', error));
      return;
    }
    if (action === 'status') {
      void handleStatus(
        component as unknown as ChatInputCommandInteraction,
        statusService,
        navigation.userConfigurationService,
        navigation.lifecycleSignal,
        navigation.discountThresholdService,
        navigation.testNotificationService,
      ).catch((error: unknown) => safeLogger.error('Dealio check status navigation failed', error));
      return;
    }
    void measureDiscordOperation(component, 'check.button-ack', () => component.deferUpdate())
      .catch((error: unknown) => safeLogger.error('Discord check acknowledgement failed', error));
  });
  const stopForShutdown = (): void => collector.stop('shutdown');
  navigation.lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  try {
    await new Promise<void>((resolve) => collector.once('end', () => resolve()));
    await measureDiscordOperation(interaction, 'check.render', () => interaction.editReply({
      components: [buildCheckPanel(currentLanguage, presentation, interaction.id, true)],
    })).catch((error: unknown) => safeLogger.error('Dealio check panel cleanup failed', error));
  } finally {
    closeUiSession();
    navigation.lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

function checkPresentation(
  result: Awaited<ReturnType<CheckService['check']>>,
  language: 'tr' | 'en',
  notificationsEnabled: boolean,
  delivery: { readonly sentCount: number; readonly failedCount: number; readonly candidateCount: number },
): CheckResultPresentation {
  const text = uiCopy(language);
  const messages = messagesFor(language);
  if (result.status === 'already-running') {
    return { kind: 'info', title: text.checkAlreadyTitle, description: messages.alreadyRunning };
  }
  if (result.status === 'cooldown') {
    return { kind: 'warning', title: text.checkCooldownTitle, description: messages.cooldown(result.retryAfterSeconds) };
  }
  if (result.status === 'unavailable') {
    return {
      kind: 'warning',
      title: text.checkUnavailableTitle,
      description: result.errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
        ? messages.wishlistInaccessible
        : messages.unavailable,
    };
  }
  if (result.status === 'failed') {
    return { kind: 'danger', title: text.checkFailedTitle, description: messages.failed };
  }
  if (result.status === 'not-configured') {
    return { kind: 'warning', title: text.checkFailedTitle, description: messages.notConfigured };
  }
  if (result.status === 'disabled') {
    return { kind: 'warning', title: text.checkFailedTitle, description: messages.statusDisabled };
  }
  const description = notificationsEnabled
    ? messages.checkCompleted(
        result.checkedCount,
        delivery.candidateCount,
        result.failedItems.length,
        result.unknownPriceCount,
        delivery.sentCount,
        delivery.failedCount,
      )
    : messages.checkCompletedNotificationsDisabled(
        result.checkedCount,
        result.notificationCandidates.length,
        result.failedItems.length,
        result.unknownPriceCount,
      );
  return {
    kind: delivery.failedCount > 0 || result.failedItems.length > 0 ? 'warning' : 'success',
    title: text.checkSuccessTitle,
    description,
    metrics: [
      { label: language === 'tr' ? 'İşlenen oyun' : 'Games processed', value: result.checkedCount },
      { label: language === 'tr' ? 'İndirim adayı' : 'Sale candidates', value: result.notificationCandidates.length },
      { label: language === 'tr' ? 'Gönderilen DM' : 'DMs sent', value: delivery.sentCount },
      { label: language === 'tr' ? 'Eksik fiyat' : 'Unknown prices', value: result.unknownPriceCount },
      { label: language === 'tr' ? 'Ayrıntı hatası' : 'Detail errors', value: result.failedItems.length },
    ],
  };
}
