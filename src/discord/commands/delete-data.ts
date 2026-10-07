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
import type { Language } from '../../domain/user-config.js';
import { localizer } from '../i18n.js';
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
import { isFromUser } from '../ui/refused-interactions.js';

export const deleteDataCommand = new SlashCommandBuilder()
  .setName('delete-data')
  .setDescription('Permanently delete your Dealio data')
  .setDescriptionLocalizations({
    tr: 'Dealio verilerini kalıcı olarak sil',
    de: 'Deine Dealio-Daten endgültig löschen',
    fr: 'Supprimer définitivement tes données Dealio',
  });

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
  const t = localizer(language);
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
    filter: (component) => isFromUser(component, interaction.user.id)
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
          t({ tr: 'Vazgeçtin, sorun değil', en: 'No problem, nothing deleted', de: 'Kein Problem, nichts gelöscht', fr: 'Pas de souci, rien n’a été supprimé' }),
          t({
            tr: 'Verilerine dokunmadım, her şey olduğu gibi duruyor.',
            en: 'I didn’t touch your data; everything is just as it was.',
            de: 'Ich habe deine Daten nicht angerührt, alles bleibt, wie es war.',
            fr: 'Je n’ai pas touché à tes données, tout est resté comme avant.',
          }),
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
            && isFromUser(submission, interaction.user.id),
        }).catch(() => null),
        sessionClosed.then(() => null),
      ]);
      if (!modal) return;
      const confirmed = modal.fields.getCheckboxGroup('delete-consent').includes('confirmed');
      if (!confirmed) {
        await measureDiscordOperation(modal, 'delete-data.modal-submit-ack', () => modal.reply({
          flags: dealioEphemeralV2Flags,
          components: [buildNoticePanel(language, 'warning',
            t({ tr: 'Onay gerekiyor', en: 'Confirmation needed', de: 'Bestätigung nötig', fr: 'Confirmation nécessaire' }),
            t({
              tr: 'Kutucuğu işaretlemediğin için hiçbir şeyi silmedim.',
              en: 'You didn’t tick the box, so I didn’t delete anything.',
              de: 'Du hast das Kästchen nicht angehakt, deshalb habe ich nichts gelöscht.',
              fr: 'Tu n’as pas coché la case, donc je n’ai rien supprimé.',
            }))],
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
            ? t({
                tr: 'Steam bağlantını, bildirim ayarlarını ve Dealio geçmişini kalıcı olarak sildim. Yeniden görüşmek istersen buradayım.',
                en: 'I permanently deleted your Steam connection, alert settings and Dealio history. I’m here if you ever want to come back.',
                de: 'Ich habe deine Steam-Verbindung, deine Benachrichtigungseinstellungen und deinen Dealio-Verlauf endgültig gelöscht. Wenn du zurückkommen willst, bin ich da.',
                fr: 'J’ai supprimé définitivement ta connexion Steam, tes réglages d’alertes et ton historique Dealio. Je suis là si tu veux revenir.',
              })
            : t({
                tr: 'Bu hesaba ait bir Dealio kurulumu bulamadım. Kalan kullanım kayıtları varsa onları da sildim.',
                en: 'I couldn’t find a Dealio setup for your account. Any remaining usage records are deleted too.',
                de: 'Ich habe zu deinem Konto keine Dealio-Einrichtung gefunden. Eventuell verbliebene Nutzungsdaten habe ich ebenfalls gelöscht.',
                fr: 'Je n’ai trouvé aucune configuration Dealio pour ton compte. J’ai aussi supprimé les éventuelles données d’utilisation restantes.',
              }),
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

function buildDeleteWarningPanel(language: Language, sessionId: string): ContainerBuilder {
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

function buildDeleteConfirmationModal(customId: string, language: Language): ModalBuilder {
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
