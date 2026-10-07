import { measureDiscordOperation } from '../interaction-timing.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionUpdateOptions,
} from 'discord.js';
import type { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { StatusService, StatusDashboardResult } from '../../application/status-service.js';
import {
  TestNotificationCooldownError,
  type TestNotificationService,
} from '../../application/test-notification-service.js';
import type { UserConfigurationService } from '../../application/user-configuration-service.js';
import { isLanguage, languages, type Language } from '../../domain/user-config.js';
import { languageChoice, localizer } from '../i18n.js';
import { parseStoreCountryCode } from '../../domain/store-country.js';
import { handOffPanel, parseTabAction, type PanelNavigation } from '../ui/tab-bar.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import { buildAccountChangePanel, buildStatusV2Panel } from '../status-view-v2.js';
import type { SetupService } from '../../application/setup-service.js';
import type { PreparedUserConfiguration } from '../../application/user-configuration-service.js';
import { buildSetupModal, setupErrorMessage } from './setup.js';
import { handleDeleteData } from './delete-data.js';
import {
  buildNoticePanel,
  buildExpiredPanel,
  dealioEphemeralV2Flags,
  dealioUiSessionTimeoutMs,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { buildCountryListPanel, buildCountryRangePanel, buildCountrySearchModal, buildCountrySearchPanel } from '../ui/country-picker.js';
import { uiCopy } from '../ui/copy.js';
import { countryDisplay } from '../ui/design.js';
import { PanelOperationQueue } from '../ui/operation-queue.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { isFromUser } from '../ui/refused-interactions.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;

export function parseDiscountPercent(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const percent = Number(value);
  return Number.isSafeInteger(percent) && percent <= 100 ? percent : null;
}

export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  statusService: StatusService,
  userConfigurationService: UserConfigurationService,
  lifecycleSignal?: AbortSignal,
  thresholdService?: DiscountThresholdService,
  testNotificationService?: TestNotificationService,
  ui: PanelNavigation = {},
  accountService?: Pick<SetupService, 'prepareAccountChange' | 'changeAccount'>,
): Promise<void> {
  if (!ui.inPlace) {
    await measureDiscordOperation(interaction, 'status-v2.ack', () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  }
  const tabs = ui.navigate !== undefined;
  const fallbackLanguage = languageFromDiscordLocale(interaction.locale);
  const initial = statusService.getDashboard(interaction.user.id, fallbackLanguage);
  if (initial.status !== 'ready') {
    const messages = messagesFor(initial.language);
    await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(
        initial.language,
        initial.status === 'not-configured' ? 'warning' : 'danger',
        initial.status === 'not-configured'
          ? uiCopy(initial.language).notSetUpTitle
          : uiCopy(initial.language).detailsUnavailableTitle,
        initial.status === 'not-configured' ? messages.statusNotConfigured : messages.statusDashboardUnavailable,
      )],
    }));
    return;
  }
  let current: ReadyStatus = initial;

  let avatarUrl: string | undefined;
  try {
    avatarUrl = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    avatarUrl = undefined;
  }
  const message = await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
    flags: dealioV2Flags,
    components: [buildStatusV2Panel(current, interaction.id, { avatarUrl, tabs })],
  }));
  const closeUiSession = dealioUiSessions.open(
    interaction.id,
    interaction.user.id,
    ['status-v2', 'country'],
    dealioUiSessionTimeoutMs,
  );
  const collector = message.createMessageComponentCollector({
    time: dealioUiSessionTimeoutMs,
    filter: (component) => isFromUser(component, interaction.user.id)
      && (component.customId.startsWith(`status-v2:${interaction.id}:`)
        || component.customId.startsWith(`country:${interaction.id}:`)),
  });
  const sessionExpiresAt = Date.now() + dealioUiSessionTimeoutMs;
  let modalSequence = 0;
  let controlsRemoved = false;
  let sessionActive = true;
  let handedOff = false;
  // "Change Steam account": a profile waiting for its Store country, then the account waiting for confirmation.
  let accountProfileInput: string | null = null;
  let pendingAccount: PreparedUserConfiguration | null = null;
  const operations = new PanelOperationQueue(async (error) => {
    safeLogger.error('Discord panel update failed', error);
    await interaction.followUp({
      flags: dealioEphemeralV2Flags,
      components: [buildNoticePanel(
        current.language, 'warning',
        uiCopy(current.language).actionFailedTitle,
        uiCopy(current.language).actionFailedDescription,
      )],
    });
  });
  // Inside a click's work, the first edit of the panel is the click's answer.
  const edit = (options: InteractionEditReplyOptions & InteractionUpdateOptions) =>
    operations.edit(options, () => interaction.editReply(options));

  const refresh = async (notice?: string): Promise<boolean> => {
    const refreshed = statusService.getDashboard(interaction.user.id, fallbackLanguage);
    if (refreshed.status !== 'ready') {
      controlsRemoved = true;
      collector.stop('unavailable');
      await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
        components: [buildNoticePanel(
          refreshed.language,
          refreshed.status === 'not-configured' ? 'warning' : 'danger',
          uiCopy(refreshed.language).panelClosedTitle,
          refreshed.status === 'not-configured'
            ? messagesFor(refreshed.language).statusNotConfigured
            : messagesFor(refreshed.language).statusDashboardUnavailable,
        )],
      }));
      return false;
    }
    current = refreshed;
    await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
      components: [buildStatusV2Panel(current, interaction.id, { avatarUrl, tabs, ...(notice ? { notice } : {}) })],
    }));
    return true;
  };

  const showAccountChange = async (profileInput: string, country: string): Promise<void> => {
    if (!accountService) return;
    const language = current.language;
    await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
      components: [buildNoticePanel(language, 'info',
        localizer(language)({ tr: 'Steam hesabına bakıyorum', en: 'Looking up your Steam account', de: 'Ich suche dein Steam-Konto', fr: 'Je cherche ton compte Steam' }),
        messagesFor(language).setupWizardPreparing)],
    }));
    let prepared: PreparedUserConfiguration;
    try {
      prepared = await accountService.prepareAccountChange(interaction.user.id, profileInput, language, country);
    } catch (error: unknown) {
      await refresh(`🛑 ${setupErrorMessage(error, language)}`);
      return;
    }
    if (!sessionActive) return;
    if (prepared.steamId64 === current.config.steamId64) {
      await refresh('ℹ️ ' + localizer(language)({
        tr: 'Bu zaten bağlı Steam hesabın. Mağaza bölgesini değiştirmek için 🌍 Bölge butonunu kullan.',
        en: 'That’s already your connected Steam account. To change the Store region, use 🌍 Region.',
        de: 'Das ist bereits dein verbundenes Steam-Konto. Die Shop-Region änderst du unter 🌍 Region.',
        fr: 'C’est déjà ton compte Steam connecté. Pour changer de région, utilise 🌍 Région.',
      }));
      return;
    }
    pendingAccount = prepared;
    await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
      components: [buildAccountChangePanel(prepared, current.config, interaction.id)],
    }));
  };

  collector.on('collect', (component) => {
    const tab = parseTabAction(component.customId.slice(`status-v2:${interaction.id}:`.length));
    if (tab && component.customId.startsWith(`status-v2:${interaction.id}:`)) {
      if (ui.navigate && tab !== 'settings') {
        handedOff = true;
        handOffPanel({
          component, target: tab, navigate: ui.navigate,
          stop: () => collector.stop('handoff'), settle: () => operations.drain(),
        });
      } else {
        void operations.enqueue(measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate()), async () => undefined);
      }
      return;
    }
    if (component.customId === `country:${interaction.id}:range` && component.isStringSelectMenu()) {
      const rangeIndex = Number(component.values[0]);
      void operations.enqueueClick(component, 'status-v2', async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
          components: [buildCountryListPanel(current.language, interaction.id, rangeIndex, current.config.storeCountryCode)],
        }));
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:back` && component.isButton()) {
      void operations.enqueueClick(component, 'status-v2', async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => edit({ components: [buildCountryRangePanel(current.language, interaction.id, { selected: current.config.storeCountryCode })] }));
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:cancel` && component.isButton()) {
      accountProfileInput = null;
      void operations.enqueueClick(component, 'status-v2', async () => {
        await refresh();
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:search` && component.isButton()) {
      const modalId = `status-country-search:${interaction.id}:${++modalSequence}`;
      void (async () => {
        await measureDiscordOperation(component, 'status-v2.modal', () => component.showModal(buildCountrySearchModal(modalId, current.language)));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId && isFromUser(submission, interaction.user.id),
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          }));
          return;
        }
        const query = modal.fields.getTextInputValue('country-query').trim();
        const acknowledgement = measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate());
        await operations.enqueue(acknowledgement, async () => {
          await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
            components: [buildCountrySearchPanel(current.language, interaction.id, query, current.config.storeCountryCode)],
          }));
        });
      })().catch((error: unknown) => safeLogger.error('Discord status country search failed', error));
      return;
    }
    if (component.customId === `country:${interaction.id}:select` && component.isStringSelectMenu()) {
      const country = parseStoreCountryCode(component.values[0] ?? '');
      const profileInput = accountProfileInput;
      accountProfileInput = null;
      void operations.enqueueClick(component, 'status-v2', async () => {
        if (profileInput !== null) {
          // The country for a new Steam account, chosen under "Other country".
          if (country) await showAccountChange(profileInput, country);
          else await refresh();
          return;
        }
        let notice: string | undefined;
        if (country) {
          const before = current.config.configVersion;
          const updated = await userConfigurationService.setStoreCountry(interaction.user.id, country);
          if (updated && updated.configVersion !== before) {
            notice = '✅ ' + messagesFor(updated.language).regionSaved(countryDisplay(updated.storeCountryCode, updated.language));
          }
        }
        await refresh(notice);
      });
      return;
    }
    if (!component.isButton()) {
      void operations.enqueue(measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate()), async () => undefined);
      return;
    }
    const action = component.customId.slice(`status-v2:${interaction.id}:`.length);
    if (action === 'account' && accountService) {
      // The same Steam profile form as setup, with the current Store region preselected.
      const modalId = `status-account:${interaction.id}:${++modalSequence}`;
      const t = localizer(current.language);
      void (async () => {
        await measureDiscordOperation(component, 'status-v2.modal', () => component.showModal(buildSetupModal(
          modalId, current.language, current.config.storeCountryCode, {
            title: t({ tr: 'Steam hesabını değiştir', en: 'Change Steam account', de: 'Steam-Konto wechseln', fr: 'Changer de compte Steam' }),
            regionDescription: t({
              tr: 'Şu anki mağaza bölgen seçili; yeni hesabınki farklıysa değiştir.',
              en: 'Your current Store region is selected; change it if the new account’s is different.',
              de: 'Deine aktuelle Shop-Region ist ausgewählt; ändere sie, falls das neue Konto eine andere hat.',
              fr: 'Ta région actuelle est sélectionnée ; change-la si celle du nouveau compte est différente.',
            }),
          })));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId && isFromUser(submission, interaction.user.id),
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          }));
          return;
        }
        const profileInput = modal.fields.getTextInputValue('steam-profile');
        const selected = modal.fields.getStringSelectValues('store-country')[0] ?? '';
        const acknowledgement = measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate());
        await operations.enqueue(acknowledgement, async () => {
          const country = parseStoreCountryCode(selected);
          if (!country) {
            // "Other country": pick it from the full list, then continue with this profile.
            accountProfileInput = profileInput;
            await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
              components: [buildCountryRangePanel(current.language, interaction.id, { selected: current.config.storeCountryCode })],
            }));
            return;
          }
          await showAccountChange(profileInput, country);
        });
      })().catch((error: unknown) => safeLogger.error('Discord status account change failed', error));
      return;
    }
    if (action === 'delete') {
      // The same confirmation flow as /delete-data, in its own private message.
      void handleDeleteData(component as unknown as ChatInputCommandInteraction, userConfigurationService,
        accountService as SetupService | undefined, lifecycleSignal)
        .catch((error: unknown) => safeLogger.error('Discord status delete-data failed', error));
      return;
    }
    if (action === 'account-cancel') {
      pendingAccount = null;
      void operations.enqueueClick(component, 'status-v2', async () => {
        await refresh();
      });
      return;
    }
    if (action === 'account-confirm' && accountService) {
      const prepared = pendingAccount;
      pendingAccount = null;
      void operations.enqueueClick(component, 'status-v2', async () => {
        if (!prepared) {
          await refresh();
          return;
        }
        const t = localizer(current.language);
        await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
          components: [buildAccountChangePanel(prepared, current.config, interaction.id, true)],
        }));
        let notice: string;
        try {
          const result = await accountService.changeAccount(prepared);
          notice = '✅ ' + (result.wishlistLoaded
            ? t({
                tr: 'Steam hesabın değişti; yeni istek listeni okudum.',
                en: 'Your Steam account is switched, and I’ve read the new wishlist.',
                de: 'Dein Steam-Konto ist gewechselt, und ich habe die neue Wunschliste gelesen.',
                fr: 'Ton compte Steam est changé, et j’ai lu ta nouvelle liste.',
              })
            : t({
                tr: 'Steam hesabın değişti. Yeni istek listeni bir sonraki kontrolde okuyacağım.',
                en: 'Your Steam account is switched. I’ll read the new wishlist on the next check.',
                de: 'Dein Steam-Konto ist gewechselt. Die neue Wunschliste lese ich bei der nächsten Prüfung.',
                fr: 'Ton compte Steam est changé. Je lirai ta nouvelle liste à la prochaine vérification.',
              }));
        } catch (error: unknown) {
          safeLogger.error('Discord status account change failed', error);
          notice = `🛑 ${setupErrorMessage(error, current.language)}`;
        }
        await refresh(notice);
      });
      return;
    }
    if (action === 'region') {
      void operations.enqueueClick(component, 'status-v2', async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => edit({ components: [buildCountryRangePanel(current.language, interaction.id, { selected: current.config.storeCountryCode })] }));
      });
      return;
    }
    if (action === 'language') {
      const modalId = `status-language:${interaction.id}:${++modalSequence}`;
      void (async () => {
        await measureDiscordOperation(component, 'status-v2.modal', () => component.showModal(buildLanguageModal(modalId, current.language)));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId
            && isFromUser(submission, interaction.user.id),
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          }));
          return;
        }
        const language = modal.fields.getRadioGroup('notification-language', true);
        // In the panel's queue: a failure gets the same notice as any other action.
        await operations.enqueue(measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate()), async () => {
          if (isLanguage(language)) {
            await userConfigurationService.setLanguage(interaction.user.id, language);
          }
          await refresh();
        });
      })().catch((error: unknown) => safeLogger.error('Discord status language update failed', error));
      return;
    }
    if (action === 'minimum-discount' && thresholdService) {
      const modalId = `status-threshold-v2:${interaction.id}:${++modalSequence}`;
      const configurationId = current.config.configurationId;
      void (async () => {
        await measureDiscordOperation(component, 'status-v2.modal', () => component.showModal(buildThresholdModal(modalId, current.language, current.config.minimumDiscountPercent)));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId
            && isFromUser(submission, interaction.user.id),
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          }));
          return;
        }
        const value = parseDiscountPercent(modal.fields.getTextInputValue('minimum-discount-percent').trim());
        if (value === null) {
          await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildNoticePanel(current.language, 'warning',
              localizer(current.language)({ tr: 'Bu değer olmadı', en: 'That value won’t work', de: 'Dieser Wert passt nicht', fr: 'Cette valeur ne convient pas' }),
              messagesFor(current.language).discountThresholdInvalid)],
          }));
          return;
        }
        await operations.enqueue(measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate()), async () => {
          await thresholdService.setGlobal(interaction.user.id, value, configurationId);
          await refresh();
        });
      })().catch((error: unknown) => safeLogger.error('Discord status threshold update failed', error));
      return;
    }
    if (action === 'test' && testNotificationService) {
      // The result shows inside this panel; a separate message would break the one-panel flow.
      void operations.enqueueClick(component, 'status-v2', async () => {
        const text = uiCopy(current.language);
        let notice: string;
        try {
          await testNotificationService.send(
            interaction.user.id,
            current.language,
            current.config.storeCountryCode,
          );
          notice = `✅ **${text.testSentTitle}** ${text.testSentDescription}`;
        } catch (error: unknown) {
          notice = error instanceof TestNotificationCooldownError
            ? `⏳ **${text.testCooldownTitle}** ${messagesFor(current.language).testNotificationCooldown(error.retryAfterSeconds)}`
            : `🛑 **${text.testFailedTitle}** ${messagesFor(current.language).testNotificationFailed}`;
        }
        await refresh(notice);
      });
      return;
    }
    if (action === 'enable' || action === 'disable') {
      void operations.enqueueClick(component, 'status-v2', async () => {
        await userConfigurationService.setEnabled(interaction.user.id, action === 'enable');
        await refresh();
      });
      return;
    }
    void operations.enqueue(measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate()), async () => undefined);
  });

  const ended = new Promise<void>((resolve) => collector.once('end', () => {
    sessionActive = false;
    resolve();
  }));
  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (lifecycleSignal?.aborted) collector.stop('shutdown');
  try {
    await ended;
    sessionActive = false;
    await operations.drain();
    if (!controlsRemoved && !handedOff) {
      await measureDiscordOperation(interaction, 'status-v2.render', () => edit({
        components: [buildStatusV2Panel(current, interaction.id, { avatarUrl, tabs, disabled: true })],
      })).catch((error: unknown) => safeLogger.error('Discord status V2 cleanup failed', error));
    }
  } finally {
    sessionActive = false;
    closeUiSession();
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

function buildLanguageModal(customId: string, language: Language): ModalBuilder {
  const t = localizer(language);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(t({ tr: 'Dil', en: 'Language', de: 'Sprache', fr: 'Langue' }))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t({
          tr: 'Hangi dilde konuşalım?',
          en: 'Which language do you prefer?',
          de: 'Welche Sprache möchtest du?',
          fr: 'Quelle langue préfères-tu ?',
        }))
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId('notification-language')
            .setRequired(true)
            .addOptions(languages.map((option) => new RadioGroupOptionBuilder()
              .setLabel(languageChoice(option)).setValue(option).setDefault(option === language))),
        ),
    );
}

function buildThresholdModal(customId: string, language: Language, currentPercent: number): ModalBuilder {
  const messages = messagesFor(language);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(messages.statusMinimumDiscountModalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(messages.statusMinimumDiscountInputLabel)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('minimum-discount-percent')
            .setPlaceholder(messages.statusMinimumDiscountPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(3)
            .setValue(String(currentPercent)),
        ),
    );
}
