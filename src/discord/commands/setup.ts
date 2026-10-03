import { measureDiscordOperation } from '../interaction-timing.js';
import type { InteractionEditReplyOptions } from 'discord.js';
import { safeLogger } from '../../application/safe-logger.js';
import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  InvalidUserConfigurationError,
  type PreparedUserConfiguration,
} from '../../application/user-configuration-service.js';
import { SetupAlreadyCompletedError } from '../../application/setup-service.js';
import type { SetupService } from '../../application/setup-service.js';
import { SteamWishlistError } from '../../domain/steam.js';
import { SteamIdentityError } from '../../domain/steam-identity.js';
import {
  parseStoreCountryCode,
} from '../../domain/store-country.js';
import type { Language } from '../../domain/user-config.js';
import {
  languageFromDiscordLocale,
  suggestedStoreCountryFromDiscordLocale,
} from '../language.js';
import { messagesFor } from '../messages.js';
import {
  buildSetupCompleteEmbed,
  buildSetupAlreadyCompletedEmbed,
  buildSetupCountrySelectOptions,
  buildSetupConfirmationComponents,
  buildSetupConfirmationEmbed,
  buildSetupWelcomeComponents,
  buildSetupWelcomeEmbed,
  canUseSetupComponent,
  parseSetupAction,
  type SetupPresentationOptions,
} from '../setup-view.js';
import {
  buildSetupAlreadyCompletedPanel,
  buildSetupCompletePanel,
  buildSetupConfirmationPanel,
  buildSetupWelcomePanel,
} from '../setup-view.js';
import {
  buildNoticePanel,
  dealioEphemeralV2Flags,
  dealioV2Flags,
} from '../ui/components-v2.js';
import { buildCountryListPanel, buildCountryRangePanel, buildCountrySearchModal, buildCountrySearchPanel } from '../ui/country-picker.js';
import { handOffPanel, type PanelNavigation } from '../ui/tab-bar.js';
import { dealioUiSessions } from '../ui/session-manager.js';

const setupSessionTimeoutMs = 5 * 60 * 1_000;

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Start the guided Steam wishlist setup')
  .setDescriptionLocalizations({
    tr: 'Rehberli Steam wishlist kurulumunu başlat',
  });

