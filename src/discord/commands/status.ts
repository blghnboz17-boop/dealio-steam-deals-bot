import {
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  StatusService,
  type StatusDashboardResult,
} from '../../application/status-service.js';
import { UserConfigurationService } from '../../application/user-configuration-service.js';
import { DiscountThresholdService } from '../../application/discount-threshold-service.js';
import type { CheckStatus } from '../../domain/check-state.js';
import type { Language, UserConfig } from '../../domain/user-config.js';
import { languageFromDiscordLocale } from '../language.js';
import { messagesFor } from '../messages.js';

export const statusCommand = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show your Steam wishlist dashboard')
  .setDescriptionLocalizations({ tr: 'Steam wishlist dashboardunu göster' });

export const statusEmbedColors = {
  healthy: 0x57f287,
  pending: 0xfee75c,
  unhealthy: 0xed4245,
  disabled: 0x95a5a6,
} as const;
const statusSessionTimeoutMs = 2 * 60 * 1_000;
export type StatusToggleAction = 'enable' | 'disable';
export type StatusAction = StatusToggleAction | 'minimum-discount';

function displayTime(value: string | null, emptyValue: string): string {
  if (!value) {
    return emptyValue;
  }
  const timestamp = Math.floor(new Date(value).getTime() / 1_000);
  return Number.isSafeInteger(timestamp)
    ? `<t:${timestamp}:f> (<t:${timestamp}:R>)`
    : emptyValue;
}

function displayCount(value: number | null, emptyValue: string): string {
  return value === null ? emptyValue : String(value);
}

function maskSteamId(steamId64: string): string {
  if (steamId64.length <= 9) {
    return '*'.repeat(steamId64.length);
  }
  return `${steamId64.slice(0, 5)}${'*'.repeat(steamId64.length - 9)}${steamId64.slice(-4)}`;
}

function localizedCheckStatus(status: CheckStatus | null, language: Language): string {
  const messages = messagesFor(language);
  switch (status) {
    case 'success': return messages.statusResultSuccess;
    case 'unavailable': return messages.statusResultUnavailable;
    case 'failed': return messages.statusResultFailed;
    case 'pending':
    case null: return messages.statusResultPending;
  }
}

function safeErrorMessage(errorCode: string | null, language: Language): string | null {
  if (!errorCode) {
    return null;
  }
  const messages = messagesFor(language);
  const value = errorCode === 'STEAM_WISHLIST_INACCESSIBLE'
    ? messages.wishlistInaccessible
    : errorCode.startsWith('STEAM_')
      ? messages.statusSteamUnavailable
      : messages.statusCheckFailed;
  return value.length > 400 ? `${value.slice(0, 397)}...` : value;
}

