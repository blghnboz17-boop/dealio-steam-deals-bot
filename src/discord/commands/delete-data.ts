import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  ContainerBuilder,
  LabelBuilder,
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
  buildExpiredPanel,
  buildNoticePanel,
  dealioEphemeralV2Flags,
  dealioFooter,
  dealioUiSessionTimeoutMs,
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
  const config = service.get(interaction.user.id);
  const language = config?.language ?? languageFromDiscordLocale(interaction.locale);
  const text = uiCopy(language);
  const sessionId = interaction.id;
  const message = await interaction.reply({
    flags: dealioEphemeralV2Flags,
    components: [buildDeleteWarningPanel(language, sessionId)],
  });
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

  collector.on('collect', (component) => {
    const action = component.customId.slice(`delete-v2:${sessionId}:`.length);
    if (action === 'cancel') {
      void component.update({
        components: [buildNoticePanel(
          language,
          'info',
          language === 'tr' ? 'Silme işlemi iptal edildi' : 'Deletion cancelled',
          language === 'tr' ? 'Hiçbir verin değiştirilmedi.' : 'None of your data was changed.',
        )],
      });
      collector.stop('cancelled');
      return;
    }
    if (action === 'setup' && setupService) {
      collector.stop('setup');
      void handleSetup(
        component as unknown as ChatInputCommandInteraction,
        setupService,
        lifecycleSignal,
        setupPresentation,
      ).catch((error: unknown) => console.error('Dealio setup after deletion failed', error));
      return;
    }
    if (action !== 'confirm') {
      void component.deferUpdate();
      return;
    }
    const modalId = `delete-confirm:${sessionId}:${interaction.user.id}`;
    void (async () => {
      await component.showModal(buildDeleteConfirmationModal(modalId, language));
      const modal = await component.awaitModalSubmit({
        time: dealioUiSessionTimeoutMs,
        filter: (submission) => submission.customId === modalId
          && submission.user.id === interaction.user.id,
      }).catch(() => null);
      if (!modal) return;
      if (!sessionActive) {
        await modal.reply({
          flags: dealioEphemeralV2Flags,
          components: [buildExpiredPanel(language)],
        });
        return;
      }
      const confirmed = modal.fields.getCheckboxGroup('delete-consent').includes('confirmed');
      if (!confirmed) {
        await modal.reply({
          flags: dealioEphemeralV2Flags,
          components: [buildNoticePanel(language, 'warning',
            language === 'tr' ? 'Onay gerekli' : 'Confirmation required',
            language === 'tr' ? 'Veriler silinmedi.' : 'No data was deleted.')],
        });
        return;
      }
      await modal.deferUpdate();
      const deleted = await service.deleteData(interaction.user.id);
      await interaction.editReply({
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
      });
      if (!setupService) {
        collector.stop('completed');
      }
    })().catch((error: unknown) => console.error('Discord delete-data flow failed', error));
  });

  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  try {
    await new Promise<void>((resolve) => collector.once('end', () => resolve()));
    sessionActive = false;
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
