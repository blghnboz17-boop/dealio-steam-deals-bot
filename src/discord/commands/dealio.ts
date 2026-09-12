import { matchesRule } from '../assistant-view.js';
import { handleAssistant } from './assistant.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { CheckService } from '../../application/check-service.js';
import type { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { NotificationService } from '../../application/notification-service.js';
import type { SetupService } from '../../application/setup-service.js';
import type { StatusService } from '../../application/status-service.js';
import type { TestNotificationService } from '../../application/test-notification-service.js';
import type { UserConfigurationService } from '../../application/user-configuration-service.js';
import type { WishlistViewService } from '../../application/wishlist-view-service.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import type { SetupPresentationOptions } from '../setup-view.js';
import { buildStatusV2Panel } from '../status-view-v2.js';
import {
  buildNoticePanel,
  dealioUiSessionTimeoutMs,
  dealioEphemeralV2Flags,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { PanelOperationQueue } from '../ui/operation-queue.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { handleCheck } from './check.js';
import { handleSetup } from './setup.js';
import { handleStatusV2 } from './status-v2.js';
import { handleTestNotification } from './test-notification.js';
import { handleWishlist } from './wishlist.js';

export const dealioCommand = new SlashCommandBuilder()
  .setName('dealio')
  .setDescription('Open the Dealio control center')
  .setDescriptionLocalizations({ tr: 'Dealio kontrol merkezini aç' });

export interface DealioCommandServices {
  readonly setupService: SetupService;
  readonly statusService: StatusService;
  readonly userConfigurationService: UserConfigurationService;
  readonly wishlistViewService: WishlistViewService;
  readonly checkService: CheckService;
  readonly notificationService: NotificationService;
  readonly testNotificationService: TestNotificationService;
  readonly discountThresholdService?: DiscountThresholdService;
  readonly setupPresentation?: SetupPresentationOptions;
  readonly lifecycleSignal?: AbortSignal;
}

export async function handleDealio(
  interaction: ChatInputCommandInteraction,
  services: DealioCommandServices,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fallbackLanguage = languageFromDiscordLocale(interaction.locale);
  let current = services.statusService.getDashboard(interaction.user.id, fallbackLanguage);
  let avatarUrl: string | undefined;
  try {
    avatarUrl = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    avatarUrl = undefined;
  }
  const bannerUrl = services.setupPresentation?.bannerUrl;
  const featured = () => {
    const assistant=services.wishlistViewService?.assistantService, config=assistant?.config(interaction.user.id);
    if(!assistant||!config)return {};
    const items=assistant.repository.snapshot(config)?.items??[];
    const matching=items.filter(item=>matchesRule(item,assistant.repository.rule(config,item.appId)??undefined,config.minimumDiscountPercent));
    return {featuredDeal:matching[0],eligibleDealCount:matching.length};
  };
  const firstPanel = current.status === 'ready'
    ? buildStatusV2Panel(current, interaction.id, { mode: 'home', bannerUrl, avatarUrl, ...featured() })
    : buildNoticePanel(
        current.language,
        current.status === 'not-configured' ? 'warning' : 'danger',
        current.status === 'not-configured'
          ? (current.language === 'tr' ? 'Dealio’ya hoş geldin' : 'Welcome to Dealio')
          : (current.language === 'tr' ? 'Dealio paneli açılamadı' : 'Dealio panel unavailable'),
        current.status === 'not-configured'
          ? messagesFor(current.language).statusNotConfigured
          : messagesFor(current.language).statusDashboardUnavailable,
        current.status === 'not-configured'
          ? { button: {
              customId: `dealio:${interaction.id}:setup`,
              label: current.language === 'tr' ? 'Kurulumu Başlat' : 'Start Setup',
              emoji: '✨',
            } }
          : {},
      );
  const message = await interaction.editReply({
    flags: dealioV2Flags,
    components: [firstPanel],
  });
  const closeUiSession = dealioUiSessions.open(
    interaction.id,
    interaction.user.id,
    ['dealio'],
    dealioUiSessionTimeoutMs,
  );
  const collector = message.createMessageComponentCollector({
    time: dealioUiSessionTimeoutMs,
    filter: (component) => component.user.id === interaction.user.id
      && component.customId.startsWith(`dealio:${interaction.id}:`),
  });
  const operations = new PanelOperationQueue(async (error) => {
    safeLogger.error('Discord panel update failed', error);
    await interaction.followUp({
      flags: dealioEphemeralV2Flags,
      components: [buildNoticePanel(
        current.language, 'warning',
        current.language === 'tr' ? 'İşlem tamamlanamadı' : 'Action could not be completed',
        current.language === 'tr'
          ? 'İşlem sonucu gösterilemedi. Güncel durumu görmek için paneli yeniden açabilirsin.'
          : 'The result could not be displayed. Reopen the panel to check the current state.',
      )],
    });
  });

  collector.on('collect', (component) => {
    const action = component.customId.slice(`dealio:${interaction.id}:`.length);
    if ((action === 'history' || action === 'rhythm') && services.wishlistViewService?.assistantService) {
      void handleAssistant(component as unknown as ChatInputCommandInteraction,services.wishlistViewService?.assistantService,
        services.wishlistViewService,services.lifecycleSignal,action)
        .catch(error=>safeLogger.error('Assistant navigation failed',error));
      return;
    }
    if (action === 'setup') {
      void handleSetup(
        component as unknown as ChatInputCommandInteraction,
        services.setupService,
        services.lifecycleSignal,
        services.setupPresentation,
      ).catch((error: unknown) => safeLogger.error('Dealio home setup navigation failed', error));
      return;
    }
    if (action === 'wishlist') {
      void handleWishlist(
        component as unknown as ChatInputCommandInteraction,
        services.wishlistViewService,
        services.lifecycleSignal,
        services.discountThresholdService,
      ).catch((error: unknown) => safeLogger.error('Dealio home wishlist navigation failed', error));
      return;
    }
    if (action === 'check') {
      void handleCheck(
        component as unknown as ChatInputCommandInteraction,
        services.checkService,
        services.statusService,
        services.notificationService,
        {
          wishlistViewService: services.wishlistViewService,
          userConfigurationService: services.userConfigurationService,
          discountThresholdService: services.discountThresholdService,
          testNotificationService: services.testNotificationService,
          lifecycleSignal: services.lifecycleSignal,
        },
      ).catch((error: unknown) => safeLogger.error('Dealio home check navigation failed', error));
      return;
    }
    if (action === 'settings' || action === 'region') {
      void handleStatusV2(
        component as unknown as ChatInputCommandInteraction,
        services.statusService,
        services.userConfigurationService,
        services.lifecycleSignal,
        services.discountThresholdService,
        services.testNotificationService,
      ).catch((error: unknown) => safeLogger.error('Dealio home settings navigation failed', error));
      return;
    }
    if (action === 'test') {
      void handleTestNotification(
        component as unknown as ChatInputCommandInteraction,
        services.userConfigurationService,
        services.testNotificationService,
      ).catch((error: unknown) => safeLogger.error('Dealio home test navigation failed', error));
      return;
    }
    if (action === 'refresh') {
      const acknowledgement = component.deferUpdate();
      void operations.enqueue(acknowledgement, async () => {
        current = services.statusService.getDashboard(interaction.user.id, fallbackLanguage);
        const refreshed = current.status === 'ready'
          ? buildStatusV2Panel(current, interaction.id, { mode: 'home', bannerUrl, avatarUrl, ...featured() })
          : buildNoticePanel(
              current.language,
              current.status === 'not-configured' ? 'warning' : 'danger',
              current.status === 'not-configured'
                ? (current.language === 'tr' ? 'Dealio kurulumu bulunamadı' : 'Dealio setup not found')
                : (current.language === 'tr' ? 'Durum bilgisi alınamadı' : 'Status unavailable'),
              current.status === 'not-configured'
                ? messagesFor(current.language).statusNotConfigured
                : messagesFor(current.language).statusDashboardUnavailable,
            );
        await interaction.editReply({ components: [refreshed] });
      });
      return;
    }
    void operations.enqueue(component.deferUpdate(), async () => undefined);
  });

  const ended = new Promise<void>((resolve) => collector.once('end', () => resolve()));
  const stopForShutdown = (): void => collector.stop('shutdown');
  services.lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (services.lifecycleSignal?.aborted) collector.stop('shutdown');
  try {
    await ended;
    await operations.drain();
    if (current.status === 'ready') {
      await interaction.editReply({
        components: [buildStatusV2Panel(current, interaction.id, {
          mode: 'home', bannerUrl, avatarUrl, ...featured(), disabled: true,
        })],
      }).catch((error: unknown) => safeLogger.error('Dealio home cleanup failed', error));
    } else {
      await interaction.editReply({
        components: [buildNoticePanel(
          current.language, 'info',
          current.language === 'tr' ? 'Panel kapatıldı' : 'Panel closed',
          current.language === 'tr'
            ? 'Devam etmek için /dealio komutuyla yeni bir panel aç.'
            : 'Open a fresh panel with /dealio to continue.',
        )],
      }).catch((error: unknown) => safeLogger.error('Dealio welcome cleanup failed', error));
    }
  } finally {
    closeUiSession();
    services.lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}
