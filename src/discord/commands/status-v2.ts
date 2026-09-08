import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
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
import type { Language } from '../../domain/user-config.js';
import { parseStoreCountryCode } from '../../domain/store-country.js';
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
import { buildCountryListPanel, buildCountryRangePanel } from '../ui/country-picker.js';
import { uiCopy } from '../ui/copy.js';
import { dealioUiSessions } from '../ui/session-manager.js';
import { parseDiscountPercent } from './status.js';

type ReadyStatus = Extract<StatusDashboardResult, { status: 'ready' }>;

export async function handleStatusV2(
  interaction: ChatInputCommandInteraction,
  statusService: StatusService,
  userConfigurationService: UserConfigurationService,
  lifecycleSignal?: AbortSignal,
  thresholdService?: DiscountThresholdService,
  testNotificationService?: TestNotificationService,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fallbackLanguage = languageFromDiscordLocale(interaction.locale);
  const initial = statusService.getDashboard(interaction.user.id, fallbackLanguage);
  if (initial.status !== 'ready') {
    const messages = messagesFor(initial.language);
    await interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(
        initial.language,
        initial.status === 'not-configured' ? 'warning' : 'danger',
        initial.status === 'not-configured'
          ? (initial.language === 'tr' ? 'Dealio henüz kurulmamış' : 'Dealio is not configured')
          : (initial.language === 'tr' ? 'Durum bilgisi alınamadı' : 'Status unavailable'),
        initial.status === 'not-configured' ? messages.statusNotConfigured : messages.statusDashboardUnavailable,
      )],
    });
    return;
  }
  let current: ReadyStatus = initial;

  let avatarUrl: string | undefined;
  try {
    avatarUrl = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    avatarUrl = undefined;
  }
  const message = await interaction.editReply({
    flags: dealioV2Flags,
    components: [buildStatusV2Panel(current, interaction.id, { avatarUrl })],
  });
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
  let operations = Promise.resolve();

  const refresh = async (): Promise<boolean> => {
    const refreshed = statusService.getDashboard(interaction.user.id, fallbackLanguage);
    if (refreshed.status !== 'ready') {
      controlsRemoved = true;
      collector.stop('unavailable');
      await interaction.editReply({
        components: [buildNoticePanel(
          refreshed.language,
          'warning',
          refreshed.language === 'tr' ? 'Panel kapatıldı' : 'Panel closed',
          messagesFor(refreshed.language).statusNotConfigured,
        )],
      });
      return false;
    }
    current = refreshed;
    await interaction.editReply({
      components: [buildStatusV2Panel(current, interaction.id, { avatarUrl })],
    });
    return true;
  };

  collector.on('collect', (component) => {
    if (component.customId === `country:${interaction.id}:range` && component.isStringSelectMenu()) {
      const rangeIndex = Number(component.values[0]);
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        await interaction.editReply({
          components: [buildCountryListPanel(current.language, interaction.id, rangeIndex, current.config.storeCountryCode)],
        });
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:back` && component.isButton()) {
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        await interaction.editReply({ components: [buildCountryRangePanel(current.language, interaction.id)] });
      });
      return;
    }
    if (component.customId === `country:${interaction.id}:select` && component.isStringSelectMenu()) {
      const country = parseStoreCountryCode(component.values[0] ?? '');
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        if (country) {
          await userConfigurationService.setStoreCountry(interaction.user.id, country);
        }
        await refresh();
      });
      return;
    }
    if (!component.isButton()) {
      void component.deferUpdate();
      return;
    }
    const action = component.customId.slice(`status-v2:${interaction.id}:`.length);
    if (action === 'region') {
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        await interaction.editReply({ components: [buildCountryRangePanel(current.language, interaction.id)] });
      });
      return;
    }
    if (action === 'language') {
      const modalId = `status-language:${interaction.id}:${++modalSequence}`;
      void (async () => {
        await component.showModal(buildLanguageModal(modalId, current.language));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId
            && submission.user.id === interaction.user.id,
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          });
          return;
        }
        const language = modal.fields.getRadioGroup('notification-language', true);
        await modal.deferUpdate();
        if (language === 'tr' || language === 'en') {
          await userConfigurationService.setLanguage(interaction.user.id, language);
        }
        await refresh();
      })().catch((error: unknown) => console.error('Discord status language update failed', error));
      return;
    }
    if (action === 'minimum-discount' && thresholdService) {
      const modalId = `status-threshold-v2:${interaction.id}:${++modalSequence}`;
      const configurationId = current.config.configurationId;
      void (async () => {
        await component.showModal(buildThresholdModal(modalId, current.language, current.config.minimumDiscountPercent));
        const modal = await component.awaitModalSubmit({
          time: Math.max(1, sessionExpiresAt - Date.now()),
          filter: (submission) => submission.customId === modalId
            && submission.user.id === interaction.user.id,
        }).catch(() => null);
        if (!modal) return;
        if (!sessionActive) {
          await modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildExpiredPanel(current.language)],
          });
          return;
        }
        const value = parseDiscountPercent(modal.fields.getTextInputValue('minimum-discount-percent').trim());
        if (value === null) {
          await modal.reply({
            flags: dealioEphemeralV2Flags,
            components: [buildNoticePanel(current.language, 'warning',
              current.language === 'tr' ? 'Geçersiz değer' : 'Invalid value',
              messagesFor(current.language).discountThresholdInvalid)],
          });
          return;
        }
        await modal.deferUpdate();
        await thresholdService.setGlobal(interaction.user.id, value, configurationId);
        await refresh();
      })().catch((error: unknown) => console.error('Discord status threshold update failed', error));
      return;
    }
    if (action === 'test' && testNotificationService) {
      const acknowledgement = component.deferReply({ flags: MessageFlags.Ephemeral });
      operations = operations.then(async () => {
        await acknowledgement;
        const text = uiCopy(current.language);
        try {
          await testNotificationService.send(
            interaction.user.id,
            current.language,
            current.config.storeCountryCode,
          );
          await component.editReply({
            flags: dealioV2Flags,
            components: [buildNoticePanel(current.language, 'success', text.testSentTitle, text.testSentDescription)],
          });
        } catch (error: unknown) {
          const cooldown = error instanceof TestNotificationCooldownError;
          await component.editReply({
            flags: dealioV2Flags,
            components: [buildNoticePanel(
              current.language,
              cooldown ? 'warning' : 'danger',
              cooldown ? text.testCooldownTitle : text.testFailedTitle,
              cooldown
                ? messagesFor(current.language).testNotificationCooldown(error.retryAfterSeconds)
                : messagesFor(current.language).testNotificationFailed,
            )],
          });
        }
        await refresh();
      });
      return;
    }
    if (action === 'enable' || action === 'disable') {
      const acknowledgement = component.deferUpdate();
      operations = operations.then(async () => {
        await acknowledgement;
        await userConfigurationService.setEnabled(interaction.user.id, action === 'enable');
        await refresh();
      });
      return;
    }
    void component.deferUpdate();
  });

  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  try {
    await new Promise<void>((resolve) => collector.once('end', () => resolve()));
    sessionActive = false;
    await operations;
    if (!controlsRemoved) {
      await interaction.editReply({
        components: [buildStatusV2Panel(current, interaction.id, { avatarUrl, disabled: true })],
      }).catch((error: unknown) => console.error('Discord status V2 cleanup failed', error));
    }
  } finally {
    sessionActive = false;
    closeUiSession();
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

function buildLanguageModal(customId: string, language: Language): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(language === 'tr' ? 'Bildirim dili' : 'Notification language')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(language === 'tr' ? 'Kullanmak istediğin dili seç' : 'Choose your preferred language')
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId('notification-language')
            .setRequired(true)
            .addOptions(
              new RadioGroupOptionBuilder().setLabel('Türkçe').setValue('tr').setDefault(language === 'tr'),
              new RadioGroupOptionBuilder().setLabel('English').setValue('en').setDefault(language === 'en'),
            ),
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
