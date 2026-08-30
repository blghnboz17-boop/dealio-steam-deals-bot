import { Events, MessageFlags, type Client } from 'discord.js';
import type { ApplicationTaskTracker } from '../application/application-task-tracker.js';
import type { CheckService } from '../application/check-service.js';
import type { DiscountThresholdService } from '../application/discount-threshold-service.js';
import type { NotificationRetryScheduler } from '../application/notification-retry-scheduler.js';
import type { NotificationService } from '../application/notification-service.js';
import type { RuntimeHealth } from '../application/runtime-health.js';
import type { WishlistScheduler } from '../application/scheduler.js';
import type { SetupService } from '../application/setup-service.js';
import type { StatusService } from '../application/status-service.js';
import type { TestNotificationService } from '../application/test-notification-service.js';
import type { UserConfigurationService } from '../application/user-configuration-service.js';
import type { WishlistViewService } from '../application/wishlist-view-service.js';
import { handleCheck } from './commands/check.js';
import { handleDeleteData } from './commands/delete-data.js';
import { handleRegion } from './commands/region.js';
import { handleSetup } from './commands/setup.js';
import { handleStatus } from './commands/status.js';
import { handleTestNotification } from './commands/test-notification.js';
import { handleWishlist } from './commands/wishlist.js';
import { handleDealio } from './commands/dealio.js';
import { handleStatusV2 } from './commands/status-v2.js';
import { handleStoreCountryAutocomplete } from './store-country-options.js';
import type { SetupPresentationOptions } from './setup-view.js';
import { buildExpiredPanel, buildNoticePanel, dealioEphemeralV2Flags } from './ui/components-v2.js';
import { dealioUiSessions } from './ui/session-manager.js';
import { languageFromDiscordLocale } from './language.js';

export interface BotCommandServices {
  readonly userConfigurationService: UserConfigurationService;
  readonly setupService: SetupService;
  readonly statusService: StatusService;
  readonly checkService: CheckService;
  readonly notificationService: NotificationService;
  readonly testNotificationService: TestNotificationService;
  readonly wishlistViewService: WishlistViewService;
  readonly discountThresholdService: DiscountThresholdService;
  readonly setupPresentation?: SetupPresentationOptions;
}

export interface BotEventOptions {
  readonly client: Client;
  readonly scheduler: Pick<WishlistScheduler, 'start'>;
  readonly notificationRetryScheduler: Pick<NotificationRetryScheduler, 'start'>;
  readonly taskTracker: Pick<ApplicationTaskTracker, 'run'>;
  readonly services: BotCommandServices;
  readonly lifecycleSignal?: AbortSignal;
  readonly health?: Pick<RuntimeHealth, 'markReady' | 'refreshDiscordReady'>;
}

