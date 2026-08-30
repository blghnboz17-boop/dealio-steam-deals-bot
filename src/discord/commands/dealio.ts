import {
  ChatInputCommandInteraction,
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
  dealioEphemeralV2Flags,
  dealioUiSessionTimeoutMs,
} from '../ui/components-v2.js';
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
  const fallbackLanguage = languageFromDiscordLocale(interaction.locale);
  let current = services.statusService.getDashboard(interaction.user.id, fallbackLanguage);
  let avatarUrl: string | undefined;
  try {
    avatarUrl = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    avatarUrl = undefined;
  }
  const bannerUrl = services.setupPresentation?.bannerUrl;
  const firstPanel = current.status === 'ready'
    ? buildStatusV2Panel(current, interaction.id, { mode: 'home', bannerUrl, avatarUrl })
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
  const message = await interaction.reply({
    flags: dealioEphemeralV2Flags,
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
  let operations = Promise.resolve();

  collector.on('collect', (component) => {
    const action = component.customId.slice(`dealio:${interaction.id}:`.length);
    if (action === 'setup') {
      void handleSetup(
        component as unknown as ChatInputCommandInteraction,
        services.setupService,
        services.lifecycleSignal,
        services.setupPresentation,
      ).catch((error: unknown) => console.error('Dealio home setup navigation failed', error));
      return;
    }
    if (action === 'wishlist') {
      void handleWishlist(
        component as unknown as ChatInputCommandInteraction,
        services.wishlistViewService,
        services.lifecycleSignal,
        services.discountThresholdService,
      ).catch((error: unknown) => console.error('Dealio home wishlist navigation failed', error));
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
      ).catch((error: unknown) => console.error('Dealio home check navigation failed', error));
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
      ).catch((error: unknown) => console.error('Dealio home settings navigation failed', error));
      return;
    }
    if (action === 'test') {
      void handleTestNotification(
        component as unknown as ChatInputCommandInteraction,
        services.userConfigurationService,
        services.testNotificationService,
      ).catch((error: unknown) => console.error('Dealio home test navigation failed', error));
      return;
    }
    if (action === 'refresh') {
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        current = services.statusService.getDashboard(interaction.user.id, fallbackLanguage);
        const refreshed = current.status === 'ready'
          ? buildStatusV2Panel(current, interaction.id, { mode: 'home', bannerUrl, avatarUrl })
          : buildNoticePanel(
              current.language,
              'warning',
              current.language === 'tr' ? 'Dealio kurulumu bulunamadı' : 'Dealio setup not found',
              messagesFor(current.language).statusNotConfigured,
            );
        await interaction.editReply({ components: [refreshed] });
      });
      return;
    }
    void component.deferUpdate();
  });

  const stopForShutdown = (): void => collector.stop('shutdown');
  services.lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  try {
    await new Promise<void>((resolve) => collector.once('end', () => resolve()));
    await operations;
    if (current.status === 'ready') {
      await interaction.editReply({
        components: [buildStatusV2Panel(current, interaction.id, {
          mode: 'home', bannerUrl, avatarUrl, disabled: true,
        })],
      }).catch((error: unknown) => console.error('Dealio home cleanup failed', error));
    }
  } finally {
    closeUiSession();
    services.lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}