export function buildStatusDashboardEmbed(
  result: Extract<StatusDashboardResult, { status: 'ready' }>,
  botAvatarUrl?: string,
): APIEmbed {
  const { config, checkState, notificationQueue, language } = result;
  const messages = messagesFor(language);
  const profileUrl = `https://steamcommunity.com/profiles/${config.steamId64}`;
  const errorMessage = safeErrorMessage(checkState?.lastErrorCode ?? null, language);
  const color = !config.enabled
    ? statusEmbedColors.disabled
    : checkState?.lastStatus === 'success'
      ? statusEmbedColors.healthy
      : checkState?.lastStatus === 'unavailable' || checkState?.lastStatus === 'failed'
        ? statusEmbedColors.unhealthy
        : statusEmbedColors.pending;

  return {
    title: messages.statusTitle,
    color,
    thumbnail: botAvatarUrl ? { url: botAvatarUrl } : undefined,
    fields: [
      {
        name: messages.statusAccountSection,
        value: [
          `${messages.statusSteamIdLabel}: \`${maskSteamId(config.steamId64)}\``,
          `[${messages.statusOpenProfile}](${profileUrl})`,
          `${messages.statusLanguageLabel}: **${language === 'tr' ? 'Türkçe' : 'English'}**`,
          `${messages.statusEnabledLabel}: **${config.enabled ? messages.statusEnabled : messages.statusDisabled}**`,
          `${messages.statusMinimumDiscountLabel}: **${config.minimumDiscountPercent}%**`,
          `${messages.statusGameOverridesLabel}: **${result.gameDiscountOverrideCount ?? 0}**`,
          `${messages.statusUpdatedAtLabel}: ${displayTime(config.updatedAt, messages.statusNever)}`,
        ].join('\n'),
      },
      {
        name: messages.statusWishlistSection,
        value: [
          `${messages.statusLastSuccessLabel}: ${displayTime(checkState?.lastSuccessCompletedAt ?? null, messages.statusNever)}`,
          `${messages.statusCheckedCountLabel}: **${displayCount(checkState?.lastSuccessCheckedCount ?? null, messages.statusNever)}**`,
          `${messages.statusOnSaleCountLabel}: **${displayCount(checkState?.lastSuccessOnSaleCount ?? null, messages.statusNever)}**`,
          `${messages.statusFreeCountLabel}: **${displayCount(checkState?.lastSuccessFreeCount ?? null, messages.statusNever)}**`,
          `${messages.statusUnknownPriceCountLabel}: **${displayCount(checkState?.lastSuccessUnknownPriceCount ?? null, messages.statusNever)}**`,
          `${messages.statusFailedItemCountLabel}: **${displayCount(checkState?.lastSuccessFailedItemCount ?? null, messages.statusNever)}**`,
        ].join('\n'),
      },
      {
        name: messages.statusCheckSection,
        value: [
          `${messages.statusStartedAtLabel}: ${displayTime(checkState?.lastStartedAt ?? null, messages.statusNever)}`,
          `${messages.statusCompletedAtLabel}: ${displayTime(checkState?.lastCompletedAt ?? null, messages.statusNever)}`,
          `${messages.statusResultLabel}: **${localizedCheckStatus(checkState?.lastStatus ?? null, language)}**`,
          `${messages.statusNextCheckLabel}: ${displayTime(checkState?.nextScheduledAt ?? null, messages.statusNever)}`,
          ...(errorMessage ? [`${messages.statusErrorLabel}: ${errorMessage}`] : []),
        ].join('\n'),
      },
      {
        name: messages.statusNotificationSection,
        value: [
          `${messages.statusQueuePendingLabel}: **${notificationQueue.pending}**`,
          `${messages.statusQueueRetryLabel}: **${notificationQueue.retry}**`,
          `${messages.statusQueueSendingLabel}: **${notificationQueue.sending}**`,
          `${messages.statusQueueSentLabel}: **${notificationQueue.sent}**`,
          `${messages.statusQueueTerminalLabel}: **${notificationQueue.terminalFailed}**`,
          `${messages.statusQueueExpiredLabel}: **${notificationQueue.expired}**`,
        ].join('\n'),
      },
    ],
  };
}

export function buildStatusComponents(
  sessionId: string,
  language: Language,
  enabled: boolean,
  disabled = false,
): APIActionRowComponent<APIButtonComponent>[] {
  const messages = messagesFor(language);
  const action: StatusToggleAction = enabled ? 'disable' : 'enable';
  return [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.Button,
      style: enabled ? ButtonStyle.Danger : ButtonStyle.Success,
      custom_id: `status:${sessionId}:${action}`,
      label: enabled
        ? messages.statusDisableNotifications
        : messages.statusEnableNotifications,
      disabled,
    }, {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      custom_id: `status:${sessionId}:minimum-discount`,
      label: messages.statusEditMinimumDiscount,
      disabled,
    }],
  }];
}

export function parseStatusToggleAction(
  customId: string,
  sessionId: string,
): StatusToggleAction | null {
  const prefix = `status:${sessionId}:`;
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const action = customId.slice(prefix.length);
  return action === 'enable' || action === 'disable' ? action : null;
}

export function canUseStatusComponent(
  customId: string,
  componentUserId: string,
  ownerUserId: string,
  sessionId: string,
): boolean {
  return componentUserId === ownerUserId
    && parseStatusAction(customId, sessionId) !== null;
}

export function parseStatusAction(customId: string, sessionId: string): StatusAction | null {
  const toggle = parseStatusToggleAction(customId, sessionId);
  if (toggle) {
    return toggle;
  }
  return customId === `status:${sessionId}:minimum-discount` ? 'minimum-discount' : null;
}