export async function handleSetup(
  interaction: ChatInputCommandInteraction,
  service: Pick<SetupService, 'configure' | 'prepare' | 'confirm'>
    & Partial<Pick<SetupService, 'hasExistingConfiguration'>>,
  lifecycleSignal?: AbortSignal,
  presentation: SetupPresentationOptions = {},
  ui: PanelNavigation = {},
): Promise<void> {
  const editPanel = (options: InteractionEditReplyOptions) => measureDiscordOperation(
    interaction, 'setup.render', () => interaction.editReply(options),
  );
  await measureDiscordOperation(interaction, 'setup.ack',
    () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const initialLanguage = languageFromDiscordLocale(interaction.locale ?? 'en-US');
  const avatarUrl = safeAvatarUrl(interaction);
  const viewOptions = { ...presentation, avatarUrl };
  if (service.hasExistingConfiguration?.(interaction.user.id)) {
    await editPanel({
      components: [buildSetupAlreadyCompletedPanel(initialLanguage, viewOptions)],
      flags: dealioV2Flags,
    });
    return;
  }

  const legacyProfile = safeGetString(interaction, 'steam-profile')
    ?? safeGetString(interaction, 'steamid64');
  if (legacyProfile) {
    await handleLegacySetup(interaction, service, legacyProfile);
    return;
  }

  let language = initialLanguage;
  const response = await editPanel({
    components: [buildSetupWelcomePanel(language, interaction.id, viewOptions)],
    flags: dealioV2Flags,
  });
  const closeUiSession = dealioUiSessions.open(
    interaction.id,
    interaction.user.id,
    ['setup', 'country'],
    setupSessionTimeoutMs,
  );
  const collector = response.createMessageComponentCollector({
    time: setupSessionTimeoutMs,
    filter: (component) => component.user.id === interaction.user.id
      && (canUseSetupComponent(component.customId, component.user.id, interaction.user.id, interaction.id)
        || component.customId.startsWith(`country:${interaction.id}:`)),
  });
  const localeCountry = suggestedStoreCountryFromDiscordLocale(interaction.locale ?? '') ?? 'US';
  let prepared: PreparedUserConfiguration | null = null;
  let completed = false;
  let sessionActive = true;
  let modalSequence = 0;
  let regionSelectionSource: 'discord-locale' | 'user' = 'discord-locale';
  let pendingProfileInput: string | null = null;
  let countrySelectionPurpose: 'initial' | 'change' | null = null;
  let operations = Promise.resolve();
  const concurrentOperations = new Set<Promise<void>>();
  const sessionClosed = new Promise<void>((resolve) => {
    collector.once('end', () => {
      sessionActive = false;
      resolve();
    });
  });
  const confirmationViewOptions = (): SetupPresentationOptions => ({
    ...viewOptions,
    regionSelectionSource,
  });
  const reportWizardFailure = async (error: unknown): Promise<void> => {
    safeLogger.error('Discord setup wizard failed', error);
    try {
      await editPanel({
        components: [buildSetupErrorPanel(error, language, interaction.id)],
      });
    } catch (_replyError: unknown) {
      safeLogger.error('Discord setup wizard error response failed.');
    }
  };
  let completedPanel: { readonly prepared: PreparedUserConfiguration; readonly status: Parameters<typeof buildSetupCompletePanel>[1] } | null = null;
  let handedOff = false;
  collector.on('collect', (component) => {
    const acknowledge = () => measureDiscordOperation(
      component, 'setup.button-ack', () => component.deferUpdate(),
    );
    if (component.customId === `setup:${interaction.id}:open`) {
      // Setup is done: hand this message to the Dealio panel instead of a dead end.
      if (completedPanel && ui.navigate) {
        handedOff = true;
        handOffPanel({ component, target: 'home', navigate: ui.navigate,
          stop: () => collector.stop('handoff'), settle: () => operations });
      } else {
        void acknowledge().catch(() => undefined);
      }
      return;
    }
    if (component.customId === `country:${interaction.id}:cancel` && component.isButton()) {
      const previousOperations = operations;
      const acknowledgement = acknowledge().then(
        () => ({ status: 'fulfilled' } as const),
        (error: unknown) => ({ status: 'rejected', error } as const),
      );
      operations = (async () => {
        const acknowledgementResult = await acknowledgement;
        await previousOperations;
        if (acknowledgementResult.status === 'rejected') {
          await reportWizardFailure(acknowledgementResult.error);
          return;
        }
        if (!sessionActive) {
          return;
        }
        // Cancelling the picker returns to where it was opened: the summary, or the start.
        countrySelectionPurpose = null;
        pendingProfileInput = null;
        await editPanel({
          components: [prepared
            ? buildSetupConfirmationPanel(prepared, interaction.id, confirmationViewOptions())
            : buildSetupWelcomePanel(language, interaction.id, viewOptions)],
        });
      })().catch(reportWizardFailure);
      return;
    }
    if (component.customId === `country:${interaction.id}:search` && component.isButton()) {
      const searchId = `setup-country-search:${interaction.id}:${++modalSequence}`;
      void (async () => {
        await measureDiscordOperation(component, 'setup.modal', () => component.showModal(buildCountrySearchModal(searchId, language)));
        const modal = await Promise.race([
          component.awaitModalSubmit({
            time: setupSessionTimeoutMs,
            filter: (submission) => submission.customId === searchId && submission.user.id === interaction.user.id,
          }).catch(() => null),
          sessionClosed.then(() => null),
        ]);
        if (!modal || !sessionActive) {
          return;
        }
        const query = modal.fields.getTextInputValue('country-query').trim();
        await measureDiscordOperation(modal, 'setup.modal-submit-ack', () => modal.deferUpdate());
        const previousOperations = operations;
        operations = (async () => {
          await previousOperations;
          if (sessionActive) {
            await editPanel({
              components: [buildCountrySearchPanel(language, interaction.id, query, prepared?.storeCountryCode)],
            });
          }
        })().catch(reportWizardFailure);
      })().catch(reportWizardFailure);
      return;
    }
    if (component.customId === `country:${interaction.id}:range` && component.isStringSelectMenu()) {
      const rangeIndex = Number(component.values[0]);
      const previousOperations = operations;
      const acknowledgement = acknowledge().then(
        () => ({ status: 'fulfilled' } as const),
        (error: unknown) => ({ status: 'rejected', error } as const),
      );
      operations = (async () => {
        const acknowledgementResult = await acknowledgement;
        await previousOperations;
        if (acknowledgementResult.status === 'rejected') {
          await reportWizardFailure(acknowledgementResult.error);
          return;
        }
        if (!sessionActive) {
          return;
        }
        await editPanel({
          components: [buildCountryListPanel(
            language,
            interaction.id,
            rangeIndex,
            prepared?.storeCountryCode,
          )],
        });
      })().catch(reportWizardFailure);
      return;
    }
    if (component.customId === `country:${interaction.id}:back` && component.isButton()) {
      const previousOperations = operations;
      const acknowledgement = acknowledge().then(
        () => ({ status: 'fulfilled' } as const),
        (error: unknown) => ({ status: 'rejected', error } as const),
      );
      operations = (async () => {
        const acknowledgementResult = await acknowledgement;
        await previousOperations;
        if (acknowledgementResult.status === 'rejected') {
          await reportWizardFailure(acknowledgementResult.error);
          return;
        }
        if (!sessionActive) {
          return;
        }
        await editPanel({
          components: [buildCountryRangePanel(language, interaction.id, { selected: prepared?.storeCountryCode ?? localeCountry })],
        });
      })().catch(reportWizardFailure);
      return;
    }
    if (component.customId === `country:${interaction.id}:select` && component.isStringSelectMenu()) {
      const selectedCountry = parseStoreCountryCode(component.values[0] ?? '');
      const purpose = countrySelectionPurpose;
      const profileInput = pendingProfileInput;
      const countrySelectionOperation = (async () => {
        await acknowledge();
        if (!sessionActive || !selectedCountry || !purpose) {
          return;
        }
        regionSelectionSource = 'user';
        if (purpose === 'change' && prepared) {
          prepared = { ...prepared, storeCountryCode: selectedCountry };
          countrySelectionPurpose = null;
          await editPanel({
            components: [buildSetupConfirmationPanel(
              prepared,
              interaction.id,
              confirmationViewOptions(),
            )],
          });
          return;
        }
        if (purpose === 'initial' && profileInput) {
          await editPanel({
            components: [buildNoticePanel(
              language,
              'info',
              language === 'tr' ? 'Steam hesabı doğrulanıyor' : 'Verifying Steam account',
              messagesFor(language).setupWizardPreparing,
            )],
          });
          if (!sessionActive) {
            return;
          }
          try {
            const nextPrepared = await service.prepare(
              interaction.user.id,
              profileInput,
              language,
              selectedCountry,
            );
            if (!sessionActive) {
              return;
            }
            prepared = nextPrepared;
            pendingProfileInput = null;
            countrySelectionPurpose = null;
            await editPanel({
              components: [buildSetupConfirmationPanel(
                prepared,
                interaction.id,
                confirmationViewOptions(),
              )],
            });
          } catch (error: unknown) {
            if (!sessionActive) {
              return;
            }
            pendingProfileInput = null;
            countrySelectionPurpose = null;
            await editPanel({
              components: [buildSetupErrorPanel(error, language, interaction.id)],
            });
          }
        }
      })().catch((error: unknown) => safeLogger.error('Discord setup country selection failed', error));
      concurrentOperations.add(countrySelectionOperation);
      void countrySelectionOperation.then(
        () => concurrentOperations.delete(countrySelectionOperation),
        () => concurrentOperations.delete(countrySelectionOperation),
      );
      return;
    }
    const immediateAction = parseSetupAction(component.customId, interaction.id);
    if (immediateAction === 'start') {
      const sequence = ++modalSequence;
      const modalOperation = (async () => {
        if (completed || !sessionActive) {
          await acknowledge().catch(() => undefined);
          return;
        }
        const modalId = `setup-modal:${interaction.id}:${interaction.user.id}:${sequence}`;
        const suggestedCountry = suggestedStoreCountryFromDiscordLocale(
          interaction.locale ?? '',
        ) ?? 'US';
        await measureDiscordOperation(component, 'setup.modal',
          () => component.showModal(buildSetupModal(modalId, language, suggestedCountry)));
        if (!sessionActive) {
          return;
        }
        const modal = await Promise.race([
          component.awaitModalSubmit({
            time: setupSessionTimeoutMs,
            filter: (submission) => submission.customId === modalId
              && submission.user.id === interaction.user.id,
          }).catch(() => null),
          sessionClosed.then(() => null),
        ]);
        if (!modal || !sessionActive) {
          return;
        }
        await measureDiscordOperation(modal, 'setup.modal-submit-ack', () => modal.deferUpdate());
        if (sequence !== modalSequence || completed || !sessionActive) {
          return;
        }
        const messages = messagesFor(language);
        const selectedValue = modal.fields.getStringSelectValues('store-country')[0] ?? '';
        const profileInput = modal.fields.getTextInputValue('steam-profile');
        if (selectedValue === 'OTHER') {
          pendingProfileInput = profileInput;
          countrySelectionPurpose = 'initial';
          regionSelectionSource = 'user';
          await editPanel({
            components: [buildCountryRangePanel(language, interaction.id, { selected: prepared?.storeCountryCode ?? localeCountry })],
          });
          return;
        }
        await editPanel({
          flags: dealioV2Flags,
          components: [buildNoticePanel(
            language,
            'info',
            language === 'tr' ? 'Steam hesabı doğrulanıyor' : 'Verifying Steam account',
            messages.setupWizardPreparing,
          )],
        });
        try {
          const selectedCountry = parseStoreCountryCode(
            selectedValue,
          ) ?? suggestedCountry;
          const nextPrepared = await service.prepare(
            interaction.user.id,
            profileInput,
            language,
            selectedCountry,
          );
          if (sequence !== modalSequence || completed || !sessionActive) {
            return;
          }
          prepared = nextPrepared;
          regionSelectionSource = selectedCountry === suggestedCountry
            ? 'discord-locale'
            : 'user';
        } catch (error: unknown) {
          if (sequence !== modalSequence || completed || !sessionActive) {
            return;
          }
          await editPanel(error instanceof SetupAlreadyCompletedError
            ? {
                components: [buildSetupAlreadyCompletedPanel(language, viewOptions)],
              }
            : {
                components: [buildSetupErrorPanel(error, language, interaction.id)],
              });
          return;
        }
        await editPanel({
          components: [buildSetupConfirmationPanel(
            prepared,
            interaction.id,
            confirmationViewOptions(),
          )],
        });
      })().catch(async (error: unknown) => {
        safeLogger.error('Discord setup modal failed', error);
        if (!sessionActive) {
          return;
        }
        await editPanel({
          components: [buildSetupErrorPanel(error, language, interaction.id)],
        }).catch(() => undefined);
      });
      concurrentOperations.add(modalOperation);
      void modalOperation.then(
        () => concurrentOperations.delete(modalOperation),
        () => concurrentOperations.delete(modalOperation),
      );
      return;
    }

    if (immediateAction === 'region') {
      const regionOperation = (async () => {
        await acknowledge();
        if (!prepared || completed || !sessionActive) {
          return;
        }
        countrySelectionPurpose = 'change';
        await editPanel({
          components: [buildCountryRangePanel(language, interaction.id, { selected: prepared?.storeCountryCode ?? localeCountry })],
        });
      })().catch(async (error: unknown) => {
        safeLogger.error('Discord setup region picker failed', error);
        if (sessionActive) {
          await editPanel({
            components: [buildSetupErrorPanel(error, language, interaction.id)],
          }).catch(() => undefined);
        }
      });
      concurrentOperations.add(regionOperation);
      void regionOperation.then(
        () => concurrentOperations.delete(regionOperation),
        () => concurrentOperations.delete(regionOperation),
      );
      return;
    }

    // Acknowledge on receipt, not after earlier edits or Steam work finish.
    // Observe rejection immediately even while this action waits for the panel.
    const acknowledgement = acknowledge().then(
      () => ({ status: 'fulfilled' } as const),
      (error: unknown) => ({ status: 'rejected', error } as const),
    );
    operations = operations.then(async () => {
      const outcome = await acknowledgement;
      const action = parseSetupAction(component.customId, interaction.id);
      if (completed) {
        return;
      }
      if (outcome.status === 'rejected') throw outcome.error;
      if (action === 'how') {
        await editPanel({
          components: [buildSetupWelcomePanel(language, interaction.id, viewOptions, true)],
        });
        return;
      }
      if (action === 'language' && prepared) {
        language = prepared.language === 'tr' ? 'en' : 'tr';
        prepared = { ...prepared, language };
        await editPanel({
          components: [buildSetupConfirmationPanel(
            prepared,
            interaction.id,
            confirmationViewOptions(),
          )],
        });
        return;
      }
      if (action === 'cancel') {
        completed = true;
        collector.stop('cancelled');
        await editPanel({
          components: [buildNoticePanel(
            language,
            'info',
            language === 'tr' ? 'Kurulum iptal edildi' : 'Setup cancelled',
            messagesFor(language).setupWizardCancelled,
          )],
        });
        return;
      }
      if (action === 'confirm' && prepared) {
        completed = true;
        await editPanel({
          components: [buildSetupConfirmationPanel(
            prepared,
            interaction.id,
            confirmationViewOptions(),
            true,
          )],
        });
        const result = await service.confirm(prepared);
        completedPanel = { prepared, status: result.summary.status };
        await editPanel({
          components: [buildSetupCompletePanel(prepared, result.summary.status, viewOptions, ui.navigate ? interaction.id : undefined)],
        });
        if (!ui.navigate) collector.stop('completed');
        return;
      }
    }).catch(reportWizardFailure);
  });

  const stopForShutdown = (): void => collector.stop('shutdown');
  lifecycleSignal?.addEventListener('abort', stopForShutdown, { once: true });
  if (lifecycleSignal?.aborted) {
    collector.stop('shutdown');
  }
  await sessionClosed;
  closeUiSession();
  await operations;
  await Promise.all(concurrentOperations);
  lifecycleSignal?.removeEventListener('abort', stopForShutdown);
  const finished = completedPanel as { readonly prepared: PreparedUserConfiguration; readonly status: Parameters<typeof buildSetupCompletePanel>[1] } | null;
  if (finished && ui.navigate && !handedOff) {
    // The session ended without opening the panel: remove the button rather than leave it dead.
    await editPanel({ components: [buildSetupCompletePanel(finished.prepared, finished.status, viewOptions)] }).catch(() => undefined);
  }
  if (!completed) {
    const expiredPrepared = prepared as PreparedUserConfiguration | null;
    try {
      await editPanel({
        components: expiredPrepared
          ? [buildSetupConfirmationPanel(
              expiredPrepared,
              interaction.id,
              confirmationViewOptions(),
              true,
            )]
          : [buildSetupWelcomePanel(language, interaction.id, viewOptions, false, true)],
      });
    } catch (_error: unknown) {
      // Expired Discord interactions cannot be edited.
    }
  }
}

function buildSetupModal(
  customId: string,
  language: Language,
  suggestedCountry: Parameters<typeof buildSetupCountrySelectOptions>[1],
): ModalBuilder {
  const messages = messagesFor(language);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(messages.setupWizardModalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(messages.setupWizardProfileLabel)
        .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('steam-profile')
          .setPlaceholder(messages.setupWizardProfilePlaceholder)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200),
      ),
      new LabelBuilder()
        .setLabel(messages.setupWizardCountryLabel)
        .setDescription(messages.setupWizardRegionSuggested)
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('store-country')
            .setPlaceholder(messages.setupWizardCountryPickerPlaceholder)
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
            .addOptions(buildSetupCountrySelectOptions(language, suggestedCountry)),
        ),
    );
}

