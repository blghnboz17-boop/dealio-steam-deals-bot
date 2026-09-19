import { measureDiscordOperation } from '../interaction-timing.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SetupService } from '../../application/setup-service.js';
import type { UserConfigurationService } from '../../application/user-configuration-service.js';
import { languageFromDiscordLocale } from '../language.js';
import { handleSetup } from './setup.js';
import type { SetupPresentationOptions } from '../setup-view.js';
import { dealioBrand } from '../ui/brand.js';
import {
  assertComponentsV2Limit,
  buildNoticePanel,
  dealioEphemeralV2Flags,
  dealioFooter,
  dealioUiSessionTimeoutMs,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { uiCopy } from '../ui/copy.js';
import { dealioUiSessions } from '../ui/session-manager.js';

export const deleteDataCommand = new SlashCommandBuilder()
  .setName('delete-data')
  .setDescription('Permanently delete your Dealio data')
  .setDescriptionLocalizations({ tr: 'Dealio verilerini kalıcı olarak sil' });

export async function handleDeleteData(
  interaction: ChatInputCommandInteraction,
  service: UserConfigurationService,
  setupService?: SetupService,
  lifecycleSignal?: AbortSignal,
  setupPresentation?: SetupPresentationOptions,
): Promise<void> {
  await measureDiscordOperation(interaction, 'delete-data.ack', () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const config = service.get(interaction.user.id);
  const language = config?.language ?? languageFromDiscordLocale(interaction.locale);
  const text = uiCopy(language);
  const sessionId = interaction.id;
  const message = await measureDiscordOperation(interaction, 'delete-data.render', () => interaction.editReply({
    flags: dealioV2Flags,
    components: [buildDeleteWarningPanel(language, sessionId)],
  }));
  const closeUiSession = dealioUiSessions.open(
    sessionId,
    interaction.user.id,
    ['delete-v2'],
    dealioUiSessionTimeoutMs,
  );
  const collector = message.createMessageComponentCollector({
    time: dealioUiSessionTimeoutMs,
    filter: (component) => component.user.id === interaction.user.id
      && component.customId.startsWith(`delete-v2:${sessionId}:`),
  });
  let sessionActive = true;
  const activeOperations = new Set<Promise<void>>();
  const sessionClosed = new Promise<void>((resolve) => {
    collector.once('end', () => {
      sessionActive = false;
      resolve();
    });
  });

  collector.on('collect', (component) => {
    const action = component.customId.slice(`delete-v2:${sessionId}:`.length);
    if (action === 'cancel') {
      const operation = measureDiscordOperation(component, 'delete-data.button-ack', () => component.update({
        components: [buildNoticePanel(
          language,
          'info',
          language === 'tr' ? 'Silme işlemi iptal edildi' : 'Deletion cancelled',
          language === 'tr' ? 'Hiçbir verin değiştirilmedi.' : 'None of your data was changed.',
        )],
      })).then(
        () => undefined,
        (error: unknown) => safeLogger.error('Discord delete-data cancel failed', error),
      );
      activeOperations.add(operation);
      collector.stop('cancelled');
      return;
    }
    if (action === 'setup' && setupService) {
      const operation = handleSetup(
        component as unknown as ChatInputCommandInteraction,
        setupService,
        lifecycleSignal,
        setupPresentation,
      ).catch((error: unknown) => safeLogger.error('Dealio setup after deletion failed', error));
      activeOperations.add(operation);
      collector.stop('setup');
      return;
    }
    if (action !== 'confirm') {
      const operation = measureDiscordOperation(component, 'delete-data.button-ack', () => component.deferUpdate()).then(
        () => undefined,
        (error: unknown) => safeLogger.error('Discord delete-data acknowledgement failed', error),
      );
      activeOperations.add(operation);
      return;
    }
    const modalId = `delete-confirm:${sessionId}:${interaction.user.id}`;
    const operation = (async () => {
      await measureDiscordOperation(component, 'delete-data.modal', () => component.showModal(buildDeleteConfirmationModal(modalId, language)));
      if (!sessionActive) {
        return;
      }
      const modal = await Promise.race([
        component.awaitModalSubmit({
          time: dealioUiSessionTimeoutMs,
          filter: (submission) => submission.customId === modalId
            && submission.user.id === interaction.user.id,
        }).catch(() => null),
        sessionClosed.then(() => null),
      ]);
      if (!modal) return;
      const confirmed = modal.fields.getCheckboxGroup('delete-consent').includes('confirmed');
      if (!confirmed) {
        await measureDiscordOperation(modal, 'delete-data.modal-submit-ack', () => modal.reply({
          flags: dealioEphemeralV2Flags,
          components: [buildNoticePanel(language, 'warning',
            language === 'tr' ? 'Onay gerekli' : 'Confirmation required',
            language === 'tr' ? 'Veriler silinmedi.' : 'No data was deleted.')],
        }));
        return;
      }
      await measureDiscordOperation(modal, 'delete-data.modal-submit-ack', () => modal.deferUpdate());
      const deleted = await service.deleteData(interaction.user.id);
      await measureDiscordOperation(interaction, 'delete-data.render', () => interaction.editReply({
        components: [buildNoticePanel(
          language,
          deleted ? 'success' : 'info',
          deleted ? text.deleteSuccessTitle : text.deleteNoDataTitle,
          deleted
            ? (language === 'tr'
                ? 'Steam bağlantın, bildirim ayarların ve Dealio geçmişin kalıcı olarak silindi.'
                : 'Your Steam connection, alert settings, and Dealio history were permanently deleted.')
            : (language === 'tr' ? 'Hesabına ait aktif Dealio kaydı yok.' : 'There is no active Dealio record for your account.'),
          setupService
            ? { button: { customId: `delete-v2:${sessionId}:setup`, label: text.setupAgain, emoji: '✨' } }
            : {},
        )],
      }));
      if (!setupService) {
        collector.stop('completed');
      }
    })().catch((error: unknown) => safeLogger.error('Discord delete-data flow failed', error));
    activeOperations.add(operation);
  });

  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (lifecycleSignal?.aborted) {
    collector.stop('shutdown');
  }
  try {
    await sessionClosed;
    await Promise.all(activeOperations);
  } finally {
    sessionActive = false;
    closeUiSession();
    lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  }
}

function buildDeleteWarningPanel(language: 'tr' | 'en', sessionId: string): ContainerBuilder {
  const text = uiCopy(language);
  const container = new ContainerBuilder()
    .setAccentColor(dealioBrand.colors.danger)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# 🗑️ ${text.deleteTitle}`),
      new TextDisplayBuilder().setContent(`> ⚠️ ${text.deleteDescription}`),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`delete-v2:${sessionId}:confirm`).setLabel(text.deleteOpenConfirm).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`delete-v2:${sessionId}:cancel`).setLabel(text.deleteCancel).setStyle(ButtonStyle.Secondary),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}

function buildDeleteConfirmationModal(customId: string, language: 'tr' | 'en'): ModalBuilder {
  const text = uiCopy(language);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(text.deleteModalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(text.deleteConsentLabel)
        .setCheckboxGroupComponent(
          new CheckboxGroupBuilder()
            .setCustomId('delete-consent')
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              new CheckboxGroupOptionBuilder()
                .setLabel(text.deleteConsentOption.slice(0, 100))
                .setValue('confirmed'),
            ),
        ),
    );
}
