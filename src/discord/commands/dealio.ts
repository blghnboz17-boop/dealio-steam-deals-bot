import { measureDiscordOperation } from '../interaction-timing.js';
import type { InteractionEditReplyOptions } from 'discord.js';
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
import { handOffPanel, parseTabAction, type Navigate, type PanelNavigation } from '../ui/tab-bar.js';
import { handleCheck } from './check.js';
import { handleSetup } from './setup.js';
import { handleStatus } from './status.js';

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

/**
 * Opens every Dealio screen in the message of an acknowledged component, so the
 * panel changes in place instead of stacking new messages.
 */
export function createDealioNavigator(services: DealioCommandServices): Navigate {
  const navigate: Navigate = async (target, component) => {
    const interaction = component as unknown as ChatInputCommandInteraction;
    const ui = { inPlace: true, navigate };
    if (target === 'home') return handleDealio(interaction, services, ui);
    if (target === 'settings') {
      return handleStatus(interaction, services.statusService, services.userConfigurationService,
        services.lifecycleSignal, services.discountThresholdService, services.testNotificationService, ui);
    }
    if (target === 'check') {
      return handleCheck(interaction, services.checkService, services.statusService, services.notificationService,
        { ...ui, lifecycleSignal: services.lifecycleSignal });
    }
    const assistant = services.wishlistViewService.assistantService;
    if (!assistant) throw new Error('The Dealio assistant is not configured');
    return handleAssistant(interaction, assistant, services.wishlistViewService, services.lifecycleSignal,
      target === 'games' ? 'wishlist' : 'rhythm', ui);
  };
  return navigate;
}

export async function handleDealio(
  interaction: ChatInputCommandInteraction,
  services: DealioCommandServices,
  ui: PanelNavigation = {},
): Promise<void> {
  const navigate = ui.navigate ?? createDealioNavigator(services);
  const editPanel = (options: InteractionEditReplyOptions) => measureDiscordOperation(
    interaction, 'dealio.render', () => interaction.editReply(options),
  );
  if (!ui.inPlace) {
    await measureDiscordOperation(interaction, 'dealio.ack',
      () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  }
  let handedOff = false;
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
    const snapshot=assistant.repository.snapshot(config);
    const items=snapshot?.items??[];
    const rules=assistant.repository.rules(config);
    const matching=items.filter(item=>matchesRule(item,rules.get(item.appId),config.minimumDiscountPercent));
    return {featuredDeal:matching[0],heroGame:matching[0]??items.find(item=>item.price?.currency),
      eligibleDealCount:snapshot?matching.length:undefined,trackedGameCount:snapshot?items.length:undefined,
      capturedAt:snapshot?.capturedAt,notificationPreference:assistant.repository.preference(config.discordUserId)};
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
  const message = await editPanel({
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
    const acknowledge = () => measureDiscordOperation(
      component, 'dealio.button-ack', () => component.deferUpdate(),
    );
    const action = component.customId.slice(`dealio:${interaction.id}:`.length);
    const target = action === 'check' ? 'check' : parseTabAction(action);
    if (target && target !== 'home') {
      handedOff = true;
      handOffPanel({ component, target, navigate, stop: () => collector.stop('handoff'), settle: () => operations.drain() });
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
    if (action === 'refresh') {
      const acknowledgement = acknowledge();
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
        await editPanel({ components: [refreshed] });
      });
      return;
    }
    void operations.enqueue(acknowledge(), async () => undefined);
  });

  const ended = new Promise<void>((resolve) => collector.once('end', () => resolve()));
  const stopForShutdown = (): void => collector.stop('shutdown');
  services.lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (services.lifecycleSignal?.aborted) collector.stop('shutdown');
  try {
    await ended;
    await operations.drain();
    if (handedOff) {
      return;
    }
    if (current.status === 'ready') {
      await editPanel({
        components: [buildStatusV2Panel(current, interaction.id, {
          mode: 'home', bannerUrl, avatarUrl, ...featured(), disabled: true,
        })],
      }).catch((error: unknown) => safeLogger.error('Dealio home cleanup failed', error));
    } else {
      await editPanel({
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