export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  statusService: StatusService,
  userConfigurationService: UserConfigurationService,
  lifecycleSignal?: AbortSignal,
  thresholdService?: DiscountThresholdService,
): Promise<void> {
  const fallbackLanguage = languageFromDiscordLocale(interaction.locale);
  const result = statusService.getDashboard(
    interaction.user.id,
    fallbackLanguage,
  );
  const messages = messagesFor(result.language);

  if (result.status !== 'ready') {
    await interaction.reply({
      content: result.status === 'not-configured'
        ? messages.statusNotConfigured
        : messages.statusDashboardUnavailable,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let botAvatarUrl: string | undefined;
  try {
    botAvatarUrl = interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    botAvatarUrl = undefined;
  }

  let currentResult = result;
  let controlsRemoved = false;
  const response = await interaction.reply({
    embeds: [buildStatusDashboardEmbed(currentResult, botAvatarUrl)],
    components: buildStatusComponents(
      interaction.id,
      currentResult.language,
      currentResult.config.enabled,
    ),
    flags: MessageFlags.Ephemeral,
  });
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: statusSessionTimeoutMs,
    filter: (component) => canUseStatusComponent(
      component.customId,
      component.user.id,
      interaction.user.id,
      interaction.id,
    ),
  });
  const sessionExpiresAt = Date.now() + statusSessionTimeoutMs;
  let operations = Promise.resolve();
  let modalSequence = 0;
  const modalTasks = new Set<Promise<void>>();
  const modalAbortController = new AbortController();

  collector.on('collect', (component) => {
    const action = parseStatusAction(component.customId, interaction.id);
    if (action === 'minimum-discount') {
      if (!thresholdService) {
        void component.deferUpdate();
        return;
      }
      const modalCustomId = `status-threshold:${interaction.id}:${interaction.user.id}:${++modalSequence}`;
      const configurationId = currentResult.config.configurationId;
      const modalTask = (async () => {
        try {
          await component.showModal(buildStatusThresholdModal(
            modalCustomId,
            currentResult.language,
            currentResult.config.minimumDiscountPercent,
          ));
          let cancelModal = (): void => undefined;
          const cancelled = new Promise<null>((resolve) => {
            cancelModal = () => resolve(null);
            if (modalAbortController.signal.aborted) {
              resolve(null);
              return;
            }
            modalAbortController.signal.addEventListener('abort', cancelModal, { once: true });
          });
          const modal = await Promise.race([
            component.awaitModalSubmit({
              time: Math.max(1, sessionExpiresAt - Date.now()),
              filter: (submission) => submission.customId === modalCustomId
                && submission.user.id === interaction.user.id,
            }),
            cancelled,
          ]).catch(() => null);
          modalAbortController.signal.removeEventListener('abort', cancelModal);
          if (!modal || modalAbortController.signal.aborted) {
            return;
          }
          const rawValue = modal.fields.getTextInputValue('minimum-discount-percent').trim();
          const percent = parseDiscountPercent(rawValue);
          if (percent === null) {
            await modal.reply({
              content: messagesFor(currentResult.language).discountThresholdInvalid,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await modal.deferUpdate();
          operations = operations.then(async () => {
            if (modalAbortController.signal.aborted) {
              return;
            }
            const updatedConfig = await thresholdService.setGlobal(
              interaction.user.id,
              percent,
              configurationId,
            );
            if (!updatedConfig) {
              await interaction.editReply({
                content: messagesFor(currentResult.language).statusNotConfigured,
                embeds: [],
                components: [],
              });
              controlsRemoved = true;
              collector.stop('not-configured');
              return;
            }
            const refreshed = statusService.getDashboard(interaction.user.id, fallbackLanguage);
            if (refreshed.status !== 'ready') {
              await interaction.editReply({
                content: messagesFor(refreshed.language).statusDashboardUnavailable,
                embeds: [],
                components: [],
              });
              controlsRemoved = true;
              collector.stop('unavailable');
              return;
            }
            currentResult = refreshed;
            await interaction.editReply({
              content: messagesFor(currentResult.language).statusMinimumDiscountSaved(percent),
              embeds: [buildStatusDashboardEmbed(currentResult, botAvatarUrl)],
              components: buildStatusComponents(
                interaction.id,
                currentResult.language,
                currentResult.config.enabled,
              ),
            });
          }).catch(async (error: unknown) => {
            console.error('Discord status minimum discount update failed', error);
            try {
              await interaction.editReply({
                content: messagesFor(currentResult.language).discountThresholdSaveFailed,
              });
            } catch (_replyError: unknown) {
              // The original interaction may have expired while the modal was open.
            }
          });
          await operations;
        } catch (error: unknown) {
          if (!modalAbortController.signal.aborted) {
            console.error('Discord status modal failed', error);
          }
        }
      })();
      modalTasks.add(modalTask);
      void modalTask.finally(() => modalTasks.delete(modalTask));
      return;
    }
    const acknowledgement = component.deferUpdate();
    operations = operations.then(async () => {
      await acknowledgement;
      if (action === null) {
        return;
      }

      let updatedConfig: UserConfig | null;
      try {
        updatedConfig = await userConfigurationService.setEnabled(
          interaction.user.id,
          action === 'enable',
        );
      } catch (error: unknown) {
        console.error('Discord status notification toggle failed', error);
        await interaction.editReply({
          content: messagesFor(currentResult.language).statusToggleFailed,
          embeds: [buildStatusDashboardEmbed(currentResult, botAvatarUrl)],
          components: buildStatusComponents(
            interaction.id,
            currentResult.language,
            currentResult.config.enabled,
          ),
        });
        return;
      }

      if (!updatedConfig) {
        controlsRemoved = true;
        collector.stop('not-configured');
        await interaction.editReply({
          content: messagesFor(currentResult.language).statusNotConfigured,
          embeds: [],
          components: [],
        });
        return;
      }

      const refreshed = statusService.getDashboard(interaction.user.id, fallbackLanguage);
      if (refreshed.status !== 'ready') {
        controlsRemoved = true;
        collector.stop('unavailable');
        await interaction.editReply({
          content: refreshed.status === 'not-configured'
            ? messagesFor(refreshed.language).statusNotConfigured
            : messagesFor(refreshed.language).statusDashboardUnavailable,
          embeds: [],
          components: [],
        });
        return;
      }

      currentResult = refreshed;
      await interaction.editReply({
        content: null,
        embeds: [buildStatusDashboardEmbed(currentResult, botAvatarUrl)],
        components: buildStatusComponents(
          interaction.id,
          currentResult.language,
          currentResult.config.enabled,
        ),
      });
    }).catch((error: unknown) => {
      console.error('Discord status component update failed', error);
    });
  });

  const endReason = new Promise<void>((resolve) => {
    collector.once('end', () => resolve());
  });
  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (lifecycleSignal?.aborted) {
    collector.stop('shutdown');
  }

  try {
    await endReason;
    modalAbortController.abort();
    await Promise.allSettled([...modalTasks]);
    await operations;
    if (!controlsRemoved) {
      try {
        await interaction.editReply({
          content: null,
          embeds: [buildStatusDashboardEmbed(currentResult, botAvatarUrl)],
          components: buildStatusComponents(
            interaction.id,
            currentResult.language,
            currentResult.config.enabled,
            true,
          ),
        });
      } catch (error: unknown) {
        console.error('Discord status component cleanup failed', error);
      }
    }
  } finally {
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

export function parseDiscountPercent(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const percent = Number(value);
  return Number.isSafeInteger(percent) && percent <= 100 ? percent : null;
}

function buildStatusThresholdModal(
  customId: string,
  language: Language,
  currentPercent: number,
): ModalBuilder {
  const messages = messagesFor(language);
  const input = new TextInputBuilder()
    .setCustomId('minimum-discount-percent')
    .setLabel(messages.statusMinimumDiscountInputLabel)
    .setPlaceholder(messages.statusMinimumDiscountPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3)
    .setValue(String(currentPercent));
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(messages.statusMinimumDiscountModalTitle)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}