export function registerBotEvents(options: BotEventOptions): void {
  const {
    client,
    scheduler,
    notificationRetryScheduler,
    taskTracker,
    services,
    lifecycleSignal,
    health,
  } = options;

  client.once(Events.ClientReady, () => {
    console.log(`${new Date().toISOString()} Discord client is ready; schedulers started.`);
    scheduler.start();
    notificationRetryScheduler.start();
    health?.markReady();
  });
  client.on(Events.ShardReady, () => health?.refreshDiscordReady());
  client.on(Events.ShardDisconnect, () => health?.refreshDiscordReady());
  client.on(Events.Invalidated, () => health?.refreshDiscordReady());

  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isAutocomplete()) {
      taskTracker.run(async () => {
        try {
          await handleStoreCountryAutocomplete(interaction);
        } catch (error: unknown) {
          console.error('Discord store-country autocomplete failed', error);
          if (!interaction.responded) {
            await interaction.respond([]).catch(() => undefined);
          }
        }
      });
      return;
    }
    if (typeof interaction.isMessageComponent === 'function'
      && interaction.isMessageComponent()
      && isDealioComponent(interaction.customId)) {
      taskTracker.run(async () => {
        const session = dealioUiSessions.resolve(interaction.customId, interaction.user.id);
        if (session === 'active-owner') {
          return;
        }
        const language = services.userConfigurationService.get(interaction.user.id)?.language
          ?? languageFromDiscordLocale(interaction.locale);
        await interaction.reply({
          flags: dealioEphemeralV2Flags,
          components: [session === 'active-other-user'
            ? buildNoticePanel(
                language,
                'warning',
                language === 'tr' ? 'Bu panel sana ait değil' : 'This panel is not yours',
                language === 'tr'
                  ? 'Kendi güvenli panelini açmak için komutu yeniden çalıştır.'
                  : 'Run the command yourself to open your secure panel.',
              )
            : buildExpiredPanel(language)],
        }).catch(() => undefined);
      });
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }

    taskTracker.run(async () => {
      try {
        await handleInteraction(interaction, services, lifecycleSignal);
      } catch (error: unknown) {
        console.error('Discord interaction failed', error);

        try {
          const language = services.userConfigurationService.get(interaction.user.id)?.language
            ?? languageFromDiscordLocale(interaction.locale);
          const panel = buildNoticePanel(
            language,
            'danger',
            language === 'tr' ? 'İşlem tamamlanamadı' : 'Action could not be completed',
            language === 'tr'
              ? 'Geçici bir sorun oluştu. Biraz sonra yeniden deneyebilirsin.'
              : 'A temporary problem occurred. Please try again shortly.',
          );
          if (interaction.replied || interaction.deferred) {
            await interaction.editReply({
              flags: MessageFlags.IsComponentsV2,
              components: [panel],
            });
          } else {
            await interaction.reply({
              components: [panel],
              flags: dealioEphemeralV2Flags,
            });
          }
        } catch (replyError: unknown) {
          console.error('Discord interaction error reply failed', replyError);
        }
      }
    });
  });
}

async function handleInteraction(
  interaction: Parameters<typeof handleSetup>[0],
  services: BotCommandServices,
  lifecycleSignal?: AbortSignal,
): Promise<void> {
  switch (interaction.commandName) {
    case 'dealio':
      await handleDealio(interaction, {
        ...services,
        lifecycleSignal,
      });
      return;
    case 'setup':
      await handleSetup(
        interaction,
        services.setupService,
        lifecycleSignal,
        services.setupPresentation,
      );
      return;
    case 'region':
      await handleRegion(interaction, services.userConfigurationService);
      return;
    case 'status':
      await handleStatusV2(
        interaction,
        services.statusService,
        services.userConfigurationService,
        lifecycleSignal,
        services.discountThresholdService,
        services.testNotificationService,
      );
      return;
    case 'check':
      await handleCheck(
        interaction,
        services.checkService,
        services.statusService,
        services.notificationService,
        {
          wishlistViewService: services.wishlistViewService,
          userConfigurationService: services.userConfigurationService,
          discountThresholdService: services.discountThresholdService,
          testNotificationService: services.testNotificationService,
          lifecycleSignal,
        },
      );
      return;
    case 'wishlist':
      await handleWishlist(
        interaction,
        services.wishlistViewService,
        lifecycleSignal,
        services.discountThresholdService,
      );
      return;
    case 'test-notification':
      await handleTestNotification(
        interaction,
        services.userConfigurationService,
        services.testNotificationService,
      );
      return;
    case 'delete-data':
      await handleDeleteData(
        interaction,
        services.userConfigurationService,
        services.setupService,
        lifecycleSignal,
        services.setupPresentation,
      );
      return;
    default:
      {
        const language = services.userConfigurationService.get(interaction.user.id)?.language
          ?? languageFromDiscordLocale(interaction.locale);
      await interaction.reply({
        components: [buildNoticePanel(
          language,
          'warning',
          language === 'tr' ? 'Bilinmeyen komut' : 'Unknown command',
          language === 'tr' ? 'Bu komut Dealio tarafından tanınmadı.' : 'Dealio did not recognize this command.',
        )],
        flags: dealioEphemeralV2Flags,
      });
      }
  }
}

function isDealioComponent(customId: string): boolean {
  return [
    'dealio:',
    'status-v2:',
    'wishlist-v2:',
    'country:',
    'delete-v2:',
    'setup:',
    'dealio-summary:',
    'check-v2:',
  ].some((prefix) => customId.startsWith(prefix));
}