function buildSetupRegionModal(
  customId: string,
  language: Language,
  currentCountry: Parameters<typeof buildSetupCountrySelectOptions>[1],
): ModalBuilder {
  const messages = messagesFor(language);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(messages.setupWizardRegionModalTitle)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(messages.setupWizardCountryLabel)
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('store-country')
            .setPlaceholder(messages.setupWizardCountryPickerPlaceholder)
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
            .addOptions(buildSetupCountrySelectOptions(language, currentCountry)),
        ),
    );
}

async function handleLegacySetup(
  interaction: ChatInputCommandInteraction,
  service: Pick<SetupService, 'configure'>,
  profileInput: string,
): Promise<void> {
  const rawLanguage = safeGetString(interaction, 'language');
  const language: Language = rawLanguage === 'en' ? 'en' : 'tr';
  const storeCountry = safeGetString(interaction, 'store-country') ?? undefined;
  try {
    const { config, summary } = await service.configure(
      interaction.user.id,
      profileInput,
      language,
      storeCountry,
    );
    const messages = messagesFor(config.language);
    const summaryMessage = summary.status === 'sent'
      ? messages.setupSummarySent
      : summary.status === 'dm-blocked'
        ? messages.setupWizardDmBlocked
        : summary.status === 'dm-transient-failed'
          ? messages.setupWizardDmTransient
          : messages.setupSummaryUnavailable;
    await interaction.editReply({
      flags: dealioV2Flags,
      components: [buildNoticePanel(
        config.language,
        summary.status === 'sent' ? 'success' : 'warning',
        config.language === 'tr' ? 'Kurulum tamamlandı' : 'Setup complete',
        `${messages.setupSuccess} ${summaryMessage}`,
      )],
    });
  } catch (error: unknown) {
    await interaction.editReply({
      flags: dealioV2Flags,
      components: [buildSetupErrorPanel(error, language, interaction.id)],
    });
  }
}

