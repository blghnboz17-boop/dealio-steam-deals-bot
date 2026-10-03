import { measureDiscordOperation } from '../interaction-timing.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { StatusService, StatusDashboardResult } from '../../application/status-service.js';
import {
  TestNotificationCooldownError,
  type TestNotificationService,
} from '../../application/test-notification-service.js';
import type { UserConfigurationService } from '../../application/user-configuration-service.js';
import { isLanguage, languages, type Language } from '../../domain/user-config.js';
import { languageNames, localizer } from '../i18n.js';
import { parseStoreCountryCode } from '../../domain/store-country.js';
import { handOffPanel, parseTabAction, type PanelNavigation } from '../ui/tab-bar.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';
import { buildStatusV2Panel } from '../status-view-v2.js';
import {
  buildNoticePanel,
  buildExpiredPanel,
  dealioEphemeralV2Flags,
  dealioUiSessionTimeoutMs,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { buildCountryListPanel, buildCountryRangePanel, buildCountrySearchModal, buildCountrySearchPanel } from '../ui/country-picker.js';
import { uiCopy } from '../ui/copy.js';
import { PanelOperationQueue } from '../ui/operation-queue.js';
import { dealioUiSessions } from '../ui/session-manager.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;

export const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Open your Dealio settings: alerts, region, language')
  .setDescriptionLocalizations({
    tr: 'Dealio ayarlarını aç: bildirimler, bölge, dil',
    de: 'Deine Dealio-Einstellungen öffnen: Benachrichtigungen, Region, Sprache',
    fr: 'Ouvrir tes réglages Dealio : alertes, région, langue',
  });

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
    filter: (component) => component.user.id === interaction.user.id
      && (component.customId.startsWith(`status-v2:${interaction.id}:`)
        || component.customId.startsWith(`country:${interaction.id}:`)),
  });
  const sessionExpiresAt = Date.now() + dealioUiSessionTimeoutMs;
  let modalSequence = 0;
  let controlsRemoved = false;
  let sessionActive = true;
  let handedOff = false;
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

  const refresh = async (notice?: string): Promise<boolean> => {
    const refreshed = statusService.getDashboard(interaction.user.id, fallbackLanguage);
    if (refreshed.status !== 'ready') {
      controlsRemoved = true;
      collector.stop('unavailable');
      await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
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
    await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
      components: [buildStatusV2Panel(current, interaction.id, { avatarUrl, tabs, ...(notice ? { notice } : {}) })],
    }));
    return true;
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
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
          components: [buildCountryListPanel(current.language, interaction.id, rangeIndex, current.config.storeCountryCode)],
        }));
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:back` && component.isButton()) {
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({ components: [buildCountryRangePanel(current.language, interaction.id, { selected: current.config.storeCountryCode })] }));
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:cancel` && component.isButton()) {
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
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
          filter: (submission) => submission.customId === modalId && submission.user.id === interaction.user.id,
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
          await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
            components: [buildCountrySearchPanel(current.language, interaction.id, query, current.config.storeCountryCode)],
          }));
        });
      })().catch((error: unknown) => safeLogger.error('Discord status country search failed', error));
      return;
    }
    if (component.customId === `country:${interaction.id}:select` && component.isStringSelectMenu()) {
      const country = parseStoreCountryCode(component.values[0] ?? '');
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
        if (country) {
          await userConfigurationService.setStoreCountry(interaction.user.id, country);
        }
        await refresh();
      });
      return;
    }
    if (!component.isButton()) {
      void operations.enqueue(measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate()), async () => undefined);
      return;
    }
    const action = component.customId.slice(`status-v2:${interaction.id}:`.length);
    if (action === 'region') {
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
        await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({ components: [buildCountryRangePanel(current.language, interaction.id, { selected: current.config.storeCountryCode })] }));
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
            && submission.user.id === interaction.user.id,
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
        await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate());
        if (isLanguage(language)) {
          await userConfigurationService.setLanguage(interaction.user.id, language);
        }
        await refresh();
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
            && submission.user.id === interaction.user.id,
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
        await measureDiscordOperation(modal, 'status-v2.modal-submit-ack', () => modal.deferUpdate());
        await thresholdService.setGlobal(interaction.user.id, value, configurationId);
        await refresh();
      })().catch((error: unknown) => safeLogger.error('Discord status threshold update failed', error));
      return;
    }
    if (action === 'test' && testNotificationService) {
      // The result shows inside this panel; a separate message would break the one-panel flow.
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
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
      const acknowledgement = measureDiscordOperation(component, 'status-v2.button-ack', () => component.deferUpdate());
      void operations.enqueue(acknowledgement, async () => {
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
      await measureDiscordOperation(interaction, 'status-v2.render', () => interaction.editReply({
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
              .setLabel(languageNames[option]).setValue(option).setDefault(option === language))),
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
