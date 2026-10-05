import { safeLogger } from '../application/safe-logger.js';
import { Events, MessageFlags, type ChatInputCommandInteraction, type Client } from 'discord.js';
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
import { handleDeleteData } from './commands/delete-data.js';
import { handleSetup } from './commands/setup.js';
import { createDealioNavigator, handleDealio } from './commands/dealio.js';
import type { SetupPresentationOptions } from './setup-view.js';
import { buildExpiredPanel, buildNoticePanel, dealioEphemeralV2Flags, openPanelCustomId } from './ui/components-v2.js';
import { dealioUiSessions } from './ui/session-manager.js';
import { localizer } from './i18n.js';
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
    if (typeof interaction.isButton === 'function' && interaction.isButton()
      && interaction.customId === openPanelCustomId) {
      // "🏠 Dealio panel" in DMs and expired panels: a fresh panel, like /dealio.
      taskTracker.run(async () => {
        try {
          await handleDealio(interaction as unknown as ChatInputCommandInteraction,
            { ...services, lifecycleSignal }, { navigate: createDealioNavigator({ ...services, lifecycleSignal }) });
        } catch (error: unknown) {
          safeLogger.error('Dealio open-panel button failed', error);
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
                localizer(language)({ tr: 'Bu panel başkasına ait', en: 'This panel belongs to someone else', de: 'Dieses Panel gehört jemand anderem', fr: 'Ce panneau appartient à quelqu’un d’autre' }),
                localizer(language)({
                  tr: 'Kendi panelini açmak için komutu sen de çalıştırabilirsin.',
                  en: 'Run the command yourself to open your own panel.',
                  de: 'Führ den Befehl selbst aus, um dein eigenes Panel zu öffnen.',
                  fr: 'Lance la commande toi-même pour ouvrir ton propre panneau.',
                }),
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
        safeLogger.error('Discord interaction failed', error);

        try {
          const language = services.userConfigurationService.get(interaction.user.id)?.language
            ?? languageFromDiscordLocale(interaction.locale);
          const panel = buildNoticePanel(
            language,
            'danger',
            localizer(language)({ tr: 'Bir şeyler ters gitti', en: 'Something went wrong', de: 'Da ist etwas schiefgelaufen', fr: 'Quelque chose s’est mal passé' }),
            localizer(language)({
              tr: 'Geçici bir sorun çıktı. Biraz sonra yeniden dener misin?',
              en: 'A temporary problem got in the way. Could you try again in a moment?',
              de: 'Ein vorübergehendes Problem ist aufgetreten. Versuchst du es gleich noch mal?',
              fr: 'Un souci passager est survenu. Tu peux réessayer dans un instant ?',
            }),
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
          safeLogger.error('Discord interaction error reply failed', replyError);
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
  // Panels opened by any command share one in-place navigator for their tabs.
  const ui = { navigate: createDealioNavigator({ ...services, lifecycleSignal }) };
  switch (interaction.commandName) {
    case 'dealio':
      await handleDealio(interaction, {
        ...services,
        lifecycleSignal,
      }, ui);
      return;
    case 'setup':
      await handleSetup(
        interaction,
        services.setupService,
        lifecycleSignal,
        services.setupPresentation,
        ui,
      );
      return;
    case 'region':
    case 'status':
    case 'check':
    case 'wishlist':
    case 'test-notification':
      // Retired shortcuts: a Discord client that still lists them opens the panel instead.
      await handleDealio(interaction, { ...services, lifecycleSignal }, ui);
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
          localizer(language)({ tr: 'Bu komutu tanımıyorum', en: 'I don’t know that command', de: 'Diesen Befehl kenne ich nicht', fr: 'Je ne connais pas cette commande' }),
          localizer(language)({
            tr: 'Tüm Dealio özelliklerine /dealio ile ulaşabilirsin.',
            en: 'Everything Dealio can do is in /dealio.',
            de: 'Alles, was Dealio kann, findest du unter /dealio.',
            fr: 'Tout ce que fait Dealio se trouve dans /dealio.',
          }),
        )],
        flags: dealioEphemeralV2Flags,
      });
      }
  }
}

function isDealioComponent(customId: string): boolean {
  return [
    'assistant:',
    'dealio:',
    'status-v2:',
    'country:',
    'delete-v2:',
    'setup:',
    'dealio-summary:',
    'check-v2:',
  ].some((prefix) => customId.startsWith(prefix));
}