function buildSetupErrorPanel(
  error: unknown,
  language: Language,
  sessionId: string,
) {
  return buildNoticePanel(
    language,
    'danger',
    language === 'tr' ? 'Kurulum tamamlanamadı' : 'Setup could not be completed',
    setupErrorMessage(error, language),
    {
      button: {
        customId: `setup:${sessionId}:start`,
        label: messagesFor(language).setupWizardStart,
        emoji: '🔄',
      },
    },
  );
}

function setupErrorMessage(error: unknown, language: Language): string {
  const messages = messagesFor(language);
  if (error instanceof SetupAlreadyCompletedError) {
    return messages.setupWizardAlreadyCompletedDescription;
  }
  if (error instanceof InvalidUserConfigurationError) {
    return error.code === 'INVALID_STORE_COUNTRY'
      ? messages.invalidStoreCountry
      : messages.invalidSetup;
  }
  if (error instanceof SteamIdentityError) {
    return error.code === 'STEAM_PROFILE_INVALID'
      ? messages.invalidSteamProfile
      : error.code === 'STEAM_VANITY_NOT_FOUND'
        ? messages.vanityProfileNotFound
        : error.code === 'STEAM_WEB_API_KEY_MISSING'
          ? messages.steamWebApiKeyMissing
          : messages.vanityResolutionUnavailable;
  }
  if (error instanceof SteamWishlistError) {
    return error.code === 'STEAM_WISHLIST_INACCESSIBLE'
      ? messages.wishlistInaccessible
      : messages.setupValidationUnavailable;
  }
  return language === 'tr'
    ? 'Kurulum şu anda tamamlanamadı. Lütfen daha sonra tekrar dene.'
    : 'Setup could not be completed right now. Please try again later.';
}

function safeGetString(
  interaction: ChatInputCommandInteraction,
  name: string,
): string | null {
  try {
    return interaction.options.getString(name);
  } catch (_error: unknown) {
    return null;
  }
}

function safeAvatarUrl(interaction: ChatInputCommandInteraction): string | undefined {
  try {
    return interaction.client.user?.displayAvatarURL({ extension: 'png', size: 128 });
  } catch (_error: unknown) {
    return undefined;
  }
}
